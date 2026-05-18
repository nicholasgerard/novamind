import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@novamind/shared/events";
import { getLiveStatus } from "./stream-helpers";

describe("literature chat stream helpers", () => {
  it("renders backend-owned Agent SDK model labels without stage-order inference", () => {
    const status = getLiveStatus([
      {
        type: "agent_loop_event",
        phase: "model",
        status: "running",
        label: "Claude is finalizing structured output",
        detail: "Returning the terminal typed result for SDK validation.",
        elapsedMs: 12_000,
        ts: 1,
      },
    ]);

    expect(status).toMatchObject({
      icon: "brain",
      label: "Claude is finalizing structured output",
      tone: "active",
    });
  });

  it("renders backend-owned Agent SDK tool labels", () => {
    const status = getLiveStatus([
      {
        type: "agent_loop_event",
        phase: "tool",
        status: "running",
        label: "Starting citation verifier...",
        tool: "verify_citations",
        elapsedMs: 8_000,
        ts: 1,
      },
    ]);

    expect(status).toMatchObject({
      icon: "tool",
      label: "Starting citation verifier...",
      tone: "active",
    });
  });

  it("renders backend-owned Agent SDK completion labels", () => {
    const status = getLiveStatus([
      {
        type: "agent_loop_event",
        phase: "complete",
        status: "complete",
        label: "Agent loop complete",
        elapsedMs: 18_000,
        ts: 1,
      },
    ]);

    expect(status).toMatchObject({
      icon: "check",
      label: "Agent loop complete",
      tone: "settled",
    });
  });

  it("renders SDK loop errors with error tone", () => {
    const status = getLiveStatus([
      {
        type: "agent_loop_event",
        phase: "complete",
        status: "error",
        label: "Agent loop ended with an SDK error",
        elapsedMs: 18_000,
        ts: 1,
      },
    ]);

    expect(status).toMatchObject({
      icon: "tool",
      label: "Agent loop ended with an SDK error",
      tone: "error",
    });
  });

  it("does not let terminal events replace the latest live activity", () => {
    const events: StreamEvent[] = [
      {
        type: "agent_loop_event",
        phase: "model",
        status: "running",
        label: "Claude is finalizing structured output",
        ts: 1,
      },
      {
        type: "pipeline_result",
        result: {
          confidence: 0.8,
          evidence: [],
          hypothesis: "Done.",
        },
        totalUsage: {
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
        ts: 2,
      },
    ];

    expect(getLiveStatus(events).label).toBe(
      "Claude is finalizing structured output",
    );
  });
});
