import {
  callStructured,
  type StructuredCallResult,
  type StructuredProvider,
} from "@novamind/pipeline";
import type { Paper, TokenUsage } from "@novamind/shared";
import { z } from "zod";
import { pickStructuredExtractionCases } from "../datasets/structured-extraction-cases";
import type {
  EvalCase,
  EvalScorer,
  EvalSpec,
  EvalTaskContext,
} from "../runner";

/**
 * Clinical-trial extraction schema. Deliberately mixes:
 *   - free-form strings (intervention, primary_endpoint)
 *   - nullable numbers (population_size, duration_weeks)
 *   - a constrained enum (study_design)
 * to surface failure modes in strict-schema compliance.
 */
const ClinicalTrialFactsSchema = z
  .object({
    trial_name: z
      .string()
      .describe("Trial acronym or short name. Use 'unknown' if not given."),
    intervention: z
      .string()
      .describe("Drug name(s); include dose if specified."),
    population_size: z
      .number()
      .int()
      .nullable()
      .describe("Total enrolled (N), or null if unspecified."),
    primary_endpoint: z
      .string()
      .describe("Brief description of the primary outcome measure."),
    duration_weeks: z
      .number()
      .int()
      .nullable()
      .describe("Trial duration in weeks, or null."),
    study_design: z
      .enum([
        "RCT",
        "open_label",
        "observational",
        "meta_analysis",
        "review",
        "other",
      ])
      .describe(
        "Use 'review' for narrative reviews; 'other' if none of the above fits.",
      ),
  })
  .strict();

type ClinicalTrialFacts = z.infer<typeof ClinicalTrialFactsSchema>;

const SCHEMA_NAME = "clinical_trial_facts";
const SCHEMA_DESCRIPTION =
  "Structured facts about a clinical study extracted from a single PubMed abstract.";

const SYSTEM_PROMPT = `Extract clinical-trial facts from one PubMed abstract.

Rules:
- Extract only what the abstract directly states.
- Use null for nullable fields when the abstract does not state the value.
- Pick the closest enum value for study_design; never invent enum values.
- Copy intervention names verbatim from the abstract.`;

function buildUserPrompt(paper: Paper): string {
  return `<paper pmid="${paper.pmid}" year="${paper.year}"><title>${paper.title}</title><abstract>${paper.abstract}</abstract></paper>`;
}

export interface StructuredExtractionInput {
  paper: Paper;
  provider: StructuredProvider;
  model: string;
}

export interface StructuredExtractionOutput {
  result: StructuredCallResult<ClinicalTrialFacts>;
}

async function task(
  input: StructuredExtractionInput,
  context?: EvalTaskContext,
): Promise<{ output: StructuredExtractionOutput; usage: TokenUsage }> {
  const result = await callStructured({
    provider: input.provider,
    model: input.model,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(input.paper),
    schema: ClinicalTrialFactsSchema,
    schemaName: SCHEMA_NAME,
    schemaDescription: SCHEMA_DESCRIPTION,
    effort: input.provider === "claude" ? "low" : undefined,
    maxTokens: 1024,
    signal: context?.signal,
  });
  return { output: { result }, usage: result.usage };
}

/** 1.0 if the model returned schema-valid JSON; 0.0 otherwise. */
const schemaValidScorer: EvalScorer<
  StructuredExtractionInput,
  StructuredExtractionOutput
> = {
  name: "schema_valid",
  score: (_input, output) => (output.result.schemaValid ? 1 : 0),
};

/**
 * Soft-content score: rewards outputs that have non-empty required fields.
 * Distinguishes "filled the schema with garbage" from "filled it well." Only
 * applies when schemaValid=true (otherwise we can't even parse).
 */
const fieldCompletenessScorer: EvalScorer<
  StructuredExtractionInput,
  StructuredExtractionOutput
> = {
  name: "field_completeness",
  score: (_input, output) => {
    if (!output.result.schemaValid || !output.result.output) return 0;
    const f = output.result.output;
    let total = 0;
    let filled = 0;
    const stringFields: Array<keyof typeof f> = [
      "trial_name",
      "intervention",
      "primary_endpoint",
      "study_design",
    ];
    for (const key of stringFields) {
      total++;
      const v = f[key];
      if (typeof v === "string" && v.trim().length > 0 && v !== "unknown") {
        filled++;
      }
    }
    return total === 0 ? 0 : filled / total;
  },
};

export async function buildStructuredExtractionSpec(opts: {
  provider: StructuredProvider;
  model: string;
  n?: number;
}): Promise<EvalSpec<StructuredExtractionInput, StructuredExtractionOutput>> {
  const papers = await pickStructuredExtractionCases(opts.n ?? 10);
  const cases: ReadonlyArray<EvalCase<StructuredExtractionInput>> = papers.map(
    (paper) => ({
      id: `${paper.pmid}-${opts.provider}`,
      input: { paper, provider: opts.provider, model: opts.model },
      label: paper.title,
    }),
  );
  return {
    name: `single-turn-structured/${opts.provider}/${opts.model}`,
    cases,
    task,
    scorers: [schemaValidScorer, fieldCompletenessScorer],
  };
}

export { ClinicalTrialFactsSchema, type ClinicalTrialFacts };
