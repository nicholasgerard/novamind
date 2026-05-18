import { z } from "zod";
import type { TokenUsage } from "@novamind/shared";
import {
  callStructured,
  type ClaudeEffort,
  type StructuredCallMetadata,
  type StructuredPromptBlock,
} from "./structured";
import { IMPROVE_DEFAULT_EFFORT, IMPROVE_MODEL } from "./model-config";

export const IMPROVE_SCHEMA_NAME = "submit_improvement";
export { IMPROVE_DEFAULT_EFFORT, IMPROVE_MODEL } from "./model-config";

export interface ImprovementOutput {
  newPrompt: string;
  rationale: string;
  targetedMetric: string;
}

const METRIC_PRIORITY = [
  "gap_handling",
  "rejected_claim_discipline",
  "evidence_precision",
  "confidence_calibration",
] as const;

const DEFAULT_TARGET_METRIC = "gap_handling";
const MAX_FAILURE_CASES = 3;
const MAX_NOTE_CHARS = 420;
const MAX_ANSWER_EXCERPT_CHARS = 360;

const ImprovementSchema = z
  .object({
    newPrompt: z
      .string()
      .describe(
        "The complete refined system prompt. Preserve the original voice and structure; change only what targets the selected metric.",
      ),
    rationale: z
      .string()
      .describe("Two sentences: what changed and why it should help."),
    targetedMetric: z
      .enum(METRIC_PRIORITY)
      .describe("The metric being improved; echo the provided target metric."),
  })
  .strict() satisfies z.ZodType<ImprovementOutput>;

const METRIC_GUIDANCE: Record<string, string> = {
  evidence_precision:
    "Select evidence IDs only for verified claims that directly support affirmative hypothesis clauses; do not select contextual contrast, off-question background, or limitation-only evidence.",
  gap_handling:
    "Make the evidence boundary auditable for every requested facet: direct, indirect, missing, off-question, or blocked.",
  rejected_claim_discipline:
    "Treat relevant rejected claims as explicit unsupported limitations or blocked claims, never as factual evidence.",
  confidence_calibration:
    "Set confidence according to directness, completeness, and rejected-claim pressure instead of generic optimism.",
};

const EVIDENCE_BOUNDARY_REPAIR_PATTERN = [
  "Add a compact evidence-boundary discipline section with these semantic requirements:",
  "1. Before writing the hypothesis, classify each requested facet, not each claim, as directly supported by verified_claims, contextual/contrast only, missing from verified_claims, or blocked by rejected_claims.",
  "2. In the hypothesis text, make missing or blocked requested facets explicit. When a rejected_claim is relevant, name or paraphrase the blocked substance as unsupported using wording such as 'the evidence does not support ...'; do not repeat a rejected claim as fact.",
  "3. Select evidenceIds only for verified claims that directly support affirmative hypothesis clauses; do not select IDs used only as contextual contrasts, off-question background, or limitations.",
].join(" ");

const TARGET_REPAIR_PATTERNS: Record<string, string> = {
  evidence_precision: EVIDENCE_BOUNDARY_REPAIR_PATTERN,
  gap_handling: EVIDENCE_BOUNDARY_REPAIR_PATTERN,
  rejected_claim_discipline: EVIDENCE_BOUNDARY_REPAIR_PATTERN,
  confidence_calibration:
    "Add a compact confidence instruction: set confidence from evidence directness, completeness across requested facets, and rejected-claim pressure.",
};

const EVAL_SETUP = [
  "This eval isolates the research-agent hypothesis step.",
  "Each case starts at the same handoff the live hypothesis tool receives: a research question, retrieved abstracts for context, verified_claims, and rejected_claims.",
  "All metrics are higher-is-better. The goal is one small system-prompt change that improves the weakest observed behavior without rewriting unrelated instructions.",
].join(" ");

