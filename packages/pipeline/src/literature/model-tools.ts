import { z } from "zod";
import {
  HYPOTHESIS_SYSTEM_PROMPT,
  type Paper,
  type TokenUsage,
} from "@novamind/shared";
import {
  callStructured,
  type StructuredCallMetadata,
  type StructuredCallResult,
} from "../structured";
import {
  CLAIM_EXTRACTOR_MODEL,
  HYPOTHESIS_MODEL,
  HYPOTHESIS_MODEL_EFFORT,
  VERIFIER_MODEL,
} from "../model-config";

export {
  CLAIM_EXTRACTOR_MODEL,
  HYPOTHESIS_MODEL,
  HYPOTHESIS_MODEL_EFFORT,
  VERIFIER_MODEL,
} from "../model-config";

export interface CandidateClaim {
  evidenceId?: string;
  pmid: string;
  claim: string;
}

export class StructuredToolValidationError extends Error {
  constructor(
    message: string,
    readonly usage: TokenUsage,
    readonly parseError: string | undefined,
    readonly rawJson: unknown,
    readonly metadata?: StructuredCallMetadata,
  ) {
    super(message);
    this.name = "StructuredToolValidationError";
  }
}

export class ClaimExtractionValidationError extends StructuredToolValidationError {
  override name = "ClaimExtractionValidationError";
}

export class CitationVerificationValidationError extends StructuredToolValidationError {
  override name = "CitationVerificationValidationError";
}

export class HypothesisValidationError extends StructuredToolValidationError {
  override name = "HypothesisValidationError";
}

export interface CitationVerdict extends CandidateClaim {
  evidenceId: string;
  supported: boolean;
  rationale: string;
  supportingQuote?: string;
}

const CandidateClaimSchema = z.preprocess(
  normalizeCandidateClaim,
  z
    .object({
      pmid: z
        .string()
        .describe(
          "Exact PubMed ID copied from the source paper pmid attribute.",
        ),
      claim: z
        .string()
        .describe(
          "One concise claim directly stated by that paper's abstract.",
        ),
    })
    .strict(),
);
const CitationVerifierItemSchema = z.preprocess(
  normalizeVerifierItem,
  z
    .object({
      evidenceId: z.string(),
      pmid: z.string(),
      claim: z.string(),
      supported: z.boolean(),
      rationale: z.string(),
      supportingQuote: z.string().optional(),
    })
    .strict(),
);

const ClaimExtractionSchema = z.preprocess(
  normalizeClaimsOutput,
  z
    .object({
      claims: z.array(CandidateClaimSchema).min(1),
    })
    .strict(),
);

const CitationVerifierSchema = z.preprocess(
  normalizeVerifierOutput,
  z
    .object({
      verdicts: z.array(CitationVerifierItemSchema),
    })
    .strict(),
);

const HypothesisFromEvidenceSchema = z.preprocess(
  normalizeHypothesisOutput,
  z
    .object({
      hypothesis: z.string(),
      evidenceIds: z.array(z.string()),
      confidence: z.number().min(0).max(1),
    })
    .strict(),
);

const DIRECT_LITERATURE_TOOL_SYSTEM_PROMPT = [
  "You are a biomedical literature model tool.",
  "Use only the PubMed abstracts and task instructions provided by the caller.",
  "Preserve PMIDs, evidence IDs, and source ordering exactly when requested.",
  "Do not use titles, prior knowledge, class effects, or unstated assumptions as evidence.",
].join("\n");

const PAPER_CACHE_CONTROL = { ttl: "1h" as const };

