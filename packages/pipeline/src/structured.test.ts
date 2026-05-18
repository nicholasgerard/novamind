import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callStructured, usageFromAgentResult } from "./structured";

const DemoSchema = z.object({
  answer: z.string().min(1),
});

describe("Claude structured calls", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses JSON structured outputs and sends supported effort", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = mockClaudeFetch({ answer: "ok" });

    const result = await callStructured({
      provider: "claude",
      model: "claude-sonnet-4-6",
      systemPrompt: "Return the answer.",
      userPrompt: "Answer now.",
      schema: DemoSchema,
      schemaName: "submit_demo",
      effort: "medium",
    });

    expect(result.output).toEqual({ answer: "ok" });
    expect(result.metadata).toMatchObject({
      finishReason: "end_turn",
      model: "claude-sonnet-4-6",
      maxBudgetUsd: undefined,
      outputMode: "json_schema",
      provider: "claude",
      requestedEffort: "medium",
      retryCount: 0,
      schemaName: "submit_demo",
      sentEffort: "medium",
    });
    const body = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).toMatchObject({
      output_config: {
        effort: "medium",
        format: {
          schema: {
            additionalProperties: false,
          },
          type: "json_schema",
        },
      },
    });
    const schema = (
      body.output_config as {
        format: {
          schema: { properties: Record<string, Record<string, unknown>> };
        };
      }
    ).format.schema;
    const answerSchema = schema.properties.answer!;
    expect(answerSchema).not.toHaveProperty("minLength");
    expect(answerSchema.description).toContain("minLength=1");
  });

  it("adds cache-control breakpoints when requested", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = mockClaudeFetch({ answer: "ok" });

    await callStructured({
      provider: "claude",
      model: "claude-sonnet-4-6",
      systemPrompt: "Return the answer.",
      userPrompt: "Answer now.",
      schema: DemoSchema,
      schemaName: "submit_demo",
      cacheControl: { systemPrompt: true, userPrompt: true },
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
      system: Array<Record<string, unknown>>;
    };
    expect(body.system[0]).toMatchObject({
      cache_control: { type: "ephemeral" },
      type: "text",
    });
    expect(body.messages[0]?.content[0]).toMatchObject({
      cache_control: { type: "ephemeral" },
      type: "text",
    });
  });

  it("adds cache-control breakpoints to selected user prompt blocks", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = mockClaudeFetch({ answer: "ok" });

    await callStructured({
      provider: "claude",
      model: "claude-sonnet-4-6",
      systemPrompt: "Return the answer.",
      userPrompt: [
        {
          text: "<retrieved_papers>stable</retrieved_papers>",
          cacheControl: true,
        },
        { text: "<question>dynamic</question>" },
      ],
      schema: DemoSchema,
      schemaName: "submit_demo",
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    expect(body.messages[0]?.content).toHaveLength(2);
    expect(body.messages[0]?.content[0]).toMatchObject({
      cache_control: { type: "ephemeral" },
      text: "<retrieved_papers>stable</retrieved_papers>",
      type: "text",
    });
    expect(body.messages[0]?.content[1]).toEqual({
      text: "<question>dynamic</question>",
      type: "text",
    });
  });

  it("serializes requested 1-hour cache TTLs", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = mockClaudeFetch({ answer: "ok" });

    await callStructured({
      provider: "claude",
      model: "claude-sonnet-4-6",
      systemPrompt: "Return the answer.",
      userPrompt: [
        {
          text: "<retrieved_papers>stable</retrieved_papers>",
          cacheControl: { ttl: "1h" },
        },
        { text: "<question>dynamic</question>" },
      ],
      schema: DemoSchema,
      schemaName: "submit_demo",
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    expect(body.messages[0]?.content[0]).toMatchObject({
      cache_control: { ttl: "1h", type: "ephemeral" },
      type: "text",
    });
  });

  it("omits effort for Claude models that do not support the effort parameter", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = mockClaudeFetch({ answer: "ok" });

    const result = await callStructured({
      provider: "claude",
      model: "claude-haiku-4-5",
      systemPrompt: "Return the answer.",
      userPrompt: "Answer now.",
      schema: DemoSchema,
      schemaName: "submit_demo",
      effort: "low",
    });

    expect(result.metadata.sentEffort).toBeUndefined();
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      output_config?: { effort?: string; format?: unknown };
    };
    expect(body.output_config?.effort).toBeUndefined();
    expect(body.output_config?.format).toMatchObject({ type: "json_schema" });
  });

  it("includes finish reason when structured output fails validation", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    mockClaudeFetch({}, { stopReason: "max_tokens" });

    const result = await callStructured({
      provider: "claude",
      model: "claude-sonnet-4-6",
      systemPrompt: "Return the answer.",
      userPrompt: "Answer now.",
      schema: DemoSchema,
      schemaName: "submit_demo",
      maxTokens: 8192,
    });

    expect(result.schemaValid).toBe(false);
    expect(result.metadata.finishReason).toBe("max_tokens");
    expect(result.metadata.truncated).toBe(true);
    expect(result.parseError).toContain("finish_reason=max_tokens");
  });

  it("retries truncated Claude structured output once with a larger token budget", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        claudeResponse({}, { stopReason: "max_tokens", outputTokens: 1024 }),
      )
      .mockResolvedValueOnce(claudeResponse({ answer: "ok" }));

    const result = await callStructured({
      provider: "claude",
      model: "claude-sonnet-4-6",
      systemPrompt: "Return the answer.",
      userPrompt: "Answer now.",
      schema: DemoSchema,
      schemaName: "submit_demo",
      maxTokens: 1024,
    });

    expect(result.output).toEqual({ answer: "ok" });
    expect(result.metadata).toMatchObject({
      finishReason: "end_turn",
      initialFinishReason: "max_tokens",
      retryCount: 1,
    });
    expect(result.metadata.truncated).toBeUndefined();
    const firstBody = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as { max_tokens: number };
    const secondBody = JSON.parse(
      fetchMock.mock.calls[1]?.[1]?.body as string,
    ) as { max_tokens: number };
    expect(firstBody.max_tokens).toBe(1024);
    expect(secondBody.max_tokens).toBe(2048);
  });

  it("marks Claude structured output as truncated when the retry also hits max tokens", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        claudeResponse({}, { stopReason: "max_tokens", outputTokens: 1024 }),
      )
      .mockResolvedValueOnce(
        claudeResponse({}, { stopReason: "max_tokens", outputTokens: 2048 }),
      );

    const result = await callStructured({
      provider: "claude",
      model: "claude-sonnet-4-6",
      systemPrompt: "Return the answer.",
      userPrompt: "Answer now.",
      schema: DemoSchema,
      schemaName: "submit_demo",
      maxTokens: 1024,
    });

    expect(result.schemaValid).toBe(false);
    expect(result.metadata).toMatchObject({
      finishReason: "max_tokens",
      initialFinishReason: "max_tokens",
      retryCount: 1,
      truncated: true,
    });
  });

  it("retries transient Claude transport failures", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("overloaded", { status: 529 }))
      .mockResolvedValueOnce(claudeResponse({ answer: "ok" }));

    const resultPromise = callStructured({
      provider: "claude",
      model: "claude-sonnet-4-6",
      systemPrompt: "Return the answer.",
      userPrompt: "Answer now.",
      schema: DemoSchema,
      schemaName: "submit_demo",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await resultPromise;

    expect(result.output).toEqual({ answer: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("enforces the caller's direct-call budget guard", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    mockClaudeFetch({ answer: "ok" }, { inputTokens: 1_000_000 });

    await expect(
      callStructured({
        provider: "claude",
        model: "claude-sonnet-4-6",
        systemPrompt: "Return the answer.",
        userPrompt: "Answer now.",
        schema: DemoSchema,
        schemaName: "submit_demo",
        maxBudgetUsd: 0.01,
      }),
    ).rejects.toThrow(/exceeded budget/);
  });

  it("fails unknown direct-call models before calling the provider", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      callStructured({
        provider: "claude",
        model: "claude-unpriced",
        systemPrompt: "Return the answer.",
        userPrompt: "Answer now.",
        schema: DemoSchema,
        schemaName: "submit_demo",
      }),
    ).rejects.toThrow(/No direct API pricing configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Agent SDK usage", () => {
  it("uses per-model SDK costs when modelUsage provides them", () => {
    const usage = usageFromAgentResult(
      sdkResult({
        modelUsage: {
          "claude-sonnet-4-6": {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadInputTokens: 10,
            cacheCreationInputTokens: 5,
            costUSD: 0.0004,
          },
          "claude-haiku-4-5": {
            inputTokens: 50,
            outputTokens: 10,
            costUSD: 0.0001,
          },
        },
        total_cost_usd: 0.02,
      }),
    );

    expect(usage).toEqual({
      inputTokens: 150,
      outputTokens: 30,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      costUsd: 0.0005,
      uncachedCostUsd: (115 * 3 + 20 * 15 + 50 * 1 + 10 * 5) / 1_000_000,
      cacheSavingsUsd:
        (115 * 3 + 20 * 15 + 50 * 1 + 10 * 5) / 1_000_000 - 0.0005,
    });
  });

  it("uses a fallback model to compute cache savings from aggregate SDK usage", () => {
    const usage = usageFromAgentResult(
      sdkResult({
        total_cost_usd: 0.001,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 2_000,
          cache_creation_input_tokens: 100,
        },
      }),
      { fallbackModel: "claude-sonnet-4-6" },
    );

    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 2_000,
      cacheCreationTokens: 100,
      costUsd: 0.001,
      uncachedCostUsd: (2_200 * 3 + 20 * 15) / 1_000_000,
      cacheSavingsUsd: (2_200 * 3 + 20 * 15) / 1_000_000 - 0.001,
    });
  });

  it("does not estimate aggregate SDK cache savings without a known model", () => {
    const usage = usageFromAgentResult(
      sdkResult({
        total_cost_usd: 0.001,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 2_000,
          cache_creation_input_tokens: 100,
        },
      }),
    );

    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 2_000,
      cacheCreationTokens: 100,
      costUsd: 0.001,
    });
  });

  it("falls back to SDK total cost when modelUsage omits per-model cost", () => {
    const usage = usageFromAgentResult(
      sdkResult({
        modelUsage: {
          "claude-sonnet-4-6": {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadInputTokens: 10,
            cacheCreationInputTokens: 5,
          },
        },
        total_cost_usd: 0.02,
      }),
    );

    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      costUsd: 0.02,
    });
  });

  it("treats missing SDK usage as zero instead of masking SDK errors", () => {
    const usage = usageFromAgentResult(
      sdkResult({
        omitUsage: true,
        subtype: "error_max_turns",
      }),
    );

    expect(usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
    });
  });
});

