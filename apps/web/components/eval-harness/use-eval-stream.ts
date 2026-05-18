"use client";

import { useCallback, useReducer } from "react";
import {
  isEvalTerminalEventPayload,
  parseEvalStreamEvent,
} from "@/lib/client-stream-events";
import { fetchDemoApi, responseNeedsAccess } from "@/lib/demo-api-fetch";
import { readJsonSseStream } from "@/lib/sse-client";
import { useAbortableRequest } from "@/lib/use-abortable-request";
import type { EvalStreamEvent } from "@novamind/shared/eval-events";
import { ZERO_USAGE, addUsage } from "@novamind/shared/usage";
import type { BaselineSnapshot, CaseState, CurrentRun } from "./types";

interface State {
  current: CurrentRun | null;
}

type Action =
  | {
      type: "RUN_STARTED";
      baseline: BaselineSnapshot;
      runningCaseCount: number;
    }
  | { type: "EVENT"; event: EvalStreamEvent }
  | { type: "RUN_ERROR"; message: string }
  | { type: "RUN_STREAM_ENDED" }
  | { type: "RUN_RESET" };

const initialState: State = { current: null };
const FIRST_STREAM_EVENT_TIMEOUT_MS = 20_000;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "RUN_STARTED": {
      const startedAt = Date.now();
      const cases: CaseState[] = action.baseline.cases.map((b, index) => ({
        caseId: b.caseId,
        index: b.index,
        label: b.label,
        status: index < action.runningCaseCount ? "running" : "pending",
        startedAt: index < action.runningCaseCount ? startedAt : undefined,
      }));
      return {
        current: {
          phase: "starting",
          cases,
          startedAt,
          totalUsage: { ...ZERO_USAGE },
        },
      };
    }

    case "EVENT":
      return { current: applyEvent(state.current, action.event) };

    case "RUN_ERROR":
      return {
        current: state.current
          ? {
              ...state.current,
              cases: markUnfinishedCasesErrored(
                state.current.cases,
                action.message,
              ),
              completedAt: Date.now(),
              phase: "error",
              error: action.message,
            }
          : null,
      };

    case "RUN_STREAM_ENDED": {
      // The fetch stream closed. If we never received eval_complete (e.g.
      // network drop, agent crash), surface that and mark unfinished cases
      // as errored so the UI doesn't sit in "running" indefinitely.
      if (!state.current) return state;
      if (
        state.current.phase === "complete" ||
        state.current.phase === "error"
      ) {
        return state;
      }
      const cases = state.current.cases.map((c) =>
        c.status === "pending" || c.status === "running"
          ? { ...c, status: "error" as const, error: "stream ended" }
          : c,
      );
      return {
        current: {
          ...state.current,
          cases,
          completedAt: Date.now(),
          phase: "error",
          error:
            "Eval stream ended before completion. The agent may have restarted or the network dropped.",
        },
      };
    }

    case "RUN_RESET":
      return initialState;
  }
}

function markUnfinishedCasesErrored(
  cases: readonly CaseState[],
  message: string,
): CaseState[] {
  return cases.map((c) =>
    c.status === "pending" || c.status === "running"
      ? { ...c, status: "error" as const, error: message }
      : c,
  );
}

