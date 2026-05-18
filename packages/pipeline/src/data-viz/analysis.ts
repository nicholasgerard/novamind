import {
  query,
  startup,
  type McpServerConfig,
  type Options,
  type Query,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  sumUsage,
  type DataVizSourceSummary,
  type DataVizStreamEvent,
} from "@novamind/shared";
import { AsyncEventQueue } from "../async-event-queue";
import {
  ensureClaudeAgentRuntime,
  orchestratorEffort,
  orchestratorThinking,
  sdkColdFirstMessageTimeoutMs,
  sdkIdleTimeoutMs,
  sdkLiveStartupWaitMs,
  sdkStartupInitializeTimeoutMs,
  sdkWarmFirstMessageTimeoutMs,
} from "../agent-sdk/config";
import { describeSdkMessage } from "../agent-sdk/messages";
import {
  getAgentSdkRuntimeManager,
  withAgentSdkMessageTimeouts,
  type AgentSdkRuntimeTimingSink,
  type AgentSdkWarmProfileDefinition,
} from "../agent-sdk/runtime";
import {
  claudeAgentEnv,
  claudeAgentRuntimePaths,
  claudeStructuredOutputSchema,
  resolveClaudeExecutablePath,
  usageFromAgentResult,
} from "../structured";
import {
  abortError,
  dataVizAgentEventFromSdkMessage,
  emitAgentEvent,
  emitTiming,
  errorMessage,
  isAbortError,
  startDataVizTiming,
} from "./events";
import {
  loadClinicalTrialsDatasetSource,
  type ClinicalTrialsDatasetSource,
} from "./loader";
import { dataVizAgentPrompt, dataVizRunPrompt } from "./prompt";
import {
  DataVizOrchestratorResultSchema,
  buildFallbackDataVizReport,
  parseDataVizResult,
  type DataVizOrchestratorResult,
  type DataVizResultParse,
} from "./result";
import {
  createDataVizToolServer,
  createDeferredDataVizToolServer,
} from "./tools";
import {
  DATA_VIZ_AGENT_MODEL,
  DATA_VIZ_MAX_TURNS,
  REQUIRED_CHART_COUNT,
  allowedDataVizTools,
  type DataVizRunState,
  type DataVizTimingEvent,
  type RunDataVizAnalysisArgs,
} from "./types";

const DEFAULT_FINAL_REPORT_GRACE_MS = 10_000;

type ResolvedDataVizReport = {
  agentUsageCostUsd?: number;
  fallbackReason?: string;
  report: DataVizOrchestratorResult;
  source: "structured_output" | "chart_fallback";
};

export {
  DATA_VIZ_AGENT_MODEL,
  type DataVizTimingEvent,
  type RunDataVizAnalysisArgs,
};

export const dataVizAgentSdkWarmProfile = {
  name: "data-viz",
  async startWarmQuery({ abortController, onTiming }) {
    const target = createDeferredDataVizToolServer();
    const startedAt = Date.now();
    const warmQuery = await startup({
      initializeTimeoutMs: sdkStartupInitializeTimeoutMs(),
      options: await buildDataVizSdkOptions({
        abortController,
        mcpServer: target.server,
        runId: "warm-data-viz-profile",
        telemetryAction: "data-viz-warm-profile",
      }),
    });
    onTiming?.({
      elapsedMs: Date.now() - startedAt,
      phase: "finish",
      profile: "data-viz",
      sdkEvent: "warm_query_initialized",
      stage: "agent_sdk_runtime",
    });
    return {
      warmQuery,
      bind: target.bind,
      clear: target.clear,
    };
  },
} satisfies AgentSdkWarmProfileDefinition<{
  emit: (event: DataVizStreamEvent) => void;
  startedAt: number;
  state: DataVizRunState;
}>;

export async function preloadDataVizResources(): Promise<DataVizSourceSummary> {
  const sourceInfo = await loadClinicalTrialsDatasetSource();
  return dataVizSourceSummary(sourceInfo);
}

export async function* runDataVizAnalysis(
  args: RunDataVizAnalysisArgs,
): AsyncIterable<DataVizStreamEvent> {
  const queue = new AsyncEventQueue<DataVizStreamEvent>({
    label: "data-viz stream",
    maxBuffer: 512,
  });

  const producer = runDataVizAgent(args, (event) => queue.push(event))
    .catch((err) => {
      if (isAbortError(err)) {
        console.info("[data-viz] report builder aborted");
        return;
      }
      console.error("[data-viz] report builder failed", err);
      queue.push({
        type: "data_viz_error",
        message: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
      });
    })
    .finally(() => queue.finish());

  for await (const event of queue) {
    yield event;
  }

  await producer;
}

