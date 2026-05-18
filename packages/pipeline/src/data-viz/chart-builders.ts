import { z } from "zod";
import {
  type ClinicalTrialAdverseEvent,
  type ClinicalTrialOutcomeMeasurement,
  type ClinicalTrialsDataset,
  type ClinicalTrialStudy,
  type DataVizChart,
  type DataVizChartPoint,
  type ResearchHandoff,
} from "@novamind/shared";

export const TrialChartAnalysisSchema = z.enum([
  "intervention_landscape",
  "phase_mix",
  "enrollment_by_phase",
  "completion_timeline",
  "outcome_signal",
  "adverse_event_rates",
  "results_depth",
]);
export type TrialChartAnalysis = z.infer<typeof TrialChartAnalysisSchema>;

export const TrialEndpointSchema = z.enum([
  "hba1c",
  "weight",
  "cardiovascular",
  "renal",
  "safety",
  "general",
]);
export type TrialEndpoint = z.infer<typeof TrialEndpointSchema>;

export const BuildTrialChartInputSchema = z.object({
  analysis: TrialChartAnalysisSchema.describe(
    "The aggregate analysis to run over raw ClinicalTrials.gov rows.",
  ),
  endpoint: TrialEndpointSchema.default("general").describe(
    "Endpoint family to filter when analysis=outcome_signal or when safety context is needed.",
  ),
  focusTerms: z
    .array(z.string().trim().min(1).max(80))
    .max(8)
    .default([])
    .describe(
      "Optional molecule, endpoint, comparator, or adverse-event terms from the hypothesis.",
    ),
  rationale: z
    .string()
    .trim()
    .min(1)
    .max(360)
    .describe("Why this chart helps support or understand the handoff."),
  title: z.string().trim().min(1).max(80).optional(),
  subtitle: z.string().trim().min(1).max(120).optional(),
});
export type BuildTrialChartInput = z.infer<typeof BuildTrialChartInputSchema>;

export interface TrialDatasetProfile {
  adverseEventTerms: Array<{ label: string; value: number }>;
  completionYears: Array<{ label: string; value: number }>;
  endpointFamilies: Array<{ label: TrialEndpoint; value: number }>;
  interventionCounts: Array<{ label: string; value: number }>;
  phaseCounts: Array<{ label: string; value: number }>;
  source: {
    adverseEventRows: number;
    outcomeRows: number;
    studies: number;
  };
}

export interface TrialChartBuildResult {
  chart: DataVizChart;
  rationale: string;
  rowCount: number;
  summary: string;
}

export function profileTrialDataset(
  dataset: ClinicalTrialsDataset,
): TrialDatasetProfile {
  return {
    source: {
      studies: dataset.studies.length,
      outcomeRows: dataset.outcomes.length,
      adverseEventRows: dataset.adverseEvents.length,
    },
    interventionCounts: interventionCounts(dataset).slice(0, 8),
    phaseCounts: orderedPhaseEntries(
      countBy(dataset.studies, (study) => phaseLabel(study)),
    ).map(([label, value]) => ({ label, value })),
    endpointFamilies: endpointFamilyCounts(dataset),
    adverseEventTerms: adverseEventRates(dataset).slice(0, 8),
    completionYears: completionTimeline(dataset).slice(-8),
  };
}

/**
 * Build one chart by running a bounded aggregate over normalized
 * ClinicalTrials.gov rows. The agent chooses the analysis; this module owns
 * filtering, aggregation, labels, and numeric integrity.
 */
export function buildTrialChart(
  dataset: ClinicalTrialsDataset,
  input: BuildTrialChartInput,
  index: number,
): TrialChartBuildResult {
  const chart = (() => {
    switch (input.analysis) {
      case "intervention_landscape":
        return topInterventionsChart(dataset);
      case "phase_mix":
        return phaseMixChart(dataset);
      case "enrollment_by_phase":
        return enrollmentByPhaseChart(dataset);
      case "completion_timeline":
        return completionTimelineChart(dataset);
      case "outcome_signal":
        return outcomeSignalChart(dataset, input.endpoint, input.focusTerms);
      case "adverse_event_rates":
        return adverseEventRatesChart(dataset, input.focusTerms);
      case "results_depth":
        return resultsDepthChart(dataset);
    }
  })();

  return {
    chart: {
      ...chart,
      id: `report-chart-${index}-${input.analysis}`,
      ...(input.title ? { title: input.title } : {}),
      ...(input.subtitle ? { subtitle: input.subtitle } : {}),
    },
    rationale: input.rationale,
    rowCount: chart.points.length,
    summary: chart.summary,
  };
}

