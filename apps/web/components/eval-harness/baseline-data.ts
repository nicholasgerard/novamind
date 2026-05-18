import { HYPOTHESIS_SYSTEM_PROMPT } from "@novamind/shared/prompts";
import type { BaselineSnapshot, MetricMeta, ScoreMap } from "./types";

/**
 * Static baseline snapshot for the hypothesis-only plan-stability axis.
 * The live UI treats this as a pending baseline so the first browser run
 * becomes the visible v0 point for the hill-climb trace.
 */
export const PLAN_STABILITY_BASELINE: BaselineSnapshot = {
  axis: "plan-stability",
  hypothesisSystemPrompt: HYPOTHESIS_SYSTEM_PROMPT,
  averageScores: {
    evidence_precision: 0,
    gap_handling: 0,
    rejected_claim_discipline: 0,
    confidence_calibration: 0,
  },
  cases: [
    {
      caseId: "tirzepatide-vs-semaglutide-weight",
      index: 0,
      label: "Tirzepatide vs semaglutide for weight loss in obesity",
      scores: {
        evidence_precision: 0,
        gap_handling: 0,
        rejected_claim_discipline: 0,
        confidence_calibration: 0,
      },
    },
    {
      caseId: "glp1-cardiovascular-outcomes",
      index: 1,
      label: "GLP-1 receptor agonists cardiovascular outcomes in T2D",
      scores: {
        evidence_precision: 0,
        gap_handling: 0,
        rejected_claim_discipline: 0,
        confidence_calibration: 0,
      },
    },
    {
      caseId: "retatrutide-phase2",
      index: 2,
      label: "Retatrutide phase 2 HbA1c + weight outcomes",
      scores: {
        evidence_precision: 0,
        gap_handling: 0,
        rejected_claim_discipline: 0,
        confidence_calibration: 0,
      },
    },
    {
      caseId: "tirzepatide-safety",
      index: 3,
      label: "Tirzepatide adverse events by dose",
      scores: {
        evidence_precision: 0,
        gap_handling: 0,
        rejected_claim_discipline: 0,
        confidence_calibration: 0,
      },
    },
    {
      caseId: "lipidation-half-life",
      index: 4,
      label: "Fatty-acid lipidation effect on GLP-1 agonist half-life",
      scores: {
        evidence_precision: 0,
        gap_handling: 0,
        rejected_claim_discipline: 0,
        confidence_calibration: 0,
      },
    },
  ],
  totalUsage: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  },
  capturedAt: "pending",
};

export const PLAN_STABILITY_METRICS: ReadonlyArray<MetricMeta> = [
  {
    key: "evidence_precision",
    label: "Evidence precision",
    goodIsHigh: true,
    description:
      "Selected evidence directly supports the hypothesis and stays inside the case-specific evidence boundary.",
  },
  {
    key: "gap_handling",
    label: "Gap handling",
    goodIsHigh: true,
    description:
      "The hypothesis explicitly names missing, indirect, partial, or off-question support instead of papering over it.",
  },
  {
    key: "rejected_claim_discipline",
    label: "Rejected-claim discipline",
    goodIsHigh: true,
    description:
      "Rejected claims are used only as limitations or confidence signals, never as factual evidence.",
  },
  {
    key: "confidence_calibration",
    label: "Confidence calibration",
    goodIsHigh: true,
    description:
      "Confidence lands in the expected band for direct, indirect, partial, or unsupported evidence.",
  },
];

export const SYNTHESIS_SCORE_KEYS = PLAN_STABILITY_METRICS.map((m) => m.key);

export const PLAN_STABILITY_LIVE_CASE_IDS = [
  "retatrutide-phase2",
  "tirzepatide-safety",
  "lipidation-half-life",
] as const;

export const PLAN_STABILITY_LIVE_CASE_COUNT =
  PLAN_STABILITY_LIVE_CASE_IDS.length;

const PLAN_STABILITY_LIVE_CASES = PLAN_STABILITY_LIVE_CASE_IDS.map(
  (caseId, index) => {
    const caseItem = PLAN_STABILITY_BASELINE.cases.find(
      (item) => item.caseId === caseId,
    );
    if (!caseItem) throw new Error(`Missing live eval case: ${caseId}`);
    return { ...caseItem, index };
  },
);

export const PLAN_STABILITY_LIVE_BASELINE: BaselineSnapshot = {
  ...PLAN_STABILITY_BASELINE,
  averageScores: averageCaseScores(PLAN_STABILITY_LIVE_CASES),
  cases: PLAN_STABILITY_LIVE_CASES,
};

export function synthesisGuardrailScore(scores: ScoreMap | undefined): number {
  if (!scores) return 0;
  const values = SYNTHESIS_SCORE_KEYS.map((key) => scores[key]).filter(
    (value): value is number => typeof value === "number",
  );
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageCaseScores(
  cases: ReadonlyArray<{ scores: ScoreMap }>,
): ScoreMap {
  const keys = new Set(cases.flatMap((c) => Object.keys(c.scores)));
  const scores: ScoreMap = {};
  for (const key of keys) {
    scores[key] =
      cases.reduce((sum, c) => sum + (c.scores[key] ?? 0), 0) /
      Math.max(1, cases.length);
  }
  return scores;
}
