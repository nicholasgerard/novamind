import type {
  DataVizChart,
  DataVizAgentEvent,
  DataVizSourceSummary,
  DataVizStreamEvent,
} from "@novamind/shared/data-viz-events";
import type { EvalStreamEvent } from "@novamind/shared/eval-events";
import type {
  AgentLoopEvent,
  HypothesisResult,
  LiteratureStageId,
  StreamEvent,
  TokenUsage,
} from "@novamind/shared/events";

type UnknownRecord = Record<string, unknown>;

const literatureStages = new Set([
  "search",
  "claim_extractor",
  "citation_verifier",
  "hypothesis",
  "orchestrator",
]);
const agentLoopPhases = new Set<AgentLoopEvent["phase"]>([
  "session",
  "model",
  "tool",
  "recovery",
  "complete",
]);
const agentLoopStatuses = new Set<AgentLoopEvent["status"]>([
  "running",
  "complete",
  "error",
]);
const dataVizAgentPhases = new Set<DataVizAgentEvent["phase"]>([
  "data",
  "session",
  "model",
  "tool",
  "chart",
  "recovery",
  "complete",
]);
const dataVizAgentStatuses = new Set<DataVizAgentEvent["status"]>([
  "running",
  "complete",
  "error",
]);
const chartKinds = new Set([
  "bar",
  "horizontal_bar",
  "line",
  "scatter",
  "heatmap",
]);
const literatureTerminalEventTypes = new Set(["pipeline_result", "error"]);
const dataVizTerminalEventTypes = new Set([
  "data_viz_complete",
  "data_viz_error",
]);
const evalTerminalEventTypes = new Set(["eval_complete", "eval_error"]);

/**
 * Lightweight client-side guards for trusted SSE contracts. Server routes keep
 * the canonical Zod validation; these avoid shipping Zod into browser chunks.
 */
export function parseLiteratureStreamEvent(value: unknown): StreamEvent | null {
  const record = asRecord(value);
  if (!record || !isString(record.type) || !isNumber(record.ts)) return null;

  switch (record.type) {
    case "literature_stage_started":
      return isLiteratureStage(record.stage) && isString(record.model)
        ? {
            type: "literature_stage_started",
            stage: record.stage,
            model: record.model,
            ts: record.ts,
          }
        : null;
    case "literature_stage_message":
      return isLiteratureStage(record.stage) && isString(record.text)
        ? {
            type: "literature_stage_message",
            stage: record.stage,
            text: record.text,
            ts: record.ts,
          }
        : null;
    case "agent_loop_event":
      return isAgentLoopPhase(record.phase) &&
        isAgentLoopStatus(record.status) &&
        isString(record.label) &&
        (record.elapsedMs === undefined ||
          (isNumber(record.elapsedMs) && record.elapsedMs >= 0)) &&
        (record.tool === undefined || isString(record.tool)) &&
        (record.turn === undefined || isPositiveInteger(record.turn)) &&
        (record.detail === undefined || isString(record.detail))
        ? {
            type: "agent_loop_event",
            phase: record.phase,
            status: record.status,
            label: record.label,
            ...(isString(record.detail) ? { detail: record.detail } : {}),
            ...(isNumber(record.elapsedMs)
              ? { elapsedMs: record.elapsedMs }
              : {}),
            ...(isString(record.tool) ? { tool: record.tool } : {}),
            ...(isPositiveInteger(record.turn) ? { turn: record.turn } : {}),
            ts: record.ts,
          }
        : null;
    case "tool_call":
      return isLiteratureStage(record.stage) && isString(record.tool)
        ? {
            type: "tool_call",
            stage: record.stage,
            tool: record.tool,
            input: record.input,
            ts: record.ts,
          }
        : null;
    case "tool_result":
      return isLiteratureStage(record.stage) && isString(record.tool)
        ? {
            type: "tool_result",
            stage: record.stage,
            tool: record.tool,
            output: record.output,
            ts: record.ts,
          }
        : null;
    case "literature_stage_finished": {
      const usage = parseTokenUsage(record.usage);
      return isLiteratureStage(record.stage) && usage
        ? {
            type: "literature_stage_finished",
            stage: record.stage,
            usage,
            ts: record.ts,
          }
        : null;
    }
    case "pipeline_result": {
      const result = parseHypothesisResult(record.result);
      const totalUsage = parseTokenUsage(record.totalUsage);
      return result && totalUsage
        ? { type: "pipeline_result", result, totalUsage, ts: record.ts }
        : null;
    }
    case "error":
      return isString(record.message)
        ? { type: "error", message: record.message, ts: record.ts }
        : null;
    default:
      return null;
  }
}

