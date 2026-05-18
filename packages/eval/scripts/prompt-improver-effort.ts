import "../src/load-env";

import { HYPOTHESIS_SYSTEM_PROMPT } from "@novamind/shared";
import {
  IMPROVE_MODEL,
  improvePrompt,
  type ClaudeEffort,
  type RunSummary,
} from "@novamind/pipeline";

const EFFORTS: readonly ClaudeEffort[] = ["low", "medium"];

const representativeSummary: RunSummary = {
  axis: "plan-stability",
  averageScores: {
    evidence_precision: 0.83,
    gap_handling: 0.52,
    rejected_claim_discipline: 0.58,
    confidence_calibration: 0.72,
  },
  cases: [
    {
      caseId: "retatrutide-phase2",
      question: "Retatrutide phase 2 HbA1c + weight outcomes",
      scores: {
        evidence_precision: 1,
        gap_handling: 0.55,
        rejected_claim_discipline: 0.6,
        confidence_calibration: 0.78,
      },
      hypothesis:
        "Retatrutide appears to improve HbA1c and weight in phase 2 data, but confidence should remain moderate because longer-term durability is not established.",
      gradingNotes: {
        gap_handling:
          "Missing/weak: durability boundary. Improve by explicitly classifying long-term durability as missing instead of implied.",
        rejected_claim_discipline:
          "Missing/weak: dose-response lure. Improve by naming that monotonic dose-response was rejected rather than silently avoiding it.",
      },
    },
    {
      caseId: "tirzepatide-safety",
      question: "Tirzepatide adverse events by dose",
      scores: {
        evidence_precision: 0.75,
        gap_handling: 0.5,
        rejected_claim_discipline: 0.55,
        confidence_calibration: 0.68,
      },
      hypothesis:
        "Tirzepatide trials show gastrointestinal adverse events are common, with limited evidence for clean dose-specific safety conclusions.",
      gradingNotes: {
        gap_handling:
          "Missing/weak: dose-specific boundary. Improve by separating general GI AE support from missing dose-by-dose rates.",
        rejected_claim_discipline:
          "Missing/weak: unsupported dose escalation claim. Improve by treating it as blocked negative evidence.",
      },
    },
    {
      caseId: "lipidation-half-life",
      question: "Fatty-acid lipidation effect on GLP-1 agonist half-life",
      scores: {
        evidence_precision: 0.75,
        gap_handling: 0.5,
        rejected_claim_discipline: 0.6,
        confidence_calibration: 0.7,
      },
      hypothesis:
        "Fatty-acid lipidation is plausibly linked to longer GLP-1 agonist exposure, but the handoff evidence is mechanistic and indirect.",
      gradingNotes: {
        gap_handling:
          "Missing/weak: indirect mechanism vs clinical half-life. Improve by labeling mechanistic evidence as indirect support.",
        rejected_claim_discipline:
          "Missing/weak: unsupported oral bioavailability analogy. Improve by naming it as off-question or blocked.",
      },
    },
  ],
};

for (const effort of EFFORTS) {
  const startedAt = Date.now();
  const result = await improvePrompt({
    currentPrompt: HYPOTHESIS_SYSTEM_PROMPT,
    effort,
    runSummary: representativeSummary,
  });
  const elapsedMs = Date.now() - startedAt;
  console.log(
    JSON.stringify(
      {
        effort,
        elapsedMs,
        model: IMPROVE_MODEL,
        outputTokens: result.usage.outputTokens,
        sentEffort: result.metadata.sentEffort,
        targetedMetric: result.output.targetedMetric,
        usageCostUsd: Number(result.usage.costUsd.toFixed(6)),
        rationale: result.output.rationale,
        promptLength: result.output.newPrompt.length,
      },
      null,
      2,
    ),
  );
}