export function researchFocusTerms(handoff: ResearchHandoff): string[] {
  const text = [
    handoff.question,
    handoff.hypothesis,
    ...handoff.evidence.map((item) => item.claim),
  ].join(" ");
  return [
    "tirzepatide",
    "semaglutide",
    "retatrutide",
    "liraglutide",
    "dulaglutide",
    "exenatide",
    "hba1c",
    "weight",
    "cardiovascular",
    "renal",
    "gastrointestinal",
    "adverse",
  ].filter((term) => new RegExp(term, "i").test(text));
}

function topInterventionsChart(dataset: ClinicalTrialsDataset): DataVizChart {
  const points = interventionCounts(dataset).slice(0, 8);
  return {
    id: "top_interventions",
    title: "Top interventions",
    subtitle: "Studies with posted results",
    kind: "horizontal_bar",
    xLabel: "studies",
    yLabel: "intervention",
    points,
    summary: summarizeLeader(points, "intervention volume"),
    sourceNote: "ClinicalTrials.gov studies with posted results.",
  };
}

function phaseMixChart(dataset: ClinicalTrialsDataset): DataVizChart {
  const points = orderedPhaseEntries(
    countBy(dataset.studies, (study) => phaseLabel(study)),
  ).map(([label, value]) => ({ label, value }));
  return {
    id: "phase_mix",
    title: "Development phase mix",
    subtitle: "Result-bearing GLP-1 studies",
    kind: "bar",
    xLabel: "phase",
    yLabel: "studies",
    points,
    summary: summarizeMax(points, "study count by phase"),
    sourceNote: "Phase from ClinicalTrials.gov protocol module.",
  };
}

function enrollmentByPhaseChart(dataset: ClinicalTrialsDataset): DataVizChart {
  const values = new Map<string, number[]>();
  for (const study of dataset.studies) {
    if (study.enrollmentCount === undefined) continue;
    const phase = phaseLabel(study);
    values.set(phase, [...(values.get(phase) ?? []), study.enrollmentCount]);
  }
  const points = orderedPhaseEntries(
    new Map([...values].map(([phase, ns]) => [phase, median(ns)])),
  ).map(([label, value]) => ({ label, value }));
  return {
    id: "enrollment_by_phase",
    title: "Median enrollment",
    subtitle: "Actual enrolled participants by phase",
    kind: "bar",
    xLabel: "phase",
    yLabel: "median participants",
    points,
    summary: summarizeMax(points, "median enrollment"),
    sourceNote: "Enrollment counts from ClinicalTrials.gov design module.",
  };
}

function completionTimelineChart(dataset: ClinicalTrialsDataset): DataVizChart {
  const points = completionTimeline(dataset).slice(-10);
  return {
    id: "completion_timeline",
    title: "Completion timeline",
    subtitle: "Studies completed per year",
    kind: "line",
    xLabel: "completion year",
    yLabel: "studies",
    points,
    summary: summarizeTrend(points),
    sourceNote: "Completion date from ClinicalTrials.gov status module.",
  };
}

