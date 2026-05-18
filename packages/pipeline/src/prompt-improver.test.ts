import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenUsage } from "@novamind/shared";

const callStructuredMock = vi.hoisted(() => vi.fn());

vi.mock("./structured", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./structured")>();
  return {
    ...actual,
    callStructured: callStructuredMock,
  };
});

import {
  buildPromptImproverContext,
  improvePrompt,
  IMPROVE_SCHEMA_NAME,
  selectTargetMetric,
} from "./prompt-improver";
import type { StructuredPromptBlock } from "./structured";

const usage: TokenUsage = {
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0.01,
  inputTokens: 100,
  outputTokens: 20,
};

describe("prompt improver", () => {
  beforeEach(() => {
    callStructuredMock.mockReset();
  });

  it("calls the structured Claude path with a compact target-metric prompt", async () => {
    callStructuredMock.mockResolvedValue({
      metadata: {
        finishReason: "end_turn",
        model: "claude-sonnet-4-6",
        provider: "claude",
        schemaName: IMPROVE_SCHEMA_NAME,
      },
      output: {
        newPrompt: "Improved prompt",
        rationale: "Targets the weakest metric.",
        targetedMetric: "gap_handling",
      },
      usage,
    });

    const result = await improvePrompt({
      currentPrompt: "Current prompt",
      runSummary: {
        axis: "plan-stability",
        averageScores: { gap_handling: 0.4, rejected_claim_discipline: 0.8 },
        cases: [
          {
            caseId: "case-1",
            question: "What is supported?",
            scores: { gap_handling: 0.2 },
            hypothesis: "Hypothesis text",
            gradingNotes: {
              gap_handling: "Missing/weak: dose boundary.",
              rejected_claim_discipline:
                "This note is not relevant to the selected target.",
            },
          },
        ],
      },
    });

    expect(result.output.targetedMetric).toBe("gap_handling");
    const callArgs = callStructuredMock.mock.calls[0]![0];
    const userPrompt = promptBlockText(callArgs.userPrompt);
    expect(callArgs).toEqual(
      expect.objectContaining({
        maxTokens: 1600,
        model: "claude-sonnet-4-6",
        provider: "claude",
        schemaName: IMPROVE_SCHEMA_NAME,
      }),
    );
    expect(callArgs.userPrompt).toEqual(expect.any(Array));
    expect(
      callArgs.schema.safeParse({
        newPrompt: "Improved prompt",
        rationale: "Rejects unsupported metric names.",
        targetedMetric: "unknown_metric",
      }).success,
    ).toBe(false);
    expect(userPrompt).toContain("<target_metric>gap_handling</target_metric>");
    expect(userPrompt).toContain("Missing/weak: dose boundary.");
    expect(userPrompt).toContain(
      "<answer_excerpt>Hypothesis text</answer_excerpt>",
    );
    expect(userPrompt).not.toContain(
      "This note is not relevant to the selected target.",
    );
  });

  it("gives evidence-precision repairs a concrete evidence-boundary pattern", async () => {
    callStructuredMock.mockResolvedValue({
      metadata: {
        finishReason: "end_turn",
        model: "claude-sonnet-4-6",
        provider: "claude",
        schemaName: IMPROVE_SCHEMA_NAME,
      },
      output: {
        newPrompt: "Improved prompt",
        rationale: "Targets evidence selection.",
        targetedMetric: "evidence_precision",
      },
      usage,
    });

    await improvePrompt({
      currentPrompt: "Current prompt",
      runSummary: {
        axis: "plan-stability",
        averageScores: {
          confidence_calibration: 0.9,
          evidence_precision: 0.2,
          gap_handling: 0.8,
          rejected_claim_discipline: 0.7,
        },
        cases: [
          {
            caseId: "case-1",
            question: "What is direct support?",
            scores: {
              confidence_calibration: 0.9,
              evidence_precision: 0.2,
              gap_handling: 0.8,
              rejected_claim_discipline: 0.7,
            },
            hypothesis: "Hypothesis text",
            gradingNotes: {
              evidence_precision:
                "Problem selected IDs: context-only contrast.",
            },
          },
        ],
      },
    });

    const callArgs = callStructuredMock.mock.calls[0]![0];
    const userPrompt = promptBlockText(callArgs.userPrompt);
    expect(userPrompt).toContain(
      "<target_metric>evidence_precision</target_metric>",
    );
    expect(userPrompt).toContain("<target_repair_pattern>");
    expect(userPrompt).toContain(
      "Select evidence IDs only for verified claims that directly support affirmative hypothesis clauses",
    );
    expect(userPrompt).toContain("<protected_metrics>");
    expect(userPrompt).toContain("rejected_claim_discipline: 70.0%");
  });

  it("throws when structured output validation fails", async () => {
    callStructuredMock.mockResolvedValue({
      metadata: {
        finishReason: "end_turn",
        model: "claude-sonnet-4-6",
        provider: "claude",
        schemaName: IMPROVE_SCHEMA_NAME,
      },
      output: undefined,
      parseError: "missing newPrompt",
      usage,
    });

    await expect(
      improvePrompt({
        currentPrompt: "Current prompt",
        runSummary: {
          axis: "plan-stability",
          averageScores: { gap_handling: 0.4 },
          cases: [],
        },
      }),
    ).rejects.toThrow(/missing newPrompt/);
  });

  it("throws when Claude returns a valid schema response for the wrong metric", async () => {
    callStructuredMock.mockResolvedValue({
      metadata: {
        finishReason: "end_turn",
        model: "claude-sonnet-4-6",
        provider: "claude",
        schemaName: IMPROVE_SCHEMA_NAME,
      },
      output: {
        newPrompt: "Improved prompt",
        rationale: "This targeted a different metric.",
        targetedMetric: "rejected_claim_discipline",
      },
      usage,
    });

    await expect(
      improvePrompt({
        currentPrompt: "Current prompt",
        runSummary: {
          axis: "plan-stability",
          averageScores: {
            gap_handling: 0.4,
            rejected_claim_discipline: 0.8,
          },
          cases: [],
        },
      }),
    ).rejects.toThrow(/expected gap_handling/);
  });

  it("selects the lowest metric with a stable prompt-edit tie break", () => {
    expect(
      selectTargetMetric({
        confidence_calibration: 0.7,
        evidence_precision: 0.5,
        gap_handling: 0.5,
        rejected_claim_discipline: 0.9,
      }),
    ).toBe("gap_handling");
    expect(selectTargetMetric({ unknown_metric: 0 })).toBe("gap_handling");
  });

  it("builds a compact failure packet from the worst target-metric cases", () => {
    const context = buildPromptImproverContext({
      axis: "plan-stability",
      averageScores: {
        confidence_calibration: 0.8,
        gap_handling: 0.3,
        rejected_claim_discipline: 0.6,
      },
      cases: [
        caseSummary("best", 0.9, "Best note", "Best answer"),
        caseSummary("worst", 0.1, "Worst note", "Worst answer"),
        caseSummary("middle", 0.4, "Middle note", "Middle answer"),
        caseSummary(
          "long",
          0.2,
          "Long note ".repeat(80),
          "Long answer ".repeat(80),
        ),
      ],
    });

    expect(context.targetMetric).toBe("gap_handling");
    expect(context.cases.map((c) => c.caseId)).toEqual([
      "worst",
      "long",
      "middle",
    ]);
    expect(context.cases[1]?.targetNote?.length).toBeLessThanOrEqual(420);
    expect(context.cases[1]?.answerExcerpt?.length).toBeLessThanOrEqual(360);
    expect(context.cases.some((c) => c.caseId === "best")).toBe(false);
  });
});

function caseSummary(
  caseId: string,
  gapScore: number,
  note: string,
  hypothesis: string,
) {
  return {
    caseId,
    question: `Question for ${caseId}`,
    scores: {
      confidence_calibration: 0.8,
      gap_handling: gapScore,
      rejected_claim_discipline: 0.6,
    },
    hypothesis,
    gradingNotes: {
      gap_handling: note,
      rejected_claim_discipline: "Ignored note",
    },
  };
}

function promptBlockText(
  prompt: string | readonly StructuredPromptBlock[],
): string {
  return typeof prompt === "string"
    ? prompt
    : prompt.map((block) => block.text).join("\n");
}