function applyEvent(
  current: CurrentRun | null,
  event: EvalStreamEvent,
): CurrentRun | null {
  if (!current) return current;

  switch (event.type) {
    case "eval_started":
      return { ...current, phase: "running" };

    case "eval_case_started": {
      const cases = current.cases.map((c) =>
        c.caseId === event.caseId
          ? { ...c, status: "running" as const, startedAt: event.ts }
          : c,
      );
      return { ...current, cases };
    }

    case "eval_case_complete": {
      const cases = current.cases.map((c) =>
        c.caseId === event.caseId
          ? {
              ...c,
              status: event.error ? ("error" as const) : ("complete" as const),
              scores: event.scores,
              output: event.output,
              usage: event.usage,
              elapsedMs: event.elapsedMs,
              error: event.error,
              completedAt: event.ts,
            }
          : c,
      );
      return {
        ...current,
        cases,
        totalUsage: addUsage(current.totalUsage, event.usage),
      };
    }

    case "eval_complete":
      return {
        ...current,
        phase: "complete",
        averageScores: event.averageScores,
        totalUsage: event.totalUsage,
        completedAt: event.ts,
      };

    case "eval_error":
      return {
        ...current,
        cases: markUnfinishedCasesErrored(current.cases, event.message),
        completedAt: event.ts,
        phase: "error",
        error: event.message,
      };
  }
}

export interface RunRequest {
  axis: "plan-stability" | "citation-accuracy";
  hypothesisSystemPrompt?: string;
  caseIds?: string[];
  concurrency?: number;
  limit?: number;
}

export interface UseEvalStream {
  current: CurrentRun | null;
  start: (req: RunRequest, baseline: BaselineSnapshot) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

/**
 * React hook that drives a streaming `/api/eval/run` request and exposes the
 * resulting `CurrentRun` state. Components that show wall-clock elapsed time
 * own their local tickers so streaming Monaco/chart state only re-renders on
 * actual SSE updates.
 */
export function useEvalStream({
  onAccessRequired,
}: {
  onAccessRequired?: () => void;
} = {}): UseEvalStream {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { abortCurrent, clearCurrent, startRequest } = useAbortableRequest();

  const start = useCallback(
    async (req: RunRequest, baseline: BaselineSnapshot) => {
      const controller = startRequest();
      const runningCaseCount = Math.min(
        req.concurrency ?? 1,
        baseline.cases.length,
      );
      let sawStreamEvent = false;
      let timedOutBeforeFirstEvent = false;
      const firstEventTimer = window.setTimeout(() => {
        if (sawStreamEvent || controller.signal.aborted) return;
        timedOutBeforeFirstEvent = true;
        dispatch({
          type: "RUN_ERROR",
          message:
            "Eval stream did not send a first event within 20 seconds. The request may be stuck before the agent started scoring cases.",
        });
        controller.abort();
      }, FIRST_STREAM_EVENT_TIMEOUT_MS);

      dispatch({ type: "RUN_STARTED", baseline, runningCaseCount });

      try {
        const res = await fetchDemoApi("/api/eval/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(req),
          signal: controller.signal,
        });

        if (responseNeedsAccess(res)) {
          dispatch({ type: "RUN_RESET" });
          onAccessRequired?.();
          return;
        }
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
        }
        if (!res.body) throw new Error("No response body");

        await readJsonSseStream({
          body: res.body,
          isTerminalEventPayload: isEvalTerminalEventPayload,
          parseEvent: parseEvalStreamEvent,
          streamName: "eval-stream",
          onEvent: (event) => {
            sawStreamEvent = true;
            window.clearTimeout(firstEventTimer);
            dispatch({ type: "EVENT", event });
          },
        });
        dispatch({ type: "RUN_STREAM_ENDED" });
      } catch (err) {
        if (
          err instanceof Error &&
          err.name === "AbortError" &&
          timedOutBeforeFirstEvent
        ) {
          return;
        }
        if (err instanceof Error && err.name === "AbortError") return;
        dispatch({
          type: "RUN_ERROR",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        window.clearTimeout(firstEventTimer);
        clearCurrent(controller);
      }
    },
    [clearCurrent, onAccessRequired, startRequest],
  );

  const cancel = useCallback(() => {
    abortCurrent();
    dispatch({ type: "RUN_RESET" });
  }, [abortCurrent]);

  const reset = useCallback(() => {
    abortCurrent();
    dispatch({ type: "RUN_RESET" });
  }, [abortCurrent]);

  return { current: state.current, start, cancel, reset };
}
