import type { RetrievalHit } from "@novamind/shared";
import {
  corpusSize,
  corpusSourceMode,
  corpusSourceName,
  retrieve,
  type RetrievalMethod,
} from "../rag";
import type { LiteratureTimingSink, LiteratureToolTrace } from "./types";

export const RAG_SEARCH_TOOL_LABEL = "Hybrid RAG";
const DEFAULT_SEARCH_K = 5;
const MAX_SEARCH_K = 10;

export interface RunRagSearchToolArgs {
  query: string;
  k?: number;
  method?: RetrievalMethod;
}

export interface RunRagSearchToolResult {
  hits: RetrievalHit[];
  message: string;
  query: string;
  traces: LiteratureToolTrace[];
}

/**
 * Run deterministic corpus retrieval for a query selected by the orchestrator.
 * This keeps planning with the agent while keeping search itself as a fast,
 * typed RAG tool with no extra model call.
 */
export async function runRagSearchTool(
  args: RunRagSearchToolArgs,
  options: { onTiming?: LiteratureTimingSink } = {},
): Promise<RunRagSearchToolResult> {
  const query = normalizeSearchQuery(args.query);
  if (!query) {
    throw new Error("search_literature requires a non-empty query.");
  }

  const k = normalizeSearchLimit(args.k);
  const method = args.method ?? "hybrid";
  const retrieveStartedAt = Date.now();
  options.onTiming?.({
    k,
    method,
    phase: "start",
    query,
    stage: "rag_retrieve",
  });

  let hits: RetrievalHit[];
  try {
    hits = await retrieve(query, { k, method });
  } catch (err) {
    options.onTiming?.({
      elapsedMs: Date.now() - retrieveStartedAt,
      error: err instanceof Error ? err.message : String(err),
      k,
      method,
      phase: "error",
      query,
      stage: "rag_retrieve",
    });
    throw err;
  }

  const [corpusSizeValue, corpusSource, corpusMode] = await Promise.all([
    corpusSize(),
    corpusSourceName(),
    corpusSourceMode(),
  ]);
  options.onTiming?.({
    corpusMode,
    corpusSize: corpusSizeValue,
    corpusSource,
    elapsedMs: Date.now() - retrieveStartedAt,
    hitCount: hits.length,
    k,
    method,
    phase: "finish",
    query,
    stage: "rag_retrieve",
  });

  return {
    hits,
    message: "Searching the GLP-1 corpus for relevant documents.",
    query,
    traces: [
      {
        tool: "pubmed_corpus_search",
        input: { query, k, method },
        output: {
          corpusSize: corpusSizeValue,
          corpusSource,
          corpusMode,
          hits: hits.map((hit) => ({
            pmid: hit.paper.pmid,
            title: hit.paper.title,
            year: hit.paper.year,
            score: Number(hit.score.toFixed(4)),
            abstractExcerpt: hit.paper.abstract.slice(0, 360),
          })),
        },
      },
    ],
  };
}

function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function normalizeSearchLimit(k: number | undefined): number {
  if (k === undefined) return DEFAULT_SEARCH_K;
  if (!Number.isInteger(k) || k < 1) {
    throw new Error("search_literature requires k to be a positive integer.");
  }
  return Math.min(k, MAX_SEARCH_K);
}
