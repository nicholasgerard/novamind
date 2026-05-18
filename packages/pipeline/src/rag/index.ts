import type { Paper, RetrievalHit } from "@novamind/shared";
import { BM25 } from "./bm25";
import { loadCorpusSource } from "./sources";
import {
  type EmbeddingProvider,
  loadEmbeddingIndex,
  vectorAvailable,
  vectorSearch,
} from "./vector";

let papers: ReadonlyArray<Paper> = [];
let papersByPmid: Map<string, Paper> = new Map();
let bm25Index: BM25 | null = null;
let sourceName: "ingested" | "fixture" = "fixture";
let sourceMode: "r2" | "local" | "fixture" = "fixture";
let initPromise: Promise<void> | null = null;

/**
 * Initialize the RAG layer once: load the corpus by the configured data-source
 * policy, build the BM25 index, and prepare maps for downstream lookups.
 * Idempotent and concurrency-safe — multiple callers await the same in-flight
 * Promise.
 *
 * Called automatically by `retrieve()` and the corpus accessors.
 * `preloadRagResources()` wraps this with vector-index loading for container
 * boot and demo startup.
 */
export async function ensureRagReady(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const source = await loadCorpusSource();
    papers = source.papers;
    sourceName = source.name;
    sourceMode = source.mode;
    papersByPmid = new Map(papers.map((p) => [p.pmid, p]));
    bm25Index = new BM25(
      papers.map((p) => ({
        id: p.pmid,
        text: `${p.title}\n${p.abstract}\n${p.meshTerms.join(" ")}`,
      })),
    );
  })();
  return initPromise;
}

export type RetrievalMethod = "bm25" | "voyage" | "openai" | "hybrid";

export interface RetrieveOptions {
  k?: number;
  /** Default `"hybrid"`. Falls back to BM25-only if the requested vector backend is unavailable. */
  method?: RetrievalMethod;
}

export interface RagWarmupTimingEvent {
  elapsedMs?: number;
  phase: "start" | "finish" | "error";
  stage: "corpus" | "embedding_index" | "probe_retrieval";
  [key: string]: unknown;
}

export interface RagWarmupResult {
  corpus: {
    mode: "r2" | "local" | "fixture";
    name: "ingested" | "fixture";
    papers: number;
  };
  probe?: {
    hitCount: number;
    query: string;
  };
  vector: {
    loaded: boolean;
    provider: EmbeddingProvider;
  };
}

export interface RagWarmupOptions {
  onTiming?: (event: RagWarmupTimingEvent) => void;
  probeQuery?: string;
  provider?: EmbeddingProvider;
}

const RRF_K = 60;

