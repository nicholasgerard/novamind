import { PaperSchema, type Paper } from "@novamind/shared";
import { z } from "zod";
import fixtures from "./fixtures.json" with { type: "json" };
import {
  DataSourceUnavailableError,
  fetchJsonWithTimeout,
  fixtureModeEnabled,
  productionDataSourcesRequired,
  readJsonFromLocalCorpus,
} from "./loader";

const PapersFileSchema = z.object({ papers: z.array(PaperSchema) });

export interface CorpusSource {
  name: "ingested" | "fixture";
  mode: "r2" | "local" | "fixture";
  papers: readonly Paper[];
}

const FETCH_TIMEOUT_MS = 30_000;

async function tryLoadFromR2(): Promise<CorpusSource | null> {
  const url = process.env.NOVAMIND_PAPERS_URL;
  if (!url) return null;
  try {
    console.log(`[rag] fetching corpus from R2: ${url}`);
    const raw = await fetchJsonWithTimeout(url, FETCH_TIMEOUT_MS);
    const parsed = PapersFileSchema.parse(raw);
    console.log(`[rag] loaded R2 corpus: ${parsed.papers.length} papers`);
    return { name: "ingested", mode: "r2", papers: parsed.papers };
  } catch (err) {
    console.warn(`[rag] R2 corpus fetch failed:`, err);
    return null;
  }
}

function tryLoadFromFs(): CorpusSource | null {
  const parsed = readJsonFromLocalCorpus(
    "papers.json",
    (raw) => PapersFileSchema.parse(raw),
    (path, parsed) =>
      console.log(
        `[rag] loaded local corpus: ${parsed.papers.length} papers from ${path}`,
      ),
  );
  if (!parsed) return null;
  return { name: "ingested", mode: "local", papers: parsed.papers };
}

let cached: CorpusSource | null = null;
let pending: Promise<CorpusSource> | null = null;

/**
 * Load the corpus, preferring (by default):
 *   1. R2 (`NOVAMIND_PAPERS_URL` set) — portable production path
 *   2. Local filesystem (`internal/corpus/data/papers.json`) — dev path
 *   3. Offline 12-paper fixture — last-resort fallback for local dev
 *
 * `NOVAMIND_CORPUS_DIR` overrides the local development lookup directory.
 * `DEMO_FIXTURE_MODE=true` short-circuits to the fixture without checking R2
 * or the filesystem. Production fails closed before fixture fallback unless
 * that explicit fixture flag is set.
 */
export function loadCorpusSource(): Promise<CorpusSource> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = (async () => {
      if (fixtureModeEnabled()) {
        console.log(
          `[rag] using offline fixture (${fixtures.papers.length} papers) — DEMO_FIXTURE_MODE=true`,
        );
        cached = {
          name: "fixture",
          mode: "fixture",
          papers: fixtures.papers as Paper[],
        };
        return cached;
      }
      const fromR2 = await tryLoadFromR2();
      if (fromR2) {
        cached = fromR2;
        return fromR2;
      }
      const fromFs = tryLoadFromFs();
      if (fromFs) {
        cached = fromFs;
        return fromFs;
      }
      if (productionDataSourcesRequired()) {
        throw new DataSourceUnavailableError(
          "PubMed corpus",
          "set NOVAMIND_PAPERS_URL to an R2 papers.json object or set DEMO_FIXTURE_MODE=true for an explicit fixture-backed demo",
        );
      }
      console.log(
        `[rag] using offline fixture (${fixtures.papers.length} papers) — no R2 URL or local data`,
      );
      cached = {
        name: "fixture",
        mode: "fixture",
        papers: fixtures.papers as Paper[],
      };
      return cached;
    })();
  }
  return pending;
}
