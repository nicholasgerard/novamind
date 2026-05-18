import {
  runHypothesisModelTool,
  type CitationVerdict,
} from "@novamind/pipeline";
import {
  sumUsage,
  type HypothesisResult,
  type TokenUsage,
} from "@novamind/shared";
import {
  planStabilityCases,
  type PlanStabilityCase,
} from "../datasets/plan-stability-cases";
import type {
  EvalCase,
  EvalScorer,
  EvalSpec,
  EvalTaskContext,
} from "../runner";
import {
  PlanSynthesisJudge,
  type PlanSynthesisJudgment,
} from "../scorers/plan-synthesis-judge";

function buildHypothesisResult(
  verdicts: readonly CitationVerdict[],
  hypothesis: {
    hypothesis: string;
    evidenceIds: readonly string[];
    confidence: number;
  },
): HypothesisResult {
  const supportedById = new Map(
    verdicts
      .filter((verdict) => verdict.supported)
      .map((verdict) => [verdict.evidenceId, verdict]),
  );
  const seen = new Set<string>();
  const evidence = hypothesis.evidenceIds
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((id) => supportedById.get(id))
    .filter((verdict): verdict is CitationVerdict => Boolean(verdict))
    .map((verdict) => ({
      citation: `PMID:${verdict.pmid}`,
      claim: verdict.claim,
      verified: true,
    }));

  return {
    hypothesis: hypothesis.hypothesis,
    evidence,
    confidence: hypothesis.confidence,
  };
}

export type PlanStabilityInput = PlanStabilityCase;

export interface PlanStabilityOutput {
  result: HypothesisResult;
  handoffPmids: string[];
  selectedEvidenceIds: string[];
  synthesisJudgment: PlanSynthesisJudgment;
  gradingNotes: Record<string, string>;
}

export interface BuildPlanStabilityOpts {
  /** Override the hypothesis synthesis prompt. Used by the live hill-climbing demo. */
  hypothesisSystemPrompt?: string;
  cases?: ReadonlyArray<PlanStabilityInput>;
}

/**
 * Build a hypothesis-only plan-stability eval spec. Each fixture starts at the
 * post-verification handoff (question, abstracts, verified/rejected claims), so
 * the hill-climbing UI can A/B one prompt without rerunning upstream tools.
 */
export function buildPlanStabilitySpec(
  opts: BuildPlanStabilityOpts = {},
): EvalSpec<PlanStabilityInput, PlanStabilityOutput> {
  const judge = new PlanSynthesisJudge();
  const dataset = opts.cases ?? planStabilityCases;

  const cases: ReadonlyArray<EvalCase<PlanStabilityInput>> = dataset.map(
    (q) => ({
      id: q.id,
      input: q,
      label: q.question,
    }),
  );

  async function task(
    input: PlanStabilityInput,
    context?: EvalTaskContext,
  ): Promise<{ output: PlanStabilityOutput; usage: TokenUsage }> {
    const hypothesis = await runHypothesisModelTool({
      question: input.question,
      papers: input.papers,
      verdicts: input.verdicts,
      systemPromptOverride: opts.hypothesisSystemPrompt,
      signal: context?.signal,
    });
    const result = buildHypothesisResult(input.verdicts, hypothesis.output);
    const selectedEvidenceIds = [...hypothesis.output.evidenceIds];
    const synthesisJudgment = await judge.judge({
      question: input.question,
      result,
      selectedEvidenceIds,
      verdicts: input.verdicts,
      expectations: input.expectations,
      signal: context?.signal,
    });
    const gradingNotes = buildGradingNotes({
      input,
      confidence: hypothesis.output.confidence,
      selectedEvidenceIds,
      synthesisJudgment,
    });

    return {
      output: {
        result,
        handoffPmids: input.papers.map((p) => p.pmid),
        selectedEvidenceIds,
        synthesisJudgment,
        gradingNotes,
      },
      usage: sumUsage([hypothesis.usage, synthesisJudgment.usage]),
    };
  }

  const evidencePrecision: EvalScorer<PlanStabilityInput, PlanStabilityOutput> =
    {
      name: "evidence_precision",
      score: (input, output) =>
        scoreEvidenceSelection(input, output.selectedEvidenceIds),
    };

  const gapHandling: EvalScorer<PlanStabilityInput, PlanStabilityOutput> = {
    name: "gap_handling",
    score: (_input, output) => output.synthesisJudgment.gapHandling,
  };

  const rejectedClaimDiscipline: EvalScorer<
    PlanStabilityInput,
    PlanStabilityOutput
  > = {
    name: "rejected_claim_discipline",
    score: (input, output) => {
      const rejectedIds = new Set(
        input.verdicts
          .filter((verdict) => !verdict.supported)
          .map((verdict) => verdict.evidenceId),
      );
      return output.selectedEvidenceIds.some((id) => rejectedIds.has(id))
        ? 0
        : output.synthesisJudgment.rejectedClaimDiscipline;
    },
  };

  const confidenceCalibration: EvalScorer<
    PlanStabilityInput,
    PlanStabilityOutput
  > = {
    name: "confidence_calibration",
    score: (input, output) =>
      scoreConfidence(output.result.confidence, input.expectations.confidence),
  };

  return {
    name: "plan-stability",
    cases,
    task,
    scorers: [
      evidencePrecision,
      gapHandling,
      rejectedClaimDiscipline,
      confidenceCalibration,
    ],
  };
}

