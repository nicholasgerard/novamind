import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import type { DataVizStreamEvent } from "@novamind/shared";
import {
  BuildTrialChartInputSchema,
  buildTrialChart,
  profileTrialDataset,
  researchFocusTerms,
  type BuildTrialChartInput,
} from "./chart-builders";
import { DATA_VIZ_FINAL_REPORT_TOOL_HINT } from "./final-report";
import {
  emitAgentEvent,
  emitToolCall,
  emitToolResult,
  throwIfAborted,
} from "./events";
import {
  REQUIRED_CHART_COUNT,
  type BuiltChartData,
  type DataVizRunState,
  type DataVizToolEnvelope,
  type DatasetProfileData,
  type InspectHandoffData,
} from "./types";

const INSPECT_HANDOFF_DESCRIPTION =
  "Use this first to read the completed research-agent handoff. It returns the question, hypothesis, confidence, verified evidence, and derived focus terms; unsupported verifier catches are intentionally omitted. Call it before choosing trial-data analyses so chart decisions are grounded in the research result.";
const PROFILE_DATASET_DESCRIPTION =
  "Use this after inspecting the research handoff and before building charts. It returns compact coverage summaries for interventions, phases, endpoints, completion years, results availability, and adverse events in the ClinicalTrials.gov snapshot. Provide optional focus terms from the hypothesis or question to help compare available trial fields with the research topic.";
const BUILD_CHART_DESCRIPTION =
  "Use this to build exactly one chart from raw ClinicalTrials.gov rows. The tool owns filtering, aggregation, and chart data; Claude chooses the analysis type and focus terms, but must use the returned numbers exactly. Call it four times with non-duplicative analyses that support or contextualize the hypothesis, and retry with a different slice if the tool returns a recoverable error.";

export function createDataVizToolServer(
  state: DataVizRunState,
  emit: (event: DataVizStreamEvent) => void,
  startedAt: number,
): McpServerConfig {
  return createDataVizToolServerFromContext(() => ({ emit, startedAt, state }));
}

export interface DeferredDataVizToolServer {
  bind(context: {
    emit: (event: DataVizStreamEvent) => void;
    startedAt: number;
    state: DataVizRunState;
  }): void;
  clear(): void;
  server: McpServerConfig;
}

export function createDeferredDataVizToolServer(): DeferredDataVizToolServer {
  let context:
    | {
        emit: (event: DataVizStreamEvent) => void;
        startedAt: number;
        state: DataVizRunState;
      }
    | undefined;
  return {
    bind(nextContext) {
      context = nextContext;
    },
    clear() {
      context = undefined;
    },
    server: createDataVizToolServerFromContext(() => {
      if (!context) {
        throw new Error("Data-viz Agent SDK tool server is not bound.");
      }
      return context;
    }),
  };
}

function createDataVizToolServerFromContext(
  getContext: () => {
    emit: (event: DataVizStreamEvent) => void;
    startedAt: number;
    state: DataVizRunState;
  },
): McpServerConfig {
  return createSdkMcpServer({
    name: "novamind_data_viz_report_builder",
    version: "0.0.0",
    tools: [
      tool(
        "inspect_research_handoff",
        INSPECT_HANDOFF_DESCRIPTION,
        {},
        async () => {
          const { state, emit, startedAt } = getContext();
          return structuredToolResult(
            inspectResearchHandoff(state, emit, startedAt),
          );
        },
      ),
      tool(
        "profile_trial_dataset",
        PROFILE_DATASET_DESCRIPTION,
        {
          focusTerms: z
            .array(z.string().trim().min(1).max(80))
            .max(8)
            .default([])
            .describe(
              "Optional molecule or endpoint terms to compare with available trial fields.",
            ),
        },
        async ({ focusTerms }) => {
          const { state, emit, startedAt } = getContext();
          return structuredToolResult(
            profileTrialData(state, emit, startedAt, focusTerms),
          );
        },
      ),
      tool(
        "build_trial_chart",
        BUILD_CHART_DESCRIPTION,
        BuildTrialChartInputSchema.shape,
        async (input) => {
          const { state, emit, startedAt } = getContext();
          return structuredToolResult(
            buildChartFromTrialData(
              state,
              emit,
              startedAt,
              BuildTrialChartInputSchema.parse(input),
            ),
          );
        },
      ),
    ],
    alwaysLoad: true,
  });
}

