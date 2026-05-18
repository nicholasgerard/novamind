import type { z } from "zod";
import type { SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";

export type AgentSdkStructuredOutputSource =
  | "structured_output"
  | "missing_structured_output";

export type AgentSdkStructuredOutputParse<T> =
  | {
      data: T;
      rawKeys: string[] | undefined;
      rawType: string;
      source: AgentSdkStructuredOutputSource;
      success: true;
    }
  | {
      error: string;
      rawKeys: string[] | undefined;
      rawType: string;
      source: AgentSdkStructuredOutputSource;
      success: false;
    };

/**
 * Parses the Agent SDK final structured output. When `outputFormat` is set,
 * the SDK contract is `result.structured_output`; plain result text is not a
 * substitute because accepting it would bypass SDK validation and retry
 * behavior.
 */
export function parseAgentSdkStructuredOutput<T>(
  result: SDKResultSuccess,
  schema: z.ZodType<T>,
  label: string,
): AgentSdkStructuredOutputParse<T> {
  if (result.structured_output === undefined) {
    return {
      error: `${label} returned success without SDK structured_output despite outputFormat.`,
      rawKeys: undefined,
      rawType: "undefined",
      source: "missing_structured_output",
      success: false,
    };
  }

  const rawType = describeRawJson(result.structured_output);
  const rawKeys = objectKeys(result.structured_output);
  const parsed = schema.safeParse(result.structured_output);
  if (parsed.success) {
    return {
      data: parsed.data,
      rawKeys,
      rawType,
      source: "structured_output",
      success: true,
    };
  }
  return {
    error: `${label} returned invalid SDK structured_output: ${parsed.error.message}`,
    rawKeys,
    rawType,
    source: "structured_output",
    success: false,
  };
}

function describeRawJson(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function objectKeys(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return Object.keys(value).slice(0, 20);
}