async function runDataVizAgent(
  args: RunDataVizAnalysisArgs,
  emit: (event: DataVizStreamEvent) => void,
): Promise<void> {
  const startedAt = Date.now();
  if (!args.researchHandoff) {
    emit({
      type: "data_viz_error",
      message: "Run the research agent first before generating visualizations.",
      ts: Date.now(),
    });
    return;
  }

  emitAgentEvent(emit, startedAt, {
    phase: "data",
    status: "running",
    label: "Loading ClinicalTrials.gov data",
    detail: "Resolving the trial snapshot before starting the report agent.",
  });
  const sourceInfo = await loadClinicalTrialsDatasetSource();
  const dataset = sourceInfo.dataset;
  const source = dataVizSourceSummary(sourceInfo);
  emit({
    type: "data_viz_started",
    model: DATA_VIZ_AGENT_MODEL,
    source,
    ts: Date.now(),
  });
  emit({
    type: "data_viz_step",
    message: `Loaded ${dataset.studies.length} ClinicalTrials.gov studies, ${dataset.outcomes.length} outcome rows, and ${dataset.adverseEvents.length} adverse-event rows.`,
    ts: Date.now(),
  });
  emitAgentEvent(emit, startedAt, {
    phase: "data",
    status: "complete",
    label: "Trial dataset ready",
    detail: sourceInfo.isFixture
      ? "Using the explicit fixture dataset."
      : sourceInfo.mode === "r2"
        ? "Using the R2 trial snapshot."
        : "Using the local trial snapshot.",
  });

  const state: DataVizRunState = {
    args,
    builtChartKeys: new Set(),
    charts: [],
    dataset,
    profile: undefined,
    question: args.question ?? args.researchHandoff.question,
    researchHandoff: args.researchHandoff,
    source,
    usageParts: [],
  };

  const finishTiming = startDataVizTiming(state, "report_builder_agent", {
    model: DATA_VIZ_AGENT_MODEL,
    sourceMode: source.sourceMode,
  });

  try {
    emitAgentEvent(emit, startedAt, {
      phase: "session",
      status: "running",
      label: "Starting report-builder agent",
      detail:
        "Claude will inspect the research handoff, query trial-data tools, and build the visual report.",
    });
    const resolved = await resolveDataVizReport(state, emit, startedAt);
    if (
      resolved.source === "structured_output" &&
      state.charts.length < REQUIRED_CHART_COUNT
    ) {
      emit({
        type: "data_viz_step",
        message: `Claude returned the final recommendation after building ${state.charts.length} chart${state.charts.length === 1 ? "" : "s"}; expected ${REQUIRED_CHART_COUNT}.`,
        ts: Date.now(),
      });
    }

    emitAgentEvent(emit, startedAt, {
      phase: "complete",
      status: "complete",
      label: "Visual report complete",
      detail:
        resolved.source === "structured_output"
          ? "Claude returned the final recommendation."
          : "Final report assembled from the completed chart set.",
    });
    emit({
      type: "data_viz_complete",
      recommendation: resolved.report.recommendation,
      rationale: resolved.report.rationale,
      caveats: resolved.report.caveats,
      totalUsage: sumUsage(state.usageParts),
      ts: Date.now(),
    });
    finishTiming("finish", {
      chartCount: state.charts.length,
      elapsedMs: Date.now() - startedAt,
      finalReportSource: resolved.source,
      fallbackReason: resolved.fallbackReason,
      usageCostUsd:
        resolved.agentUsageCostUsd ?? sumUsage(state.usageParts).costUsd,
    });
  } catch (err) {
    finishTiming("error", {
      chartCount: state.charts.length,
      error: errorMessage(err),
    });
    throw err;
  }
}

