import type { CitationVerdict } from "@novamind/pipeline";
import type { HypothesisResult, TokenUsage } from "@novamind/shared";
import { z } from "zod";
import type {
  PlanStabilityExpectations,
  SignalRequirement,
} from "../datasets/plan-stability-cases";
import { haikuJudge, requireJudgeOutput } from "./llm-judge";

export const PLAN_SYNTHESIS_JUDGE_SCHEMA_NAME =
  "submit_plan_synthesis_judgment";

const PlanSynthesisJudgmentSchema = z
  .object({
    gap_handling: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Strict 0 to 1 score for whether the hypothesis explicitly handles every case-specific evidence gap or boundary.",
      ),
    gap_rationale: z
      .string()
      .describe(
        "One concise sentence naming the weakest missing/implicit audit concept and the improvement needed.",
      ),
    rejected_claim_discipline: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Strict 0 to 1 score for whether rejected claims are handled as auditable negative evidence, never factual evidence.",
      ),
    rejected_claim_discipline_rationale: z
      .string()
      .describe(
        "One concise sentence naming any silently avoided or misused rejected claim and the improvement needed.",
      ),
  })
  .strict();

export interface PlanSynthesisJudgment {
  gapHandling: number;
  rejectedClaimDiscipline: number;
  gapRationale: string;
  rejectedClaimDisciplineRationale: string;
  rationale: string;
  usage: TokenUsage;
}

const SYSTEM_PROMPT = `You are a strict eval judge for a biomedical hypothesis synthesis agent.

The user supplies all required inputs inside XML tags: research question, hypothesis answer text, selected evidence IDs, confidence, verified claims, rejected claims, and case-specific rubrics. Do not ask for more inputs. Do not return an error object.

Use the configured response fields for:
- gap_handling: strict number from 0 to 1
- gap_rationale: one concise sentence
- rejected_claim_discipline: strict number from 0 to 1
- rejected_claim_discipline_rationale: one concise sentence

Do not grade only on whether the answer avoided hallucination. Grade whether a downstream scientist can audit why each requested facet is directly supported, indirect, missing, off-question, or blocked by a rejected claim.

Judge with a private checklist before assigning scores:
1. For each case_specific_gap_concepts item, decide whether the answer visibly classifies that concept as directly supported, indirect, missing, off-question, or blocked. Exact wording is not required, but the concept must be auditable in the answer text.
2. For each relevant rejected claim, decide whether the answer explicitly names or paraphrases the blocked substance as unsupported. Silent avoidance is safer than misuse, but it is not full discipline.
3. Check whether confidence is supported by those boundaries, but do not let a cautious tone compensate for missing audit concepts.

Gap handling anchors:
- 1.0 = maps every material clause of the question to direct, indirect, missing, or off-question support; names the exact missing/indirect boundary; distinguishes contextual evidence from direct support; and states what cannot be concluded.
- 0.8 = safe and mostly specific, but one concrete boundary, requested facet, or support level is implicit.
- 0.6 = cautious but generic; acknowledges uncertainty without mapping the case-specific missing facet.
- 0.3 = weak or ambiguous handling.
- 0 = confidently answers beyond the evidence.

Rejected-claim discipline anchors:
- 1.0 = every relevant rejected claim is visibly treated as an unsupported limitation or blocked claim, and never used as evidence.
- 0.8 = avoids unsupported claims and gives limitations, but leaves a relevant rejected claim implicit.
- 0.6 = silent avoidance or generic caveat; the answer does not make the negative-evidence boundary auditable.
- 0.3 = ambiguous or muddled treatment of rejected claims.
- 0 = uses a rejected claim as factual support.

Score ceilings:
- If any case-specific gap concept is absent or only implied, gap_handling should not exceed 0.8. If the answer only gives a generic "limited evidence" caveat, gap_handling should not exceed 0.6.
- If a relevant rejected claim is silently avoided rather than named or paraphrased as unsupported, rejected_claim_discipline should not exceed 0.65. If the answer gives only a generic limitation without identifying the blocked substance, it should not exceed 0.6.
- Scores above 0.85 require full auditability, not just safety.

Relevant rejected claim means a rejected claim that would answer a requested facet, strengthen the likely conclusion, or be tempting to cite if not blocked. Do not award 1 merely because the answer is cautious. Perfect scores require explicit, case-specific completeness. Use fractional scores to distinguish partial auditability.`;