function inspectResearchHandoff(
  state: DataVizRunState,
  emit: (event: DataVizStreamEvent) => void,
  startedAt: number,
): DataVizToolEnvelope<InspectHandoffData> {
  throwIfAborted(state);
  emitToolCall(emit, "inspect_research_handoff", {});
  const data: InspectHandoffData = {
    question: state.researchHandoff.question,
    hypothesis: state.researchHandoff.hypothesis,
    confidence: state.researchHandoff.confidence,
    evidenceCount: state.researchHandoff.evidence.length,
    verifiedEvidence: state.researchHandoff.evidence,
    focusTerms: researchFocusTerms(state.researchHandoff),
  };
  emit({
    type: "data_viz_step",
    message: `Received research handoff with ${data.evidenceCount} verified evidence claim${data.evidenceCount === 1 ? "" : "s"}.`,
    ts: Date.now(),
  });
  emitAgentEvent(emit, startedAt, {
    phase: "tool",
    status: "complete",
    label: "Research handoff inspected",
    detail:
      "Question, hypothesis, verified evidence, and confidence are ready.",
    tool: "inspect_research_handoff",
  });
  emitToolResult(emit, "inspect_research_handoff", {
    evidenceCount: data.evidenceCount,
    focusTerms: data.focusTerms,
    confidence: data.confidence,
  });
  return ok(data);
}

function profileTrialData(
  state: DataVizRunState,
  emit: (event: DataVizStreamEvent) => void,
  startedAt: number,
  focusTerms: string[],
): DataVizToolEnvelope<DatasetProfileData> {
  throwIfAborted(state);
  emitToolCall(emit, "profile_trial_dataset", { focusTerms });
  const profile = profileTrialDataset(state.dataset);
  state.profile = profile;
  const inferredFocusTerms = [
    ...new Set([...researchFocusTerms(state.researchHandoff), ...focusTerms]),
  ].slice(0, 8);
  emit({
    type: "data_viz_step",
    message:
      "Profiled trial rows across interventions, phases, endpoints, completion years, and adverse events.",
    ts: Date.now(),
  });
  emitAgentEvent(emit, startedAt, {
    phase: "tool",
    status: "complete",
    label: "Trial dataset profiled",
    detail: `${profile.source.studies} studies, ${profile.source.outcomeRows} outcome rows, ${profile.source.adverseEventRows} adverse-event rows.`,
    tool: "profile_trial_dataset",
  });
  emitToolResult(emit, "profile_trial_dataset", {
    focusTerms: inferredFocusTerms,
    source: profile.source,
    endpointFamilies: profile.endpointFamilies,
    topInterventions: profile.interventionCounts.slice(0, 5),
    topAdverseEvents: profile.adverseEventTerms.slice(0, 5),
  });
  return ok({ focusTerms: inferredFocusTerms, profile });
}

function buildChartFromTrialData(
  state: DataVizRunState,
  emit: (event: DataVizStreamEvent) => void,
  startedAt: number,
  input: BuildTrialChartInput,
): DataVizToolEnvelope<BuiltChartData> {
  throwIfAborted(state);
  const chartKey = chartRequestKey(input);
  emitToolCall(emit, "build_trial_chart", {
    analysis: input.analysis,
    endpoint: input.endpoint,
    focusTerms: input.focusTerms,
  });

  if (state.charts.length >= REQUIRED_CHART_COUNT) {
    const envelope = recoverable(
      "chart_limit_reached",
      "The report already has four charts.",
      "Return the final report JSON now; do not call build_trial_chart again.",
    );
    emitToolResult(emit, "build_trial_chart", envelope);
    return envelope;
  }
  if (state.builtChartKeys.has(chartKey)) {
    emitAgentEvent(emit, startedAt, {
      phase: "recovery",
      status: "running",
      label: "Duplicate chart request",
      detail: "Asking Claude to choose a different trial-data slice.",
      tool: "build_trial_chart",
    });
    const envelope = recoverable(
      "duplicate_chart",
      "That chart analysis was already built.",
      "Call build_trial_chart again with a different analysis, endpoint, or focusTerms. The report should cover both support and context for the hypothesis.",
    );
    emitToolResult(emit, "build_trial_chart", envelope);
    return envelope;
  }

  const built = buildTrialChart(state.dataset, input, state.charts.length + 1);
  if (built.chart.points.length === 0) {
    emitAgentEvent(emit, startedAt, {
      phase: "recovery",
      status: "running",
      label: "No rows for chart request",
      detail: "Asking Claude to select a chart with available trial data.",
      tool: "build_trial_chart",
    });
    const envelope = recoverable(
      "no_chart_rows",
      "The requested analysis returned no chartable rows.",
      "Use profile_trial_dataset coverage and call build_trial_chart with another endpoint or analysis. Good fallbacks are outcome_signal with hba1c/weight, adverse_event_rates, intervention_landscape, phase_mix, enrollment_by_phase, completion_timeline, or results_depth.",
    );
    emitToolResult(emit, "build_trial_chart", envelope);
    return envelope;
  }

  state.builtChartKeys.add(chartKey);
  state.charts.push({ chart: built.chart, rationale: built.rationale });
  if (
    state.charts.length >= REQUIRED_CHART_COUNT &&
    !state.finalReportReadyAt
  ) {
    state.finalReportReadyAt = Date.now();
    state.onFinalChartsReady?.();
  }
  emit({
    type: "data_viz_chart",
    chart: built.chart,
    rationale: built.rationale,
    ts: Date.now(),
  });
  emit({
    type: "data_viz_step",
    message: `Built chart ${state.charts.length}: ${built.chart.title}.`,
    ts: Date.now(),
  });
  emitAgentEvent(emit, startedAt, {
    phase: "chart",
    status: "complete",
    label: `Chart ${state.charts.length} built`,
    detail: built.chart.summary,
    tool: "build_trial_chart",
  });
  const data: BuiltChartData = {
    analysis: input.analysis,
    chartId: built.chart.id,
    chartNumber: state.charts.length,
    pointCount: built.chart.points.length,
    rationale: built.rationale,
    summary: built.summary,
  };
  emitToolResult(emit, "build_trial_chart", data);
  return ok(data);
}

