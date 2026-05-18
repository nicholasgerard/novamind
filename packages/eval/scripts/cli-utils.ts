import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { uploadEvalResult } from "../src/braintrust";
import type { EvalResult } from "../src/runner";

/**
 * Shared utilities for the four eval CLI scripts. Keeps argument parsing,
 * output formatting, and result persistence consistent across axes — and
 * makes adding a new axis a one-script affair instead of a copy-paste.
 */

export interface SharedCliArgs {
  limit?: number;
}

/** Parse `--key=value` pairs into a map. Unknown keys land in `extras`. */
export function parseCliArgs(argv: string[]): {
  args: SharedCliArgs;
  extras: Record<string, string>;
} {
  const args: SharedCliArgs = {};
  const extras: Record<string, string> = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (!key || value === undefined) continue;
    if (key === "limit") {
      args.limit = Number(value);
    } else {
      extras[key] = value;
    }
  }
  return { args, extras };
}

export const fmtPct = (n: number): string =>
  `${(n * 100).toFixed(1).padStart(5)}%`;

export const fmtCost = (n: number): string => `$${n.toFixed(4)}`;

export const fmtMs = (ms: number): string =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

/** A tabular header line — `── ── ──`. */
export const HR = " " + "─".repeat(78);

/**
 * Persist `result` to `internal/eval/runs/<axis>-<timestamp>.json` and, when
 * `BRAINTRUST_API_KEY` is set, upload the same data to Braintrust as a
 * fresh experiment. Logs both destinations for the runner.
 */
export async function persistRun<I, O>(
  axisLabel: string,
  scriptUrl: string,
  result: EvalResult<I, O> | Record<string, EvalResult<I, O>>,
  options: {
    /** Extra metadata uploaded to Braintrust. */
    metadata?: Record<string, unknown>;
    /** When `result` is a record of sub-runs, upload each separately under this prefix. */
    multi?: { axisPrefix: string };
  } = {},
): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/.test(axisLabel)) {
    throw new Error(`Unsafe eval axis label: ${axisLabel}`);
  }
  const runsDir =
    process.env.NOVAMIND_EVAL_RUNS_DIR ||
    resolve(dirname(fileURLToPath(scriptUrl)), "../../../internal/eval/runs");
  await mkdir(runsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = resolve(runsDir, `${axisLabel}-${stamp}.json`);
  await writeFile(outPath, JSON.stringify(result, null, 2));
  console.log(`\n wrote ${outPath}`);

  if (options.multi) {
    const record = result as Record<string, EvalResult<I, O>>;
    for (const [label, sub] of Object.entries(record)) {
      const upload = await uploadEvalResult(
        `${options.multi.axisPrefix}-${label.replaceAll(/[/ ]/g, "-")}`,
        sub,
        { ...(options.metadata ?? {}), label },
      );
      if (upload?.url) console.log(` braintrust [${label}]: ${upload.url}`);
    }
    console.log("");
    return;
  }

  const upload = await uploadEvalResult(
    axisLabel,
    result as EvalResult<I, O>,
    options.metadata,
  );
  if (upload?.url) console.log(` braintrust: ${upload.url}`);
  console.log("");
}