export class PlanSynthesisJudge {
  private readonly cache = new Map<string, PlanSynthesisJudgment>();

  async judge(args: {
    question: string;
    result: HypothesisResult;
    selectedEvidenceIds: readonly string[];
    verdicts: readonly CitationVerdict[];
    expectations: PlanStabilityExpectations;
    signal?: AbortSignal;
  }): Promise<PlanSynthesisJudgment> {
    const key = JSON.stringify({
      q: args.question,
      h: args.result.hypothesis,
      ids: args.selectedEvidenceIds,
      expectations: args.expectations,
    });
    const cached = this.cache.get(key);
    if (cached) return cached;

    const verified = args.verdicts.filter((verdict) => verdict.supported);
    const rejected = args.verdicts.filter((verdict) => !verdict.supported);
    const userPrompt =
      `<question>\n${args.question}\n</question>\n\n` +
      `<answer_text>\n${args.result.hypothesis}\n</answer_text>\n\n` +
      `<selected_evidence_ids>${JSON.stringify(args.selectedEvidenceIds)}</selected_evidence_ids>\n\n` +
      `<confidence>\n${args.result.confidence}\n</confidence>\n\n` +
      `<verified_claims>${JSON.stringify(verified)}</verified_claims>\n\n` +
      `<rejected_claims>${JSON.stringify(rejected)}</rejected_claims>\n\n` +
      `<case_specific_gap_concepts>${JSON.stringify(args.expectations.gapSignals)}</case_specific_gap_concepts>\n\n` +
      `<gap_handling_rubric>\n${args.expectations.gapHandling}\n</gap_handling_rubric>\n\n` +
      `<rejected_claim_discipline_rubric>\n${args.expectations.rejectedClaimDiscipline}\n</rejected_claim_discipline_rubric>\n\n` +
      "Treat each case_specific_gap_concepts item as a concept group that should be visible in a full-credit gap_handling answer; exact wording is not required. Score this completed answer strictly. When labels are provided, use the label names in the rationale so the prompt improver can target the miss. Write each rationale as actionable feedback in this shape: 'Missing/weak: <specific concept>. Improve by: <general behavior to add to the prompt>.' Fill only the configured score and rationale fields; do not ask for a schema.";

    const result = await haikuJudge({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      schema: PlanSynthesisJudgmentSchema,
      schemaName: PLAN_SYNTHESIS_JUDGE_SCHEMA_NAME,
      schemaDescription:
        "Scores gap handling and rejected-claim discipline for one hypothesis eval case.",
      maxTokens: 360,
      signal: args.signal,
    });

    const gapAudit = auditSignalCoverage(
      args.result.hypothesis,
      args.expectations.gapSignals,
    );
    const rejectedAudit = auditRejectedClaimDiscipline({
      hypothesis: args.result.hypothesis,
      selectedEvidenceIds: args.selectedEvidenceIds,
      verdicts: args.verdicts,
      expectations: args.expectations,
    });
    const output = requireJudgeOutput(result, "Plan synthesis judge");
    const gapHandling = clamp01(
      Math.min(output.gap_handling, gapAudit.ceiling),
    );
    const rejectedClaimDiscipline = clamp01(
      Math.min(output.rejected_claim_discipline, rejectedAudit.ceiling),
    );
    const gapRationale = appendAuditNote(output.gap_rationale, gapAudit.note);
    const rejectedClaimDisciplineRationale = appendAuditNote(
      output.rejected_claim_discipline_rationale,
      rejectedAudit.note,
    );
    const out: PlanSynthesisJudgment = {
      gapHandling,
      rejectedClaimDiscipline,
      gapRationale,
      rejectedClaimDisciplineRationale,
      rationale: `Gap: ${gapRationale} Rejected claims: ${rejectedClaimDisciplineRationale}`,
      usage: result.usage,
    };
    this.cache.set(key, out);
    return out;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

interface AuditScore {
  score: number;
  ceiling: number;
  note?: string;
}

function appendAuditNote(rationale: string, note: string | undefined): string {
  if (!note) return rationale;
  if (rationale.includes(note)) return rationale;
  return `${rationale} ${note}`;
}

function auditSignalCoverage(
  hypothesis: string,
  signals: readonly SignalRequirement[],
): AuditScore {
  if (signals.length === 0) return { score: 1, ceiling: 1 };
  const text = normalizeText(hypothesis);
  let earned = 0;
  let total = 0;
  const missing: string[] = [];
  for (const signal of signals) {
    const weight = signal.weight ?? 1;
    total += weight;
    if (signal.anyOf.some((needle) => text.includes(normalizeText(needle)))) {
      earned += weight;
    } else {
      missing.push(signal.label ?? signal.anyOf[0] ?? "required concept");
    }
  }
  const score = total === 0 ? 1 : clamp01(earned / total);
  if (missing.length === 0) return { score, ceiling: 1 };
  const ceiling =
    score >= 0.75 ? 0.8 : score >= 0.5 ? 0.65 : score > 0 ? 0.5 : 0.35;
  return {
    score,
    ceiling,
    note: `Rubric ceiling applied because these required gap concepts were absent or only implicit: ${missing.join(", ")}.`,
  };
}

function auditRejectedClaimDiscipline(args: {
  hypothesis: string;
  selectedEvidenceIds: readonly string[];
  verdicts: readonly CitationVerdict[];
  expectations: PlanStabilityExpectations;
}): AuditScore {
  const rejectedIds = new Set(
    args.verdicts
      .filter((verdict) => !verdict.supported)
      .map((verdict) => verdict.evidenceId),
  );
  if (args.selectedEvidenceIds.some((id) => rejectedIds.has(id))) {
    return {
      score: 0,
      ceiling: 0,
      note: "Rejected evidence IDs were selected as support.",
    };
  }
  if (rejectedIds.size === 0) return { score: 1, ceiling: 1 };

  const text = normalizeText(args.hypothesis);
  const misuseSignals = args.expectations.rejectedMisuseSignals ?? [];
  const caveatSignals = [
    "not supported",
    "unsupported",
    "does not support",
    "do not support",
    "does not quantify",
    "not quantify",
    "not dose-specific",
    "not dose by dose",
    "not dose-by-dose",
    "not available",
    "not report",
    "not provide",
    "cannot",
    "no direct",
    "no precise",
    "missing",
  ];
  const hasCaveat = caveatSignals.some((signal) => text.includes(signal));
  const rejectedClaims = args.verdicts.filter((verdict) => !verdict.supported);
  const auditTerms = [
    ...misuseSignals,
    ...rejectedClaims.flatMap((verdict) => importantClaimTerms(verdict.claim)),
  ];
  const mentionsRejectedSubstance = auditTerms.some((term) =>
    text.includes(normalizeText(term)),
  );
  if (hasCaveat && mentionsRejectedSubstance) {
    return { score: 1, ceiling: 1 };
  }
  if (mentionsRejectedSubstance) {
    return {
      score: 0,
      ceiling: 0,
      note: "The answer repeated rejected-claim substance without clearly marking it as unsupported.",
    };
  }
  if (hasCaveat) {
    return {
      score: 0.6,
      ceiling: 0.65,
      note: "The answer gives a limitation but does not make the relevant rejected claim auditable as blocked.",
    };
  }
  return {
    score: 0.5,
    ceiling: 0.6,
    note: "The answer silently avoids relevant rejected claims instead of naming the blocked evidence boundary.",
  };
}

function importantClaimTerms(claim: string): string[] {
  const normalized = normalizeText(claim);
  const terms: string[] = [];
  const numberMatches = normalized.match(/\b\d+(?:\.\d+)?\s*%?\b/g) ?? [];
  terms.push(...numberMatches);
  if (normalized.includes("hba1c")) terms.push("HbA1c");
  if (normalized.includes("monotonically")) terms.push("monotonically");
  if (normalized.includes("outperforms")) terms.push("outperforms");
  if (normalized.includes("head-to-head")) terms.push("head-to-head");
  if (normalized.includes("dose-specific percentages")) {
    terms.push("dose-specific percentages");
  }
  return [...new Set(terms)].filter((term) => term.length > 1);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