async function resolveDataVizReport(
  state: DataVizRunState,
  emit: (event: DataVizStreamEvent) => void,
  startedAt: number,
): Promise<ResolvedDataVizReport> {
  let result: SDKResultMessage;
  try {
    result = await callDataVizAgent(state, emit, startedAt);
  } catch (err) {
    if (
      err instanceof DataVizFinalReportFallbackError &&
      state.charts.length >= REQUIRED_CHART_COUNT
    ) {
      return fallbackDataVizReport(state, emit, err.reason);
    }
    throw err;
  }

  const agentUsage = usageFromAgentResult(result, {
    fallbackModel: DATA_VIZ_AGENT_MODEL,
  });
  state.usageParts.push(agentUsage);
  const parsed =
    result.subtype === "success" ? parseDataVizResult(result) : undefined;
  emitStructuredOutputTiming(state, result, parsed);

  if (result.subtype === "success" && parsed?.success) {
    return {
      agentUsageCostUsd: agentUsage.costUsd,
      report: parsed.data,
      source: "structured_output",
    };
  }

  if (state.charts.length >= REQUIRED_CHART_COUNT) {
    const reason =
      result.subtype !== "success"
        ? result.subtype
        : (parsedError(parsed) ?? "missing_structured_output");
    return fallbackDataVizReport(state, emit, reason, agentUsage.costUsd);
  }

  if (result.subtype !== "success") {
    throw new Error(sdkResultErrorMessage(result));
  }
  throw new Error(
    parsedError(parsed) ??
      "Claude Agent SDK did not return the required structured report.",
  );
}

function parsedError(
  parsed: DataVizResultParse | undefined,
): string | undefined {
  return parsed && !parsed.success ? parsed.error : undefined;
}

function fallbackDataVizReport(
  state: DataVizRunState,
  emit: (event: DataVizStreamEvent) => void,
  reason: string,
  agentUsageCostUsd?: number,
): ResolvedDataVizReport {
  emitTiming(state, {
    chartCount: state.charts.length,
    phase: "event",
    reason,
    sdkEvent: "final_report_fallback",
    stage: "agent_sdk",
  });
  emit({
    type: "data_viz_step",
    message: "Assembled the final report from the completed chart set.",
    ts: Date.now(),
  });
  return {
    agentUsageCostUsd,
    fallbackReason: reason,
    report: buildFallbackDataVizReport(state),
    source: "chart_fallback",
  };
}