const SYSTEM_PROMPT = `Analyze eval results and propose one minimal refinement to the biomedical synthesis system prompt.

Process:
1. Use the provided target metric; do not pick a different optimization target.
2. Use the compact failure cases and target-metric grader notes to identify the observed behavior gap.
3. Add or refine 1-2 prompt instructions for that metric only.
4. Preserve the original voice, structure, formatting, and unrelated instructions.

Constraints:
- Return the complete new system prompt, not a diff.
- Do not rewrite from scratch or add domain-specific case facts.
- Focus on evidence selection, gap handling, rejected-claim discipline, or confidence calibration.
- Preserve existing rules for rejected_claims, missing support, evidenceIds, and confidence calibration unless the target metric explicitly asks you to clarify them.
- Do not improve the target metric by weakening a non-target metric.
- For evidence_precision, gap_handling, or rejected_claim_discipline failures, prefer adding one reusable "Evidence-boundary discipline" section rather than separate narrow rules. This section should preserve direct evidence selection and rejected-claim limitations together.
- The evidence-boundary repair classifies requested facets, not individual verified_claims. It must keep relevant rejected_claim substance auditable as unsupported.
- Treat "Missing/weak", "Rubric ceiling", and "Full-credit target" notes as the highest-signal failure trace.
- Prefer auditable evidence-boundary instructions: classify requested facets as direct, indirect, missing, off-question, or blocked; name rejected-claim substance when relevant; then calibrate confidence.
- Use the configured response fields for the complete prompt, rationale, and targeted metric.`;

export interface RunSummary {
  axis: "plan-stability";
  averageScores: Record<string, number>;
  cases: Array<{
    caseId: string;
    question: string;
    scores: Record<string, number>;
    hypothesis?: string;
    gradingNotes?: Record<string, string>;
  }>;
}

export interface PromptImproverContext {
  averageScores: Record<string, number>;
  cases: CompactFailureCase[];
  targetMetric: string;
  targetScore?: number;
}

export interface CompactFailureCase {
  answerExcerpt?: string;
  caseId: string;
  otherScores: Record<string, number>;
  question: string;
  targetNote?: string;
  targetScore?: number;
}

/** Pick the lowest supported plan-stability metric, using prompt-edit priority as the tie break. */
export function selectTargetMetric(
  averageScores: Record<string, number>,
): string {
  const orderedMetrics = METRIC_PRIORITY.filter((metric) =>
    Number.isFinite(averageScores[metric]),
  );

  let selected = orderedMetrics[0] ?? DEFAULT_TARGET_METRIC;
  for (const metric of orderedMetrics) {
    if ((averageScores[metric] ?? 1) < (averageScores[selected] ?? 1)) {
      selected = metric;
    }
  }
  return selected;
}

/**
 * Convert a full run summary into the small failure packet Claude needs for a
 * prompt edit: target metric, worst cases for that metric, short answer
 * excerpts, and only the relevant grader note.
 */
export function buildPromptImproverContext(
  summary: RunSummary,
): PromptImproverContext {
  const targetMetric = selectTargetMetric(summary.averageScores);
  const cases = summary.cases
    .map((caseItem, index) => ({
      caseItem,
      index,
      score:
        scoreFor(caseItem.scores, targetMetric) ??
        averageScore(caseItem.scores),
    }))
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1) || a.index - b.index)
    .slice(0, MAX_FAILURE_CASES)
    .map(({ caseItem, score }) => {
      const targetNote = caseItem.gradingNotes?.[targetMetric];
      const otherScores = Object.fromEntries(
        Object.entries(caseItem.scores).filter(
          ([metric]) => metric !== targetMetric,
        ),
      );
      return {
        caseId: caseItem.caseId,
        question: caseItem.question,
        ...(score !== undefined ? { targetScore: score } : {}),
        ...(targetNote
          ? { targetNote: compactText(targetNote, MAX_NOTE_CHARS) }
          : {}),
        ...(caseItem.hypothesis
          ? {
              answerExcerpt: compactText(
                caseItem.hypothesis,
                MAX_ANSWER_EXCERPT_CHARS,
              ),
            }
          : {}),
        otherScores,
      };
    });

  return {
    averageScores: summary.averageScores,
    cases,
    targetMetric,
    ...(Number.isFinite(summary.averageScores[targetMetric])
      ? { targetScore: summary.averageScores[targetMetric] }
      : {}),
  };
}

