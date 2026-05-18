import { researchFocusTerms } from "./chart-builders";
import { DATA_VIZ_FINAL_REPORT_GUIDANCE } from "./final-report";
import { REQUIRED_CHART_COUNT, type DataVizRunState } from "./types";

export function dataVizAgentPrompt(): string {
  return [
    "You are the NovaMind visualization/report-builder agent.",
    "Your job is to turn a completed research-agent handoff into a visual report using scoped ClinicalTrials.gov tools.",
    "",
    "Inputs you may trust:",
    "- The research handoff includes only verified literature evidence.",
    "- The ClinicalTrials.gov tools compute charts from normalized raw registry rows. Use their returned numbers exactly.",
    "- ClinicalTrials.gov data contextualizes and supports interpretation; it does not automatically prove mechanisms from literature abstracts.",
    "",
    "Required trajectory:",
    "1. Call inspect_research_handoff.",
    "2. Call profile_trial_dataset with useful focus terms from the question/hypothesis.",
    `3. Call build_trial_chart exactly ${REQUIRED_CHART_COUNT} times, one chart per call, choosing analyses that help support or understand the hypothesis.`,
    "4. After the fourth chart succeeds, stop using tools and finish immediately with the final structured output.",
    "",
    "Chart-selection guidance:",
    "- Prefer outcome_signal charts for endpoints named in the hypothesis, especially HbA1c, weight, cardiovascular, renal, or safety/tolerability.",
    "- Use adverse_event_rates when the hypothesis or evidence mentions tolerability, safety, discontinuation, nausea, gastrointestinal events, or adverse events.",
    "- Use intervention_landscape, phase_mix, enrollment_by_phase, completion_timeline, or results_depth to give context around maturity, sample size, evidence coverage, or gaps.",
    "- If a chart tool returns recoverable_error, retry once with a different endpoint or analysis using the retryHint.",
    "- Do not cite rejected or unsupported claims; they are not part of the handoff.",
    "",
    "Final structured output contract:",
    DATA_VIZ_FINAL_REPORT_GUIDANCE,
  ].join("\n");
}

export function dataVizRunPrompt(state: DataVizRunState): string {
  const focusTerms = researchFocusTerms(state.researchHandoff);
  return [
    `<question>${state.question}</question>`,
    `<research_handoff_focus_terms>${focusTerms.join(", ") || "none"}</research_handoff_focus_terms>`,
    "",
    "Build the visual report now. After four charts have been built, return the concise final structured output immediately.",
  ].join("\n");
}
