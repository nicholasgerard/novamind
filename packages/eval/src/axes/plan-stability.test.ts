import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenUsage } from "@novamind/shared";

const runHypothesisModelToolMock = vi.hoisted(() => vi.fn());
const judgeMock = vi.hoisted(() => vi.fn());

vi.mock("@novamind/pipeline", () => ({
  runHypothesisModelTool: runHypothesisModelToolMock,
}));

vi.mock("../scorers/plan-synthesis-judge", () => ({
  PlanSynthesisJudge: vi.fn(function PlanSynthesisJudge() {
    return { judge: judgeMock };
  }),
}));

import {
  buildPlanStabilitySpec,
  type PlanStabilityInput,
} from "./plan-stability";

const usage: TokenUsage = {
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0.01,
  inputTokens: 100,
  outputTokens: 20,
};

const input: PlanStabilityInput = {
  expectations: {
    confidence: { max: 0.8, min: 0.5, target: 0.65 },
    expectedEvidenceIds: ["ev-supported"],
    gapHandling: "Name the direct support boundary.",
    gapSignals: [{ anyOf: ["direct support"], label: "direct support" }],
    rejectedClaimDiscipline: "Do not cite rejected evidence.",
  },
  id: "case-1",
  papers: [
    {
      abstract: "The abstract reports a direct support signal.",
      authors: ["A Researcher"],
      journal: "Demo Journal",
      meshTerms: ["Diabetes Mellitus"],
      pmid: "12345",
      title: "Supported finding",
      year: 2026,
    },
  ],
  question: "What is supported?",
  verdicts: [
    {
      claim: "The abstract reports a supported finding.",
      evidenceId: "ev-supported",
      pmid: "12345",
      rationale: "Directly stated.",
      supported: true,
    },
    {
      claim: "The abstract proves an unsupported comparator result.",
      evidenceId: "ev-rejected",
      pmid: "12345",
      rationale: "Not stated.",
      supported: false,
    },
  ],
};

describe("plan-stability eval axis", () => {
  beforeEach(() => {
    runHypothesisModelToolMock.mockReset();
    judgeMock.mockReset();
  });

  it("runs the hypothesis tool from a fixed handoff and scores the same output contract", async () => {
    runHypothesisModelToolMock.mockResolvedValue({
      output: {
        confidence: 0.65,
        evidenceIds: ["ev-supported", "ev-supported"],
        hypothesis: "The result has direct support from the cited abstract.",
      },
      usage,
    });
    judgeMock.mockResolvedValue({
      gapHandling: 0.8,
      gapRationale: "Boundary is visible.",
      rationale: "Boundary is visible.",
      rejectedClaimDiscipline: 0.7,
      rejectedClaimDisciplineRationale: "Rejected evidence is not used.",
      usage,
    });

    const spec = buildPlanStabilitySpec({ cases: [input] });
    const { output, usage: taskUsage } = await spec.task(input);
    const scores = Object.fromEntries(
      await Promise.all(
        spec.scorers.map(async (scorer) => [
          scorer.name,
          await scorer.score(input, output),
        ]),
      ),
    );

    expect(runHypothesisModelToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        papers: input.papers,
        question: input.question,
        verdicts: input.verdicts,
      }),
    );
    expect(output.result.evidence).toEqual([
      {
        citation: "PMID:12345",
        claim: "The abstract reports a supported finding.",
        verified: true,
      },
    ]);
    expect(output.selectedEvidenceIds).toEqual([
      "ev-supported",
      "ev-supported",
    ]);
    expect(taskUsage).toEqual({
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0.02,
      inputTokens: 200,
      outputTokens: 40,
    });
    expect(scores).toEqual({
      confidence_calibration: 1,
      evidence_precision: 1,
      gap_handling: 0.8,
      rejected_claim_discipline: 0.7,
    });
  });

  it("makes evidence-precision notes actionable for context-only selections", async () => {
    runHypothesisModelToolMock.mockResolvedValue({
      output: {
        confidence: 0.65,
        evidenceIds: ["ev-supported", "ev-context"],
        hypothesis: "The result has direct support plus a contextual contrast.",
      },
      usage,
    });
    judgeMock.mockResolvedValue({
      gapHandling: 0.8,
      gapRationale: "Boundary is visible.",
      rationale: "Boundary is visible.",
      rejectedClaimDiscipline: 0.7,
      rejectedClaimDisciplineRationale: "Rejected evidence is not used.",
      usage,
    });

    const spec = buildPlanStabilitySpec({
      cases: [
        {
          ...input,
          expectations: {
            ...input.expectations,
            allowedEvidenceIds: ["ev-supported", "ev-context"],
          },
          verdicts: [
            ...input.verdicts,
            {
              claim: "A contextual contrast is reported.",
              evidenceId: "ev-context",
              pmid: "12345",
              rationale: "Directly stated but not direct support.",
              supported: true,
            },
          ],
        },
      ],
    });

    const { output } = await spec.task(spec.cases[0]!.input);

    expect(output.gradingNotes.evidence_precision).toContain(
      "context, contrast, off-question background, or limitations",
    );
    expect(output.gradingNotes.evidence_precision).toContain(
      "ev-context (context/contrast or limitation, not direct support",
    );
  });
});
