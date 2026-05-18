import type {
  HypothesisResult,
  Paper,
  RetrievalHit,
  StreamEvent,
  TokenUsage,
} from "@novamind/shared";
import type { CandidateClaim, CitationVerdict } from "./model-tools";

export interface RunLiteratureAgentArgs {
  question: string;
  /**
   * Optional request/run identifier for product SSE events and Cloudflare logs.
   * Cold Agent SDK queries also forward it into telemetry resource attributes;
   * warm profiles keep the attributes configured during startup.
   */
  runId?: string;
  /**
   * Optional timing sink used by the HTTP/container layer to correlate
   * orchestrator, tool-wrapper, and retrieval latencies in production logs.
   */
  onTiming?: LiteratureTimingSink;
  /**
   * Optional cancellation controller owned by the HTTP stream. The Agent SDK
   * query and direct structured model calls use the same signal so client
   * disconnects stop the whole trajectory instead of leaving work in flight.
   */
  abortController?: AbortController;
  /** Optional override for the hypothesis system prompt — used by evals. */
  hypothesisSystemPrompt?: string;
  /**
   * Internal override for deterministic tests and evals. When omitted, the
   * literature tool wrapper reads INJECT_UNVERIFIED_CLAIM from the agent
   * runtime env.
   */
  injectUnverifiedClaim?: boolean;
  /**
   * Eval/test-only retrieval fixture. When set, skip RAG and use these papers
   * as the retrieved set while still exercising downstream literature stages.
   * Browser/API request schemas must not expose this hook.
   */
  evalRetrievalOverride?: readonly Paper[];
  /**
   * Live demos default to a resilient final evidence fallback if the synthesis
   * model omits usable evidence IDs. Evals can disable it to score whether the
   * model itself abstained from citing evidence.
   */
  allowEvidenceFallback?: boolean;
}

export interface LiteratureAgentRun {
  result: HypothesisResult | undefined;
  totalUsage: TokenUsage;
  events: StreamEvent[];
  elapsedMs: number;
}

export type LiteratureTimingPhase =
  | "start"
  | "event"
  | "finish"
  | "error"
  | "skip";

export interface LiteratureTimingEvent {
  elapsedMs?: number;
  phase: LiteratureTimingPhase;
  stage: string;
  [key: string]: unknown;
}

export type LiteratureTimingSink = (event: LiteratureTimingEvent) => void;

export interface LiteratureToolTrace {
  tool: string;
  input: unknown;
  output: unknown;
}

export type LiteratureToolName =
  | "search_literature"
  | "extract_candidate_claims"
  | "verify_citations"
  | "synthesize_hypothesis";

export interface LiteratureRunState {
  question: string;
  args: Required<Pick<RunLiteratureAgentArgs, "injectUnverifiedClaim">> &
    Omit<RunLiteratureAgentArgs, "injectUnverifiedClaim">;
  demoClaimEvidenceIds: Set<string>;
  hits: RetrievalHit[];
  candidateClaims: CandidateClaim[];
  verdicts: CitationVerdict[];
  finalResult: HypothesisResult | undefined;
  lastExtractionError: string | undefined;
  toolAttempts: Partial<Record<LiteratureToolName, number>>;
  usageParts: TokenUsage[];
}

export type LiteratureToolEnvelope<T> =
  | {
      status: "ok";
      data: T;
    }
  | {
      status: "recoverable_error";
      code: string;
      message: string;
      retryHint: string;
    }
  | {
      status: "fatal_error";
      code: string;
      message: string;
    };
