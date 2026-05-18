import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HypothesisResult, TokenUsage } from "@novamind/shared";
import type { CitationVerdict } from "@novamind/pipeline";

const haikuJudgeMock = vi.hoisted(() => vi.fn());

vi.mock("./llm-judge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm-judge")>();
  return {
    ...actual,
    haikuJudge: haikuJudgeMock,
  };
});

import { PlanSynthesisJudge } from "./plan-synthesis-judge";

const usage: TokenUsage = {
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0.01,
  inputTokens: 100,
  outputTokens: 20,
};

const result: HypothesisResult = {
  confidence: 0.6,
  evidence: [],
  hypothesis: "This answer is cautious.",
};

const verdicts: CitationVerdict[] = [
  {
    claim: "The abstract supports the requested endpoint.",
    evidenceId: "ev-supported",
    pmid: "PMID-1",
    rationale: "Directly stated.",
    supported: true,
  },
  {
    claim: "A direct head-to-head result was proven.",
    evidenceId: "ev-rejected",
    pmid: "PMID-2",
    rationale: "Not supported.",
    supported: false,
  },
];

describe("plan synthesis judge", () => {
  beforeEach(() => {
    haikuJudgeMock.mockReset();
  });

  it("requires SDK-valid structured output and applies explicit audit ceilings", async () => {
    haikuJudgeMock.mockResolvedValue({
      output: {
        gap_handling: 0.95,
        gap_rationale: "The answer is cautious.",
        rejected_claim_discipline: 1,
        rejected_claim_discipline_rationale: "Rejected evidence is not cited.",
      },
      usage,
    });

    const judgment = await new PlanSynthesisJudge().judge({
      expectations: {
        confidence: { max: 0.7, min: 0.4, target: 0.6 },
        expectedEvidenceIds: ["ev-supported"],
        gapHandling: "The answer must name the direct support boundary.",
        gapSignals: [
          {
            anyOf: ["direct support boundary"],
            label: "direct support boundary",
          },
        ],
        rejectedClaimDiscipline:
          "The rejected head-to-head claim must be visible as unsupported.",
      },
      question: "What is supported?",
      result,
      selectedEvidenceIds: ["ev-supported"],
      verdicts,
    });

    expect(judgment.gapHandling).toBe(0.35);
    expect(judgment.gapRationale).toContain("Rubric ceiling applied");
    expect(judgment.rejectedClaimDiscipline).toBe(0.6);
    expect(judgment.rejectedClaimDisciplineRationale).toContain(
      "silently avoids",
    );
  });

  it("does not repair invalid judge output", async () => {
    haikuJudgeMock.mockResolvedValue({
      output: undefined,
      parseError: "unrecognized camelCase keys",
      rawJson: {
        gapHandling: 1,
        rejectedClaimDiscipline: 1,
      },
      usage,
    });

    await expect(
      new PlanSynthesisJudge().judge({
        expectations: {
          confidence: { max: 0.7, min: 0.4, target: 0.6 },
          expectedEvidenceIds: ["ev-supported"],
          gapHandling: "The answer must name the boundary.",
          gapSignals: [],
          rejectedClaimDiscipline: "Rejected claims must not be used.",
        },
        question: "What is supported?",
        result,
        selectedEvidenceIds: ["ev-supported"],
        verdicts,
      }),
    ).rejects.toThrow(/unrecognized camelCase keys/);
  });
});
