import { retrieve } from "@novamind/pipeline";
import type { RetrievalMethod, RetrieveOptions } from "@novamind/pipeline";
import { ZERO_USAGE, addUsage, type TokenUsage } from "@novamind/shared";
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
import type { RelevanceJudge } from "../scorers/relevance-judge";

export type RetrievalQualityInput = ResearchQuestion;

export interface RetrievedHit {
  pmid: string;
  title: string;
  year: number;
  score: number;
  /** 0–3 relevance from the LLM judge. */
  relevance: number;
  /** Judge's one-sentence rationale. */
  rationale: string;
}

export interface RetrievalQualityOutput {
  method: RetrievalMethod;
  hits: RetrievedHit[];
  judgeUsage: TokenUsage;
}

const TOP_K = 5;
const MAX_RELEVANCE = 3;

/**
 * Build an EvalSpec for one retrieval method (bm25 / voyage / openai / hybrid).
 * Each case retrieves the top-K papers, asks Haiku to judge relevance 0–3,
 * and reports avg relevance + a "good-enough" rate (relevance ≥ 2).
 *
 * The same RelevanceJudge instance is shared across method specs in the CLI
 * so the judge cache deduplicates (query, pmid) pairs that overlap between
 * methods — keeps the eval cost down.
 */
export function buildRetrievalQualitySpec(opts: {
  method: RetrievalMethod;
  judge: RelevanceJudge;
  cases?: ReadonlyArray<ResearchQuestion>;
}): EvalSpec<RetrievalQualityInput, RetrievalQualityOutput> {
  const dataset = opts.cases ?? glp1Questions;
  const cases: ReadonlyArray<EvalCase<RetrievalQualityInput>> = dataset.map(
    (q) => ({ id: `${q.id}-${opts.method}`, input: q, label: q.question }),
  );

  const judge = opts.judge;

  async function task(
    input: RetrievalQualityInput,
    context?: EvalTaskContext,
  ): Promise<{ output: RetrievalQualityOutput; usage: TokenUsage }> {
    const retrieveOpts: RetrieveOptions = { k: TOP_K, method: opts.method };
    const hits = await retrieve(input.question, retrieveOpts);

    const detailed: RetrievedHit[] = [];
    let totalUsage: TokenUsage = { ...ZERO_USAGE };

    for (const hit of hits) {
      const judgment = await judge.judge(
        input.question,
        hit.paper,
        context?.signal,
      );
      detailed.push({
        pmid: hit.paper.pmid,
        title: hit.paper.title,
        year: hit.paper.year,
        score: hit.score,
        relevance: judgment.score,
        rationale: judgment.rationale,
      });
      totalUsage = addUsage(totalUsage, judgment.usage);
    }

    return {
      output: { method: opts.method, hits: detailed, judgeUsage: totalUsage },
      usage: totalUsage,
    };
  }

  const avgRelevance: EvalScorer<
    RetrievalQualityInput,
    RetrievalQualityOutput
  > = {
    name: "avg_relevance",
    score: (_input, output) => {
      if (output.hits.length === 0) return 0;
      const sum = output.hits.reduce((a, h) => a + h.relevance, 0);
      return sum / output.hits.length / MAX_RELEVANCE;
    },
  };

  const goodEnoughRate: EvalScorer<
    RetrievalQualityInput,
    RetrievalQualityOutput
  > = {
    name: "good_enough_rate",
    score: (_input, output) => {
      if (output.hits.length === 0) return 0;
      const good = output.hits.filter((h) => h.relevance >= 2).length;
      return good / output.hits.length;
    },
  };

  return {
    name: `retrieval-quality/${opts.method}`,
    cases,
    task,
    scorers: [avgRelevance, goodEnoughRate],
  };
}