function buildUserPrompt(
  currentPrompt: string,
  summary: RunSummary,
  context: PromptImproverContext,
): readonly StructuredPromptBlock[] {
  const scoresList = Object.entries(context.averageScores)
    .map(([k, v]) => `- ${k}: ${(v * 100).toFixed(1)}%`)
    .join("\n");
  const protectedMetrics = Object.entries(context.averageScores)
    .filter(([metric]) => metric !== context.targetMetric)
    .map(([metric, score]) => `- ${metric}: ${(score * 100).toFixed(1)}%`)
    .join("\n");
  const protectedMetricRequirements = Object.entries(METRIC_GUIDANCE)
    .filter(([metric]) => metric !== context.targetMetric)
    .map(
      ([metric, guidance]) =>
        `- ${metric}: preserve this behavior: ${guidance}`,
    )
    .join("\n");

  const casesList = context.cases
    .map((c) => {
      const otherScores = Object.entries(c.otherScores)
        .map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`)
        .join(", ");
      return [
        "<case>",
        `<case_id>${xmlText(c.caseId)}</case_id>`,
        `<question>${xmlText(c.question)}</question>`,
        `<target_score>${formatScore(c.targetScore)}</target_score>`,
        otherScores
          ? `<other_scores>${xmlText(otherScores)}</other_scores>`
          : "",
        c.targetNote
          ? `<target_note>${xmlText(c.targetNote)}</target_note>`
          : "",
        c.answerExcerpt
          ? `<answer_excerpt>${xmlText(c.answerExcerpt)}</answer_excerpt>`
          : "",
        "</case>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    {
      text:
        `<eval_setup>\n${EVAL_SETUP}\n</eval_setup>\n\n` +
        `<metric_definitions>\n${formatMetricDefinitions()}\n</metric_definitions>`,
    },
    { text: `<current_prompt>\n${xmlText(currentPrompt)}\n</current_prompt>` },
    {
      text:
        `<eval_results axis="${summary.axis}">\n` +
        `<target_metric>${context.targetMetric}</target_metric>\n` +
        `<target_average_score>${formatScore(context.targetScore)}</target_average_score>\n\n` +
        `<target_repair_pattern>\n${xmlText(TARGET_REPAIR_PATTERNS[context.targetMetric] ?? METRIC_GUIDANCE[context.targetMetric] ?? "")}\n</target_repair_pattern>\n\n` +
        `<average_scores>\n${scoresList}\n</average_scores>\n\n` +
        `<protected_metrics>\n${protectedMetrics || "none"}\n</protected_metrics>\n\n` +
        `<protected_metric_requirements>\n${xmlText(protectedMetricRequirements)}\n</protected_metric_requirements>\n\n` +
        `<failure_cases>\n${casesList}\n</failure_cases>\n` +
        "</eval_results>",
    },
    {
      text:
        `Propose one minimal refinement that targets ${context.targetMetric}. ` +
        "Use target_repair_pattern as the required behavioral change; do not replace it with a narrower or weaker variant. " +
        "Return the complete replacement prompt. Preserve unrelated instructions, ordering, and voice. " +
        `Set targetedMetric exactly to "${context.targetMetric}".`,
    },
  ];
}

export async function improvePrompt(args: {
  currentPrompt: string;
  effort?: ClaudeEffort;
  runSummary: RunSummary;
}): Promise<{
  metadata: StructuredCallMetadata;
  output: ImprovementOutput;
  usage: TokenUsage;
}> {
  const effort = args.effort ?? IMPROVE_DEFAULT_EFFORT;
  const context = buildPromptImproverContext(args.runSummary);
  const result = await callStructured({
    provider: "claude",
    model: IMPROVE_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(args.currentPrompt, args.runSummary, context),
    schema: ImprovementSchema,
    schemaName: IMPROVE_SCHEMA_NAME,
    schemaDescription:
      "Submit the refined system prompt with rationale and the metric being targeted.",
    effort,
    maxBudgetUsd: 0.25,
    maxTokens: 1600,
  });
  if (!result.output) {
    throw new Error(
      `Prompt improver did not produce a valid response: ${result.parseError ?? "no output"}`,
    );
  }
  if (result.output.targetedMetric !== context.targetMetric) {
    throw new Error(
      `Prompt improver targeted ${result.output.targetedMetric}; expected ${context.targetMetric}`,
    );
  }
  return {
    metadata: result.metadata,
    output: result.output,
    usage: result.usage,
  };
}

function scoreFor(
  scores: Record<string, number>,
  metric: string,
): number | undefined {
  const value = scores[metric];
  return Number.isFinite(value) ? value : undefined;
}

function averageScore(scores: Record<string, number>): number | undefined {
  const values = Object.values(scores).filter(Number.isFinite);
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatMetricDefinitions(): string {
  return Object.entries(METRIC_GUIDANCE)
    .map(([metric, guidance]) => `- ${metric}: ${guidance}`)
    .join("\n");
}

function formatScore(score: number | undefined): string {
  return Number.isFinite(score) ? `${((score ?? 0) * 100).toFixed(1)}%` : "n/a";
}

function xmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
