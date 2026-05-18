import { z } from "zod";

/**
 * Research-agent stream contract. The agent emits these events over SSE
 * and web/agent routes validate them at service boundaries. Browser bundles
 * use lightweight guards derived from these contracts to avoid shipping Zod.
 */

/** Literature tool-stage identifiers — keep in sync with agent emissions. */
export const LiteratureStageIdSchema = z.enum([
  "search",
  "claim_extractor",
  "citation_verifier",
  "hypothesis",
  "orchestrator",
]);
export type LiteratureStageId = z.infer<typeof LiteratureStageIdSchema>;

/**
 * Token and cost telemetry normalized across provider paths. `costUsd` is
 * provider/SDK-sourced when available and otherwise estimated from the
 * direct-API rate card maintained by the pipeline package.
 */
export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheCreationTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative(),
  /**
   * Optional normalized prompt-cache economics. These are computed server-side
   * where provider pricing/SDK cost telemetry is available; browser code should
   * render them, not recalculate provider pricing.
   */
  uncachedCostUsd: z.number().nonnegative().optional(),
  cacheSavingsUsd: z.number().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const LiteratureStageStartedEventSchema = z.object({
  type: z.literal("literature_stage_started"),
  stage: LiteratureStageIdSchema,
  model: z.string(),
  ts: z.number(),
});

export const LiteratureStageMessageEventSchema = z.object({
  type: z.literal("literature_stage_message"),
  stage: LiteratureStageIdSchema,
  text: z.string(),
  ts: z.number(),
});

export const AgentLoopEventSchema = z.object({
  type: z.literal("agent_loop_event"),
  phase: z.enum(["session", "model", "tool", "recovery", "complete"]),
  status: z.enum(["running", "complete", "error"]),
  label: z.string(),
  detail: z.string().optional(),
  elapsedMs: z.number().nonnegative().optional(),
  tool: z.string().optional(),
  turn: z.number().int().positive().optional(),
  ts: z.number(),
});
export type AgentLoopEvent = z.infer<typeof AgentLoopEventSchema>;

export const ToolCallEventSchema = z.object({
  type: z.literal("tool_call"),
  stage: LiteratureStageIdSchema,
  tool: z.string(),
  input: z.unknown(),
  ts: z.number(),
});

export const ToolResultEventSchema = z.object({
  type: z.literal("tool_result"),
  stage: LiteratureStageIdSchema,
  tool: z.string(),
  output: z.unknown(),
  ts: z.number(),
});

export const LiteratureStageFinishedEventSchema = z.object({
  type: z.literal("literature_stage_finished"),
  stage: LiteratureStageIdSchema,
  usage: TokenUsageSchema,
  ts: z.number(),
});

export const HypothesisResultSchema = z.object({
  hypothesis: z.string(),
  evidence: z.array(
    z.object({
      citation: z.string(),
      claim: z.string(),
      verified: z.boolean(),
    }),
  ),
  confidence: z.number().min(0).max(1),
});
export type HypothesisResult = z.infer<typeof HypothesisResultSchema>;

export const PipelineResultEventSchema = z.object({
  type: z.literal("pipeline_result"),
  result: HypothesisResultSchema,
  totalUsage: TokenUsageSchema,
  ts: z.number(),
});

export const ErrorEventSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
  ts: z.number(),
});

export const StreamEventSchema = z.discriminatedUnion("type", [
  LiteratureStageStartedEventSchema,
  LiteratureStageMessageEventSchema,
  AgentLoopEventSchema,
  ToolCallEventSchema,
  ToolResultEventSchema,
  LiteratureStageFinishedEventSchema,
  PipelineResultEventSchema,
  ErrorEventSchema,
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;
