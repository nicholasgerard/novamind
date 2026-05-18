import { describe, expect, it } from "vitest";
import {
  isDataVizTerminalEventPayload,
  isEvalTerminalEventPayload,
  isLiteratureTerminalEventPayload,
  parseDataVizStreamEvent,
  parseEvalStreamEvent,
  parseLiteratureStreamEvent,
} from "./client-stream-events";
import { readJsonSseStream } from "./sse-client";

const usage = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0.001,
};

describe("client stream event guards", () => {
  it("accepts valid literature events and drops malformed payloads", () => {
    expect(
      parseLiteratureStreamEvent({
        type: "literature_stage_started",
        stage: "search",
        model: "claude-haiku-4-5",
        ts: 1,
      }),
    ).toMatchObject({ type: "literature_stage_started", stage: "search" });

    expect(
      parseLiteratureStreamEvent({
        type: "literature_stage_started",
        stage: "unknown_stage",
        model: "claude-haiku-4-5",
        ts: 1,
      }),
    ).toBeNull();
  });

  it("mirrors shared token-usage defaults for terminal literature events", () => {
    expect(
      parseLiteratureStreamEvent({
        type: "pipeline_result",
        result: {
          hypothesis: "GLP-1 trials support a qualified HbA1c hypothesis.",
          evidence: [
            {
              citation: "PMID 1",
              claim: "Semaglutide reduced HbA1c versus placebo.",
              verified: true,
            },
          ],
          confidence: 0.84,
        },
        totalUsage: {
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.001,
        },
        ts: 2,
      }),
    ).toMatchObject({
      type: "pipeline_result",
      totalUsage: {
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    });
  });

  it("accepts agent-loop progress events and rejects invalid loop metadata", () => {
    expect(
      parseLiteratureStreamEvent({
        type: "agent_loop_event",
        phase: "tool",
        status: "running",
        label: "Tool selected: search literature",
        detail: "Claude selected the retrieval tool.",
        elapsedMs: 1200,
        tool: "search_literature",
        turn: 1,
        ts: 2,
      }),
    ).toMatchObject({
      type: "agent_loop_event",
      phase: "tool",
      status: "running",
      tool: "search_literature",
    });

    expect(
      parseLiteratureStreamEvent({
        type: "agent_loop_event",
        phase: "tool",
        status: "running",
        label: "Invalid turn",
        turn: 0,
        ts: 2,
      }),
    ).toBeNull();
  });

  it("accepts data-viz chart events without importing shared Zod schemas", () => {
    const event = parseDataVizStreamEvent({
      type: "data_viz_chart",
      chart: {
        id: "weight-change",
        title: "Weight change",
        subtitle: "Mean change by arm",
        kind: "bar",
        xLabel: "Arm",
        yLabel: "Kilograms",
        points: [{ label: "Semaglutide", value: -14.2 }],
        summary: "Semaglutide reduced weight versus placebo.",
      },
      rationale: "A bar chart fits the grouped endpoint.",
      ts: 2,
    });

    expect(event).toMatchObject({
      type: "data_viz_chart",
      chart: { id: "weight-change", points: [{ label: "Semaglutide" }] },
    });
  });

  it("accepts data-viz agent progress events", () => {
    expect(
      parseDataVizStreamEvent({
        type: "data_viz_agent_event",
        phase: "tool",
        status: "running",
        label: "Calling trial chart builder",
        tool: "build_trial_chart",
        elapsedMs: 450,
        ts: 2,
      }),
    ).toMatchObject({
      type: "data_viz_agent_event",
      phase: "tool",
      tool: "build_trial_chart",
    });
  });

  it("accepts eval completion events and rejects bad usage shapes", () => {
    expect(
      parseEvalStreamEvent({
        type: "eval_complete",
        averageScores: { evidence_precision: 0.67 },
        totalUsage: usage,
        elapsedMs: 1200,
        ts: 3,
      }),
    ).toMatchObject({ type: "eval_complete" });

    expect(
      parseEvalStreamEvent({
        type: "eval_complete",
        averageScores: { evidence_precision: 0.67 },
        totalUsage: { ...usage, inputTokens: -1 },
        elapsedMs: 1200,
        ts: 3,
      }),
    ).toBeNull();
  });

  it("classifies terminal payloads beside the matching event guards", () => {
    expect(isLiteratureTerminalEventPayload({ type: "pipeline_result" })).toBe(
      true,
    );
    expect(isDataVizTerminalEventPayload({ type: "data_viz_complete" })).toBe(
      true,
    );
    expect(isEvalTerminalEventPayload({ type: "eval_complete" })).toBe(true);
    expect(isLiteratureTerminalEventPayload({ type: "tool_result" })).toBe(
      false,
    );
  });

  it("reads framed JSON SSE blocks with multiline data", async () => {
    const encoded = new TextEncoder().encode(
      [
        'data: {"type":"eval_started",',
        'data: "axis":"plan-stability","caseCount":3,"concurrency":3,"ts":4}',
        "",
        "",
      ].join("\n"),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 24));
        controller.enqueue(encoded.slice(24));
        controller.close();
      },
    });
    const events: unknown[] = [];

    await readJsonSseStream({
      body,
      parseEvent: parseEvalStreamEvent,
      streamName: "test-stream",
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([
      {
        type: "eval_started",
        axis: "plan-stability",
        caseCount: 3,
        concurrency: 3,
        ts: 4,
      },
    ]);
  });

  it("fails loudly when a terminal SSE event violates the client contract", async () => {
    const encoded = new TextEncoder().encode(
      [
        'data: {"type":"pipeline_result","result":{"hypothesis":"missing evidence","confidence":0.5},',
        'data: "totalUsage":{"inputTokens":10,"outputTokens":5,"costUsd":0.001},"ts":5}',
        "",
        "",
      ].join("\n"),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    });

    await expect(
      readJsonSseStream({
        body,
        isTerminalEventPayload: isLiteratureTerminalEventPayload,
        parseEvent: parseLiteratureStreamEvent,
        streamName: "literature-stream",
        onEvent: () => undefined,
      }),
    ).rejects.toThrow(
      "[literature-stream] invalid terminal event payload: pipeline_result",
    );
  });
});