export function parseDataVizStreamEvent(
  value: unknown,
): DataVizStreamEvent | null {
  const record = asRecord(value);
  if (!record || !isString(record.type) || !isNumber(record.ts)) return null;

  switch (record.type) {
    case "data_viz_agent_event":
      return isDataVizAgentPhase(record.phase) &&
        isDataVizAgentStatus(record.status) &&
        isString(record.label) &&
        (record.elapsedMs === undefined ||
          (isNumber(record.elapsedMs) && record.elapsedMs >= 0)) &&
        (record.detail === undefined || isString(record.detail)) &&
        (record.tool === undefined || isString(record.tool))
        ? {
            type: "data_viz_agent_event",
            phase: record.phase,
            status: record.status,
            label: record.label,
            ...(isString(record.detail) ? { detail: record.detail } : {}),
            ...(isNumber(record.elapsedMs)
              ? { elapsedMs: record.elapsedMs }
              : {}),
            ...(isString(record.tool) ? { tool: record.tool } : {}),
            ts: record.ts,
          }
        : null;
    case "data_viz_started": {
      const source = parseSourceSummary(record.source);
      return isString(record.model) && source
        ? {
            type: "data_viz_started",
            model: record.model,
            source,
            ts: record.ts,
          }
        : null;
    }
    case "data_viz_tool_call":
      return isString(record.tool)
        ? {
            type: "data_viz_tool_call",
            tool: record.tool,
            input: record.input,
            ts: record.ts,
          }
        : null;
    case "data_viz_tool_result":
      return isString(record.tool)
        ? {
            type: "data_viz_tool_result",
            tool: record.tool,
            output: record.output,
            ts: record.ts,
          }
        : null;
    case "data_viz_step":
      return isString(record.message)
        ? { type: "data_viz_step", message: record.message, ts: record.ts }
        : null;
    case "data_viz_chart": {
      const chart = parseDataVizChart(record.chart);
      return chart
        ? {
            type: "data_viz_chart",
            chart,
            ...(isString(record.rationale)
              ? { rationale: record.rationale }
              : {}),
            ts: record.ts,
          }
        : null;
    }
    case "data_viz_complete": {
      const totalUsage = parseTokenUsage(record.totalUsage);
      const caveats = stringArray(record.caveats);
      return isString(record.recommendation) &&
        isString(record.rationale) &&
        caveats &&
        totalUsage
        ? {
            type: "data_viz_complete",
            recommendation: record.recommendation,
            rationale: record.rationale,
            caveats,
            totalUsage,
            ts: record.ts,
          }
        : null;
    }
    case "data_viz_error":
      return isString(record.message)
        ? { type: "data_viz_error", message: record.message, ts: record.ts }
        : null;
    default:
      return null;
  }
}

