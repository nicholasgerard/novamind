import { describe, expect, it } from "vitest";
import { dataVizAgentPrompt, dataVizRunPrompt } from "./prompt";
import type { DataVizRunState } from "./types";

describe("data-viz agent prompt", () => {
  it("keeps the terminal structured output small and immediate", () => {
    const prompt = dataVizAgentPrompt();

    expect(prompt).toContain(
      "After chart 4 succeeds, return the structured output immediately",
    );
    expect(prompt).toContain("do not re-plan, call more tools");
    expect(prompt).toContain("recommendation: one sentence");
    expect(prompt).toContain("rationale: one sentence");
    expect(prompt).toContain("zero to two short strings");
    expect(prompt).toContain("under 90 words");
  });

  it("reminds the live run to finalize after four charts", () => {
    const prompt = dataVizRunPrompt({
      question: "How do GLP-1 trials support HbA1c claims?",
      researchHandoff: {
        completedAt: 1,
        confidence: 0.88,
        evidence: [{ citation: "PMID 1", claim: "HbA1c improved." }],
        hypothesis: "GLP-1 therapies improve HbA1c.",
        question: "How do GLP-1 trials support HbA1c claims?",
      },
    } as DataVizRunState);

    expect(prompt).toContain(
      "After four charts have been built, return the concise final structured output immediately.",
    );
  });
});