export async function runClaimExtractionModelTool(args: {
  question: string;
  papers: readonly Paper[];
  repairInstruction?: string;
  signal?: AbortSignal;
}): Promise<{
  claims: CandidateClaim[];
  metadata: StructuredCallMetadata;
  usage: TokenUsage;
}> {
  const allowedPmids = args.papers.map((paper) => paper.pmid);
  const repairBlock = args.repairInstruction
    ? `\n\n<repair_instruction>${args.repairInstruction}</repair_instruction>`
    : "";
  const result = await callStructured({
    provider: "claude",
    model: CLAIM_EXTRACTOR_MODEL,
    systemPrompt: DIRECT_LITERATURE_TOOL_SYSTEM_PROMPT,
    userPrompt: [
      { text: papersBlock(args.papers), cacheControl: PAPER_CACHE_CONTROL },
      {
        text:
          `<question>${args.question}</question>\n\n` +
          `<allowed_pmids>${allowedPmids.join(", ")}</allowed_pmids>${repairBlock}\n\n` +
          [
            "Task: extract candidate citation claims from the retrieved abstracts.",
            "Return exactly one claim per paper, preserving paper order.",
            'Each item must contain pmid copied exactly from <paper pmid="..."> and one concise claim directly stated in that abstract.',
            "Do not invent, omit, duplicate, or rename PMIDs. Do not output titles, DOIs, indexes, nested paper objects, nulls, or support judgments.",
            "Extract one directly stated, synthesis-useful claim per paper. Preserve order and copy each pmid exactly.",
          ].join("\n"),
      },
    ],
    schema: ClaimExtractionSchema,
    schemaName: "submit_candidate_claims",
    schemaDescription: "One candidate citation claim per retrieved paper.",
    maxBudgetUsd: 0.08,
    maxTokens: Math.min(1800, 200 + args.papers.length * 180),
    signal: args.signal,
  });

  if (result.output) {
    const validated = validateCandidateClaimHandoff(
      result.output.claims,
      args.papers,
    );
    if (validated.ok)
      return {
        claims: result.output.claims,
        metadata: result.metadata,
        usage: result.usage,
      };
    throw new ClaimExtractionValidationError(
      `Claim extractor returned claims with invalid PMIDs: ${validated.message}`,
      result.usage,
      validated.message,
      result.rawJson,
      result.metadata,
    );
  }

  throw new ClaimExtractionValidationError(
    `Claim extractor returned invalid output: ${result.parseError ?? "no output"}`,
    result.usage,
    result.parseError,
    result.rawJson,
    result.metadata,
  );
}

export async function runCitationVerificationModelTool(args: {
  claims: readonly CandidateClaim[];
  knownUnsupportedEvidenceIds?: ReadonlySet<string>;
  model?: string;
  papers: readonly Paper[];
  repairInstruction?: string;
  signal?: AbortSignal;
}): Promise<{
  metadata: StructuredCallMetadata;
  verdicts: CitationVerdict[];
  usage: TokenUsage;
}> {
  const model = args.model ?? VERIFIER_MODEL;
  const result = await callStructured({
    provider: "claude",
    model,
    systemPrompt: DIRECT_LITERATURE_TOOL_SYSTEM_PROMPT,
    userPrompt: [
      { text: papersBlock(args.papers), cacheControl: PAPER_CACHE_CONTROL },
      {
        text:
          `<claims>\n${JSON.stringify(
            args.claims.map((claim) => ({
              evidenceId: claim.evidenceId,
              pmid: claim.pmid,
              claim: claim.claim,
            })),
            null,
            2,
          )}\n</claims>` +
          retryBlock(args.repairInstruction) +
          "\n\n" +
          [
            "Task: strictly verify biomedical claims against retrieved abstracts.",
            "For each claim, use only the abstract with the same pmid.",
            "Return one verdict per claim in the same order, preserving evidenceId, pmid, and claim exactly.",
            "supported=true only if the matching abstract directly states or clearly entails every qualifier in the claim.",
            "supported=false if the abstract is silent, contradicts the claim, or differs by molecule, endpoint, population, subgroup, comparator, duration, or confidence level.",
            "For supported=true include a short supportingQuote copied from the abstract. For supported=false omit supportingQuote and name the mismatch.",
            "Never use titles, other papers, prior knowledge, or class effects as support.",
            "Verify every claim against the retrieved paper with the same PMID. Preserve evidenceId, pmid, and claim exactly. Return verdicts in the same order as the claims.",
          ].join("\n"),
      },
    ],
    schema: CitationVerifierSchema,
    schemaName: "submit_citation_verdicts",
    schemaDescription: "Citation verdicts for candidate claims.",
    effort: model.includes("haiku") ? undefined : "medium",
    maxBudgetUsd: 0.25,
    maxTokens: Math.min(1800, 500 + args.claims.length * 180),
    signal: args.signal,
  });

  const output = requireStructuredOutput(
    result,
    CitationVerificationValidationError,
    "Citation verifier",
  );

  return {
    metadata: result.metadata,
    verdicts: validateCitationVerdictHandoff(
      output.verdicts,
      args.claims,
      args.papers,
      result,
      args.knownUnsupportedEvidenceIds,
    ),
    usage: result.usage,
  };
}

