import type { TokenUsage } from "@novamind/shared";
import { z } from "zod";
import { haikuJudge, requireJudgeOutput } from "./llm-judge";

const SupportSchema = z
  .object({
    supports: z
      .boolean()
      .describe(
        "True only if the abstract directly states or clearly implies the claim.",
      ),
    rationale: z
      .string()
      .describe(
        "One short sentence pointing to the exact phrase in the abstract that supports or contradicts the claim.",
      ),
  })
  .strict();

export interface CitationJudgment {
  supports: boolean;
  rationale: string;
  usage: TokenUsage;
}

const SYSTEM_PROMPT = `Judge whether one PubMed abstract directly supports one claim. supports=true only when the abstract explicitly states or clearly entails the claim; silence or extra inference means false.`;

/**
 * LLM-as-judge for citation accuracy. The live pipeline has its own structured
 * verifier tool; this judge provides an independent scoring pass for the eval
 * harness.
 */
export class CitationJudge {
  private readonly cache = new Map<string, CitationJudgment>();

  async judge(
    claim: string,
    abstract: string,
    pmid: string,
    signal?: AbortSignal,
  ): Promise<CitationJudgment> {
    const key = `${pmid}::${claim}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const userPrompt = `<abstract>${abstract}</abstract>\n<claim>${claim}</claim>`;

    const result = await haikuJudge({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      schema: SupportSchema,
      schemaName: "support_judgment",
      schemaDescription: "Whether the abstract directly supports the claim.",
      maxTokens: 180,
      signal,
    });

    const output = requireJudgeOutput(result, "Citation judge");
    const out: CitationJudgment = {
      supports: output.supports,
      rationale: output.rationale,
      usage: result.usage,
    };
    this.cache.set(key, out);
    return out;
  }
}
