import "../src/load-env";

import { buildStructuredExtractionSpec } from "../src/axes/single-turn-structured";
import { runEval, type EvalCaseResult, type EvalResult } from "../src/runner";
import type {
  StructuredExtractionInput,
  StructuredExtractionOutput,
} from "../src/axes/single-turn-structured";
import {
  HR,
  fmtCost,
  fmtMs,
  fmtPct,
  parseCliArgs,
  persistRun,
} from "./cli-utils";

interface ProviderConfig {
  provider: "claude" | "openai";
  model: string;
  label: string;
}

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { provider: "claude", model: "claude-opus-4-7", label: "claude / opus 4.7" },
  { provider: "openai", model: "gpt-5.1", label: "openai / gpt-5.1" },
];

async function runOne(
  spec: Awaited<ReturnType<typeof buildStructuredExtractionSpec>>,
  label: string,
): Promise<EvalResult<StructuredExtractionInput, StructuredExtractionOutput>> {
  console.log(
    `\n single-turn-structured · ${label} · ${spec.cases.length} cases`,
  );
  console.log(HR);

  const result = await runEval(spec, {
    onCase: (
      r: EvalCaseResult<StructuredExtractionInput, StructuredExtractionOutput>,
    ) => {
      const id = r.case.id.padEnd(36);
      const cost = r.usage ? fmtCost(r.usage.costUsd).padStart(8) : "       —";
      const ms = fmtMs(r.elapsedMs).padStart(7);
      if (r.error) {
        console.log(` ✗ ${id}  ${ms}  ${cost}  error: ${r.error.slice(0, 60)}`);
        return;
      }
      const valid = r.scores.schema_valid ?? 0;
      const fill = r.scores.field_completeness ?? 0;
      const mark = valid === 1 ? "✓" : "✗";
      const detail =
        valid === 0 && r.output.result.parseError
          ? `  ⤷ ${r.output.result.parseError.slice(0, 50)}`
          : "";
      console.log(
        ` ${mark} ${id}  ${ms}  ${cost}  schema ${fmtPct(valid)}  fields ${fmtPct(fill)}${detail}`,
      );
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
  const { args } = parseCliArgs(process.argv);

  const results: Record<
    string,
    EvalResult<StructuredExtractionInput, StructuredExtractionOutput>
  > = {};
  for (const p of DEFAULT_PROVIDERS) {
    const spec = await buildStructuredExtractionSpec({
      provider: p.provider,
      model: p.model,
      n: args.limit,
    });
    results[p.label] = await runOne(spec, p.label);
  }

  // Side-by-side summary
  console.log("\n comparison");
  console.log(HR);
  const labels = Object.keys(results);
  const scoreNames = Object.keys(results[labels[0]!]!.averageScores);
  console.log(
    ` ${"metric".padEnd(30)}${labels.map((l) => l.padStart(20)).join("")}`,
  );
  for (const score of scoreNames) {
    console.log(
      ` ${score.padEnd(30)}` +
        labels
          .map((l) =>
            fmtPct(results[l]!.averageScores[score] ?? 0).padStart(20),
          )
          .join(""),
    );
  }
  console.log(
    ` ${"total cost".padEnd(30)}` +
      labels
        .map((l) => fmtCost(results[l]!.totalUsage.costUsd).padStart(20))
        .join(""),
  );

  await persistRun("single-turn-structured", import.meta.url, results, {
    multi: { axisPrefix: "single-turn-structured" },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