export async function runHypothesisModelTool(args: {
  question: string;
  papers: readonly Paper[];
  verdicts: readonly CitationVerdict[];
  systemPromptOverride?: string;
  repairInstruction?: string;
  signal?: AbortSignal;
}): Promise<{
  metadata: StructuredCallMetadata;
  output: z.infer<typeof HypothesisFromEvidenceSchema>;
  usage: TokenUsage;
}> {
  const verified = args.verdicts.filter((verdict) => verdict.supported);
  const rejected = args.verdicts.filter((verdict) => !verdict.supported);
  const result = await callStructured({
    provider: "claude",
    model: HYPOTHESIS_MODEL,
    systemPrompt: args.systemPromptOverride ?? HYPOTHESIS_SYSTEM_PROMPT,
    userPrompt: [
      { text: papersBlock(args.papers), cacheControl: PAPER_CACHE_CONTROL },
      {
        text:
          `<question>${args.question}</question>\n\n` +
          `<verified_claims>\n${JSON.stringify(verified, null, 2)}\n</verified_claims>\n\n` +
          `<rejected_claims>\n${JSON.stringify(rejected, null, 2)}\n</rejected_claims>\n\n` +
          `${retryBlock(args.repairInstruction)}\n\n` +
          "Synthesize from verified_claims only. Mention limitations when rejected_claims change the confidence. In evidenceIds, include only evidenceId values from verified_claims; never include rejected_claims.",
      },
    ],
    schema: HypothesisFromEvidenceSchema,
    schemaName: "submit_hypothesis",
    schemaDescription:
      "Submit a grounded biomedical hypothesis from verified citation claims.",
    effort: HYPOTHESIS_MODEL_EFFORT,
    maxBudgetUsd: 0.75,
    maxTokens: 1800,
    signal: args.signal,
  });
  if (!result.output) {
    throw new HypothesisValidationError(
      `Hypothesis synthesis returned invalid output: ${result.parseError ?? "no output"}`,
      result.usage,
      result.parseError,
      result.rawJson,
      result.metadata,
    );
  }
  const validation = validateHypothesisHandoff(result.output, args.verdicts);
  if (!validation.ok) {
    throw new HypothesisValidationError(
      `Hypothesis synthesis returned invalid evidence IDs: ${validation.message}`,
      result.usage,
      validation.message,
      result.rawJson,
      result.metadata,
    );
  }
  return {
    metadata: result.metadata,
    output: result.output,
    usage: result.usage,
  };
}

type ValidationErrorConstructor = new (
  message: string,
  usage: TokenUsage,
  parseError: string | undefined,
  rawJson: unknown,
  metadata?: StructuredCallMetadata,
) => StructuredToolValidationError;

function requireStructuredOutput<T>(
  result: StructuredCallResult<T>,
  ErrorClass: ValidationErrorConstructor,
  label: string,
): T {
  if (result.output) return result.output;
  throw new ErrorClass(
    `${label} returned invalid output: ${result.parseError ?? "no output"}`,
    result.usage,
    result.parseError,
    result.rawJson,
    result.metadata,
  );
}

