import { z } from "zod";

export const MAX_JSON_BODY_BYTES = 256 * 1024;
export const MAX_QUESTION_CHARS = 1_000;
export const MAX_SYSTEM_PROMPT_CHARS = 20_000;
export const MAX_EVAL_LIMIT = 24;
export const MAX_EVAL_CONCURRENCY = 4;
export const MAX_IMPROVER_CASES = 12;
export const MAX_HANDOFF_EVIDENCE = 8;

export const EvalAxisSchema = z.enum(["plan-stability", "citation-accuracy"]);
export type EvalAxis = z.infer<typeof EvalAxisSchema>;

export const LiteratureStreamRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(MAX_QUESTION_CHARS).optional(),
    hypothesisSystemPrompt: z
      .string()
      .trim()
      .min(1)
      .max(MAX_SYSTEM_PROMPT_CHARS)
      .optional(),
  })
  .strict();
export type LiteratureStreamRequest = z.infer<
  typeof LiteratureStreamRequestSchema
>;

export const EvalRunRequestSchema = z
  .object({
    axis: EvalAxisSchema.default("plan-stability"),
    hypothesisSystemPrompt: z
      .string()
      .trim()
      .min(1)
      .max(MAX_SYSTEM_PROMPT_CHARS)
      .optional(),
    caseIds: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(MAX_EVAL_LIMIT)
      .optional(),
    limit: z.number().int().min(1).max(MAX_EVAL_LIMIT).optional(),
    concurrency: z.number().int().min(1).max(MAX_EVAL_CONCURRENCY).optional(),
  })
  .strict()
  .refine((value) => !(value.caseIds && value.limit), {
    message: "Provide either caseIds or limit, not both.",
    path: ["limit"],
  });
export type EvalRunRequest = z.infer<typeof EvalRunRequestSchema>;

export const EvalScoresSchema = z.record(
  z.string().trim().min(1).max(80),
  z.number().finite().min(0).max(1),
);

export const PromptImproverRequestSchema = z
  .object({
    currentPrompt: z.string().trim().min(1).max(MAX_SYSTEM_PROMPT_CHARS),
    runSummary: z
      .object({
        axis: z.literal("plan-stability"),
        averageScores: EvalScoresSchema,
        cases: z
          .array(
            z
              .object({
                caseId: z.string().trim().min(1).max(120),
                question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
                scores: EvalScoresSchema,
                hypothesis: z.string().trim().min(1).max(800).optional(),
                gradingNotes: z
                  .record(
                    z.string().trim().min(1).max(80),
                    z.string().trim().min(1).max(700),
                  )
                  .optional(),
              })
              .strict(),
          )
          .max(MAX_IMPROVER_CASES),
      })
      .strict(),
  })
  .strict();
export type PromptImproverRequest = z.infer<typeof PromptImproverRequestSchema>;

export const ResearchHandoffEvidenceSchema = z
  .object({
    citation: z.string().trim().min(1).max(300),
    claim: z.string().trim().min(1).max(1_200),
  })
  .strict();

export const ResearchHandoffSchema = z
  .object({
    question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
    hypothesis: z.string().trim().min(1).max(4_000),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z
      .array(ResearchHandoffEvidenceSchema)
      .min(1)
      .max(MAX_HANDOFF_EVIDENCE),
    completedAt: z.number().int().positive().optional(),
  })
  .strict();
export type ResearchHandoff = z.infer<typeof ResearchHandoffSchema>;

export const DataVizRunRequestSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .optional()
      .describe("Optional analysis question for the data-viz agent."),
    researchHandoff: ResearchHandoffSchema.optional().describe(
      "Latest completed research-agent handoff that frames the visual report.",
    ),
  })
  .strict();
export type DataVizRunRequest = z.infer<typeof DataVizRunRequestSchema>;
