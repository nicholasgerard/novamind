import { synthesisGuardrailScore } from "./baseline-data";
import type {
  CaseState,
  CurrentRun,
  MetricMeta,
  RunSnapshot,
  ScoreMap,
} from "./types";

export function buildLiveRunSnapshot({
  current,
  metrics,
  prompt,
}: {
  current: CurrentRun;
  metrics: ReadonlyArray<MetricMeta>;
  prompt: string;
}): RunSnapshot {
  const scores =
    current.averageScores ?? averageCompletedScores(current.cases, metrics);
  return {
    id: "live",
    label: "running",
    note: "Scoring current prompt",
    prompt,
    score: synthesisGuardrailScore(scores),
    scores,
    cases: current.cases,
    startedAt: current.startedAt,
    completedAt: current.completedAt,
    elapsedMs: current.completedAt
      ? current.completedAt - current.startedAt
      : undefined,
    totalUsage: current.totalUsage,
  };
}

export function averageCompletedScores(
  cases: readonly CaseState[],
  metrics: ReadonlyArray<MetricMeta>,
): ScoreMap {
  const completed = cases.filter((c) => c.status === "complete" && c.scores);
  return Object.fromEntries(
    metrics.map((metric) => {
      const value =
        completed.reduce((sum, c) => sum + (c.scores?.[metric.key] ?? 0), 0) /
        Math.max(1, completed.length);
      return [metric.key, value];
    }),
  );
}