function validateCitationVerdictHandoff(
  verdicts: readonly CitationVerdict[],
  claims: readonly CandidateClaim[],
  papers: readonly Paper[],
  result: StructuredCallResult<z.infer<typeof CitationVerifierSchema>>,
  knownUnsupportedEvidenceIds: ReadonlySet<string> = new Set(),
): CitationVerdict[] {
  const claimsByEvidenceId = new Map(
    claims
      .filter((claim) => claim.evidenceId)
      .map((claim) => [claim.evidenceId!, claim]),
  );
  const allowedPmids = new Set(papers.map((paper) => paper.pmid));
  const verdictIdCounts = new Map<string, number>();
  for (const verdict of verdicts) {
    verdictIdCounts.set(
      verdict.evidenceId,
      (verdictIdCounts.get(verdict.evidenceId) ?? 0) + 1,
    );
  }

  const problems: string[] = [];
  if (verdicts.length !== claims.length) {
    problems.push(
      `expected ${claims.length} verdicts, received ${verdicts.length}`,
    );
  }

  const missing = [...claimsByEvidenceId.keys()].filter(
    (evidenceId) => !verdictIdCounts.has(evidenceId),
  );
  if (missing.length > 0)
    problems.push(`missing evidenceIds: ${missing.join(", ")}`);

  const unknown = verdicts
    .map((verdict) => verdict.evidenceId)
    .filter((evidenceId) => !claimsByEvidenceId.has(evidenceId));
  if (unknown.length > 0)
    problems.push(`unknown evidenceIds: ${unknown.join(", ")}`);

  const duplicates = [...verdictIdCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([evidenceId]) => evidenceId);
  if (duplicates.length > 0) {
    problems.push(`duplicate evidenceIds: ${duplicates.join(", ")}`);
  }

  for (const verdict of verdicts) {
    const source = claimsByEvidenceId.get(verdict.evidenceId);
    if (!allowedPmids.has(verdict.pmid)) {
      problems.push(`invalid PMID for ${verdict.evidenceId}: ${verdict.pmid}`);
    }
    if (source && verdict.pmid !== source.pmid) {
      problems.push(
        `PMID mismatch for ${verdict.evidenceId}: expected ${source.pmid}, received ${verdict.pmid}`,
      );
    }
    if (source && verdict.claim.trim() !== source.claim.trim()) {
      problems.push(`claim text changed for ${verdict.evidenceId}`);
    }
    if (verdict.supported && !verdict.supportingQuote?.trim()) {
      problems.push(
        `supported verdict missing quote for ${verdict.evidenceId}`,
      );
    }
    if (
      verdict.supported &&
      knownUnsupportedEvidenceIds.has(verdict.evidenceId)
    ) {
      problems.push(
        `verdict ${verdict.evidenceId} was marked supported even though the matching abstract does not directly support every qualifier; re-check exact support`,
      );
    }
  }

  if (problems.length === 0) return [...verdicts];
  throw new CitationVerificationValidationError(
    `Citation verifier must return one exact verdict per candidate claim; ${problems.join("; ")}`,
    result.usage,
    problems.join("; "),
    result.rawJson,
    result.metadata,
  );
}

function validateHypothesisHandoff(
  output: z.infer<typeof HypothesisFromEvidenceSchema>,
  verdicts: readonly CitationVerdict[],
): { ok: true } | { ok: false; message: string } {
  const supportedIds = new Set(
    verdicts
      .filter((verdict) => verdict.supported)
      .map((verdict) => verdict.evidenceId),
  );
  const rejectedIds = new Set(
    verdicts
      .filter((verdict) => !verdict.supported)
      .map((verdict) => verdict.evidenceId),
  );
  const unknown = output.evidenceIds.filter(
    (evidenceId) =>
      !supportedIds.has(evidenceId) && !rejectedIds.has(evidenceId),
  );
  const rejected = output.evidenceIds.filter((evidenceId) =>
    rejectedIds.has(evidenceId),
  );
  const problems: string[] = [];
  if (unknown.length > 0) problems.push(`unknown IDs: ${unknown.join(", ")}`);
  if (rejected.length > 0)
    problems.push(`rejected IDs: ${rejected.join(", ")}`);
  return problems.length === 0
    ? { ok: true }
    : { ok: false, message: problems.join("; ") };
}

function normalizeClaimsOutput(value: unknown): unknown {
  if (Array.isArray(value)) return { claims: value };
  const record = asRecord(value);
  if (!record) return value;
  const claims =
    record.claims ?? record.candidateClaims ?? record.candidate_claims;
  return {
    claims: claims && asRecord(claims) ? Object.values(claims) : claims,
  };
}

export function normalizeCandidateClaim(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  return {
    pmid: normalizePmid(
      firstString(record.pmid, record.PMID, record.pubmedId, record.pubmed_id),
    ),
    claim: claimString(
      record.claim,
      record.claimText,
      record.claim_text,
      record.candidateClaim,
      record.candidate_claim,
    ),
  };
}

