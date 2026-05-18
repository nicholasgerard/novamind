"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccessGate } from "@/components/access-gate";
import {
  clearCachedHillClimbState,
  readCachedHillClimbState,
  writeCachedHillClimbState,
} from "@/lib/demo-run-cache";
import {
  PLAN_STABILITY_LIVE_BASELINE,
  PLAN_STABILITY_LIVE_CASE_COUNT,
  PLAN_STABILITY_LIVE_CASE_IDS,
  PLAN_STABILITY_METRICS,
  synthesisGuardrailScore,
} from "./baseline-data";
import { CaseInspector } from "./case-inspector";
import { HillClimbChart, type HillClimbPoint } from "./hill-climb-chart";
import { ImprovementModal } from "./improvement-modal";
import {
  ImproveErrorMessage,
  PromptActions,
  PromptEditorFallback,
} from "./prompt-actions";
import { buildPromptHighlights } from "./prompt-highlights";
import type { PromptEditorProps } from "./prompt-editor";
import { averageCompletedScores, buildLiveRunSnapshot } from "./run-snapshots";
import { scrollPromptPanelToStickyStart } from "./sticky-scroll";
import type { RunSnapshot } from "./types";
import { useEvalStream } from "./use-eval-stream";
import { usePromptImprover } from "./use-prompt-improver";

const PromptEditor = dynamic<PromptEditorProps>(
  () => import("./prompt-editor").then((module) => module.PromptEditor),
  {
    ssr: false,
    loading: () => <PromptEditorFallback />,
  },
);

const CACHE_WRITE_DEBOUNCE_MS = 250;

/**
 * Stage 08 eval console. The workbench centers the editable hypothesis prompt,
 * with the chart absorbing metric comparison and the case inspector explaining
 * what happened on each run.
 */
