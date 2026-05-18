import { z } from "zod";
import type { SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import {
  parseAgentSdkStructuredOutput,
  type AgentSdkStructuredOutputParse,
  type AgentSdkStructuredOutputSource,
} from "../agent-sdk/structured-output";
import { DATA_VIZ_FINAL_REPORT_WORD_BUDGET } from "./final-report";
import { REQUIRED_CHART_COUNT, type DataVizRunState } from "./types";

export const DataVizOrchestratorResultSchema = z
  .object({
    recommendation: z
      .string()
      .describe(
        "One presenter-ready sentence grounded in the four generated charts and verified literature handoff.",
      ),
    rationale: z
      .string()
      .describe(
        "One sentence explaining how the generated ClinicalTrials.gov charts support or qualify the recommendation.",
      ),
    caveats: z
      .array(
        z
          .string()
          .describe(
            "Short interpretation limit, evidence gap, or safety caution.",
          ),
      )
      .describe(
        `Zero to two short interpretation limits, evidence gaps, or safety cautions surfaced by the charted trial data. Keep the full structured output under ${DATA_VIZ_FINAL_REPORT_WORD_BUDGET} words.`,
      ),
  })
  .strict();

export type DataVizOrchestratorResult = z.infer<
  typeof DataVizOrchestratorResultSchema
>;

export type DataVizStructuredOutputSource = AgentSdkStructuredOutputSource;

export type DataVizResultParse =
  AgentSdkStructuredOutputParse<DataVizOrchestratorResult>;

export function parseDataVizResult(
  result: SDKResultSuccess,
): DataVizResultParse {
  return parseAgentSdkStructuredOutput(
    result,
    DataVizOrchestratorResultSchema,
    "Visualization agent",
  );
}

export function buildFallbackDataVizReport(
  state: Pick<DataVizRunState, "charts" | "question" | "researchHandoff">,
): DataVizOrchestratorResult {
  const charts = state.charts.slice(0, REQUIRED_CHART_COUNT);
  const focus = sentenceFragment(
    state.question || state.researchHandoff.question || "the research question",
  );
  const chartTitles = charts.map(({ chart }) =>
    truncateText(sentenceFragment(chart.title), 54),
  );
  const primarySummary = sentenceFragment(
    charts[0]?.chart.summary ||
      "the generated charts summarize the trial snapshot",
  );

  return DataVizOrchestratorResultSchema.parse({
    recommendation: `Use the verified hypothesis as the narrative lead, with the four ClinicalTrials.gov charts framing trial coverage for ${truncateText(focus, 120)}.`,
    rationale: `The completed views cover ${formatList(chartTitles)}, and ${truncateText(primarySummary, 150)}.`,
    caveats: [
      "ClinicalTrials.gov registry data is contextual and does not replace verified literature evidence.",
      "Charted trial coverage may lag current labels, unpublished results, or safety updates.",
    ],
  });
}

function sentenceFragment(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function formatList(values: string[]): string {
  const filtered = values.filter(Boolean);
  if (filtered.length === 0) return "the generated trial-data views";
  if (filtered.length === 1) return filtered[0] ?? "the generated chart";
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(", ")}, and ${filtered.at(-1)}`;
}
