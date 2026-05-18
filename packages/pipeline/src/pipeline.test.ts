import { describe, expect, it } from "vitest";
import {
  assembleVerifiedEvidence,
  attachEvidenceIds,
  maybeBuildVerifierCheckClaim,
} from "./literature/evidence";
import {
  normalizeCandidateClaim,
  validateCandidateClaimHandoff,
  type CitationVerdict,
} from "./literature/model-tools";
import { runRagSearchTool } from "./literature/search-tool";

describe("verified evidence assembly", () => {
  const verdicts: CitationVerdict[] = [
    {
      evidenceId: "ev-01",
      pmid: "111",
      claim: "Semaglutide reduced HbA1c in the trial population.",
      supported: true,
      rationale: "Directly stated.",
    },
    {
      evidenceId: "ev-02",
      pmid: "222",
      claim: "Benefits were limited to normal renal function.",
      supported: false,
      rationale: "The abstract does not discuss this subgroup.",
    },
    {
      evidenceId: "ev-03",
      pmid: "333",
      claim: "Tirzepatide reduced body weight versus comparator.",
      supported: true,
      rationale: "Directly stated.",
    },
  ];

  it("builds final evidence only from supported verifier verdicts", () => {
    const assembled = assembleVerifiedEvidence(verdicts, [
      "ev-02",
      "unknown",
      "ev-01",
      "ev-01",
    ]);

    expect(assembled.evidence).toEqual([
      {
        citation: "PMID:111",
        claim: "Semaglutide reduced HbA1c in the trial population.",
        verified: true,
      },
    ]);
    expect(assembled.droppedEvidenceIds).toEqual(["ev-02", "unknown"]);
    expect(assembled.usedFallbackSelection).toBe(false);
  });

  it("falls back to supported verifier verdicts if the model selects none", () => {
    const assembled = assembleVerifiedEvidence(verdicts, ["ev-02"]);

    expect(assembled.evidence.map((item) => item.citation)).toEqual([
      "PMID:111",
      "PMID:333",
    ]);
    expect(assembled.droppedEvidenceIds).toEqual(["ev-02"]);
    expect(assembled.usedFallbackSelection).toBe(true);
  });

  it("can preserve an empty evidence selection when fallback is disabled", () => {
    const assembled = assembleVerifiedEvidence(verdicts, ["ev-02"], {
      allowFallback: false,
    });

    expect(assembled.evidence).toEqual([]);
    expect(assembled.droppedEvidenceIds).toEqual(["ev-02"]);
    expect(assembled.usedFallbackSelection).toBe(false);
  });

  it("assigns stable evidence IDs before verification", () => {
    expect(
      attachEvidenceIds([
        { pmid: "111", claim: "First claim" },
        { pmid: "222", claim: "Second claim", evidenceId: "custom" },
      ]),
    ).toEqual([
      { evidenceId: "ev-01", pmid: "111", claim: "First claim" },
      { evidenceId: "custom", pmid: "222", claim: "Second claim" },
    ]);
  });

  it("normalizes bounded claim-extractor casing variants", () => {
    expect(
      normalizeCandidateClaim({
        PMID: "PMID:123",
        claim_text: "Direct abstract finding.",
      }),
    ).toEqual({
      pmid: "123",
      claim: "Direct abstract finding.",
    });

    expect(
      normalizeCandidateClaim({
        pubmed_id: "456",
        candidateClaim: "Nested claim text.",
      }),
    ).toEqual({
      pmid: "456",
      claim: "Nested claim text.",
    });
  });

  it("does not normalize arbitrary claim-extractor shapes", () => {
    expect(
      normalizeCandidateClaim({
        citation: "PMID:123",
        findings: [{ statement: "Overly broad alias." }],
      }),
    ).toEqual({
      pmid: undefined,
      claim: undefined,
    });
  });

  it("rejects claim handoffs that omit or duplicate retrieved papers", () => {
    const papers = [
      {
        pmid: "111",
        title: "First",
        abstract: "First abstract",
        year: 2024,
        journal: "Demo Journal",
        authors: [],
        meshTerms: [],
      },
      {
        pmid: "222",
        title: "Second",
        abstract: "Second abstract",
        year: 2025,
        journal: "Demo Journal",
        authors: [],
        meshTerms: [],
      },
    ];

    expect(
      validateCandidateClaimHandoff(
        [
          { pmid: "111", claim: "First ordered claim." },
          { pmid: "111", claim: "Duplicate paper claim." },
        ],
        papers,
      ),
    ).toEqual({
      ok: false,
      message:
        "Claim extractor must return exactly one claim for each retrieved paper using copied PMIDs; missing PMIDs: 222; duplicate PMIDs: 111",
    });
  });

  it("builds the injected verifier-check claim outside model extraction", () => {
    expect(maybeBuildVerifierCheckClaim([], ["111", "222", "333"])).toEqual({
      pmid: "333",
      claim:
        "Cardiovascular benefits were observed in patients with normal renal function only.",
    });
  });

  it("runs deterministic RAG search from an orchestrator-supplied query", async () => {
    const result = await runRagSearchTool({
      query: " semaglutide   HbA1c type 2 diabetes ",
      k: 2,
      method: "bm25",
    });

    expect(result.query).toBe("semaglutide HbA1c type 2 diabetes");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.traces[0]).toMatchObject({
      tool: "pubmed_corpus_search",
      input: {
        k: 2,
        method: "bm25",
        query: "semaglutide HbA1c type 2 diabetes",
      },
    });
  });
});
