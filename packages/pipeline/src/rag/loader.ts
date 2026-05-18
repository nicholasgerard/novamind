import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared filesystem + HTTP plumbing for the RAG layer. The corpus and the
 * embedding indexes follow the same load policy — R2 first, local generated
 * files for development, then null/fixture fallback — and share the same
 * `NOVAMIND_CORPUS_DIR` override and `DEMO_FIXTURE_MODE` short-circuit.
 *
 * Keeping that resolution policy in one place means `sources.ts` and
 * `vector.ts` stay focused on their respective parsing/index logic.
 */

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Where to look for the ingested corpus on local disk. `tsup` moves this code
 * into apps/agent/dist, so a single __dirname-relative path is brittle. Try
 * source and common `process.cwd()` layouts. R2 remains the production path;
 * local generated artifacts stay under ignored `internal/` for development.
 */
export const LOCAL_CORPUS_DIRS: readonly string[] = process.env
  .NOVAMIND_CORPUS_DIR
  ? [process.env.NOVAMIND_CORPUS_DIR]
  : Array.from(
      new Set([
        resolve(here, "../../../../internal/corpus/data"),
        resolve(here, "../../../internal/corpus/data"),
        resolve(process.cwd(), "../../internal/corpus/data"),
        resolve(process.cwd(), "internal/corpus/data"),
      ]),
    );

export function fixtureModeEnabled(): boolean {
  return process.env.DEMO_FIXTURE_MODE === "true";
}

export function productionDataSourcesRequired(): boolean {
  return process.env.NODE_ENV === "production" && !fixtureModeEnabled();
}

export class DataSourceUnavailableError extends Error {
  constructor(source: string, detail: string) {
    super(`${source} data source unavailable: ${detail}`);
    this.name = "DataSourceUnavailableError";
  }
}

/**
 * `fetch()` wrapped with an `AbortController` timeout, returning parsed JSON.
 * Surfaces stalled connections fast — embedding files can be tens of MB and
 * a hung TCP connection without a timeout would wedge agent boot.
 */
export async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walk `LOCAL_CORPUS_DIRS` for `filename` and parse the first match with the
 * caller-provided parser. Returns `null` if no candidate path exists. A parse
 * error returns `null` after logging. Callers decide whether to continue to a
 * fixture fallback or fail closed for production.
 */
export function readJsonFromLocalCorpus<T>(
  filename: string,
  parse: (raw: unknown) => T,
  describe: (path: string, parsed: T) => void,
): T | null {
  for (const dir of LOCAL_CORPUS_DIRS) {
    const path = resolve(dir, filename);
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      const parsed = parse(raw);
      describe(path, parsed);
      return parsed;
    } catch (err) {
      console.warn(`[rag] local ${filename} parse failed at ${path}:`, err);
      return null;
    }
  }
  return null;
}
