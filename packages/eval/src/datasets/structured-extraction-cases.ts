import { getCorpus } from "@novamind/pipeline";
import type { Paper } from "@novamind/shared";

/**
 * Select N papers from the corpus for structured-extraction testing.
 * Uses a stable PMID ordering so the same N papers are picked across runs,
 * and interleaves from the start and end of that ordering to mix recent
 * (high PMID) with older (low PMID) papers — giving models variety in
 * difficulty without re-sorting per run.
 *
 * If the corpus has fewer than N papers, every available paper is returned
 * once. Duplicates from start/end overlap are filtered.
 */
export async function pickStructuredExtractionCases(n = 10): Promise<Paper[]> {
  const corpus = await getCorpus();
  const sorted = [...corpus].sort((a, b) => a.pmid.localeCompare(b.pmid));
  if (sorted.length <= n) return sorted;

  const half = Math.ceil(n / 2);
  const fromStart = sorted.slice(0, half);
  const fromEnd = sorted.slice(-(n - half));

  const seen = new Set<string>();
  const out: Paper[] = [];
  for (let i = 0; i < half; i++) {
    for (const paper of [fromStart[i], fromEnd[i]]) {
      if (paper && !seen.has(paper.pmid)) {
        seen.add(paper.pmid);
        out.push(paper);
        if (out.length === n) return out;
      }
    }
  }
  return out;
}
