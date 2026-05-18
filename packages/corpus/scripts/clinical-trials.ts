/**
 * Fetch GLP-1 clinical trial records with posted results from the official
 * ClinicalTrials.gov API v2 and write a normalized analysis dataset.
 *
 *   pnpm --filter @novamind/corpus clinical-trials [--retmax=250]
 *
 * Output: internal/clinical-trials/data/clinical-trials.json
 */
import "./load-env";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { clinicalTrialsDataDir } from "./paths";
import { fetchClinicalTrialsDataset } from "../src/clinical-trials";

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
  const retmax = Number(args.retmax ?? 250);

  console.log(`[clinical-trials] fetching ClinicalTrials.gov records`);
  console.log(`[clinical-trials] retmax=${retmax}`);
  const dataset = await fetchClinicalTrialsDataset({ retmax });

  const outPath = join(clinicalTrialsDataDir(), "clinical-trials.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(dataset, null, 2));

  console.log(
    `[clinical-trials] wrote ${dataset.studies.length} studies, ` +
      `${dataset.outcomes.length} outcomes, ${dataset.adverseEvents.length} adverse-event rows to ${outPath}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