async function callDataVizAgent(
  state: DataVizRunState,
  emit: (event: DataVizStreamEvent) => void,
  startedAt: number,
): Promise<SDKResultMessage> {
  const effort = orchestratorEffort(DATA_VIZ_AGENT_MODEL);
  const thinking = orchestratorThinking();

  emitTiming(state, {
    effort,
    maxTurns: DATA_VIZ_MAX_TURNS,
    model: DATA_VIZ_AGENT_MODEL,
    phase: "event",
    sdkEvent: "query_created",
    sdkStartupMode: "pending",
    stage: "agent_sdk",
    thinking: thinking.type,
    toolCount: allowedDataVizTools.length,
  });

  let result: SDKResultMessage | undefined;
  const manager = getAgentSdkRuntimeManager();
  const runtimeTiming: AgentSdkRuntimeTimingSink = (event) => {
    emitTiming(state, event);
  };
  const claim = await manager.claimWarmProfile(
    dataVizAgentSdkWarmProfile,
    { state, emit, startedAt },
    {
      liveAbortController: state.args.abortController,
      maxStartupWaitMs: sdkLiveStartupWaitMs(),
      onTiming: runtimeTiming,
    },
  );
  let messages: Query | undefined;
  const sdkStartupMode = claim ? "warm_query" : "cold_query";
  const finalReportStopController = new AbortController();
  const finalReportGraceMs = dataVizFinalReportGraceMs();
  let coldQueryAbort: LinkedAbortController | undefined;
  let coldRunStreamFinished = false;
  let finalReportTimedOut = false;
  let finalReportTimer: ReturnType<typeof setTimeout> | undefined;
  const clearFinalReportTimer = () => {
    if (!finalReportTimer) return;
    clearTimeout(finalReportTimer);
    finalReportTimer = undefined;
  };
  const stopAgentStream = () => {
    finalReportStopController.abort();
    claim?.abort();
    coldQueryAbort?.controller.abort();
    messages?.close();
  };
  const requestFinalReportFallback = () => {
    if (finalReportTimedOut || result) return;
    finalReportTimedOut = true;
    emitTiming(state, {
      chartCount: state.charts.length,
      elapsedMs: Date.now() - startedAt,
      finalReportGraceMs,
      finalReportReadyElapsedMs: state.finalReportReadyAt
        ? Date.now() - state.finalReportReadyAt
        : undefined,
      phase: "event",
      sdkEvent: "final_report_grace_elapsed",
      sdkStartupMode,
      stage: "agent_sdk",
    });
    stopAgentStream();
  };
  const startFinalReportGrace = () => {
    if (
      finalReportTimer ||
      result ||
      state.charts.length < REQUIRED_CHART_COUNT
    ) {
      return;
    }
    emitTiming(state, {
      chartCount: state.charts.length,
      elapsedMs: Date.now() - startedAt,
      finalReportGraceMs,
      phase: "event",
      sdkEvent: "final_report_grace_started",
      sdkStartupMode,
      stage: "agent_sdk",
    });
    finalReportTimer = setTimeout(
      requestFinalReportFallback,
      finalReportGraceMs,
    );
  };
  state.onFinalChartsReady = startFinalReportGrace;
  try {
    if (claim) {
      messages = claim.query(dataVizRunPrompt(state));
    } else {
      const mcpServer = createDataVizToolServer(state, emit, startedAt);
      coldQueryAbort = linkedAbortController(state.args.abortController);
      messages = query({
        prompt: dataVizRunPrompt(state),
        options: await buildDataVizSdkOptions({
          abortController: coldQueryAbort.controller,
          mcpServer,
          runId: state.args.runId,
          telemetryAction: "data-viz",
        }),
      });
    }

    emitTiming(state, {
      elapsedMs: Date.now() - startedAt,
      phase: "event",
      sdkEvent: "query_started",
      sdkStartupMode,
      stage: "agent_sdk",
    });

    let messageCount = 0;
    try {
      for await (const message of withAgentSdkMessageTimeouts(messages, {
        firstMessageTimeoutMs: claim
          ? sdkWarmFirstMessageTimeoutMs()
          : sdkColdFirstMessageTimeoutMs(),
        idleTimeoutMs: sdkIdleTimeoutMs(),
        profile: "data-viz",
        stopSignal: finalReportStopController.signal,
        onTimeout: (err) => {
          emitTiming(state, {
            elapsedMs: Date.now() - startedAt,
            error: err.message,
            phase: "event",
            sdkEvent: err.timeoutKind,
            sdkStartupMode,
            stage: "agent_sdk",
          });
          claim?.abort();
          messages?.close();
        },
      })) {
        messageCount += 1;
        emitTiming(state, {
          ...describeSdkMessage(message, messageCount),
          elapsedMs: Date.now() - startedAt,
          phase: "event",
          sdkEvent: "message",
          stage: "agent_sdk",
        });
        const event = dataVizAgentEventFromSdkMessage(message, startedAt);
        if (event) emit(event);
        if (message.type === "result") {
          result = message;
          clearFinalReportTimer();
        }
        startFinalReportGrace();
      }
    } catch (err) {
      if (!finalReportTimedOut) throw err;
      emitTiming(state, {
        chartCount: state.charts.length,
        elapsedMs: Date.now() - startedAt,
        error: errorMessage(err),
        phase: "event",
        sdkEvent: "final_report_stream_stopped",
        sdkStartupMode,
        stage: "agent_sdk",
      });
    }

    emitTiming(state, {
      elapsedMs: Date.now() - startedAt,
      messageCount,
      phase: "event",
      sdkEvent: "stream_finished",
      sdkStartupMode,
      stage: "agent_sdk",
      subtype: result?.subtype,
    });
    coldRunStreamFinished = !claim;
  } finally {
    clearFinalReportTimer();
    state.onFinalChartsReady = undefined;
    coldQueryAbort?.detach();
    if (claim) {
      claim.finish({ replenish: true });
    } else if (coldRunStreamFinished) {
      void manager.ensureWarmProfile(dataVizAgentSdkWarmProfile, {
        onTiming: runtimeTiming,
        reason: "replenish_after_cold_live_run",
      });
    }
  }

  if (!result) {
    if (finalReportTimedOut) {
      throw new DataVizFinalReportFallbackError(
        "final_report_grace_elapsed",
        finalReportGraceMs,
      );
    }
    if (state.charts.length >= REQUIRED_CHART_COUNT) {
      throw new DataVizFinalReportFallbackError(
        "no_result_after_completed_charts",
        finalReportGraceMs,
      );
    }
    if (state.args.abortController?.signal.aborted) {
      throw abortError("Claude Agent SDK stream was aborted.");
    }
    throw new Error("Claude Agent SDK returned no result message");
  }
  return result;
}

