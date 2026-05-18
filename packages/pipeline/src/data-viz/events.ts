import type { DataVizStreamEvent } from "@novamind/shared";
import {
  isInternalSdkTool,
  sdkContentBlockTypes,
  sdkToolUseNames,
  shortSdkToolName,
} from "../agent-sdk/messages";
import type {
  DataVizRunState,
  DataVizTimingEvent,
  DataVizTimingPhase,
  DataVizToolName,
} from "./types";

type DataVizAgentProgress = Omit<
  Extract<DataVizStreamEvent, { type: "data_viz_agent_event" }>,
  "type" | "ts"
>;

export function dataVizAgentEventFromSdkMessage(
  message: { type: string },
  startedAt: number,
): DataVizStreamEvent | undefined {
  const record = message as unknown as Record<string, unknown>;
  if (message.type === "system" && record.subtype === "init") {
    return dataVizAgentEvent(startedAt, {
      phase: "session",
      status: "complete",
      label: "Agent SDK session ready",
      detail: "Initialized the isolated report-builder session.",
    });
  }
  if (message.type === "assistant") {
    const toolName = sdkToolUseNames(record)?.[0];
    if (toolName) {
      const tool = shortSdkToolName(toolName);
      if (isInternalSdkTool(tool)) return undefined;
      return dataVizAgentEvent(startedAt, {
        phase: "tool",
        status: "running",
        label: `Calling ${friendlyToolName(tool)}`,
        detail: "The report-builder chose the next trial-data tool.",
        tool,
      });
    }
    if (sdkContentBlockTypes(record)?.includes("thinking")) {
      return dataVizAgentEvent(startedAt, {
        phase: "model",
        status: "running",
        label: "Claude is planning the report",
        detail: "Choosing which trial-data slice to inspect next.",
      });
    }
    return dataVizAgentEvent(startedAt, {
      phase: "model",
      status: "running",
      label: "Claude is coordinating the visual report",
      detail: "Preparing the next chart decision or final recommendation.",
    });
  }
  if (
    message.type === "user" &&
    sdkContentBlockTypes(record)?.includes("tool_result")
  ) {
    return dataVizAgentEvent(startedAt, {
      phase: "tool",
      status: "complete",
      label: "Tool result returned",
      detail: "Claude received the typed result and can choose the next chart.",
    });
  }
  return undefined;
}

export function emitAgentEvent(
  emit: (event: DataVizStreamEvent) => void,
  startedAt: number,
  event: Omit<DataVizAgentProgress, "elapsedMs">,
): void {
  emit(dataVizAgentEvent(startedAt, event));
}

export function emitToolCall(
  emit: (event: DataVizStreamEvent) => void,
  toolName: DataVizToolName,
  input: unknown,
): void {
  emit({
    type: "data_viz_tool_call",
    tool: toolName,
    input,
    ts: Date.now(),
  });
}

export function emitToolResult(
  emit: (event: DataVizStreamEvent) => void,
  toolName: DataVizToolName,
  output: unknown,
): void {
  emit({
    type: "data_viz_tool_result",
    tool: toolName,
    output,
    ts: Date.now(),
  });
}

export function startDataVizTiming(
  state: DataVizRunState,
  stage: string,
  fields: Record<string, unknown> = {},
): (phase: DataVizTimingPhase, fields?: Record<string, unknown>) => void {
  const startedAt = Date.now();
  emitTiming(state, { ...fields, phase: "start", stage });
  return (phase, nextFields = {}) => {
    emitTiming(state, {
      ...fields,
      ...nextFields,
      elapsedMs: Date.now() - startedAt,
      phase,
      stage,
    });
  };
}

export function emitTiming(
  state: DataVizRunState,
  event: DataVizTimingEvent,
): void {
  state.args.onTiming?.(event);
}

export function throwIfAborted(state: DataVizRunState): void {
  if (state.args.abortController?.signal.aborted) {
    throw abortError("Data-viz stream was aborted.");
  }
}

export function abortError(message: string): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function dataVizAgentEvent(
  startedAt: number,
  event: Omit<DataVizAgentProgress, "elapsedMs">,
): DataVizStreamEvent {
  return {
    type: "data_viz_agent_event",
    ...event,
    elapsedMs: Date.now() - startedAt,
    ts: Date.now(),
  };
}

function friendlyToolName(toolName: string): string {
  switch (toolName) {
    case "inspect_research_handoff":
      return "research handoff";
    case "profile_trial_dataset":
      return "trial dataset profile";
    case "build_trial_chart":
      return "trial chart builder";
    default:
      return toolName.replaceAll("_", " ");
  }
}