export function validateCandidateClaimHandoff(
  claims: readonly CandidateClaim[],
  papers: readonly Paper[],
): { ok: true } | { ok: false; message: string } {
  const expectedPmids = papers.map((paper) => paper.pmid);
  const allowed = new Set(expectedPmids);
  const pmidCounts = new Map<string, number>();
  for (const claim of claims) {
    pmidCounts.set(claim.pmid, (pmidCounts.get(claim.pmid) ?? 0) + 1);
  }

  const problems: string[] = [];
  if (claims.length !== papers.length) {
    problems.push(
      `expected ${papers.length} claims, received ${claims.length}`,
    );
  }

  const invalid = claims.filter((claim) => !allowed.has(claim.pmid));
  if (invalid.length > 0) {
    problems.push(
      `invalid PMIDs: ${invalid.map((claim) => claim.pmid).join(", ")}`,
    );
  }

  const missing = expectedPmids.filter((pmid) => !pmidCounts.has(pmid));
  if (missing.length > 0) {
    problems.push(`missing PMIDs: ${missing.join(", ")}`);
  }

  const duplicates = [...pmidCounts.entries()]
    .filter(([pmid, count]) => allowed.has(pmid) && count > 1)
    .map(([pmid]) => pmid);
  if (duplicates.length > 0) {
    problems.push(`duplicate PMIDs: ${duplicates.join(", ")}`);
  }

  if (problems.length === 0) return { ok: true };
  return {
    ok: false,
    message: `Claim extractor must return exactly one claim for each retrieved paper using copied PMIDs; ${problems.join("; ")}`,
  };
}

function normalizePmid(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const prefixed = trimmed.match(/^PMID\s*:?\s*(.+)$/i)?.[1];
  return (prefixed ?? trimmed).trim();
}

function normalizeVerifierOutput(value: unknown): unknown {
  if (Array.isArray(value)) return { verdicts: value };
  const record = asRecord(value);
  if (!record) return value;
  const explicit =
    record.verdicts ??
    record.citationVerdicts ??
    record.citation_verdicts ??
    record.results;
  if (explicit !== undefined) return { verdicts: explicit };
  const values = Object.values(record);
  if (values.every((item) => asRecord(item))) return { verdicts: values };
  return { verdicts: explicit };
}

function normalizeVerifierItem(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  return {
    evidenceId: firstString(record.evidenceId, record.evidence_id, record.id),
    pmid: firstString(record.pmid, record.PMID, record.pubmedId),
    claim: firstString(record.claim, record.claimText, record.claim_text),
    supported: booleanValue(
      record.supported ??
        record.supported_by_abstract ??
        record.verified ??
        record.abstractSupports ??
        record.verdict ??
        record.support,
    ),
    rationale:
      firstString(
        record.rationale,
        record.reasoning,
        record.explanation,
        record.reason,
      ) ?? "",
    supportingQuote:
      record.supportingQuote ??
      record.supporting_quote ??
      record.quote ??
      record.evidenceQuote,
  };
}

function normalizeHypothesisOutput(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  return {
    hypothesis: record.hypothesis,
    confidence: record.confidence,
    evidenceIds:
      record.evidenceIds ??
      record.evidence_ids ??
      record.selectedEvidenceIds ??
      record.selected_evidence_ids,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = stringValue(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function claimString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const direct = stringValue(value);
    if (direct) return direct;
  }
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (
    normalized === "true" ||
    normalized === "supported" ||
    normalized === "yes" ||
    normalized === "verified"
  ) {
    return true;
  }
  if (
    normalized === "false" ||
    normalized === "unsupported" ||
    normalized === "no" ||
    normalized === "rejected" ||
    normalized === "not supported"
  ) {
    return false;
  }
  return undefined;
}

function papersBlock(papers: readonly Paper[]): string {
  return `<retrieved_papers>\n${papers
    .map(
      (paper) =>
        `<paper pmid="${paper.pmid}" year="${paper.year}">\n<title>${paper.title}</title>\n<abstract>${paper.abstract}</abstract>\n</paper>`,
    )
    .join("\n\n")}\n</retrieved_papers>`;
}

function retryBlock(retryReason: string | undefined): string {
  return retryReason
    ? `\n\n<retry_instruction>${retryReason}</retry_instruction>`
    : "";
}
