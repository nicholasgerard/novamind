import type { Paper, TokenUsage } from "@novamind/shared";
import { z } from "zod";
import { haikuJudge, requireJudgeOutput } from "./llm-judge";

const RelevanceSchema = z
  .object({
    score: z
      .number()
      .int()
      .min(0)
      .max(3)
      .describe("0=irrelevant, 1=tangential, 2=relevant, 3=highly relevant"),
    rationale: z.string().describe("One sentence explaining the score."),
  })
  .strict();

type Relevance = z.infer<typeof RelevanceSchema>;

const SYSTEM_PROMPT = `Judge whether one PubMed paper answers a research query. Score 0=irrelevant, 1=tangential, 2=relevant, 3=highly relevant. Be strict: shared topic is not enough.`;

export interface RelevanceJudgment {
  score: number; // 0–3
  rationale: string;
  usage: TokenUsage;
}

/**
 * Score how relevant a paper is to a query, on a 0–3 scale, via Haiku.
 * Cached results — within a single eval run, repeated (query, pmid) pairs
 * return the same result without re-calling the API.
 */
export class RelevanceJudge {
  private readonly cache = new Map<string, RelevanceJudgment>();

  async judge(
    query: string,
    paper: Paper,
    signal?: AbortSignal,
  ): Promise<RelevanceJudgment> {
    const key = `${query}::${paper.pmid}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const userPrompt = `<query>${query}</query>\n<paper pmid="${paper.pmid}" year="${paper.year}"><title>${paper.title}</title><abstract>${paper.abstract}</abstract></paper>`;

    const result = await haikuJudge({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      schema: RelevanceSchema,
      schemaName: "submit_relevance",
      schemaDescription: "Submit the relevance judgment.",
      maxTokens: 180,
      signal,
    });
    const parsed: Relevance = RelevanceSchema.parse(
      requireJudgeOutput(result, "Relevance judge"),
    );

    const judgment: RelevanceJudgment = {
      score: parsed.score,
      rationale: parsed.rationale,
      usage: result.usage,
    };
    this.cache.set(key, judgment);
    return judgment;
  }
}