export function parseEvalStreamEvent(value: unknown): EvalStreamEvent | null {
  const record = asRecord(value);
  if (!record || !isString(record.type) || !isNumber(record.ts)) return null;

  switch (record.type) {
    case "eval_started":
      return isString(record.axis) &&
        isNonNegativeInteger(record.caseCount) &&
        isPositiveInteger(record.concurrency)
        ? {
            type: "eval_started",
            axis: record.axis,
            caseCount: record.caseCount,
            concurrency: record.concurrency,
            ts: record.ts,
          }
        : null;
    case "eval_case_started":
      return isString(record.caseId) && isNonNegativeInteger(record.caseIndex)
        ? {
            type: "eval_case_started",
            caseId: record.caseId,
            caseIndex: record.caseIndex,
            ...(isString(record.label) ? { label: record.label } : {}),
            ts: record.ts,
          }
        : null;
    case "eval_case_complete": {
      const scores = numberRecord(record.scores);
      const usage = parseOptionalTokenUsage(record.usage);
      return isString(record.caseId) &&
        isNonNegativeInteger(record.caseIndex) &&
        scores &&
        usage !== null &&
        isNumber(record.elapsedMs) &&
        record.elapsedMs >= 0
        ? {
            type: "eval_case_complete",
            caseId: record.caseId,
            caseIndex: record.caseIndex,
            scores,
            output: record.output,
            ...(usage ? { usage } : {}),
            elapsedMs: record.elapsedMs,
            ...(isString(record.error) ? { error: record.error } : {}),
            ts: record.ts,
          }
        : null;
    }
    case "eval_complete": {
      const averageScores = numberRecord(record.averageScores);
      const totalUsage = parseTokenUsage(record.totalUsage);
      return averageScores &&
        totalUsage &&
        isNumber(record.elapsedMs) &&
        record.elapsedMs >= 0
        ? {
            type: "eval_complete",
            averageScores,
            totalUsage,
            elapsedMs: record.elapsedMs,
            ts: record.ts,
          }
        : null;
    }
    case "eval_error":
      return isString(record.message)
        ? { type: "eval_error", message: record.message, ts: record.ts }
        : null;
    default:
      return null;
  }
}

export function isLiteratureTerminalEventPayload(
  value: unknown,
): value is { type: string } {
  return hasEventType(value, literatureTerminalEventTypes);
}

export function isDataVizTerminalEventPayload(
  value: unknown,
): value is { type: string } {
  return hasEventType(value, dataVizTerminalEventTypes);
}

export function isEvalTerminalEventPayload(
  value: unknown,
): value is { type: string } {
  return hasEventType(value, evalTerminalEventTypes);
}

function parseHypothesisResult(value: unknown): HypothesisResult | null {
  const record = asRecord(value);
  if (!record || !isString(record.hypothesis) || !isNumber(record.confidence)) {
    return null;
  }
  if (record.confidence < 0 || record.confidence > 1) return null;
  const evidenceSource = Array.isArray(record.evidence)
    ? record.evidence
    : null;
  const evidence = evidenceSource
    ? evidenceSource.flatMap((item) => {
        const evidenceItem = asRecord(item);
        return evidenceItem &&
          isString(evidenceItem.citation) &&
          isString(evidenceItem.claim) &&
          typeof evidenceItem.verified === "boolean"
          ? [
              {
                citation: evidenceItem.citation,
                claim: evidenceItem.claim,
                verified: evidenceItem.verified,
              },
            ]
          : [];
      })
    : null;
  if (
    !evidence ||
    !evidenceSource ||
    evidence.length !== evidenceSource.length
  ) {
    return null;
  }
  return {
    hypothesis: record.hypothesis,
    evidence,
    confidence: record.confidence,
  };
}

function parseSourceSummary(value: unknown): DataVizSourceSummary | null {
  const record = asRecord(value);
  if (
    !record ||
    !isString(record.source) ||
    !isSourceMode(record.sourceMode) ||
    !isString(record.sourceName) ||
    typeof record.isFixture !== "boolean" ||
    !isNonNegativeInteger(record.studyCount) ||
    !isNonNegativeInteger(record.outcomeCount) ||
    !isNonNegativeInteger(record.adverseEventCount)
  ) {
    return null;
  }
  return {
    source: record.source,
    sourceMode: record.sourceMode,
    sourceName: record.sourceName,
    isFixture: record.isFixture,
    ...(isString(record.sourceDataTimestamp)
      ? { sourceDataTimestamp: record.sourceDataTimestamp }
      : {}),
    studyCount: record.studyCount,
    outcomeCount: record.outcomeCount,
    adverseEventCount: record.adverseEventCount,
  };
}