function mockClaudeFetch(
  output: unknown,
  opts: {
    inputTokens?: number;
    outputTokens?: number;
    stopReason?: string;
  } = {},
) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(claudeResponse(output, opts));
}

function claudeResponse(
  output: unknown,
  opts: {
    inputTokens?: number;
    outputTokens?: number;
    stopReason?: string;
  } = {},
): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text: JSON.stringify(output) }],
      stop_reason: opts.stopReason ?? "end_turn",
      usage: {
        input_tokens: opts.inputTokens ?? 12,
        output_tokens: opts.outputTokens ?? 4,
      },
    }),
    { status: 200 },
  );
}

function sdkResult(args: {
  modelUsage?: Record<string, Record<string, number>>;
  omitUsage?: boolean;
  subtype?: string;
  total_cost_usd?: number;
  usage?: Record<string, number>;
}) {
  return {
    type: "result",
    subtype: args.subtype ?? "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: "ok",
    session_id: "test-session",
    total_cost_usd: args.total_cost_usd,
    ...(args.omitUsage
      ? {}
      : {
          usage: args.usage ?? {
            input_tokens: 0,
            output_tokens: 0,
          },
        }),
    modelUsage: args.modelUsage,
  } as unknown as Parameters<typeof usageFromAgentResult>[0];
}
