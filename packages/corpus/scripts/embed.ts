/**
 * Generate Voyage-3 + OpenAI text-embedding-3-large embeddings for the ingested
 * corpus, in parallel. Both indexes get written so the eval harness can compare
 * retrieval quality (Axis 4).
 *
 *   pnpm --filter @novamind/corpus embed
 *
 * Reads:  internal/corpus/data/papers.json
 * Writes: internal/corpus/data/embeddings.voyage.json
 *         internal/corpus/data/embeddings.openai.json
 */
import "./load-env";

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { PaperSchema } from "@novamind/shared";
import { corpusDataDir } from "./paths";
import { embedOpenAI, embedVoyage } from "../src/embed";

const PapersFileSchema = z.object({
  papers: z.array(PaperSchema),
});

const BATCH_SIZE = 64;

async function batched<T, U>(
  items: T[],
  size: number,
  fn: (batch: T[], i: number) => Promise<U[]>,
): Promise<U[]> {
  const out: U[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const result = await fn(batch, i);
    out.push(...result);
  }
  return out;
}

async function main() {
  const dataDir = corpusDataDir();
  const papersPath = join(dataDir, "papers.json");
  const raw = JSON.parse(await readFile(papersPath, "utf-8"));
  const { papers } = PapersFileSchema.parse(raw);
  console.log(`[embed] embedding ${papers.length} papers`);

  const inputs = papers.map((p) => `${p.title}\n\n${p.abstract}`);

  console.log(`[embed] voyage-3 + openai text-embedding-3-large …`);
  const [voyage, openai] = await Promise.all([
    batched(inputs, BATCH_SIZE, async (b, i) => {
      process.stdout.write(`  [voyage] ${i}-${i + b.length}\n`);
      return embedVoyage(b, { inputType: "document", model: "voyage-3" });
    }),
    batched(inputs, BATCH_SIZE, async (b, i) => {
      process.stdout.write(`  [openai] ${i}-${i + b.length}\n`);
      return embedOpenAI(b, { model: "text-embedding-3-large" });
    }),
  ]);

  const indexById = (vecs: number[][]) =>
    Object.fromEntries(papers.map((p, i) => [p.pmid, vecs[i]!]));

  await writeFile(
    join(dataDir, "embeddings.voyage.json"),
    JSON.stringify(
      {
        _model: "voyage-3",
        _dim: voyage[0]?.length ?? 0,
        byPmid: indexById(voyage),
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(dataDir, "embeddings.openai.json"),
    JSON.stringify(
      {
        _model: "text-embedding-3-large",
        _dim: openai[0]?.length ?? 0,
        byPmid: indexById(openai),
      },
      null,
      2,
    ),
  );
  console.log(`[embed] wrote both embedding files to ${dataDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