export async function retrieve(
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievalHit[]> {
  await ensureRagReady();
  const k = opts.k ?? 5;
  const method = opts.method ?? "hybrid";

  if (method === "bm25") {
    return mapHits(bm25Index!.search(query, k), "bm25");
  }
  if (method === "voyage" || method === "openai") {
    if (!(await vectorAvailable(method))) {
      console.warn(
        `[rag] ${method} unavailable; falling back to BM25 for this query`,
      );
      return mapHits(bm25Index!.search(query, k), "bm25");
    }
    const hits = await vectorSearch(query, k, method);
    return mapHits(hits, "vector");
  }
  return hybridRetrieve(query, k);
}

/**
 * Eagerly load the resources that are otherwise initialized lazily by the
 * first research-agent search: the paper corpus, BM25 index, optional Voyage
 * embedding index, and an optional one-hit retrieval probe. The container uses
 * this at boot and from the `/runtime/startup` route before live demos.
 */
export async function preloadRagResources(
  opts: RagWarmupOptions = {},
): Promise<RagWarmupResult> {
  const provider = opts.provider ?? "voyage";

  const corpusStart = Date.now();
  opts.onTiming?.({ phase: "start", stage: "corpus" });
  await ensureRagReady();
  opts.onTiming?.({
    elapsedMs: Date.now() - corpusStart,
    mode: sourceMode,
    papers: papers.length,
    phase: "finish",
    source: sourceName,
    stage: "corpus",
  });

  const vectorStart = Date.now();
  opts.onTiming?.({ phase: "start", provider, stage: "embedding_index" });
  const embeddingIndex = await loadEmbeddingIndex(provider);
  opts.onTiming?.({
    elapsedMs: Date.now() - vectorStart,
    loaded: Boolean(embeddingIndex),
    phase: "finish",
    provider,
    stage: "embedding_index",
  });

  let probe: RagWarmupResult["probe"];
  if (opts.probeQuery) {
    const probeStart = Date.now();
    opts.onTiming?.({
      phase: "start",
      query: opts.probeQuery,
      stage: "probe_retrieval",
    });
    try {
      const hits = await retrieve(opts.probeQuery, { k: 1, method: "hybrid" });
      probe = { hitCount: hits.length, query: opts.probeQuery };
      opts.onTiming?.({
        elapsedMs: Date.now() - probeStart,
        hitCount: hits.length,
        phase: "finish",
        query: opts.probeQuery,
        stage: "probe_retrieval",
      });
    } catch (err) {
      opts.onTiming?.({
        elapsedMs: Date.now() - probeStart,
        error: err instanceof Error ? err.message : String(err),
        phase: "error",
        query: opts.probeQuery,
        stage: "probe_retrieval",
      });
      throw err;
    }
  }

  return {
    corpus: { mode: sourceMode, name: sourceName, papers: papers.length },
    probe,
    vector: { loaded: Boolean(embeddingIndex), provider },
  };
}

async function hybridRetrieve(
  query: string,
  k: number,
): Promise<RetrievalHit[]> {
  const oversample = Math.max(k * 2, k + 5);
  const [bm25Hits, vectorHits] = await Promise.all([
    Promise.resolve(bm25Index!.search(query, oversample)),
    vectorSearchIfAvailable(query, oversample),
  ]);

  const hitSource: RetrievalHit["source"] =
    vectorHits.length > 0 ? "hybrid" : "bm25";
  const ranked =
    vectorHits.length === 0
      ? bm25Hits
      : reciprocalRankFusion(bm25Hits, vectorHits);

  return mapHits(ranked.slice(0, k), hitSource);
}

async function vectorSearchIfAvailable(
  query: string,
  k: number,
): Promise<Array<{ id: string; score: number }>> {
  if (!(await vectorAvailable("voyage"))) return [];
  try {
    return await vectorSearch(query, k, "voyage");
  } catch (err) {
    console.warn(`[rag] voyage search failed, BM25-only:`, err);
    return [];
  }
}

function reciprocalRankFusion(
  bm25: Array<{ id: string; score: number }>,
  vector: Array<{ id: string; score: number }>,
): Array<{ id: string; score: number }> {
  const fused = new Map<string, number>();
  for (const [rank, h] of bm25.entries()) {
    fused.set(h.id, (fused.get(h.id) ?? 0) + 1 / (RRF_K + rank));
  }
  for (const [rank, h] of vector.entries()) {
    fused.set(h.id, (fused.get(h.id) ?? 0) + 1 / (RRF_K + rank));
  }
  return [...fused.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

function mapHits(
  hits: ReadonlyArray<{ id: string; score: number }>,
  source: RetrievalHit["source"],
): RetrievalHit[] {
  const out: RetrievalHit[] = [];
  for (const h of hits) {
    const paper = papersByPmid.get(h.id);
    if (paper) out.push({ paper, score: h.score, source });
  }
  return out;
}

export async function corpusSize(): Promise<number> {
  await ensureRagReady();
  return papers.length;
}

export async function corpusSourceName(): Promise<"ingested" | "fixture"> {
  await ensureRagReady();
  return sourceName;
}

export async function corpusSourceMode(): Promise<"r2" | "local" | "fixture"> {
  await ensureRagReady();
  return sourceMode;
}

export async function getCorpus(): Promise<readonly Paper[]> {
  await ensureRagReady();
  return papers;
}

export type { EmbeddingProvider };
