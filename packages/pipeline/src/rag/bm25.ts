const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "which",
  "with",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface IndexedDoc {
  id: string;
  tokens: string[];
  tf: Map<string, number>;
}

/**
 * Minimal BM25 over a small, in-memory corpus. Suitable for the dev fixture
 * (~tens of papers) and the ingested 500-paper corpus (~milliseconds per
 * query). For production scale, full-text search lives in D1 FTS5.
 */
export class BM25 {
  private readonly k1 = 1.5;
  private readonly b = 0.75;
  private readonly docs: IndexedDoc[];
  private readonly avgdl: number;
  private readonly df = new Map<string, number>();

  constructor(docs: ReadonlyArray<{ id: string; text: string }>) {
    this.docs = docs.map((d) => {
      const tokens = tokenize(d.text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      return { id: d.id, tokens, tf };
    });
    this.avgdl =
      this.docs.length === 0
        ? 0
        : this.docs.reduce((s, d) => s + d.tokens.length, 0) / this.docs.length;
    for (const doc of this.docs) {
      for (const term of doc.tf.keys()) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }
  }

  search(query: string, k = 5): Array<{ id: string; score: number }> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.docs.length === 0) return [];
    const N = this.docs.length;
    const scored: Array<{ id: string; score: number }> = [];

    for (const doc of this.docs) {
      let score = 0;
      const dl = doc.tokens.length;
      for (const qt of queryTokens) {
        const f = doc.tf.get(qt) ?? 0;
        if (f === 0) continue;
        const n = this.df.get(qt) ?? 0;
        const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
        const norm =
          f + this.k1 * (1 - this.b + (this.b * dl) / (this.avgdl || 1));
        score += idf * ((f * (this.k1 + 1)) / norm);
      }
      if (score > 0) scored.push({ id: doc.id, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }
}
