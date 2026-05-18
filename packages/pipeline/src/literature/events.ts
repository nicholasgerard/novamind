import {
  ZERO_USAGE,
  type AgentLoopEvent,
  type LiteratureStageId,
  type StreamEvent,
  type TokenUsage,
} from "@novamind/shared";
import { ORCHESTRATOR_MODEL } from "../model-config";
export { AsyncEventQueue } from "../async-event-queue";

export type LiteratureEventSink = (event: StreamEvent) => void;
export type AgentLoopEventPayload = Omit<AgentLoopEvent, "type" | "ts">;

export function emitStageStarted(
  emit: LiteratureEventSink,
  stage: LiteratureStageId,
  model: string,
): void {
  emit({ type: "literature_stage_started", stage, model, ts: Date.now() });
}

export function emitStageMessage(
  emit: LiteratureEventSink,
  stage: LiteratureStageId,
  text: string,
): void {
  emit({ type: "literature_stage_message", stage, text, ts: Date.now() });
}

export function emitStageFinished(
  emit: LiteratureEventSink,
  stage: LiteratureStageId,
  usage: TokenUsage,
): void {
  emit({ type: "literature_stage_finished", stage, usage, ts: Date.now() });
}

export function emitOrchestratorNote(
  emit: LiteratureEventSink,
  text: string,
  usage: TokenUsage = ZERO_USAGE,
): void {
  emitStageStarted(emit, "orchestrator", ORCHESTRATOR_MODEL);
  emitStageMessage(emit, "orchestrator", text);
  emitStageFinished(emit, "orchestrator", usage);
}

export function emitAgentLoopEvent(
  emit: LiteratureEventSink,
  event: AgentLoopEventPayload,
): void {
  emit({ type: "agent_loop_event", ...event, ts: Date.now() });
}

export function emitToolCall(
  emit: LiteratureEventSink,
  stage: LiteratureStageId,
  tool: string,
  input: unknown,
): void {
  emit({ type: "tool_call", stage, tool, input, ts: Date.now() });
}

export function emitToolResult(
  emit: LiteratureEventSink,
  stage: LiteratureStageId,
  tool: string,
  output: unknown,
): void {
  emit({ type: "tool_result", stage, tool, output, ts: Date.now() });
}
