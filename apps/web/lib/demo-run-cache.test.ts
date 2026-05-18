import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readCachedDataVizRun,
  readCachedHillClimbState,
  readCachedResearchRun,
  writeCachedResearchRun,
} from "./demo-run-cache";
import type { CachedResearchRun } from "./demo-run-cache";

const usage = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0.001,
};

describe("demo run cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reconstructs research runs from validated stream events", () => {
    const completedAt = Date.now();
    installCache({
      version: 2,
      updatedAt: completedAt,
      research: {
        completedAt,
        question: "What changed?",
        result: {
          hypothesis: "stale top-level result",
          evidence: [],
          confidence: 0,
        },
        totalUsage: usage,
        events: [
          {
            type: "pipeline_result",
            result: {
              hypothesis: "validated event result",
              evidence: [
                {
                  citation: "PMID 1",
                  claim: "Claim",
                  verified: true,
                },
              ],
              confidence: 0.7,
            },
            totalUsage: usage,
            ts: completedAt,
          },
        ],
      },
    });

    expect(readCachedResearchRun()).toMatchObject({
      question: "What changed?",
      result: { hypothesis: "validated event result" },
      totalUsage: usage,
    });
  });

  it("normalizes cached research usage from the shared stream contract", () => {
    const completedAt = Date.now();
    installCache({
      version: 2,
      updatedAt: completedAt,
      research: {
        completedAt,
        question: "What changed?",
        events: [
          {
            type: "pipeline_result",
            result: {
              hypothesis: "validated event result",
              evidence: [
                {
                  citation: "PMID 1",
                  claim: "Claim",
                  verified: true,
                },
              ],
              confidence: 0.7,
            },
            totalUsage: {
              inputTokens: 10,
              outputTokens: 5,
              costUsd: 0.001,
            },
            ts: completedAt,
          },
        ],
      },
    });

    expect(readCachedResearchRun()?.totalUsage).toMatchObject({
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it("drops cached research runs with malformed stream events", () => {
    const completedAt = Date.now();
    installCache({
      version: 2,
      updatedAt: completedAt,
      research: {
        completedAt,
        question: "What changed?",
        events: [
          {
            type: "pipeline_result",
            result: { hypothesis: "missing evidence", confidence: 0.5 },
            totalUsage: usage,
            ts: completedAt,
          },
        ],
      },
    });

    expect(readCachedResearchRun()).toBeUndefined();
  });

  it("clears cache entries written too far in the future", () => {
    const completedAt = Date.now();
    installCache({
      version: 2,
      updatedAt: completedAt + 2 * 60 * 1000,
      research: validCachedResearchRun(completedAt),
    });

    expect(readCachedResearchRun()).toBeUndefined();
  });

  it("evicts stale cache data and retries once when localStorage is full", () => {
    const completedAt = Date.now();
    let stored = "";
    let removed = false;
    let setItemCalls = 0;
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        removeItem: () => {
          removed = true;
        },
        setItem: (_key: string, nextValue: string) => {
          setItemCalls += 1;
          if (setItemCalls === 1) {
            throw new DOMException(
              "Storage quota exceeded",
              "QuotaExceededError",
            );
          }
          stored = nextValue;
        },
      },
    });

    writeCachedResearchRun(validCachedResearchRun(completedAt));

    expect(removed).toBe(true);
    expect(setItemCalls).toBe(2);
    expect(JSON.parse(stored)).toMatchObject({
      research: { question: "What changed?" },
      version: 2,
    });
  });

  it("reconstructs data-viz runs only when the cached stream completed", () => {
    const completedAt = Date.now();
    installCache({
      version: 2,
      updatedAt: completedAt,
      dataViz: {
        completedAt,
        researchHandoff: {
          question: "What changed?",
          hypothesis: "Hypothesis",
          confidence: 0.8,
          evidence: [{ citation: "PMID 1", claim: "Claim" }],
          completedAt,
        },
        events: [
          {
            type: "data_viz_complete",
            recommendation: "Proceed cautiously.",
            rationale: "The charts support a qualified read.",
            caveats: ["Small sample."],
            totalUsage: usage,
            ts: completedAt,
          },
        ],
      },
    });

    expect(readCachedDataVizRun()).toMatchObject({
      researchHandoff: { hypothesis: "Hypothesis" },
      events: [{ type: "data_viz_complete" }],
    });
  });

  it("drops malformed hill-climb snapshots instead of casting them", () => {
    const updatedAt = Date.now();
    installCache({
      version: 2,
      updatedAt,
      hillClimb: {
        completedRuns: [
          {
            id: "run-1",
            label: "v0",
            note: "Baseline",
            prompt: "Prompt",
            score: 0.4,
            scores: { evidence_precision: 0.4 },
            cases: [
              {
                caseId: "case-1",
                index: 0,
                label: "Case",
                status: "impossible",
              },
            ],
            startedAt: updatedAt,
            totalUsage: usage,
          },
        ],
        diffBasePrompt: null,
        history: [{ id: "baseline", label: "v0", score: 0.4 }],
        prompt: "Prompt",
        selectedCaseId: null,
        selectedRunId: null,
        updatedAt,
      },
    });

    expect(readCachedHillClimbState()).toBeUndefined();
  });
});

function validCachedResearchRun(completedAt: number): CachedResearchRun {
  return {
    completedAt,
    question: "What changed?",
    result: {
      hypothesis: "validated event result",
      evidence: [
        {
          citation: "PMID 1",
          claim: "Claim",
          verified: true,
        },
      ],
      confidence: 0.7,
    },
    totalUsage: usage,
    events: [
      {
        type: "pipeline_result",
        result: {
          hypothesis: "validated event result",
          evidence: [
            {
              citation: "PMID 1",
              claim: "Claim",
              verified: true,
            },
          ],
          confidence: 0.7,
        },
        totalUsage: usage,
        ts: completedAt,
      },
    ],
  };
}

function installCache(value: unknown): void {
  let stored = JSON.stringify(value);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) =>
        key === "novamind.demoRuns.v2" ? stored : null,
      removeItem: (key: string) => {
        if (key === "novamind.demoRuns.v2") stored = "";
      },
      setItem: (_key: string, nextValue: string) => {
        stored = nextValue;
      },
    },
  });
}
