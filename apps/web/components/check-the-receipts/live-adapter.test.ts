import { describe, expect, it } from "vitest";
import type { DataVizStreamEvent } from "@novamind/shared/data-viz-events";
import type { StreamEvent, TokenUsage } from "@novamind/shared/events";
import type { CachedDataVizRun, CachedResearchRun } from "@/lib/demo-run-cache";
import { buildLiveReceiptData } from "./live-adapter";

const ZERO_USAGE: TokenUsage = {
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
};

describe("check-the-receipts live adapter", () => {
  it("builds receipt metrics from cached literature and visualization runs", () => {
    const data = buildLiveReceiptData(researchRun(), dataVizRun());

    expect(data.query).toBe("GLP-1 HbA1c");
    expect(data.totalCostUsd).toBeCloseTo(0.078);
    expect(data.uncachedTotalCostUsd).toBeCloseTo(0.1);
    expect(data.cacheSavingsUsd).toBeCloseTo(0.022);
    expect(data.endToEndMs).toBe(13_000);
    expect(data.totalCachedTokens).toBe(250);

    expect(data.literature.stages.map((stage) => stage.key)).toEqual([
      "lit-orchestrator",
      "lit-search",
      "lit-claim_extractor",
      "lit-citation_verifier",
      "lit-hypothesis",
    ]);

    expect(data.literature.stages[0]).toMatchObject({
      label: "Orchestrator",
      latencyMs: 8_000,
      costUsd: 0.01,
    });
    expect(data.literature.stages[1]).toMatchObject({
      label: "Search",
      latencyMs: 1_000,
      costUsd: 0,
    });
    expect(data.viz.stages[1]).toMatchObject({
      label: "Chart agent",
      latencyMs: 3_000,
      costUsd: 0.05,
    });
  });

  it("uses the visualization handoff query when only the visualization cache exists", () => {
    const data = buildLiveReceiptData(undefined, dataVizRun());

    expect(data.query).toBe("GLP-1 HbA1c");
  });
});

function researchRun(): CachedResearchRun {
  const events: StreamEvent[] = [
    {
      type: "literature_stage_started",
      stage: "orchestrator",
      model: "claude-sonnet-4-6",
      ts: 1_000,
    },
    {
      type: "literature_stage_started",
      stage: "search",
      model: "hybrid-rag",
      ts: 1_500,
    },
    {
      type: "tool_result",
      stage: "search",
      tool: "pubmed_corpus_search",
      output: {
        hits: [{}, {}, {}, {}, {}],
      },
      ts: 2_000,
    },
    {
      type: "literature_stage_finished",
      stage: "search",
      usage: ZERO_USAGE,
      ts: 2_500,
    },
    {
      type: "literature_stage_started",
      stage: "claim_extractor",
      model: "claude-haiku-4-5",
      ts: 3_000,
    },
    {
      type: "literature_stage_finished",
      stage: "claim_extractor",
      usage: usage({ cacheReadTokens: 100, costUsd: 0.005 }),
      ts: 4_000,
    },
    {
      type: "literature_stage_started",
      stage: "citation_verifier",
      model: "claude-haiku-4-5",
      ts: 4_500,
    },
    {
      type: "literature_stage_finished",
      stage: "citation_verifier",
      usage: usage({ cacheReadTokens: 150, costUsd: 0.003 }),
      ts: 5_000,
    },
    {
      type: "literature_stage_started",
      stage: "hypothesis",
      model: "claude-opus-4-7",
      ts: 5_500,
    },
    {
      type: "literature_stage_finished",
      stage: "hypothesis",
      usage: usage({ costUsd: 0.01 }),
      ts: 7_000,
    },
    {
      type: "literature_stage_finished",
      stage: "orchestrator",
      usage: usage({ costUsd: 0.01 }),
      ts: 9_000,
    },
    {
      type: "pipeline_result",
      result: {
        confidence: 0.88,
        evidence: [],
        hypothesis: "Hypothesis",
      },
      totalUsage: usage({
        cacheReadTokens: 250,
        costUsd: 0.028,
        uncachedCostUsd: 0.04,
        cacheSavingsUsd: 0.012,
      }),
      ts: 9_000,
    },
  ];

  return {
    completedAt: 9_000,
    events,
    question: "GLP-1 HbA1c",
    result: {
      confidence: 0.88,
      evidence: [],
      hypothesis: "Hypothesis",
    },
    totalUsage: usage({
      cacheReadTokens: 250,
      costUsd: 0.028,
      uncachedCostUsd: 0.04,
      cacheSavingsUsd: 0.012,
    }),
  };
}

function dataVizRun(): CachedDataVizRun {
  const events: DataVizStreamEvent[] = [
    {
      type: "data_viz_started",
      model: "claude-sonnet-4-6",
      source: {
        adverseEventCount: 30,
        isFixture: false,
        outcomeCount: 20,
        source: "r2",
        sourceMode: "r2",
        sourceName: "clinical-trials",
        studyCount: 10,
      },
      ts: 10_000,
    },
    {
      type: "data_viz_agent_event",
      phase: "data",
      status: "complete",
      label: "Dataset profiled",
      ts: 12_000,
    },
    {
      type: "data_viz_chart",
      chart: chart("one"),
      ts: 13_000,
    },
    {
      type: "data_viz_chart",
      chart: chart("two"),
      ts: 14_000,
    },
    {
      type: "data_viz_complete",
      caveats: [],
      rationale: "Rationale",
      recommendation: "Recommendation",
      totalUsage: usage({
        costUsd: 0.05,
        uncachedCostUsd: 0.06,
        cacheSavingsUsd: 0.01,
      }),
      ts: 15_000,
    },
  ];

  return {
    completedAt: 15_000,
    events,
    researchHandoff: {
      completedAt: 9_000,
      confidence: 0.88,
      evidence: [],
      hypothesis: "Hypothesis",
      question: "GLP-1 HbA1c",
    },
  };
}

function chart(
  id: string,
): Extract<DataVizStreamEvent, { type: "data_viz_chart" }>["chart"] {
  return {
    id,
    kind: "bar",
    points: [{ label: "A", value: 1 }],
    subtitle: "Subtitle",
    summary: "Summary",
    title: "Title",
    xLabel: "X",
    yLabel: "Y",
  };
}

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    inputTokens: 10,
    outputTokens: 5,
    ...overrides,
  };
}
