import "../src/load-env";

import { citationAccuracySpec } from "../src/axes/citation-accuracy";
import { runEval, type EvalCaseResult } from "../src/runner";
import type {
  CitationAccuracyInput,
  CitationAccuracyOutput,
} from "../src/axes/citation-accuracy";
import {
  HR,
  fmtCost,
  fmtMs,
  fmtPct,
  parseCliArgs,
  persistRun,
} from "./cli-utils";

async function main() {
  const { args } = parseCliArgs(process.argv);
  const cases = args.limit
    ? citationAccuracySpec.cases.slice(0, args.limit)
    : citationAccuracySpec.cases;

  const spec = { ...citationAccuracySpec, cases };

  console.log(`\n citation-accuracy · ${spec.cases.length} cases`);
  console.log(HR);

  const result = await runEval(spec, {
    onCase: (
      r: EvalCaseResult<CitationAccuracyInput, CitationAccuracyOutput>,
    ) => {
      const id = r.case.id.padEnd(36);
      const cost = r.usage ? fmtCost(r.usage.costUsd).padStart(8) : "       —";
      const ms = fmtMs(r.elapsedMs).padStart(7);
      if (r.error) {
        console.log(` ✗ ${id}  ${ms}  ${cost}  error: ${r.error.slice(0, 60)}`);
        return;
      }
      const precision = fmtPct(r.scores.verified_claim_precision ?? 0);
      const recall = fmtPct(r.scores.verified_claim_recall ?? 0);
      console.log(
        ` ✓ ${id}  ${ms}  ${cost}  precision ${precision}  recall ${recall}`,
      );
    },
  });

  console.log(HR);
  console.log(
    ` summary  ${cases.length} cases · ${fmtMs(result.elapsedMs)} · ${fmtCost(result.totalUsage.costUsd)} total · ${result.totalUsage.cacheReadTokens.toLocaleString()} cached tokens`,
  );
  for (const [name, avg] of Object.entries(result.averageScores)) {
    console.log(`          avg ${name}: ${fmtPct(avg)}`);
  }

  await persistRun("citation-accuracy", import.meta.url, result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