async function buildDataVizSdkOptions({
  abortController,
  mcpServer,
  runId,
  telemetryAction,
}: {
  abortController?: AbortController;
  mcpServer: McpServerConfig;
  runId?: string;
  telemetryAction: string;
}): Promise<Options> {
  const pathToClaudeCodeExecutable = resolveClaudeExecutablePath();
  const runtimePaths = claudeAgentRuntimePaths("data-viz");
  await ensureClaudeAgentRuntime(runtimePaths);
  const effort = orchestratorEffort(DATA_VIZ_AGENT_MODEL);
  const thinking = orchestratorThinking();

  return {
    model: DATA_VIZ_AGENT_MODEL,
    systemPrompt: dataVizAgentPrompt(),
    tools: [],
    cwd: runtimePaths.cwd,
    mcpServers: { novamind_data_viz_report_builder: mcpServer },
    allowedTools: [...allowedDataVizTools],
    strictMcpConfig: true,
    permissionMode: "dontAsk",
    persistSession: false,
    maxTurns: DATA_VIZ_MAX_TURNS,
    maxBudgetUsd: 0.35,
    effort,
    thinking,
    settingSources: [],
    skills: [],
    includePartialMessages: true,
    outputFormat: {
      type: "json_schema",
      schema: claudeStructuredOutputSchema(DataVizOrchestratorResultSchema),
    },
    abortController,
    env: claudeAgentEnv(
      {
        "novamind.action": telemetryAction,
        "novamind.agent_profile": "data-viz",
        "novamind.component": "data-viz-report-builder",
        "novamind.run_id": runId,
      },
      runtimePaths,
    ),
    debug: process.env.NOVAMIND_AGENT_SDK_DEBUG === "true",
    debugFile: process.env.NOVAMIND_AGENT_SDK_DEBUG_FILE || undefined,
    stderr: (data) => {
      if (process.env.NOVAMIND_AGENT_SDK_DEBUG === "true") {
        process.stderr.write(data);
      }
    },
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
  };
}

function dataVizSourceSummary(
  sourceInfo: ClinicalTrialsDatasetSource,
): DataVizSourceSummary {
  const { dataset } = sourceInfo;
  return {
    source: "ClinicalTrials.gov",
    sourceMode: sourceInfo.mode,
    sourceName: sourceInfo.name,
    isFixture: sourceInfo.isFixture,
    sourceDataTimestamp: dataset._sourceDataTimestamp,
    studyCount: dataset.studies.length,
    outcomeCount: dataset.outcomes.length,
    adverseEventCount: dataset.adverseEvents.length,
  };
}

function emitStructuredOutputTiming(
  state: DataVizRunState,
  result: SDKResultMessage,
  parsed: DataVizResultParse | undefined,
): void {
  emitTiming(state, {
    chartCount: state.charts.length,
    hasStructuredOutput:
      result.subtype === "success" && result.structured_output !== undefined,
    phase: "event",
    rawKeys: parsed?.rawKeys,
    rawType: parsed?.rawType,
    sdkEvent: "structured_output",
    stage: "agent_sdk",
    structuredOutputSource: parsed?.source,
    structuredOutputValid: parsed?.success ?? false,
    structuredParseError: parsed && !parsed.success ? parsed.error : undefined,
    subtype: result.subtype,
  });
}

function sdkResultErrorMessage(result: SDKResultMessage): string {
  if (result.subtype === "error_max_structured_output_retries") {
    return "Claude Agent SDK could not produce the required structured report after its structured-output retries.";
  }
  const errors = resultErrors(result);
  return errors?.join("; ") ?? `Claude Agent SDK failed with ${result.subtype}`;
}

function resultErrors(result: SDKResultMessage): string[] | undefined {
  const errors = (result as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return undefined;
  const messages = errors.filter(
    (error): error is string => typeof error === "string",
  );
  return messages.length > 0 ? messages : undefined;
}

class DataVizFinalReportFallbackError extends Error {
  constructor(
    readonly reason: string,
    readonly graceMs: number,
  ) {
    super(
      `Data-viz final report fallback requested after ${graceMs}ms: ${reason}`,
    );
    this.name = "DataVizFinalReportFallbackError";
  }
}

interface LinkedAbortController {
  controller: AbortController;
  detach: () => void;
}

function linkedAbortController(
  source: AbortController | undefined,
): LinkedAbortController {
  const controller = new AbortController();
  if (!source) return { controller, detach: () => undefined };
  if (source.signal.aborted) {
    controller.abort();
    return { controller, detach: () => undefined };
  }
  const abort = () => controller.abort();
  source.signal.addEventListener("abort", abort, { once: true });
  return {
    controller,
    detach: () => source.signal.removeEventListener("abort", abort),
  };
}

function dataVizFinalReportGraceMs(): number {
  const raw = process.env.NOVAMIND_DATA_VIZ_FINAL_REPORT_GRACE_MS;
  if (!raw) return DEFAULT_FINAL_REPORT_GRACE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_FINAL_REPORT_GRACE_MS;
}