function parseDataVizChart(value: unknown): DataVizChart | null {
  const record = asRecord(value);
  const pointsSource = Array.isArray(record?.points) ? record.points : null;
  const points = pointsSource
    ? pointsSource.flatMap((point) => {
        const item = asRecord(point);
        return item && isString(item.label) && isNumber(item.value)
          ? [
              {
                label: item.label,
                value: item.value,
                ...(isString(item.group) ? { group: item.group } : {}),
                ...(isNumber(item.secondaryValue)
                  ? { secondaryValue: item.secondaryValue }
                  : {}),
                ...(isNumber(item.low) ? { low: item.low } : {}),
                ...(isNumber(item.high) ? { high: item.high } : {}),
              },
            ]
          : [];
      })
    : null;

  if (
    !record ||
    !isString(record.id) ||
    !isString(record.title) ||
    !isString(record.subtitle) ||
    !isChartKind(record.kind) ||
    !isString(record.xLabel) ||
    !isString(record.yLabel) ||
    !points ||
    !pointsSource ||
    points.length !== pointsSource.length ||
    !isString(record.summary)
  ) {
    return null;
  }
  return {
    id: record.id,
    title: record.title,
    subtitle: record.subtitle,
    kind: record.kind,
    xLabel: record.xLabel,
    yLabel: record.yLabel,
    points,
    summary: record.summary,
    ...(isString(record.sourceNote) ? { sourceNote: record.sourceNote } : {}),
  };
}

function parseOptionalTokenUsage(
  value: unknown,
): TokenUsage | undefined | null {
  return value === undefined ? undefined : parseTokenUsage(value);
}

function parseTokenUsage(value: unknown): TokenUsage | null {
  const record = asRecord(value);
  // Mirror TokenUsageSchema defaults without shipping Zod in client chunks.
  const cacheReadTokens =
    record?.cacheReadTokens === undefined ? 0 : record.cacheReadTokens;
  const cacheCreationTokens =
    record?.cacheCreationTokens === undefined ? 0 : record.cacheCreationTokens;
  if (
    !record ||
    !isNonNegativeInteger(record.inputTokens) ||
    !isNonNegativeInteger(record.outputTokens) ||
    !isNonNegativeInteger(cacheReadTokens) ||
    !isNonNegativeInteger(cacheCreationTokens) ||
    !isNumber(record.costUsd) ||
    record.costUsd < 0
  ) {
    return null;
  }
  return {
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    costUsd: record.costUsd,
    ...(isNonNegativeNumber(record.uncachedCostUsd)
      ? { uncachedCostUsd: record.uncachedCostUsd }
      : {}),
    ...(isNonNegativeNumber(record.cacheSavingsUsd)
      ? { cacheSavingsUsd: record.cacheSavingsUsd }
      : {}),
  };
}

function numberRecord(value: unknown): Record<string, number> | null {
  const record = asRecord(value);
  if (!record) return null;
  const entries = Object.entries(record);
  if (entries.some((entry) => !isNumber(entry[1]))) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(isString) ? value : null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function hasEventType(
  value: unknown,
  eventTypes: ReadonlySet<string>,
): value is { type: string } {
  const record = asRecord(value);
  return Boolean(
    record && isString(record.type) && eventTypes.has(record.type),
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isNumber(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isLiteratureStage(value: unknown): value is LiteratureStageId {
  return isString(value) && literatureStages.has(value);
}

function isAgentLoopPhase(value: unknown): value is AgentLoopEvent["phase"] {
  return (
    isString(value) && agentLoopPhases.has(value as AgentLoopEvent["phase"])
  );
}

function isAgentLoopStatus(value: unknown): value is AgentLoopEvent["status"] {
  return (
    isString(value) && agentLoopStatuses.has(value as AgentLoopEvent["status"])
  );
}

function isDataVizAgentPhase(
  value: unknown,
): value is DataVizAgentEvent["phase"] {
  return (
    isString(value) &&
    dataVizAgentPhases.has(value as DataVizAgentEvent["phase"])
  );
}

function isDataVizAgentStatus(
  value: unknown,
): value is DataVizAgentEvent["status"] {
  return (
    isString(value) &&
    dataVizAgentStatuses.has(value as DataVizAgentEvent["status"])
  );
}

function isChartKind(value: unknown): value is DataVizChart["kind"] {
  return isString(value) && chartKinds.has(value);
}

function isSourceMode(
  value: unknown,
): value is DataVizSourceSummary["sourceMode"] {
  return value === "r2" || value === "local" || value === "fixture";
}
