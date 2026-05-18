import { describe, expect, it } from "vitest";
import {
  allowedLiteratureOrchestratorTools,
  literatureCompletionNote,
  literatureOrchestratorPrompt,
} from "./orchestrator";

describe("literature orchestrator contract", () => {
  it("keeps the public trajectory ordered around verified evidence", () => {
    const prompt = literatureOrchestratorPrompt();

    expect(prompt).toContain("search_literature");
    expect(prompt).toContain("extract_candidate_claims");
    expect(prompt).toContain("verify_citations");
    expect(prompt).toContain("synthesize_hypothesis");
    expect(prompt).toContain("never synthesize before verification succeeds");
    expect(prompt).toContain("machine-readable completion signal");
    expect(prompt).toContain(
      "no prose report, markdown, bullets, tables, or emoji",
    );
  });

  it("allows only the scoped literature tools", () => {
    expect(allowedLiteratureOrchestratorTools).toEqual([
      "mcp__novamind_literature_orchestrator__search_literature",
      "mcp__novamind_literature_orchestrator__extract_candidate_claims",
      "mcp__novamind_literature_orchestrator__verify_citations",
      "mcp__novamind_literature_orchestrator__synthesize_hypothesis",
    ]);
  });

  it("uses deterministic completion copy instead of model-written final prose", () => {
    expect(
      literatureCompletionNote({
        candidateClaimCount: 6,
        paperCount: 5,
        rejectedClaimCount: 1,
        supportedClaimCount: 5,
      }),
    ).toBe(
      "Literature trajectory complete: 5 papers retrieved, 6 candidate claims extracted, 5 verified (1 rejected), hypothesis synthesized.",
    );
  });

  it("uses deterministic completion copy for no-evidence runs", () => {
    expect(
      literatureCompletionNote({
        candidateClaimCount: 0,
        paperCount: 0,
        rejectedClaimCount: 0,
        supportedClaimCount: 0,
      }),
    ).toBe(
      "Literature trajectory complete: no matching papers retrieved; no-evidence handoff emitted.",
    );
  });
});
