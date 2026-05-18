/**
 * Fetch GLP-1 + peptide-therapeutics abstracts from PubMed and write to local JSON.
 *
 *   pnpm --filter @novamind/corpus ingest [--retmax=500]
 *
 * Output: internal/corpus/data/papers.json
 *
 * Requires NCBI_API_KEY (recommended) for higher rate limits. Set NCBI_TOOL +
 * NCBI_EMAIL for polite identification per NCBI guidelines.
 */
import "./load-env";

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { corpusDataDir } from "./paths";
import {
  GLP1_PEPTIDES_QUERY,
  fetchPubMedAbstracts,
  searchPubMed,
} from "../src/pubmed";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(.*)$/);
    if (m) out[m[1]!] = m[2] ?? "";
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const retmax = Number(args.retmax ?? 500);

  console.log(`[ingest] querying PubMed (retmax=${retmax})`);
  console.log(`[ingest] query: ${GLP1_PEPTIDES_QUERY}`);
  const ids = await searchPubMed(GLP1_PEPTIDES_QUERY, { retmax });
  console.log(`[ingest] got ${ids.length} pmids`);

  const papers = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    process.stdout.write(
      `[ingest] fetching abstracts ${i + 1}-${i + batch.length}…`,
    );
    const fetched = await fetchPubMedAbstracts(batch);
    papers.push(...fetched);
    process.stdout.write(` ${fetched.length}/${batch.length}\n`);
    if (i + 100 < ids.length) await new Promise((r) => setTimeout(r, 350));
  }

  const outPath = join(corpusDataDir(), "papers.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify(
      {
        _generated: new Date().toISOString(),
        _query: GLP1_PEPTIDES_QUERY,
        _count: papers.length,
        papers,
      },
      null,
      2,
    ),
  );
  console.log(`[ingest] wrote ${papers.length} papers to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
