import { describe, expect, it } from "vitest";
import {
  DataVizRunRequestSchema,
  EvalRunRequestSchema,
  LiteratureStreamRequestSchema,
  MAX_EVAL_CONCURRENCY,
  PromptImproverRequestSchema,
} from "./api-requests";

describe("public API request schemas", () => {
  it("applies safe defaults for demo requests", () => {
    expect(DataVizRunRequestSchema.parse({})).toEqual({});
    expect(EvalRunRequestSchema.parse({})).toEqual({
      axis: "plan-stability",
    });
  });

  it("accepts a compact research handoff for data visualization", () => {
    expect(
      DataVizRunRequestSchema.parse({
        researchHandoff: {
          completedAt: 1_765_000_000_000,
          evidence: [{ citation: "PMID:123", claim: "HbA1c improved." }],
          hypothesis: "Verified evidence supports HbA1c reduction.",
          question: "Compare HbA1c reduction across GLP-1 trials.",
        },
      }),
    ).toMatchObject({
      researchHandoff: {
        evidence: [{ citation: "PMID:123", claim: "HbA1c improved." }],
      },
    });
  });

  it("keeps eval-only retrieval fixtures out of the literature stream API", () => {
    const parsed = LiteratureStreamRequestSchema.safeParse({
      evalRetrievalOverride: [],
      question: "What is supported by the literature?",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects non-contract keys on data-viz run requests", () => {
    const parsed = DataVizRunRequestSchema.safeParse({
      researchHandoff: {
        confidence: 0.72,
        evidence: [
          {
            citation: "PMID:123",
            claim: "The abstract reported an HbA1c reduction.",
          },
        ],
        hypothesis: "GLP-1 therapies reduce HbA1c in the cited population.",
        question: "What does the evidence show?",
      },
      retrievalOverride: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects unknown fields and unsafe eval concurrency", () => {
    expect(() => DataVizRunRequestSchema.parse({ extra: true })).toThrow();
    expect(() =>
      EvalRunRequestSchema.parse({
        axis: "plan-stability",
        concurrency: MAX_EVAL_CONCURRENCY + 1,
      }),
    ).toThrow();
    expect(() =>
      EvalRunRequestSchema.parse({
        axis: "plan-stability",
        caseIds: ["case-1"],
        limit: 1,
      }),
    ).toThrow();
  });

  it("accepts compact prompt-improver summaries and rejects client-owned setup text", () => {
    expect(
      PromptImproverRequestSchema.parse({
        currentPrompt: "Synthesize only from verified evidence.",
        runSummary: {
          axis: "plan-stability",
          averageScores: {
            gap_handling: 0.4,
            rejected_claim_discipline: 0.7,
          },
          cases: [
            {
              caseId: "case-1",
              gradingNotes: {
                gap_handling: "Missing/weak: dose boundary.",
              },
              hypothesis: "The answer excerpt is compact.",
              question: "What does the evidence support?",
              scores: {
                gap_handling: 0.2,
                rejected_claim_discipline: 0.8,
              },
            },
          ],
        },
      }),
    ).toMatchObject({
      runSummary: {
        cases: [{ gradingNotes: { gap_handling: expect.any(String) } }],
      },
    });

    expect(() =>
      PromptImproverRequestSchema.parse({
        currentPrompt: "Prompt",
        runSummary: {
          axis: "plan-stability",
          averageScores: { gap_handling: 0.4 },
          cases: [],
          setup: "The UI should not own improver prompt semantics.",
        },
      }),
    ).toThrow();
    expect(() =>
      PromptImproverRequestSchema.parse({
        currentPrompt: "Prompt",
        runSummary: {
          axis: "citation-accuracy",
          averageScores: { gap_handling: 0.4 },
          cases: [],
        },
      }),
    ).toThrow();
  });
});