function outcomeSignalChart(
  dataset: ClinicalTrialsDataset,
  endpoint: TrialEndpoint,
  focusTerms: readonly string[],
): DataVizChart {
  const rows = outcomeRowsForEndpoint(dataset.outcomes, endpoint, focusTerms)
    .map((row) => ({
      label: compactLabel(`${row.groupTitle} · ${row.nctId}`),
      value: row.value,
      group: row.outcomeType ?? "OUTCOME",
      low: row.spread === undefined ? undefined : row.value - row.spread,
      high: row.spread === undefined ? undefined : row.value + row.spread,
    }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 8);
  const label = endpointLabel(endpoint);
  return {
    id: `${endpoint}_outcomes`,
    title: `${label} outcomes`,
    subtitle: `Largest reported ${label.toLowerCase()} changes`,
    kind: "horizontal_bar",
    xLabel: "reported change",
    yLabel: "arm",
    points: rows,
    summary:
      rows.length > 0
        ? `${rows[0]!.label} shows the strongest ${label} signal at ${formatNumber(rows[0]!.value)}.`
        : `No ${label.toLowerCase()} outcome rows were available in the snapshot.`,
    sourceNote: "Outcome measures from ClinicalTrials.gov results module.",
  };
}

function adverseEventRatesChart(
  dataset: ClinicalTrialsDataset,
  focusTerms: readonly string[],
): DataVizChart {
  const focusPattern =
    focusTerms.length > 0 ? regexFromTerms(focusTerms) : null;
  const points = adverseEventRates(dataset, focusPattern).slice(0, 8);
  return {
    id: "adverse_event_rates",
    title: "Adverse-event rates",
    subtitle: focusPattern
      ? "Focused terms across reporting groups"
      : "Common non-serious events across reporting groups",
    kind: "horizontal_bar",
    xLabel: "% affected",
    yLabel: "event",
    points,
    summary: summarizeLeader(points, "non-serious adverse event rate"),
    sourceNote: "Adverse events from ClinicalTrials.gov results module.",
  };
}

function resultsDepthChart(dataset: ClinicalTrialsDataset): DataVizChart {
  const points = [
    { label: "studies", value: dataset.studies.length },
    { label: "outcome rows", value: dataset.outcomes.length },
    { label: "AE rows", value: dataset.adverseEvents.length },
  ];
  return {
    id: "results_depth",
    title: "Results depth",
    subtitle: "Rows available for live analysis",
    kind: "bar",
    xLabel: "table",
    yLabel: "rows",
    points,
    summary: `${dataset.outcomes.length} outcome rows and ${dataset.adverseEvents.length} adverse-event rows were available for analysis.`,
    sourceNote:
      "Normalized from ClinicalTrials.gov protocol and results sections.",
  };
}

function interventionCounts(
  dataset: ClinicalTrialsDataset,
): DataVizChartPoint[] {
  const counts = new Map<string, number>();
  for (const study of dataset.studies) {
    for (const intervention of study.interventions) {
      const name = normalizeIntervention(intervention.name);
      if (!name || isLowSignalIntervention(name)) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return topEntries(counts, 12).map(([label, value]) => ({ label, value }));
}

function outcomeRowsForEndpoint(
  rows: readonly ClinicalTrialOutcomeMeasurement[],
  endpoint: TrialEndpoint,
  focusTerms: readonly string[],
): ClinicalTrialOutcomeMeasurement[] {
  const endpointPattern = patternForEndpoint(endpoint);
  const unitPattern =
    endpoint === "hba1c"
      ? /%|percent/i
      : endpoint === "weight"
        ? /%|kg|kilogram/i
        : null;
  const focusPattern =
    endpoint === "general" && focusTerms.length > 0
      ? regexFromTerms(focusTerms)
      : null;
  return rows.filter((row) => {
    const haystack = `${row.outcomeTitle} ${row.groupTitle} ${row.studyTitle}`;
    if (endpointPattern && !endpointPattern.test(haystack)) return false;
    if (focusPattern && !focusPattern.test(haystack)) return false;
    if (unitPattern && row.unit && !unitPattern.test(row.unit)) return false;
    return Number.isFinite(row.value);
  });
}

function endpointFamilyCounts(
  dataset: ClinicalTrialsDataset,
): Array<{ label: TrialEndpoint; value: number }> {
  return (["hba1c", "weight", "cardiovascular", "renal"] as const).map(
    (endpoint) => ({
      label: endpoint,
      value: outcomeRowsForEndpoint(dataset.outcomes, endpoint, []).length,
    }),
  );
}

function adverseEventRates(
  dataset: ClinicalTrialsDataset,
  focusPattern?: RegExp | null,
): DataVizChartPoint[] {
  const byTerm = new Map<string, { affected: number; atRisk: number }>();
  for (const row of dataset.adverseEvents) {
    if (row.serious) continue;
    if (focusPattern && !focusPattern.test(adverseEventHaystack(row))) continue;
    const key = row.term;
    const existing = byTerm.get(key) ?? { affected: 0, atRisk: 0 };
    existing.affected += row.numAffected;
    existing.atRisk += row.numAtRisk;
    byTerm.set(key, existing);
  }
  return [...byTerm.entries()]
    .map(([label, value]) => ({
      label: compactLabel(label),
      value: value.atRisk > 0 ? (100 * value.affected) / value.atRisk : 0,
    }))
    .filter((point) => point.value > 0)
    .sort((a, b) => b.value - a.value);
}

function completionTimeline(
  dataset: ClinicalTrialsDataset,
): DataVizChartPoint[] {
  const counts = new Map<string, number>();
  for (const study of dataset.studies) {
    const year = yearFromDate(study.completionDate);
    if (!year) continue;
    counts.set(String(year), (counts.get(String(year)) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([label, value]) => ({ label, value }));
}

function countBy<T>(
  items: readonly T[],
  keyFor: (item: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function topEntries(
  map: Map<string, number>,
  n: number,
): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function orderedPhaseEntries(
  map: Map<string, number>,
): Array<[string, number]> {
  const order = ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "N/A", "Unknown"];
  return [...map.entries()].sort(
    ([a], [b]) => order.indexOf(a) - order.indexOf(b),
  );
}

function phaseLabel(study: ClinicalTrialStudy): string {
  const joined = study.phases.join(" ");
  if (/PHASE4/i.test(joined)) return "Phase 4";
  if (/PHASE3/i.test(joined)) return "Phase 3";
  if (/PHASE2/i.test(joined)) return "Phase 2";
  if (/PHASE1/i.test(joined)) return "Phase 1";
  if (/NA/i.test(joined)) return "N/A";
  return "Unknown";
}

function normalizeIntervention(name: string): string {
  return name
    .replace(/^Drug:\s*/i, "")
    .replace(/\s+\d+(\.\d+)?\s*(mg|mcg|µg|g)\b/gi, "")
    .trim()
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function isLowSignalIntervention(name: string): boolean {
  return /placebo|standard care|diet|exercise|lifestyle|none|control/i.test(
    name,
  );
}

function patternForEndpoint(endpoint: TrialEndpoint): RegExp | null {
  switch (endpoint) {
    case "hba1c":
      return /hba1c|glycosylated|hemoglobin a1c|haemoglobin/i;
    case "weight":
      return /body weight|weight|bmi/i;
    case "cardiovascular":
      return /cardiovascular|major adverse cardiovascular|mace|blood pressure|heart|stroke/i;
    case "renal":
      return /renal|kidney|albuminuria|egfr|urinary albumin/i;
    case "safety":
      return /adverse|safety|tolerability/i;
    case "general":
      return null;
  }
}

function regexFromTerms(terms: readonly string[]): RegExp {
  const escaped = terms
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.length > 0 ? escaped.join("|") : "$^", "i");
}

function adverseEventHaystack(row: ClinicalTrialAdverseEvent): string {
  return `${row.term} ${row.organSystem ?? ""} ${row.groupTitle} ${row.studyTitle}`;
}

function yearFromDate(date: string | undefined): number | undefined {
  const match = date?.match(/^(\d{4})/);
  return match ? Number(match[1]) : undefined;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

function summarizeLeader(
  points: ReadonlyArray<{ label: string; value: number }>,
  metric: string,
): string {
  const first = points[0];
  if (!first) return `No ${metric} rows were available in the snapshot.`;
  return `${first.label} leads ${metric} at ${formatNumber(first.value)}.`;
}

function summarizeMax(
  points: ReadonlyArray<{ label: string; value: number }>,
  metric: string,
): string {
  const leader = [...points].sort((a, b) => b.value - a.value)[0];
  if (!leader) return `No ${metric} rows were available in the snapshot.`;
  return `${leader.label} leads ${metric} at ${formatNumber(leader.value)}.`;
}

function summarizeTrend(
  points: ReadonlyArray<{ label: string; value: number }>,
): string {
  if (points.length < 2) return "Timeline data is limited in this snapshot.";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const direction = last.value >= first.value ? "increased" : "declined";
  return `Annual completions ${direction} from ${formatNumber(first.value)} in ${first.label} to ${formatNumber(last.value)} in ${last.label}.`;
}

function compactLabel(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 36 ? `${cleaned.slice(0, 33)}...` : cleaned;
}

function endpointLabel(endpoint: TrialEndpoint): string {
  switch (endpoint) {
    case "hba1c":
      return "HbA1c";
    case "weight":
      return "Weight";
    case "cardiovascular":
      return "Cardiovascular";
    case "renal":
      return "Renal";
    case "safety":
      return "Safety";
    case "general":
      return "Outcome";
  }
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