function scoreEvidenceSelection(
  input: PlanStabilityInput,
  rawSelectedEvidenceIds: readonly string[],
): number {
  const selectedEvidenceIds = [...new Set(rawSelectedEvidenceIds)];
  const expectedIds = new Set(input.expectations.expectedEvidenceIds);
  const allowedIds = new Set(
    input.expectations.allowedEvidenceIds ??
      input.expectations.expectedEvidenceIds,
  );

  if (expectedIds.size === 0) {
    return selectedEvidenceIds.length === 0 ? 1 : 0;
  }
  if (selectedEvidenceIds.length === 0) return 0;

  const expectedSelectedCount = selectedEvidenceIds.filter((id) =>
    expectedIds.has(id),
  ).length;
  const allowedSelectedCount = selectedEvidenceIds.filter((id) =>
    allowedIds.has(id),
  ).length;
  if (allowedSelectedCount !== selectedEvidenceIds.length) return 0;
  const strictPrecision = expectedSelectedCount / selectedEvidenceIds.length;
  const recall = expectedSelectedCount / expectedIds.size;
  return (strictPrecision + recall) / 2;
}

function scoreConfidence(
  confidence: number,
  expected: { min: number; max: number; target: number },
): number {
  const boundedConfidence = Math.min(1, Math.max(0, confidence));
  const target = Math.min(1, Math.max(0, expected.target));
  const distance = Math.abs(boundedConfidence - target);
  const baseScore = Math.max(0, 1 - distance / 0.3);
  if (boundedConfidence >= expected.min && boundedConfidence <= expected.max) {
    return Math.max(0.65, baseScore);
  }
  return baseScore;
}

function buildGradingNotes(args: {
  input: PlanStabilityInput;
  confidence: number;
  selectedEvidenceIds: readonly string[];
  synthesisJudgment: PlanSynthesisJudgment;
}): Record<string, string> {
  const expected = args.input.expectations.expectedEvidenceIds;
  const allowed =
    args.input.expectations.allowedEvidenceIds ??
    args.input.expectations.expectedEvidenceIds;
  const selected =
    args.selectedEvidenceIds.length > 0
      ? args.selectedEvidenceIds.join(", ")
      : "none";
  const expectedIds = new Set(expected);
  const allowedIds = new Set(allowed);
  const verdictsById = new Map(
    args.input.verdicts.map((verdict) => [verdict.evidenceId, verdict]),
  );
  const problemSelectedIds = [...new Set(args.selectedEvidenceIds)].filter(
    (id) => !expectedIds.has(id),
  );
  const problemEvidence =
    problemSelectedIds.length > 0
      ? ` Problem selected IDs: ${problemSelectedIds
          .map((id) => {
            const verdict = verdictsById.get(id);
            const boundary = allowedIds.has(id)
              ? "context/contrast or limitation, not direct support"
              : "outside the allowed evidence boundary";
            return `${id} (${boundary}${verdict ? `: ${verdict.claim}` : ""})`;
          })
          .join("; ")}.`
      : "";
  const confidence = args.input.expectations.confidence;

  return {
    evidence_precision:
      `Selected ${selected}. Direct support should be ${expected.length > 0 ? expected.join(", ") : "none"}; allowed boundary is ${allowed.length > 0 ? allowed.join(", ") : "none"}. ` +
      "Evidence IDs used only for context, contrast, off-question background, or limitations should not be selected as support." +
      problemEvidence,
    gap_handling: `${args.synthesisJudgment.gapRationale} Full-credit target: ${args.input.expectations.gapHandling}`,
    rejected_claim_discipline: `${args.synthesisJudgment.rejectedClaimDisciplineRationale} Full-credit target: ${args.input.expectations.rejectedClaimDiscipline}`,
    confidence_calibration: `Returned confidence ${args.confidence.toFixed(2)}. Expected band ${confidence.min.toFixed(2)}-${confidence.max.toFixed(2)}, target ${confidence.target.toFixed(2)}.`,
  };
}

/** Convenience: a default-options spec, used by the CLI script. */
export const planStabilitySpec = buildPlanStabilitySpec();
