import {
  isInternalSdkTool,
  sdkContentBlockTypes,
  sdkToolUseNames,
  shortSdkToolName,
} from "../agent-sdk/messages";
import {
  emitAgentLoopEvent,
  type AgentLoopEventPayload,
  type LiteratureEventSink,
} from "./events";

type AgentLoopProgress = Omit<AgentLoopEventPayload, "elapsedMs">;
type SdkMessageLike = {
  content?: unknown;
  message?: unknown;
  subtype?: unknown;
  type: string;
};

type AgentLoopMessageMapper = (
  message: SdkMessageLike,
) => AgentLoopProgress | undefined;

/**
 * Creates the product-facing Agent SDK loop event sink. It deliberately emits
 * milestones, not raw model text or hidden thinking content, so the transcript
 * can show useful progress without coupling to Claude Code internals.
 */
export function createAgentLoopEmitter(
  emit: LiteratureEventSink,
  startedAt: number,
): (event: AgentLoopProgress) => void {
  let lastKey = "";
  return (event) => {
    const key = [
      event.phase,
      event.status,
      event.label,
      event.tool ?? "",
      event.detail ?? "",
    ].join(":");
    if (key === lastKey) return;
    lastKey = key;
    emitAgentLoopEvent(emit, {
      ...event,
      elapsedMs: Date.now() - startedAt,
    });
  };
}

/**
 * Creates a stateful mapper from stable SDK message metadata to user-visible
 * loop states. Internal SDK tools, such as the structured-output validator,
 * are represented as model finalization progress instead of leaking SDK
 * implementation details into the product transcript.
 */
export function createAgentLoopMessageMapper(): AgentLoopMessageMapper {
  let awaitingInternalStructuredOutputResult = false;

  return (message) => {
    const event = mapAgentLoopEventFromSdkMessage(
      message,
      awaitingInternalStructuredOutputResult,
    );
    awaitingInternalStructuredOutputResult =
      event.awaitingInternalStructuredOutputResult;
    return event.progress;
  };
}

function mapAgentLoopEventFromSdkMessage(
  message: SdkMessageLike,
  awaitingInternalStructuredOutputResult: boolean,
): {
  awaitingInternalStructuredOutputResult: boolean;
  progress: AgentLoopProgress | undefined;
} {
  const record = message as unknown as Record<string, unknown>;
  if (message.type === "system" && record.subtype === "init") {
    return {
      awaitingInternalStructuredOutputResult,
      progress: {
        phase: "session",
        status: "complete",
        label: "Orchestrator ready",
        detail: "Initialized the isolated Agent SDK session.",
      },
    };
  }

  if (message.type === "assistant") {
    const toolNames = (sdkToolUseNames(record) ?? []).map(shortSdkToolName);
    const publicTool = toolNames.find((tool) => !isInternalSdkTool(tool));
    if (publicTool) {
      return {
        awaitingInternalStructuredOutputResult: false,
        progress: {
          phase: "tool",
          status: "running",
          label: toolStartLabel(publicTool),
          detail:
            "The orchestrator chose the next typed tool in the research trajectory.",
          tool: publicTool,
        },
      };
    }

    if (toolNames.some(isInternalSdkTool)) {
      return {
        awaitingInternalStructuredOutputResult: true,
        progress: finalizingStructuredOutputProgress(),
      };
    }

    if (sdkContentBlockTypes(record)?.includes("thinking")) {
      return {
        awaitingInternalStructuredOutputResult: false,
        progress: {
          phase: "model",
          status: "running",
          label: "Claude is planning the next step",
          detail: "Planning the next tool call and validation step.",
        },
      };
    }

    return {
      awaitingInternalStructuredOutputResult: false,
      progress: finalizingStructuredOutputProgress(),
    };
  }

  if (
    message.type === "user" &&
    sdkContentBlockTypes(record)?.includes("tool_result")
  ) {
    if (awaitingInternalStructuredOutputResult) {
      return {
        awaitingInternalStructuredOutputResult: false,
        progress: undefined,
      };
    }
    return {
      awaitingInternalStructuredOutputResult,
      progress: {
        phase: "tool",
        status: "complete",
        label: "Tool result returned",
        detail:
          "Claude received a typed tool response and can decide whether to continue or recover.",
      },
    };
  }

  return { awaitingInternalStructuredOutputResult, progress: undefined };
}

function toolStartLabel(toolName: string): string {
  switch (toolName) {
    case "search_literature":
      return "Starting literature search...";
    case "extract_candidate_claims":
      return "Starting claim extraction...";
    case "verify_citations":
      return "Starting citation verifier...";
    case "synthesize_hypothesis":
      return "Starting hypothesis synthesis...";
    default:
      return `Starting ${toolName.replaceAll("_", " ")}...`;
  }
}

function finalizingStructuredOutputProgress(): AgentLoopProgress {
  return {
    phase: "model",
    status: "running",
    label: "Claude is finalizing structured output",
    detail: "Returning the terminal typed result for SDK validation.",
  };
}
