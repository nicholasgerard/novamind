import { z } from "zod";
import { EvalScoresSchema } from "./api-requests";
import { TokenUsageSchema } from "./events";

export const EvalStartedEventSchema = z.object({
  type: z.literal("eval_started"),
  axis: z.string(),
  caseCount: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  ts: z.number(),
});

export const EvalCaseStartedEventSchema = z.object({
  type: z.literal("eval_case_started"),
  caseId: z.string(),
  caseIndex: z.number().int().nonnegative(),
  label: z.string().optional(),
  ts: z.number(),
});

export const EvalCaseCompleteEventSchema = z.object({
  type: z.literal("eval_case_complete"),
  caseId: z.string(),
  caseIndex: z.number().int().nonnegative(),
  scores: EvalScoresSchema,
  output: z.unknown().optional(),
  usage: TokenUsageSchema.optional(),
  elapsedMs: z.number().nonnegative(),
  error: z.string().optional(),
  ts: z.number(),
});

export const EvalCompleteEventSchema = z.object({
  type: z.literal("eval_complete"),
  averageScores: EvalScoresSchema,
  totalUsage: TokenUsageSchema,
  elapsedMs: z.number().nonnegative(),
  ts: z.number(),
});

export const EvalErrorEventSchema = z.object({
  type: z.literal("eval_error"),
  message: z.string(),
  ts: z.number(),
});

export const EvalStreamEventSchema = z.discriminatedUnion("type", [
  EvalStartedEventSchema,
  EvalCaseStartedEventSchema,
  EvalCaseCompleteEventSchema,
  EvalCompleteEventSchema,
  EvalErrorEventSchema,
]);
export type EvalStreamEvent = z.infer<typeof EvalStreamEventSchema>;
