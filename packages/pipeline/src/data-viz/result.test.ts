import { describe, expect, it } from "vitest";
import type { SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import type { DataVizChart } from "@novamind/shared";
import { buildFallbackDataVizReport, parseDataVizResult } from "./result";

describe("parseDataVizResult", () => {
  it("parses SDK structured_output when present", () => {
    const parsed = parseDataVizResult(
      sdkSuccess({
        result: "not json",
        structured_output: reportPayload("Use chart evidence."),
      }),
    );

    expect(parsed).toMatchObject({
      success: true,
      source: "structured_output",
      rawType: "object",
    });
    expect(parsed.success && parsed.data.recommendation).toBe(
      "Use chart evidence.",
    );
  });

  it("keeps presentation length as prompt guidance rather than a parse failure", () => {
    const parsed = parseDataVizResult(
      sdkSuccess({
        result: "ignored",
        structured_output: reportPayload("Recommendation. ".repeat(80)),
      }),
    );

    expect(parsed).toMatchObject({
      success: true,
      source: "structured_output",
      rawType: "object",
    });
  });

  it("fails when SDK structured_output is absent", () => {
    const parsed = parseDataVizResult(
      sdkSuccess({ result: JSON.stringify(reportPayload("Proceed.")) }),
    );

    expect(parsed).toMatchObject({
      success: false,
      source: "missing_structured_output",
      rawKeys: undefined,
      rawType: "undefined",
    });
    expect(parsed.success ? "" : parsed.error).toContain(
      "without SDK structured_output",
    );
  });

  it("reports schema failures against the source it parsed", () => {
    const parsed = parseDataVizResult(
      sdkSuccess({
        result: "ignored",
        structured_output: { report: reportPayload("Proceed.") },
      }),
    );

    expect(parsed).toMatchObject({
      success: false,
      source: "structured_output",
      rawType: "object",
    });
    expect(parsed.success ? "" : parsed.error).toContain(
      "invalid SDK structured_output",
    );
  });

  it("builds a schema-valid fallback report from completed charts", () => {
    const report = buildFallbackDataVizReport({
      charts: [
        chart(
          "chart-1",
          "HbA1c outcome signal",
          "HbA1c outcomes favored active treatment arms.",
        ),
        chart(
          "chart-2",
          "Weight endpoint mix",
          "Weight endpoints were common across phase 2 studies.",
        ),
        chart(
          "chart-3",
          "Phase coverage",
          "Phase 2 studies dominated the snapshot.",
        ),
        chart(
          "chart-4",
          "Adverse-event rates",
          "Gastrointestinal events were frequently reported.",
        ),
      ].map((chart) => ({ chart, rationale: `${chart.title} rationale.` })),
      question: "How should GLP-1 trial data contextualize the handoff?",
      researchHandoff: {
        completedAt: 1,
        confidence: 0.86,
        evidence: [{ citation: "PMID 1", claim: "HbA1c improved." }],
        hypothesis: "GLP-1 therapies improve HbA1c and weight outcomes.",
        question: "How should GLP-1 trial data contextualize the handoff?",
      },
    });

    expect(report.recommendation).toContain("ClinicalTrials.gov charts");
    expect(report.rationale).toContain("HbA1c outcome signal");
    expect(report.caveats).toHaveLength(2);
  });
});

function reportPayload(recommendation: string) {
  return {
    recommendation,
    rationale: "The generated charts support the recommendation.",
    caveats: [
      "Registry data is contextual and should be interpreted carefully.",
    ],
  };
}

function sdkSuccess({
  result,
  structured_output,
}: {
  result: string;
  structured_output?: unknown;
}): SDKResultSuccess {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result,
    session_id: "test-session",
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
    },
    ...(structured_output === undefined ? {} : { structured_output }),
  } as SDKResultSuccess;
}

function chart(id: string, title: string, summary: string): DataVizChart {
  return {
    id,
    kind: "bar",
    points: [{ label: "Arm A", value: 1 }],
    subtitle: "Trial snapshot",
    summary,
    title,
    xLabel: "Arm",
    yLabel: "Count",
  };
}
