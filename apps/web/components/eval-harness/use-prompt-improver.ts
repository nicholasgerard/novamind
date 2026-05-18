"use client";

import { useCallback, useState } from "react";
import { fetchDemoApi, responseNeedsAccess } from "@/lib/demo-api-fetch";
import { useAbortableRequest } from "@/lib/use-abortable-request";
import { PLAN_STABILITY_METRICS } from "./baseline-data";
import { averageCompletedScores } from "./run-snapshots";
import type { CurrentRun, BaselineSnapshot } from "./types";

export interface ImprovementResult {
  rationale: string;
  targetedMetric: string;
  /** Total cost of the improver call. */
  costUsd?: number;
}

export interface UsePromptImprover {
  improving: boolean;
  improvement: ImprovementResult | null;
  error: string | null;
  improve: (args: {
    currentPrompt: string;
    baseline: BaselineSnapshot;
    current: CurrentRun | null;
  }) => Promise<string | null>;
  dismiss: () => void;
}

/**
 * Calls /api/eval/improve to ask Claude (Sonnet) to refine the system prompt
 * based on the most recent eval results. Builds a `RunSummary` from the
 * current run if it completed, else falls back to the baseline. Returns the
 * proposed new prompt (caller applies it).
 */
export function usePromptImprover({
  onAccessRequired,
}: {
  onAccessRequired?: () => void;
} = {}): UsePromptImprover {
  const { clearCurrent, startRequest } = useAbortableRequest();
  const [improving, setImproving] = useState(false);
  const [improvement, setImprovement] = useState<ImprovementResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const improve = useCallback(
    async (args: {
      currentPrompt: string;
      baseline: BaselineSnapshot;
      current: CurrentRun | null;
    }): Promise<string | null> => {
      const controller = startRequest();
      setImproving(true);
      setError(null);
      setImprovement(null);

      const runSummary = buildRunSummary(args.baseline, args.current);

      try {
        const res = await fetchDemoApi("/api/eval/improve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            currentPrompt: args.currentPrompt,
            runSummary,
          }),
          signal: controller.signal,
        });
        if (responseNeedsAccess(res)) {
          onAccessRequired?.();
          return null;
        }
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
        }
        const data = await res.json();
        if (typeof data?.error === "string") throw new Error(data.error);
        if (typeof data?.newPrompt !== "string") {
          throw new Error("improver returned no newPrompt");
        }
        setImprovement({
          rationale: data.rationale ?? "",
          targetedMetric: data.targetedMetric ?? "",
          costUsd: data.usage?.costUsd,
        });
        return data.newPrompt as string;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return null;
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        if (clearCurrent(controller)) setImproving(false);
      }
    },
    [clearCurrent, onAccessRequired, startRequest],
  );

  const dismiss = useCallback(() => {
    setImprovement(null);
    setError(null);
  }, []);

  return { improving, improvement, error, improve, dismiss };
}

function buildRunSummary(
  baseline: BaselineSnapshot,
  current: CurrentRun | null,
) {
  if (current && current.phase === "complete") {
    const completedCases = current.cases.filter(
      (c) => c.status === "complete" && c.scores,
    );
    if (completedCases.length === 0) return baselineRunSummary(baseline);
    return {
      axis: baseline.axis,
      averageScores: averageCompletedScores(
        current.cases,
        PLAN_STABILITY_METRICS,
      ),
      cases: completedCases.map((c) => {
        const outputSummary = summarizePlanCaseOutput(c.output);
        return {
          caseId: c.caseId,
          question: c.label,
          scores: c.scores!,
          ...outputSummary,
        };
      }),
    };
  }
  return baselineRunSummary(baseline);
}

function baselineRunSummary(baseline: BaselineSnapshot) {
  return {
    axis: baseline.axis,
    averageScores: baseline.averageScores,
    cases: baseline.cases.map((c) => ({
      caseId: c.caseId,
      question: c.label,
      scores: c.scores,
    })),
  };
}

function summarizePlanCaseOutput(output: unknown): {
  hypothesis?: string;
  gradingNotes?: Record<string, string>;
} {
  const record = asRecord(output);
  if (!record) return {};
  const result = asRecord(record.result);
  const hypothesis =
    typeof result?.hypothesis === "string" ? result.hypothesis : undefined;
  const gradingNotes = stringRecord(record.gradingNotes);
  const compactNotes = Object.fromEntries(
    Object.entries(gradingNotes)
      .map(([metric, note]) => [metric, truncate(note, 700)] as const)
      .filter(([, note]) => note.length > 0),
  );
  return {
    ...(hypothesis ? { hypothesis: truncate(hypothesis, 800) } : {}),
    ...(Object.keys(compactNotes).length > 0
      ? { gradingNotes: compactNotes }
      : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
