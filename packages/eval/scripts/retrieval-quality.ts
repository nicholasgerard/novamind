import "../src/load-env";

import type { RetrievalMethod } from "@novamind/pipeline";
import { buildRetrievalQualitySpec } from "../src/axes/retrieval-quality";
import { glp1Questions } from "../src/datasets/glp1-questions";
import { RelevanceJudge } from "../src/scorers/relevance-judge";
import { runEval, type EvalCaseResult, type EvalResult } from "../src/runner";
import type {
  RetrievalQualityInput,
  RetrievalQualityOutput,
} from "../src/axes/retrieval-quality";
import {
  HR,
  fmtCost,
  fmtMs,
  fmtPct,
  parseCliArgs,
  persistRun,
} from "./cli-utils";

const DEFAULT_METHODS: RetrievalMethod[] = [
  "bm25",
  "voyage",
  "openai",
  "hybrid",
];

function parseMethods(value: string | undefined): RetrievalMethod[] {
  if (!value) return DEFAULT_METHODS;
  return value.split(",") as RetrievalMethod[];
}

async function runOne(
  spec: ReturnType<typeof buildRetrievalQualitySpec>,
  method: RetrievalMethod,
): Promise<EvalResult<RetrievalQualityInput, RetrievalQualityOutput>> {
  console.log(`\n retrieval-quality · ${method} · ${spec.cases.length} cases`);
  console.log(HR);

  const result = await runEval(spec, {
    onCase: (
      r: EvalCaseResult<RetrievalQualityInput, RetrievalQualityOutput>,
    ) => {
      const id = r.case.input.id.padEnd(36);
      const cost = r.usage ? fmtCost(r.usage.costUsd).padStart(8) : "       —";
      const ms = fmtMs(r.elapsedMs).padStart(7);
      if (r.error) {
        console.log(` ✗ ${id}  ${ms}  ${cost}  error: ${r.error.slice(0, 60)}`);
        return;
      }
      const rel = fmtPct(r.scores.avg_relevance ?? 0);
      const good = fmtPct(r.scores.good_enough_rate ?? 0);
      console.log(` ✓ ${id}  ${ms}  ${cost}  avg-rel ${rel}  good@2 ${good}`);
    },
  });

  console.log(HR);
  console.log(
    ` summary  ${spec.cases.length} cases · ${fmtMs(result.elapsedMs)} · ${fmtCost(result.totalUsage.costUsd)}`,
  );
  for (const [name, avg] of Object.entries(result.averageScores)) {
    console.log(`          avg ${name}: ${fmtPct(avg)}`);
  }
  return result;
}

async function main() {
  const { args, extras } = parseCliArgs(process.argv);
  const methods = parseMethods(extras.methods);
  const cases = args.limit ? glp1Questions.slice(0, args.limit) : glp1Questions;
  // Single judge instance shared across methods so its cache deduplicates
  // (query, pmid) pairs that appear in multiple methods.
  const judge = new RelevanceJudge();

  const results: Record<
    string,
    EvalResult<RetrievalQualityInput, RetrievalQualityOutput>
  > = {};
  for (const method of methods) {
    const spec = buildRetrievalQualitySpec({ method, judge, cases });
    results[method] = await runOne(spec, method);
  }

  // Side-by-side comparison
  console.log("\n comparison");
  console.log(HR);
  const cols = Object.keys(results);
  const scoreNames = Object.keys(results[cols[0]!]!.averageScores);
  console.log(
    ` ${"metric".padEnd(28)}${cols.map((c) => c.padStart(13)).join("")}`,
  );
  for (const score of scoreNames) {
    console.log(
      ` ${score.padEnd(28)}` +
        cols
          .map((c) =>
            fmtPct(results[c]!.averageScores[score] ?? 0).padStart(13),
          )
          .join(""),
    );
  }
  console.log(
    ` ${"total cost".padEnd(28)}` +
      cols
        .map((c) => fmtCost(results[c]!.totalUsage.costUsd).padStart(13))
        .join(""),
  );

  await persistRun("retrieval-quality", import.meta.url, results, {
    multi: { axisPrefix: "retrieval-quality" },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
