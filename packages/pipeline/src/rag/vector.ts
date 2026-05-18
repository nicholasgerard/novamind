import { z } from "zod";
import { embedOpenAI, embedVoyage } from "./embeddings";
import {
  fetchJsonWithTimeout,
  fixtureModeEnabled,
  readJsonFromLocalCorpus,
} from "./loader";

export type EmbeddingProvider = "voyage" | "openai";

const LOCAL_FILENAMES: Record<EmbeddingProvider, string> = {
  voyage: "embeddings.voyage.json",
  openai: "embeddings.openai.json",
};

function r2UrlFor(provider: EmbeddingProvider): string | undefined {
  return provider === "voyage"
    ? process.env.NOVAMIND_VOYAGE_EMBEDDINGS_URL
    : process.env.NOVAMIND_OPENAI_EMBEDDINGS_URL;
}

const EmbedFileSchema = z.object({
  _model: z.string(),
  _dim: z.number().int(),
  byPmid: z.record(z.string(), z.array(z.number())),
});

interface EmbeddingIndex {
  provider: EmbeddingProvider;
  embeddings: Map<string, number[]>;
  dim: number;
  norms: Map<string, number>;
}

const FETCH_TIMEOUT_MS = 60_000;

function buildIndex(
  provider: EmbeddingProvider,
  parsed: z.infer<typeof EmbedFileSchema>,
): EmbeddingIndex {
  const embeddings = new Map<string, number[]>();
  const norms = new Map<string, number>();
  for (const [pmid, vec] of Object.entries(parsed.byPmid)) {
    embeddings.set(pmid, vec);
    norms.set(pmid, Math.sqrt(vec.reduce((a, b) => a + b * b, 0)));
  }
  return { provider, embeddings, dim: parsed._dim, norms };
}

async function tryLoadFromR2(
  provider: EmbeddingProvider,
): Promise<EmbeddingIndex | null> {
  const url = r2UrlFor(provider);
  if (!url) return null;
  try {
    console.log(`[rag] fetching ${provider} embeddings from R2: ${url}`);
    const raw = await fetchJsonWithTimeout(url, FETCH_TIMEOUT_MS);
    const parsed = EmbedFileSchema.parse(raw);
    const idx = buildIndex(provider, parsed);
    console.log(
      `[rag] loaded R2 ${provider} embeddings: ${idx.embeddings.size} papers, dim ${idx.dim}`,
    );
    return idx;
  } catch (err) {
    console.warn(`[rag] R2 ${provider} embeddings fetch failed:`, err);
    return null;
  }
}

function tryLoadFromFs(provider: EmbeddingProvider): EmbeddingIndex | null {
  const parsed = readJsonFromLocalCorpus(
    LOCAL_FILENAMES[provider],
    (raw) => EmbedFileSchema.parse(raw),
    (path, parsed) =>
      console.log(
        `[rag] loaded local ${provider} embeddings: ${Object.keys(parsed.byPmid).length} papers, dim ${parsed._dim} from ${path}`,
      ),
  );
  if (!parsed) return null;
  return buildIndex(provider, parsed);
}

const cache: Partial<Record<EmbeddingProvider, EmbeddingIndex | null>> = {};
const pending: Partial<
  Record<EmbeddingProvider, Promise<EmbeddingIndex | null>>
> = {};
const MAX_QUERY_EMBEDDING_CACHE_ENTRIES = 128;
const queryEmbeddingCache = new Map<string, Promise<number[]>>();

/**
 * Load the embedding index for `provider`. Preference order matches the
 * corpus loader: R2 first, then local development files, then `null`.
 * `null` means vector search is unavailable for that provider; `retrieve()`
 * will fall back to BM25.
 *
 * `DEMO_FIXTURE_MODE=true` disables vector retrieval entirely so the demo
 * stays deterministic and offline-friendly.
 */
