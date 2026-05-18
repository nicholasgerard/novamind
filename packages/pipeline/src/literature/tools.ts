import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import { ZERO_USAGE, type Paper, type RetrievalHit } from "@novamind/shared";
import { corpusSize, corpusSourceMode, corpusSourceName } from "../rag";
import {
  CLAIM_EXTRACTOR_MODEL,
  ClaimExtractionValidationError,
  HYPOTHESIS_MODEL,
  StructuredToolValidationError,
  VERIFIER_MODEL,
  runCitationVerificationModelTool,
  runClaimExtractionModelTool,
  runHypothesisModelTool,
} from "./model-tools";
import { RAG_SEARCH_TOOL_LABEL, runRagSearchTool } from "./search-tool";
import {
  assembleVerifiedEvidence,
  attachEvidenceIds,
  maybeBuildVerifierCheckClaim,
} from "./evidence";
import {
  emitAgentLoopEvent,
  emitStageFinished,
  emitStageMessage,
  emitStageStarted,
  emitOrchestratorNote,
  emitToolCall,
  emitToolResult,
  type LiteratureEventSink,
} from "./events";
import { startLiteratureTiming } from "./timing";
import type {
  LiteratureRunState,
  LiteratureToolEnvelope,
  LiteratureToolName,
} from "./types";

const MAX_TOOL_ATTEMPTS = 2;
const SEARCH_TOOL_DESCRIPTION =
  "Use this first to retrieve PubMed abstracts from the GLP-1 corpus. Provide one compact biomedical query that preserves the molecule, endpoint, population, and comparator from the research question when present. The tool performs deterministic hybrid retrieval and returns typed hit metadata; it does not call an LLM or synthesize evidence.";
const EXTRACT_TOOL_DESCRIPTION =
  "Use this after search_literature has returned abstracts. The tool runs one bounded Claude structured call that extracts exactly one abstract-grounded candidate claim per retrieved paper. Do not call it before search, and pass retryReason only when a prior extraction attempt returned a recoverable validation error.";
const VERIFY_TOOL_DESCRIPTION =
  "Use this after extract_candidate_claims has produced candidate claims. The tool runs one batched Claude structured call that verifies each claim only against its matching abstract and returns supported/rejected verdicts. Do not synthesize until this tool has succeeded; pass retryReason only when the previous verifier attempt returned a recoverable validation error.";
const SYNTHESIZE_TOOL_DESCRIPTION =
  "Use this last, after citation verification succeeds. The tool runs the hypothesis model with verified claims as the only allowed evidence and rejected claims only as limitations or confidence calibration. The returned hypothesis becomes the final research handoff, so do not call it before verifier output exists.";

interface SearchToolData {
  hitCount: number;
  completeWithoutEvidence?: boolean;
}

interface ExtractionToolData {
  claimCount: number;
}

interface VerificationToolData {
  verdictCount: number;
  supportedCount: number;
  rejectedCount: number;
}

interface SynthesisToolData {
  confidence: number;
  evidenceCount: number;
}

export function createLiteratureToolServer(
  state: LiteratureRunState,
  emit: LiteratureEventSink,
): McpServerConfig {
  return createLiteratureToolServerFromContext(() => ({ state, emit }));
}

export interface DeferredLiteratureToolServer {
  bind(context: { emit: LiteratureEventSink; state: LiteratureRunState }): void;
  clear(): void;
  server: McpServerConfig;
}

export function createDeferredLiteratureToolServer(): DeferredLiteratureToolServer {
  let context:
    | {
        emit: LiteratureEventSink;
        state: LiteratureRunState;
      }
    | undefined;
  return {
    bind(nextContext) {
      context = nextContext;
    },
    clear() {
      context = undefined;
    },
    server: createLiteratureToolServerFromContext(() => {
      if (!context) {
        throw new Error("Literature Agent SDK tool server is not bound.");
      }
      return context;
    }),
  };
}

