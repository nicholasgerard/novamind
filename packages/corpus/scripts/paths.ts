import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(here, "../../..");

export function corpusDataDir(): string {
  return (
    process.env.NOVAMIND_CORPUS_DIR || resolve(repoRoot, "internal/corpus/data")
  );
}

export function clinicalTrialsDataDir(): string {
  return (
    process.env.NOVAMIND_TRIALS_DIR ||
    resolve(repoRoot, "internal/clinical-trials/data")
  );
}
