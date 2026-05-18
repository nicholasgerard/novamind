import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { parseAgentSdkStructuredOutput } from "./structured-output";

const SmokeSchema = z
  .object({
    answer: z.string(),
  })
  .strict();

describe("parseAgentSdkStructuredOutput", () => {
  it("parses SDK structured_output", () => {
    const parsed = parseAgentSdkStructuredOutput(
      sdkSuccess({
        result: "plain text is not authoritative",
        structured_output: { answer: "ok" },
      }),
      SmokeSchema,
      "Smoke agent",
    );

    expect(parsed).toMatchObject({
      success: true,
      source: "structured_output",
      rawKeys: ["answer"],
    });
    expect(parsed.success && parsed.data.answer).toBe("ok");
  });

  it("does not accept result text as a structured-output substitute", () => {
    const parsed = parseAgentSdkStructuredOutput(
      sdkSuccess({ result: JSON.stringify({ answer: "ok" }) }),
      SmokeSchema,
      "Smoke agent",
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

  it("reports schema failures from structured_output", () => {
    const parsed = parseAgentSdkStructuredOutput(
      sdkSuccess({
        result: "ignored",
        structured_output: { report: { answer: "nested" } },
      }),
      SmokeSchema,
      "Smoke agent",
    );

    expect(parsed).toMatchObject({
      success: false,
      source: "structured_output",
      rawKeys: ["report"],
    });
    expect(parsed.success ? "" : parsed.error).toContain(
      "invalid SDK structured_output",
    );
  });
});

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