function createLiteratureToolServerFromContext(
  getContext: () => {
    emit: LiteratureEventSink;
    state: LiteratureRunState;
  },
): McpServerConfig {
  return createSdkMcpServer({
    name: "novamind_literature_orchestrator",
    version: "0.0.0",
    tools: [
      tool(
        "search_literature",
        SEARCH_TOOL_DESCRIPTION,
        {
          query: z
            .string()
            .min(3)
            .describe(
              "Compact biomedical retrieval query preserving molecule, endpoint, population, and comparator when present.",
            ),
          retryReason: z
            .string()
            .optional()
            .describe(
              "Validation error or retry instruction from a prior attempt.",
            ),
        },
        async ({ query, retryReason }) => {
          const { state, emit } = getContext();
          return structuredToolResult(
            await searchLiterature(state, emit, retryReason, query),
          );
        },
      ),
      tool(
        "extract_candidate_claims",
        EXTRACT_TOOL_DESCRIPTION,
        {
          retryReason: z
            .string()
            .optional()
            .describe(
              "Validation error or retry instruction from a prior attempt.",
            ),
        },
        async ({ retryReason }) => {
          const { state, emit } = getContext();
          return structuredToolResult(
            await extractCandidateClaims(state, emit, retryReason),
          );
        },
      ),
      tool(
        "verify_citations",
        VERIFY_TOOL_DESCRIPTION,
        {
          retryReason: z
            .string()
            .optional()
            .describe(
              "Validation error or retry instruction from a prior attempt.",
            ),
        },
        async ({ retryReason }) => {
          const { state, emit } = getContext();
          return structuredToolResult(
            await verifyCitations(state, emit, retryReason),
          );
        },
      ),
      tool(
        "synthesize_hypothesis",
        SYNTHESIZE_TOOL_DESCRIPTION,
        {
          retryReason: z
            .string()
            .optional()
            .describe(
              "Validation error or retry instruction from a prior attempt.",
            ),
        },
        async ({ retryReason }) => {
          const { state, emit } = getContext();
          return structuredToolResult(
            await synthesizeHypothesis(state, emit, retryReason),
          );
        },
      ),
    ],
    alwaysLoad: true,
  });
}

async function searchLiterature(
  state: LiteratureRunState,
  emit: LiteratureEventSink,
  retryReason: string | undefined,
  query: string,
): Promise<LiteratureToolEnvelope<SearchToolData>> {
  throwIfAborted(state);
  const finishTiming = startLiteratureTiming(state, "search_literature", {
    retry: Boolean(retryReason),
    evalRetrievalOverride: Boolean(state.args.evalRetrievalOverride),
  });
  if (state.hits.length > 0) {
    finishTiming("skip", { hitCount: state.hits.length });
    return ok({ hitCount: state.hits.length });
  }

  emitStageStarted(
    emit,
    "search",
    state.args.evalRetrievalOverride
      ? "eval-retrieval-override"
      : RAG_SEARCH_TOOL_LABEL,
  );

  const attempt = nextToolAttempt(state, "search_literature");
  try {
    if (state.args.evalRetrievalOverride) {
      state.hits = evalRetrievalOverrideHits(state.args.evalRetrievalOverride);
      emitStageMessage(
        emit,
        "search",
        "Using caller-provided retrieval override for an eval case; no corpus search was performed.",
      );
      emitToolResult(emit, "search", "retrieval_override", {
        corpus_size: await corpusSize(),
        corpus_source: await corpusSourceName(),
        corpus_mode: await corpusSourceMode(),
        hits: state.hits.map((hit) => ({
          pmid: hit.paper.pmid,
          title: hit.paper.title,
          year: hit.paper.year,
          score: hit.score,
        })),
      });
      state.usageParts.push(ZERO_USAGE);
    } else {
      const search = await runRagSearchTool(
        { query },
        { onTiming: state.args.onTiming },
      );
      state.hits = search.hits;
      emitStageMessage(emit, "search", search.message);
      for (const trace of search.traces) {
        emitToolCall(emit, "search", trace.tool, trace.input);
        emitToolResult(emit, "search", trace.tool, trace.output);
      }
      state.usageParts.push(ZERO_USAGE);
    }

    emitStageFinished(emit, "search", state.usageParts.at(-1) ?? ZERO_USAGE);

    if (state.hits.length === 0) {
      finishTiming("finish", {
        completeWithoutEvidence: true,
        hitCount: 0,
        usageCostUsd: (state.usageParts.at(-1) ?? ZERO_USAGE).costUsd,
      });
      if (attempt < MAX_TOOL_ATTEMPTS) {
        emitRecoveryEvent(
          emit,
          "Search returned no evidence; asking the orchestrator to broaden the query.",
        );
        return recoverable(
          "search_no_hits",
          "Search returned no matching papers.",
          `Call search_literature again with a broader query. Keep core biomedical terms from the question but remove overly specific phrasing. Original question: ${state.question}`,
        );
      }
      state.finalResult = {
        hypothesis: `No matching papers in the GLP-1 + peptides corpus for: "${state.question}". Try rebuilding the corpus, checking the R2 URLs, or using a broader question.`,
        evidence: [],
        confidence: 0,
      };
      return ok({ hitCount: 0, completeWithoutEvidence: true });
    }

    finishTiming("finish", {
      hitCount: state.hits.length,
      usageCostUsd: (state.usageParts.at(-1) ?? ZERO_USAGE).costUsd,
    });
    return ok({ hitCount: state.hits.length });
  } catch (err) {
    if (isAbortError(err)) throw err;
    finishTiming("error", { error: errorMessage(err) });
    emitStageFinished(emit, "search", ZERO_USAGE);
    if (attempt < MAX_TOOL_ATTEMPTS) {
      emitRecoveryEvent(
        emit,
        "Search failed; asking the orchestrator to retry with a compact query.",
      );
      return recoverable(
        "search_failed",
        "Search retrieval failed.",
        `Call search_literature again with a compact query that preserves the molecule, endpoint, population, and comparator from the question. Previous error: ${truncate(errorMessage(err), 700)}`,
      );
    }
    return fatal("search_failed", errorMessage(err));
  }
}

