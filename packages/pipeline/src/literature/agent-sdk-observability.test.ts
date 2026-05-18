import { describe, expect, it } from "vitest";
import { createAgentLoopMessageMapper } from "./agent-sdk-observability";

describe("literature Agent SDK observability", () => {
  it("maps public tool-use messages to product-facing tool labels", () => {
    const mapMessage = createAgentLoopMessageMapper();

    expect(
      mapMessage({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "mcp__novamind_literature_orchestrator__verify_citations",
            },
          ],
        },
      }),
    ).toMatchObject({
      phase: "tool",
      status: "running",
      label: "Starting citation verifier...",
      tool: "verify_citations",
    });
  });

  it("maps terminal assistant text to structured-output finalization", () => {
    const mapMessage = createAgentLoopMessageMapper();

    expect(
      mapMessage({
        type: "assistant",
        message: {
          content: [{ type: "text", text: '{"status":"complete"}' }],
        },
      }),
    ).toMatchObject({
      phase: "model",
      status: "running",
      label: "Claude is finalizing structured output",
    });
  });

  it("hides internal structured-output tool results from the product stream", () => {
    const mapMessage = createAgentLoopMessageMapper();

    expect(
      mapMessage({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "StructuredOutput" }],
        },
      }),
    ).toMatchObject({
      phase: "model",
      status: "running",
      label: "Claude is finalizing structured output",
    });

    expect(
      mapMessage({
        type: "user",
        message: {
          content: [{ type: "tool_result", content: "ok" }],
        },
      }),
    ).toBeUndefined();
  });
});
