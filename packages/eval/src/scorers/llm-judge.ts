import { callStructured, type StructuredCallResult } from "@novamind/pipeline";
import type { z } from "zod";
import { HAIKU_JUDGE_MODEL } from "../model-config";

export { HAIKU_JUDGE_MODEL } from "../model-config";

export interface JudgeArgs<T> {
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
  schemaDescription?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Tiny wrapper around `callStructured` that locks the provider/model to Haiku
 * for cheap, deterministic evaluation judges. Callers should treat missing
 * structured output as a judge failure rather than silently repairing it.
 */
export async function haikuJudge<T>(
  args: JudgeArgs<T>,
): Promise<StructuredCallResult<T>> {
  return callStructured({
    provider: "claude",
    model: HAIKU_JUDGE_MODEL,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    schema: args.schema,
    schemaName: args.schemaName,
    schemaDescription: args.schemaDescription,
    maxTokens: args.maxTokens ?? 256,
    signal: args.signal,
  });
}

export function requireJudgeOutput<T>(
  result: StructuredCallResult<T>,
  label: string,
): T {
  if (result.output) return result.output;
  throw new Error(
    `${label} returned invalid structured output: ${result.parseError ?? "no output"}`,
  );
}
