import "../src/load-env";

import { planStabilitySpec } from "../src/axes/plan-stability";
import { runEval, type EvalCaseResult } from "../src/runner";
import type {
  PlanStabilityInput,
  PlanStabilityOutput,
} from "../src/axes/plan-stability";
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
    ? planStabilitySpec.cases.slice(0, args.limit)
    : planStabilitySpec.cases;
  const spec = { ...planStabilitySpec, cases };

  console.log(
    `\n plan-stability · ${spec.cases.length} hypothesis handoff cases`,
  );
  console.log(HR);

  const result = await runEval(spec, {
    onCase: (r: EvalCaseResult<PlanStabilityInput, PlanStabilityOutput>) => {
      const id = r.case.id.padEnd(36);
      const cost = r.usage ? fmtCost(r.usage.costUsd).padStart(8) : "       —";
      const ms = fmtMs(r.elapsedMs).padStart(7);
      if (r.error) {
        console.log(` ✗ ${id}  ${ms}  ${cost}  error: ${r.error.slice(0, 60)}`);
        return;
      }
      const evidence = fmtPct(r.scores.evidence_precision ?? 0);
      const gap = fmtPct(r.scores.gap_handling ?? 0);
      const rejected = fmtPct(r.scores.rejected_claim_discipline ?? 0);
      const confidence = fmtPct(r.scores.confidence_calibration ?? 0);
      console.log(
        ` ✓ ${id}  ${ms}  ${cost}  evidence ${evidence}  gap ${gap}  rejected ${rejected}  confidence ${confidence}`,
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

  await persistRun("plan-stability", import.meta.url, result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