function structuredToolResult<T>(value: DataVizToolEnvelope<T>): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent: Record<string, unknown>;
} {
  return {
    structuredContent: value,
    ...(value.status === "ok" ? {} : { isError: true }),
    content: [{ type: "text", text: summarizeToolEnvelope(value) }],
  };
}

function summarizeToolEnvelope<T>(value: DataVizToolEnvelope<T>): string {
  switch (value.status) {
    case "ok":
      return okToolSummary(value.data);
    case "recoverable_error":
      return `status=recoverable_error code=${value.code} message=${value.message} retryHint=${value.retryHint}`;
    case "fatal_error":
      return `status=fatal_error code=${value.code} message=${value.message}`;
  }
}

function okToolSummary(data: unknown): string {
  const record = data && typeof data === "object" ? data : undefined;
  if (record && "verifiedEvidence" in record && "evidenceCount" in record) {
    const handoff = record as InspectHandoffData;
    const evidence = handoff.verifiedEvidence
      .map((item) => `${item.citation}: ${truncateToolText(item.claim, 180)}`)
      .join("; ");
    return [
      "status=ok",
      `question=${truncateToolText(handoff.question, 140)}`,
      `hypothesis=${truncateToolText(handoff.hypothesis, 420)}`,
      `evidenceCount=${handoff.evidenceCount}`,
      `verifiedEvidence=${evidence || "none"}`,
      `confidence=${handoff.confidence ?? "unknown"}`,
      `focusTerms=${handoff.focusTerms.join(",") || "none"}`,
    ].join(" ");
  }
  if (record && "profile" in record) {
    const profileData = record as DatasetProfileData;
    return [
      "status=ok",
      `studies=${profileData.profile.source.studies}`,
      `outcomeRows=${profileData.profile.source.outcomeRows}`,
      `adverseEventRows=${profileData.profile.source.adverseEventRows}`,
      `focusTerms=${profileData.focusTerms.join(",") || "none"}`,
    ].join(" ");
  }
  if (record && "chartId" in record) {
    const chartData = record as BuiltChartData;
    return [
      "status=ok",
      `chartNumber=${chartData.chartNumber}`,
      `chartId=${chartData.chartId}`,
      `points=${chartData.pointCount}`,
      `summary=${truncateToolText(chartData.summary, 180)}`,
      chartData.chartNumber >= REQUIRED_CHART_COUNT
        ? DATA_VIZ_FINAL_REPORT_TOOL_HINT
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return "status=ok";
}

function ok<T>(data: T): DataVizToolEnvelope<T> {
  return { status: "ok", data };
}

function recoverable(
  code: string,
  message: string,
  retryHint: string,
): DataVizToolEnvelope<never> {
  return { status: "recoverable_error", code, message, retryHint };
}

function chartRequestKey(input: BuildTrialChartInput): string {
  const focusTerms = [...new Set(input.focusTerms.map((term) => term.trim()))]
    .filter(Boolean)
    .map((term) => term.toLowerCase())
    .sort()
    .join("|");
  return `${input.analysis}:${input.endpoint}:${focusTerms}`;
}

function truncateToolText(value: string, maxChars: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 3).trim()}...`;
}
