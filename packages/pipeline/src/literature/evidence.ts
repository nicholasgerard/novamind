import type { HypothesisResult } from "@novamind/shared";
import type { CandidateClaim, CitationVerdict } from "./model-tools";

const UNSUPPORTED_DEMO_CLAIM =
  "Cardiovascular benefits were observed in patients with normal renal function only.";

/**
 * Assign stable evidence ids before verification so the hypothesis model can
 * select evidence without depending on repeated claim text or PMID order.
 */
export function attachEvidenceIds(
  claims: readonly CandidateClaim[],
): CandidateClaim[] {
  return claims.map((claim, index) => ({
    ...claim,
    evidenceId: claim.evidenceId ?? `ev-${String(index + 1).padStart(2, "0")}`,
  }));
}

/**
 * Build the final public evidence list from verifier-supported claims only.
 * If the hypothesis model selects no supported ids, fall back to the first
 * supported verifier verdicts unless the caller needs to evaluate the model's
 * own evidence selection behavior.
 */
export function assembleVerifiedEvidence(
  verdicts: readonly CitationVerdict[],
  selectedEvidenceIds: readonly string[],
  opts: { allowFallback?: boolean } = {},
): {
  evidence: HypothesisResult["evidence"];
  droppedEvidenceIds: string[];
  usedFallbackSelection: boolean;
} {
  const allowFallback = opts.allowFallback ?? true;
  const verifiedById = new Map(
    verdicts
      .filter((verdict) => verdict.supported)
      .map((verdict) => [verdict.evidenceId, verdict]),
  );
  const seen = new Set<string>();
  const selected = selectedEvidenceIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const supportedSelection = selected
    .map((id) => verifiedById.get(id))
    .filter((verdict): verdict is CitationVerdict => Boolean(verdict));
  const fallbackSelection =
    allowFallback && verifiedById.size > 0 && supportedSelection.length === 0
      ? [...verifiedById.values()].slice(0, 4)
      : supportedSelection;

  return {
    evidence: fallbackSelection.map((verdict) => ({
      citation: `PMID:${verdict.pmid}`,
      claim: verdict.claim,
      verified: true,
    })),
    droppedEvidenceIds: selected.filter((id) => !verifiedById.has(id)),
    usedFallbackSelection:
      allowFallback && verifiedById.size > 0 && supportedSelection.length === 0,
  };
}

/**
 * Demo-only verifier check. The claim is deterministic and appended outside
 * the claim-extractor model so extracted claims remain faithful to abstracts.
 */
export function maybeBuildVerifierCheckClaim(
  claims: readonly CandidateClaim[],
  pmids: readonly string[],
): CandidateClaim | undefined {
  const targetPmid = pmids[2] ?? pmids[0];
  if (!targetPmid) return undefined;
  const alreadyPresent = claims.some(
    (claim) =>
      claim.pmid === targetPmid &&
      claim.claim.trim().toLowerCase() === UNSUPPORTED_DEMO_CLAIM.toLowerCase(),
  );
  if (alreadyPresent) return undefined;
  return {
    pmid: targetPmid,
    claim: UNSUPPORTED_DEMO_CLAIM,
  };
}