export function loadEmbeddingIndex(
  provider: EmbeddingProvider,
): Promise<EmbeddingIndex | null> {
  if (provider in cache) return Promise.resolve(cache[provider] ?? null);
  let p = pending[provider];
  if (!p) {
    p = (async () => {
      if (fixtureModeEnabled()) {
        console.log(
          `[rag] ${provider} embeddings disabled — DEMO_FIXTURE_MODE=true`,
        );
        cache[provider] = null;
        return null;
      }
      const fromR2 = await tryLoadFromR2(provider);
      if (fromR2) {
        cache[provider] = fromR2;
        return fromR2;
      }
      const fromFs = tryLoadFromFs(provider);
      cache[provider] = fromFs;
      if (!fromFs) {
        console.log(
          `[rag] ${provider} embeddings unavailable — vector retrieval disabled for this provider`,
        );
      }
      return fromFs;
    })();
    pending[provider] = p;
  }
  return p;
}

function cosine(
  a: number[],
  b: number[],
  normA: number,
  normB: number,
): number {
  if (normA === 0 || normB === 0) return 0;
  if (a.length !== b.length) {
    throw new Error(
      `Embedding dimension mismatch: query has ${a.length}, index vector has ${b.length}`,
    );
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot / (normA * normB);
}

async function embedQuery(
  query: string,
  provider: EmbeddingProvider,
): Promise<number[]> {
  const key = `${provider}:${normalizeQueryForCache(query)}`;
  const cached = queryEmbeddingCache.get(key);
  if (cached) return cached;

  const pendingEmbedding = fetchQueryEmbedding(query, provider).catch((err) => {
    queryEmbeddingCache.delete(key);
    throw err;
  });
  evictOldestQueryEmbeddingIfNeeded();
  queryEmbeddingCache.set(key, pendingEmbedding);
  return pendingEmbedding;
}

async function fetchQueryEmbedding(
  query: string,
  provider: EmbeddingProvider,
): Promise<number[]> {
  if (provider === "voyage") {
    if (!process.env.VOYAGE_API_KEY) throw new Error("VOYAGE_API_KEY not set");
    const [vec] = await embedVoyage([query], {
      inputType: "query",
      model: "voyage-3",
    });
    if (!vec) throw new Error("Voyage query embedding failed");
    return vec;
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const [vec] = await embedOpenAI([query], {
    model: "text-embedding-3-large",
  });
  if (!vec) throw new Error("OpenAI query embedding failed");
  return vec;
}

function normalizeQueryForCache(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function evictOldestQueryEmbeddingIfNeeded(): void {
  if (queryEmbeddingCache.size < MAX_QUERY_EMBEDDING_CACHE_ENTRIES) return;
  const oldestKey = queryEmbeddingCache.keys().next().value;
  if (oldestKey) queryEmbeddingCache.delete(oldestKey);
}

export async function vectorSearch(
  query: string,
  k: number,
  provider: EmbeddingProvider = "voyage",
): Promise<Array<{ id: string; score: number }>> {
  const idx = await loadEmbeddingIndex(provider);
  if (!idx) throw new Error(`${provider} index not loaded`);

  const queryVec = await embedQuery(query, provider);
  if (queryVec.length !== idx.dim) {
    throw new Error(
      `${provider} query embedding dimension ${queryVec.length} does not match index dimension ${idx.dim}`,
    );
  }
  const queryNorm = Math.sqrt(queryVec.reduce((a, b) => a + b * b, 0));

  const scored: Array<{ id: string; score: number }> = [];
  for (const [id, vec] of idx.embeddings) {
    scored.push({
      id,
      score: cosine(queryVec, vec, queryNorm, idx.norms.get(id) ?? 1),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export async function vectorAvailable(
  provider: EmbeddingProvider = "voyage",
): Promise<boolean> {
  const hasApiKey =
    provider === "voyage"
      ? Boolean(process.env.VOYAGE_API_KEY)
      : Boolean(process.env.OPENAI_API_KEY);
  if (!hasApiKey) return false;
  if ((await loadEmbeddingIndex(provider)) === null) return false;
  return true;
}
