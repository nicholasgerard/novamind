import { init } from "braintrust";
import type { EvalResult } from "./runner";

const PROJECT_NAME = "novamind";

export interface UploadResult {
  experimentName: string;
  url?: string;
}

/**
 * Uploads a completed `EvalResult` to Braintrust as a new experiment.
 * No-op when `BRAINTRUST_API_KEY` is unset (returns null), so CLIs can call
 * this unconditionally without guarding env state.
 *
 * Each case becomes one Braintrust record with input, output, scores, and
 * per-case metadata (id, elapsed, usage, error). The Braintrust dashboard
 * groups these under the experiment for trace exploration and side-by-side
 * comparison with other experiments in the same project.
 */
export async function uploadEvalResult<I, O>(
  axisName: string,
  result: EvalResult<I, O>,
  metadata: Record<string, unknown> = {},
): Promise<UploadResult | null> {
  if (!process.env.BRAINTRUST_API_KEY) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const experimentName = `${axisName}-${stamp}`;

  const experiment = init({
    project: PROJECT_NAME,
    experiment: experimentName,
    metadata: {
      ...metadata,
      axis: axisName,
      caseCount: result.cases.length,
      avgScores: result.averageScores,
      totalUsage: result.totalUsage,
      elapsedMs: result.elapsedMs,
    },
  });

  for (const c of result.cases) {
    experiment.log({
      input: c.case.input as never,
      output: c.output as never,
      scores: c.scores,
      metadata: {
        caseId: c.case.id,
        label: c.case.label,
        elapsedMs: c.elapsedMs,
        usage: c.usage,
        error: c.error,
      },
    });
  }

  try {
    const summary = await experiment.summarize();
    return {
      experimentName,
      url: summary.experimentUrl ?? undefined,
    };
  } catch (err) {
    console.warn(`[braintrust] summarize failed:`, err);
    return { experimentName };
  }
}
