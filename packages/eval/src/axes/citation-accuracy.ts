import {
  collectLiteratureAgentRun,
  getCorpus,
  type LiteratureAgentRun,
} from "@novamind/pipeline";
import {
  sumUsage,
  type HypothesisResult,
  type Paper,
  type TokenUsage,
} from "@novamind/shared";
import {
  glp1Questions,
  type ResearchQuestion,
} from "../datasets/glp1-questions";
import type {
  EvalCase,
  EvalScorer,
  EvalSpec,
  EvalTaskContext,
} from "../runner";
import {
  CitationJudge,
  type CitationJudgment,
} from "../scorers/citation-judge";

export type CitationAccuracyInput = ResearchQuestion;

export interface JudgedClaim {
  pmid: string;
  claim: string;
  llmVerified: boolean;
  abstractSupports: boolean;
  judgeRationale: string;
}

export interface CitationAccuracyOutput {
  result: HypothesisResult;
  judgedClaims: JudgedClaim[];
  rawElapsedMs: number;
}

export interface BuildCitationAccuracyOpts {
  /** Override the hypothesis synthesis prompt. Used by the live hill-climbing demo. */
  hypothesisSystemPrompt?: string;
  cases?: ReadonlyArray<ResearchQuestion>;
}

export function buildCitationAccuracySpec(
  opts: BuildCitationAccuracyOpts = {},
): EvalSpec<CitationAccuracyInput, CitationAccuracyOutput> {
  const judge = new CitationJudge();
  const dataset = opts.cases ?? glp1Questions;

  const cases: ReadonlyArray<EvalCase<CitationAccuracyInput>> = dataset.map(
    (q) => ({ id: q.id, input: q, label: q.question }),
  );

  async function task(
    input: CitationAccuracyInput,
    context?: EvalTaskContext,
  ): Promise<{ output: CitationAccuracyOutput; usage: TokenUsage }> {
    const { abortController, cleanup } = abortControllerFromSignal(
      context?.signal,
    );
    let run: LiteratureAgentRun;
    try {
      run = await collectLiteratureAgentRun({
        abortController,
        question: input.question,
        injectUnverifiedClaim: false,
        hypothesisSystemPrompt: opts.hypothesisSystemPrompt,
      });
    } finally {
      cleanup();
    }
    if (!run.result) throw new Error("research agent produced no result");

    const corpus = await getCorpus();
    const byPmid = new Map<string, Paper>(corpus.map((p) => [p.pmid, p]));

    const judgedClaims: JudgedClaim[] = [];
    const judgeUsages: TokenUsage[] = [];

    for (const e of run.result.evidence) {
      const pmid = e.citation.replace(/^PMID:/, "");
      const paper = byPmid.get(pmid);
      if (!paper) continue;
      const j: CitationJudgment = await judge.judge(
        e.claim,
        paper.abstract,
        pmid,
        context?.signal,
      );
      judgedClaims.push({
        pmid,
        claim: e.claim,
        llmVerified: e.verified,
        abstractSupports: j.supports,
        judgeRationale: j.rationale,
      });
      judgeUsages.push(j.usage);
    }

    return {
      output: {
        result: run.result,
        judgedClaims,
        rawElapsedMs: run.elapsedMs,
      },
      usage: sumUsage([run.totalUsage, ...judgeUsages]),
    };
  }

  const verifiedClaimPrecision: EvalScorer<
    CitationAccuracyInput,
    CitationAccuracyOutput
  > = {
    name: "verified_claim_precision",
    score: (_input, output) => {
      const verified = output.judgedClaims.filter((c) => c.llmVerified);
      if (verified.length === 0) return 1;
      return (
        verified.filter((c) => c.abstractSupports).length / verified.length
      );
    },
  };

  const verifiedClaimRecall: EvalScorer<
    CitationAccuracyInput,
    CitationAccuracyOutput
  > = {
    name: "verified_claim_recall",
    score: (_input, output) => {
      const supported = output.judgedClaims.filter((c) => c.abstractSupports);
      if (supported.length === 0) return 1;
      return supported.filter((c) => c.llmVerified).length / supported.length;
    },
  };

  const f1: EvalScorer<CitationAccuracyInput, CitationAccuracyOutput> = {
    name: "f1",
    score: (input, output) => {
      const p = verifiedClaimPrecision.score(input, output);
      const r = verifiedClaimRecall.score(input, output);
      const pn = typeof p === "number" ? p : 0;
      const rn = typeof r === "number" ? r : 0;
      return pn + rn === 0 ? 0 : (2 * pn * rn) / (pn + rn);
    },
  };

  return {
    name: "citation-accuracy",
    cases,
    task,
    scorers: [verifiedClaimPrecision, verifiedClaimRecall, f1],
  };
}

function abortControllerFromSignal(signal: AbortSignal | undefined): {
  abortController: AbortController | undefined;
  cleanup: () => void;
} {
  if (!signal) return { abortController: undefined, cleanup: () => undefined };
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  if (signal.aborted) {
    abort();
    return { abortController, cleanup: () => undefined };
  }
  signal.addEventListener("abort", abort, { once: true });
  return {
    abortController,
    cleanup: () => signal.removeEventListener("abort", abort),
  };
}

/** Convenience: a default-options spec, used by the CLI script. */
export const citationAccuracySpec = buildCitationAccuracySpec();