async function extractCandidateClaims(
  state: LiteratureRunState,
  emit: LiteratureEventSink,
  retryReason: string | undefined,
): Promise<LiteratureToolEnvelope<ExtractionToolData>> {
  throwIfAborted(state);
  const finishTiming = startLiteratureTiming(
    state,
    "extract_candidate_claims",
    {
      retry: Boolean(retryReason),
    },
  );
  if (state.candidateClaims.length > 0) {
    finishTiming("skip", { claimCount: state.candidateClaims.length });
    return ok({
      claimCount: state.candidateClaims.length,
    });
  }
  if (state.hits.length === 0) {
    finishTiming("error", { error: "missing_retrieval" });
    return fatal(
      "missing_retrieval",
      "Run search_literature before extracting candidate claims.",
    );
  }

  const attempt = nextToolAttempt(state, "extract_candidate_claims");
  emitStageStarted(emit, "claim_extractor", CLAIM_EXTRACTOR_MODEL);

  try {
    const extraction = await runClaimExtractionModelTool({
      question: state.question,
      papers: state.hits.map((hit) => hit.paper),
      repairInstruction: retryReason ?? state.lastExtractionError,
      signal: state.args.abortController?.signal,
    });
    state.usageParts.push(extraction.usage);
    state.lastExtractionError = undefined;

    let candidateClaims = extraction.claims;
    if (attempt > 1) {
      emitStageMessage(
        emit,
        "claim_extractor",
        "Claim extraction retry produced a valid structured handoff.",
      );
    }
    emitStageMessage(
      emit,
      "claim_extractor",
      "Extracting candidate claims from the retrieved abstracts.",
    );
    emitToolResult(emit, "claim_extractor", "candidate_claims", {
      claims: candidateClaims.map((claim) => ({
        pmid: claim.pmid,
        claim: claim.claim,
      })),
    });

    const verifierCheckClaim = state.args.injectUnverifiedClaim
      ? maybeBuildVerifierCheckClaim(
          candidateClaims,
          state.hits.map((hit) => hit.paper.pmid),
        )
      : undefined;
    if (verifierCheckClaim) {
      candidateClaims = [...candidateClaims, verifierCheckClaim];
      emitStageMessage(
        emit,
        "claim_extractor",
        "Injected demo claim: Added one intentionally unsupported claim for demo purposes. The injected claim is not backed by any of the retrieved literature.",
      );
    }

    state.candidateClaims = attachEvidenceIds(candidateClaims);
    if (verifierCheckClaim) {
      const appendedClaim = state.candidateClaims.at(-1);
      if (appendedClaim?.evidenceId) {
        state.demoClaimEvidenceIds.add(appendedClaim.evidenceId);
      }
    }
    emitStageFinished(emit, "claim_extractor", extraction.usage);
    finishTiming("finish", {
      attempt,
      claimCount: state.candidateClaims.length,
      finishReason: extraction.metadata.finishReason,
      injectUnverifiedClaim: state.args.injectUnverifiedClaim,
      requestedEffort: extraction.metadata.requestedEffort,
      retryCount: extraction.metadata.retryCount,
      schemaName: extraction.metadata.schemaName,
      sentEffort: extraction.metadata.sentEffort,
      usageCostUsd: extraction.usage.costUsd,
    });
    return ok({
      claimCount: state.candidateClaims.length,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (err instanceof ClaimExtractionValidationError) {
      state.usageParts.push(err.usage);
      state.lastExtractionError = err.parseError ?? err.message;
      emitStageMessage(
        emit,
        "claim_extractor",
        `Claim extractor returned invalid structured output: ${truncate(
          state.lastExtractionError,
          260,
        )}`,
      );
      emitStageFinished(emit, "claim_extractor", err.usage);
      if (attempt < MAX_TOOL_ATTEMPTS) {
        emitRecoveryEvent(
          emit,
          "Claim extraction schema issue; asking the orchestrator to retry with stricter field guidance.",
        );
        emitOrchestratorNote(
          emit,
          "Claim extraction returned a recoverable schema error; retry guidance is being returned to the orchestrator.",
        );
        finishTiming("error", {
          attempt,
          error: "claim_schema_invalid",
          finishReason: err.metadata?.finishReason,
          recoverable: true,
          requestedEffort: err.metadata?.requestedEffort,
          retryCount: err.metadata?.retryCount,
          schemaName: err.metadata?.schemaName,
          sentEffort: err.metadata?.sentEffort,
          usageCostUsd: err.usage.costUsd,
        });
        return recoverable(
          "claim_schema_invalid",
          "The claim extractor omitted or malformed required fields.",
          `Call extract_candidate_claims again. Tell it every claim must include pmid copied exactly from one of these retrieved paper PMIDs: ${state.hits
            .map((hit) => hit.paper.pmid)
            .join(", ")}. Previous validation error: ${truncate(
            state.lastExtractionError,
            700,
          )}`,
        );
      }
      finishTiming("error", {
        attempt,
        error: err.message,
        finishReason: err.metadata?.finishReason,
        recoverable: false,
        requestedEffort: err.metadata?.requestedEffort,
        retryCount: err.metadata?.retryCount,
        schemaName: err.metadata?.schemaName,
        sentEffort: err.metadata?.sentEffort,
        usageCostUsd: err.usage.costUsd,
      });
      return fatal("claim_schema_invalid", err.message);
    }
    finishTiming("error", { attempt, error: errorMessage(err) });
    emitStageFinished(emit, "claim_extractor", ZERO_USAGE);
    return fatal("claim_extraction_failed", errorMessage(err));
  }
}

async function verifyCitations(
  state: LiteratureRunState,
  emit: LiteratureEventSink,
  retryReason: string | undefined,
): Promise<LiteratureToolEnvelope<VerificationToolData>> {
  throwIfAborted(state);
  const finishTiming = startLiteratureTiming(state, "verify_citations", {
    claimCount: state.candidateClaims.length,
    retry: Boolean(retryReason),
  });
  if (state.verdicts.length > 0) {
    finishTiming("skip", { ...verificationSummary(state) });
    return ok(verificationSummary(state));
  }
  if (state.candidateClaims.length === 0) {
    finishTiming("error", { error: "missing_candidate_claims" });
    return fatal(
      "missing_candidate_claims",
      "Run extract_candidate_claims before verifying citations.",
    );
  }

  emitStageStarted(emit, "citation_verifier", VERIFIER_MODEL);
  const attempt = nextToolAttempt(state, "verify_citations");
  try {
    const verifierContext = verifierContextSummary(state);
    emitStageMessage(
      emit,
      "citation_verifier",
      "Verifying extracted claims against retrieved abstracts.",
    );
    emitToolResult(emit, "citation_verifier", "verifier_context", {
      abstract_count: verifierContext.abstractCount,
      claim_count: verifierContext.claimCount,
      pmids: verifierContext.pmids,
    });
    const verifier = await runCitationVerificationModelTool({
      claims: state.candidateClaims,
      knownUnsupportedEvidenceIds: state.demoClaimEvidenceIds,
      papers: state.hits.map((hit) => hit.paper),
      repairInstruction: retryReason,
      signal: state.args.abortController?.signal,
    });
    for (const verdict of verifier.verdicts) {
      emitToolResult(emit, "citation_verifier", "citation_verdict", {
        evidence_id: verdict.evidenceId,
        pmid: verdict.pmid,
        claim: verdict.claim,
        verified: verdict.supported,
        rationale: verdict.rationale,
        supporting_quote: verdict.supportingQuote,
      });
    }
    state.verdicts = verifier.verdicts;
    state.usageParts.push(verifier.usage);
    emitStageFinished(emit, "citation_verifier", verifier.usage);
    const summary = verificationSummary(state);
    finishTiming("finish", {
      ...summary,
      abstractContextCount: verifierContext.abstractCount,
      finishReason: verifier.metadata.finishReason,
      requestedEffort: verifier.metadata.requestedEffort,
      retryCount: verifier.metadata.retryCount,
      schemaName: verifier.metadata.schemaName,
      sentEffort: verifier.metadata.sentEffort,
      usageCostUsd: verifier.usage.costUsd,
    });
    return ok(summary);
  } catch (err) {
    if (isAbortError(err)) throw err;
    finishTiming("error", {
      error: errorMessage(err),
      finishReason:
        err instanceof StructuredToolValidationError
          ? err.metadata?.finishReason
          : undefined,
      requestedEffort:
        err instanceof StructuredToolValidationError
          ? err.metadata?.requestedEffort
          : undefined,
      retryCount:
        err instanceof StructuredToolValidationError
          ? err.metadata?.retryCount
          : undefined,
      schemaName:
        err instanceof StructuredToolValidationError
          ? err.metadata?.schemaName
          : undefined,
      sentEffort:
        err instanceof StructuredToolValidationError
          ? err.metadata?.sentEffort
          : undefined,
    });
    const usage =
      err instanceof StructuredToolValidationError ? err.usage : ZERO_USAGE;
    if (err instanceof StructuredToolValidationError) {
      state.usageParts.push(err.usage);
      emitStageMessage(
        emit,
        "citation_verifier",
        `Citation verification returned invalid structured output: ${truncate(
          err.parseError ?? err.message,
          260,
        )}`,
      );
    }
    emitStageFinished(emit, "citation_verifier", usage);
    if (
      err instanceof StructuredToolValidationError &&
      attempt < MAX_TOOL_ATTEMPTS
    ) {
      emitRecoveryEvent(
        emit,
        "Verifier schema issue; asking the orchestrator to retry with stricter verdict guidance.",
      );
      emitOrchestratorNote(
        emit,
        "Citation verification returned a recoverable validation error; retry guidance is being returned to the orchestrator.",
      );
      return recoverable(
        "verification_schema_invalid",
        "The citation verifier omitted, malformed, or contradicted required verdict fields.",
        `Call verify_citations again with this retryReason. Return exactly one verdict per evidenceId, preserve evidenceId/pmid/claim exactly, include supportingQuote only for supported=true, and mark supported=true only when the matching abstract directly supports every qualifier. Previous validation error: ${truncate(
          err.parseError ?? err.message,
          700,
        )}`,
      );
    }
    return fatal("verification_failed", errorMessage(err));
  }
}

async function synthesizeHypothesis(
  state: LiteratureRunState,
  emit: LiteratureEventSink,
  retryReason: string | undefined,
): Promise<LiteratureToolEnvelope<SynthesisToolData>> {
  throwIfAborted(state);
  const finishTiming = startLiteratureTiming(state, "synthesize_hypothesis", {
    retry: Boolean(retryReason),
    verdictCount: state.verdicts.length,
  });
  if (state.finalResult) {
    finishTiming("skip", {
      confidence: state.finalResult.confidence,
      evidenceCount: state.finalResult.evidence.length,
    });
    return ok({
      confidence: state.finalResult.confidence,
      evidenceCount: state.finalResult.evidence.length,
    });
  }
  if (state.verdicts.length === 0) {
    finishTiming("error", { error: "missing_verdicts" });
    return fatal(
      "missing_verdicts",
      "Run verify_citations before synthesizing the final hypothesis.",
    );
  }

  emitStageStarted(emit, "hypothesis", HYPOTHESIS_MODEL);
  const attempt = nextToolAttempt(state, "synthesize_hypothesis");
  try {
    const verifiedCount = state.verdicts.filter(
      (verdict) => verdict.supported,
    ).length;
    emitStageMessage(
      emit,
      "hypothesis",
      `Synthesizing from ${verifiedCount} verified claim${verifiedCount === 1 ? "" : "s"}; rejected claims are passed as limitations, not evidence.`,
    );
    const hypothesis = await runHypothesisModelTool({
      question: state.question,
      papers: state.hits.map((hit) => hit.paper),
      verdicts: state.verdicts,
      systemPromptOverride: state.args.hypothesisSystemPrompt,
      repairInstruction: retryReason,
      signal: state.args.abortController?.signal,
    });
    state.usageParts.push(hypothesis.usage);
    // Live demos prefer a resilient public handoff if the synthesis model
    // omits evidence IDs, but evals disable this so evidence-selection misses
    // are scored as model behavior instead of repaired at assembly time.
    const assembledEvidence = assembleVerifiedEvidence(
      state.verdicts,
      hypothesis.output.evidenceIds,
      { allowFallback: state.args.allowEvidenceFallback },
    );
    if (assembledEvidence.droppedEvidenceIds.length > 0) {
      emitStageMessage(
        emit,
        "hypothesis",
        `Dropped ${assembledEvidence.droppedEvidenceIds.length} evidence ID${assembledEvidence.droppedEvidenceIds.length === 1 ? "" : "s"} because the model selected rejected or unknown verifier output.`,
      );
    }
    if (assembledEvidence.usedFallbackSelection) {
      emitStageMessage(
        emit,
        "hypothesis",
        "The synthesis model returned no usable evidence IDs, so final evidence was assembled directly from supported verifier verdicts.",
      );
    }
    state.finalResult = {
      hypothesis: hypothesis.output.hypothesis,
      evidence: assembledEvidence.evidence,
      confidence: hypothesis.output.confidence,
    };
    emitStageFinished(emit, "hypothesis", hypothesis.usage);
    finishTiming("finish", {
      confidence: state.finalResult.confidence,
      droppedEvidenceIdCount: assembledEvidence.droppedEvidenceIds.length,
      evidenceCount: state.finalResult.evidence.length,
      finishReason: hypothesis.metadata.finishReason,
      requestedEffort: hypothesis.metadata.requestedEffort,
      retryCount: hypothesis.metadata.retryCount,
      schemaName: hypothesis.metadata.schemaName,
      sentEffort: hypothesis.metadata.sentEffort,
      usedFallbackSelection: assembledEvidence.usedFallbackSelection,
      usageCostUsd: hypothesis.usage.costUsd,
    });
    return ok({
      confidence: state.finalResult.confidence,
      evidenceCount: state.finalResult.evidence.length,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    finishTiming("error", {
      error: errorMessage(err),
      finishReason:
        err instanceof StructuredToolValidationError
          ? err.metadata?.finishReason
          : undefined,
      requestedEffort:
        err instanceof StructuredToolValidationError
          ? err.metadata?.requestedEffort
          : undefined,
      retryCount:
        err instanceof StructuredToolValidationError
          ? err.metadata?.retryCount
          : undefined,
      schemaName:
        err instanceof StructuredToolValidationError
          ? err.metadata?.schemaName
          : undefined,
      sentEffort:
        err instanceof StructuredToolValidationError
          ? err.metadata?.sentEffort
          : undefined,
    });
    const usage =
      err instanceof StructuredToolValidationError ? err.usage : ZERO_USAGE;
    if (err instanceof StructuredToolValidationError) {
      state.usageParts.push(err.usage);
      emitStageMessage(
        emit,
        "hypothesis",
        `Hypothesis synthesis returned invalid structured output: ${truncate(
          err.parseError ?? err.message,
          260,
        )}`,
      );
    }
    emitStageFinished(emit, "hypothesis", usage);
    if (
      err instanceof StructuredToolValidationError &&
      attempt < MAX_TOOL_ATTEMPTS
    ) {
      emitRecoveryEvent(
        emit,
        "Hypothesis schema issue; asking the orchestrator to retry with stricter evidence guidance.",
      );
      emitOrchestratorNote(
        emit,
        "Hypothesis synthesis returned a recoverable validation error; retry guidance is being returned to the orchestrator.",
      );
      return recoverable(
        "hypothesis_schema_invalid",
        "The hypothesis model omitted or selected invalid evidence IDs.",
        `Call synthesize_hypothesis again with this retryReason. Select only evidenceId values from supported verifier verdicts; never select rejected or unknown IDs. Previous validation error: ${truncate(
          err.parseError ?? err.message,
          700,
        )}`,
      );
    }
    return fatal("hypothesis_failed", errorMessage(err));
  }
}

function evalRetrievalOverrideHits(papers: readonly Paper[]): RetrievalHit[] {
  return papers.map((paper) => ({
    paper,
    score: 0,
    source: "bm25" as const,
  }));
}

function nextToolAttempt(
  state: LiteratureRunState,
  toolName: LiteratureToolName,
): number {
  const attempt = (state.toolAttempts[toolName] ?? 0) + 1;
  state.toolAttempts[toolName] = attempt;
  return attempt;
}

function verificationSummary(state: LiteratureRunState): VerificationToolData {
  const supportedCount = state.verdicts.filter(
    (verdict) => verdict.supported,
  ).length;
  const rejectedCount = state.verdicts.length - supportedCount;
  return {
    verdictCount: state.verdicts.length,
    supportedCount,
    rejectedCount,
  };
}

function verifierContextSummary(state: LiteratureRunState): {
  abstractCount: number;
  claimCount: number;
  pmids: string[];
} {
  const retrievedPmids = new Set(state.hits.map((hit) => hit.paper.pmid));
  const pmids = [
    ...new Set(
      state.candidateClaims
        .map((claim) => claim.pmid)
        .filter((pmid) => retrievedPmids.has(pmid)),
    ),
  ];
  return {
    abstractCount: pmids.length,
    claimCount: state.candidateClaims.length,
    pmids,
  };
}

function ok<T>(data: T): LiteratureToolEnvelope<T> {
  return { status: "ok", data };
}

function recoverable(
  code: string,
  message: string,
  retryHint: string,
): LiteratureToolEnvelope<never> {
  return { status: "recoverable_error", code, message, retryHint };
}

function fatal(code: string, message: string): LiteratureToolEnvelope<never> {
  return { status: "fatal_error", code, message };
}

function emitRecoveryEvent(emit: LiteratureEventSink, detail: string): void {
  emitAgentLoopEvent(emit, {
    phase: "recovery",
    status: "running",
    label: "Recoverable tool error",
    detail,
  });
}

function throwIfAborted(state: LiteratureRunState): void {
  if (state.args.abortController?.signal.aborted) {
    const err = new Error("Literature stream was aborted.");
    err.name = "AbortError";
    throw err;
  }
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

function structuredToolResult<T>(value: LiteratureToolEnvelope<T>): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent: Record<string, unknown>;
} {
  return {
    structuredContent: value,
    ...(value.status === "ok" ? {} : { isError: true }),
    content: [
      {
        type: "text" as const,
        text: summarizeToolEnvelope(value),
      },
    ],
  };
}

function summarizeToolEnvelope<T>(value: LiteratureToolEnvelope<T>): string {
  switch (value.status) {
    case "ok":
      return `status=ok data=${JSON.stringify(value.data)}`;
    case "recoverable_error":
      return `status=recoverable_error code=${value.code} message=${value.message} retryHint=${value.retryHint}`;
    case "fatal_error":
      return `status=fatal_error code=${value.code} message=${value.message}`;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