export function EvalHarness() {
  const { requireAccess, showLogin } = useAccessGate();
  const baseline = PLAN_STABILITY_LIVE_BASELINE;
  const baselinePending = baseline.capturedAt === "pending";
  const baselineScore = synthesisGuardrailScore(baseline.averageScores);
  const cachedState = readCachedHillClimbState();
  const initialHistory = useMemo<ReadonlyArray<HillClimbPoint>>(
    () => [
      {
        id: baselinePending ? "pending-baseline" : "baseline",
        label: baselinePending ? "pending" : "v0",
        score: baselinePending ? 0.5 : baselineScore,
        scores: baselinePending ? undefined : baseline.averageScores,
        pending: baselinePending,
      },
    ],
    [baseline.averageScores, baselinePending, baselineScore],
  );
  const [prompt, setPrompt] = useState(
    () => cachedState?.prompt ?? baseline.hypothesisSystemPrompt,
  );
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(
    () => cachedState?.selectedCaseId ?? baseline.cases[0]?.caseId ?? null,
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    () => cachedState?.selectedRunId ?? null,
  );
  const [completedRuns, setCompletedRuns] = useState<
    ReadonlyArray<RunSnapshot>
  >(() => cachedState?.completedRuns ?? []);
  const [improvementModalOpen, setImprovementModalOpen] = useState(false);
  const [history, setHistory] = useState<ReadonlyArray<HillClimbPoint>>(
    () => cachedState?.history ?? initialHistory,
  );
  const [diffBasePrompt, setDiffBasePrompt] = useState<string | null>(
    () => cachedState?.diffBasePrompt ?? null,
  );
  const promptPanelRef = useRef<HTMLDivElement | null>(null);
  const runPromptRef = useRef(prompt);
  const capturedRunRef = useRef<number | null>(null);
  const {
    current,
    start,
    cancel,
    reset: resetCurrentRun,
  } = useEvalStream({
    onAccessRequired: () => showLogin({ resetAccessHint: true }),
  });
  const {
    improving,
    improvement,
    error: improveError,
    improve,
    dismiss,
  } = usePromptImprover({
    onAccessRequired: () => showLogin({ resetAccessHint: true }),
  });

  const running = current?.phase === "running" || current?.phase === "starting";
  const failedCaseCount =
    current?.cases.filter((c) => c.status === "error").length ?? 0;
  const completedCaseCount =
    current?.cases.filter((c) => c.status === "complete" && c.scores).length ??
    0;
  const runTerminal =
    current?.phase === "complete" || current?.phase === "error";
  const scorableRunComplete = Boolean(runTerminal && completedCaseCount > 0);
  const improvedPromptQueued = Boolean(
    improvement && prompt !== runPromptRef.current && !running,
  );
  const hasPersistableHillClimbState = Boolean(
    completedRuns.length > 0 ||
    prompt !== baseline.hypothesisSystemPrompt ||
    diffBasePrompt ||
    selectedRunId,
  );
  const resetAvailable = Boolean(
    hasPersistableHillClimbState ||
    current ||
    improvement ||
    improveError ||
    selectedCaseId !== (baseline.cases[0]?.caseId ?? null),
  );

  useEffect(() => {
    if (!hasPersistableHillClimbState) {
      clearCachedHillClimbState();
      return;
    }
    const timer = window.setTimeout(() => {
      writeCachedHillClimbState({
        completedRuns: [...completedRuns],
        diffBasePrompt,
        history: [...history],
        prompt,
        selectedCaseId,
        selectedRunId,
        updatedAt: Date.now(),
      });
    }, CACHE_WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    completedRuns,
    diffBasePrompt,
    hasPersistableHillClimbState,
    history,
    prompt,
    selectedCaseId,
    selectedRunId,
  ]);

  useEffect(() => {
    if (improvement) setImprovementModalOpen(true);
  }, [improvement]);

  useEffect(() => {
    if (
      !runTerminal ||
      completedCaseCount === 0 ||
      capturedRunRef.current === current.startedAt
    ) {
      return;
    }
    capturedRunRef.current = current.startedAt;

    const scores = averageCompletedScores(
      current.cases,
      PLAN_STABILITY_METRICS,
    );
    const score = synthesisGuardrailScore(scores);
    const runNumber = completedRuns.length;
    const label = runNumber === 0 ? "v0" : `run ${runNumber}`;
    const edited = runPromptRef.current !== baseline.hypothesisSystemPrompt;
    const partial = failedCaseCount > 0;
    const snapshot: RunSnapshot = {
      id: `run-${current.startedAt}`,
      label,
      note: partial
        ? `${completedCaseCount}/${PLAN_STABILITY_LIVE_CASE_COUNT} cases scored`
        : edited
          ? "Edited synthesis prompt scored"
          : "Baseline prompt run",
      prompt: runPromptRef.current,
      score,
      scores,
      cases: current.cases,
      startedAt: current.startedAt,
      completedAt: current.completedAt,
      elapsedMs: current.completedAt
        ? current.completedAt - current.startedAt
        : undefined,
      totalUsage: current.totalUsage,
    };

    setCompletedRuns((prev) => [...prev, snapshot]);
    setSelectedRunId(snapshot.id);
    setSelectedCaseId((prev) => prev ?? baseline.cases[0]?.caseId ?? null);
    setHistory((prev) => {
      const nextPoint: HillClimbPoint = {
        id: snapshot.id,
        label: snapshot.label,
        score: snapshot.score,
        scores: snapshot.scores,
      };
      return prev[0]?.pending ? [nextPoint] : [...prev, nextPoint];
    });
  }, [
    baseline.cases,
    baseline.hypothesisSystemPrompt,
    completedCaseCount,
    completedRuns.length,
    current,
    failedCaseCount,
    runTerminal,
  ]);

  const liveRun = useMemo(
    () =>
      current && running
        ? buildLiveRunSnapshot({
            current,
            metrics: PLAN_STABILITY_METRICS,
            prompt,
          })
        : null,
    [current, prompt, running],
  );
  const inspectorRuns = liveRun ? [...completedRuns, liveRun] : completedRuns;
  const promptHighlights = useMemo(
    () =>
      diffBasePrompt && improvement
        ? buildPromptHighlights({
            after: prompt,
            before: diffBasePrompt,
            improvement,
          })
        : [],
    [diffBasePrompt, improvement, prompt],
  );

  const handlePromptChange = (value: string) => {
    setPrompt(value);
    if (value === baseline.hypothesisSystemPrompt) setDiffBasePrompt(null);
  };

  const handleReset = () => {
    resetCurrentRun();
    dismiss();
    setImprovementModalOpen(false);
    setPrompt(baseline.hypothesisSystemPrompt);
    runPromptRef.current = baseline.hypothesisSystemPrompt;
    capturedRunRef.current = null;
    setSelectedCaseId(baseline.cases[0]?.caseId ?? null);
    setSelectedRunId(null);
    setCompletedRuns([]);
    setHistory(initialHistory);
    setDiffBasePrompt(null);
    clearCachedHillClimbState();
  };

  const handleRun = () => {
    if (!requireAccess()) return;
    scrollPromptPanelToStickyStart(promptPanelRef.current);
    runPromptRef.current = prompt;
    setSelectedRunId("live");
    setSelectedCaseId((prev) => prev ?? baseline.cases[0]?.caseId ?? null);
    void start(
      {
        axis: "plan-stability",
        hypothesisSystemPrompt: prompt,
        caseIds: [...PLAN_STABILITY_LIVE_CASE_IDS],
        concurrency: PLAN_STABILITY_LIVE_CASE_COUNT,
      },
      baseline,
    );
  };

  const handleImprove = async () => {
    if (!requireAccess()) return;
    const sourcePrompt = prompt;
    const newPrompt = await improve({
      currentPrompt: prompt,
      baseline,
      current,
    });
    if (newPrompt) {
      setDiffBasePrompt(sourcePrompt);
      setPrompt(newPrompt);
    }
  };

  const statusMessagesVisible = Boolean(improveError) || failedCaseCount > 0;

  return (
    <>
      <div className="grid min-h-[calc(100dvh-13rem)] grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.04fr)_minmax(28rem,0.96fr)]">
        <div
          ref={promptPanelRef}
          className="flex h-[min(34rem,calc(100dvh-6rem))] min-h-[24rem] flex-col sm:h-[min(42rem,calc(100dvh-3rem))] sm:min-h-[30rem] xl:sticky xl:top-6 xl:z-30 xl:h-[calc(100dvh-3rem)] xl:max-h-[calc(100dvh-3rem)]"
        >
          <PromptEditor
            value={prompt}
            baseline={baseline.hypothesisSystemPrompt}
            onChange={handlePromptChange}
            onReset={handleReset}
            disabled={running || improving}
            changedLines={promptHighlights}
            resetAvailable={resetAvailable}
            actions={
              <PromptActions
                current={current}
                totalCases={PLAN_STABILITY_LIVE_CASE_COUNT}
                running={running}
                improving={improving}
                canImprove={scorableRunComplete || Boolean(improvement)}
                onRun={handleRun}
                onCancel={cancel}
                onImprove={handleImprove}
              />
            }
          />
        </div>

        <div className="relative flex min-h-0 flex-col gap-4 xl:z-30 xl:min-h-[42rem]">
          <HillClimbChart
            points={history}
            metrics={PLAN_STABILITY_METRICS}
            running={running}
            hasQueuedImprovement={improvedPromptQueued}
          />
          {statusMessagesVisible && (
            <div className="space-y-2">
              {failedCaseCount > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {failedCaseCount} case
                  {failedCaseCount === 1 ? "" : "s"} errored.{" "}
                  {runTerminal && completedCaseCount > 0
                    ? `The chart uses the ${completedCaseCount} completed case${completedCaseCount === 1 ? "" : "s"}.`
                    : current?.phase === "error"
                      ? "No cases completed, so no chart point was added."
                      : "The chart will use completed cases only."}
                </div>
              )}
              {improveError && (
                <ImproveErrorMessage error={improveError} onDismiss={dismiss} />
              )}
            </div>
          )}
          <CaseInspector
            runs={inspectorRuns}
            baselineCases={baseline.cases}
            selectedRunId={selectedRunId}
            selectedCaseId={selectedCaseId}
            metrics={PLAN_STABILITY_METRICS}
            onSelectRun={setSelectedRunId}
            onSelectCase={setSelectedCaseId}
          />
        </div>
      </div>
      <ImprovementModal
        improvement={improvement}
        open={improvementModalOpen}
        onClose={() => setImprovementModalOpen(false)}
        highlights={promptHighlights}
        currentPrompt={prompt}
      />
    </>
  );
}
