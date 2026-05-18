import { describe, expect, it } from "vitest";
import {
  assertKnownDirectApiPricing,
  DIRECT_API_PRICING,
  estimateAnthropicMessagesUsage,
  estimateOpenAIChatUsage,
} from "./pricing";

describe("direct API pricing", () => {
  it("documents source and review metadata", () => {
    expect(DIRECT_API_PRICING).toMatchObject({
      asOf: "2026-05-14",
      reviewAfter: "2026-08-14",
      unit: "usd_per_million_tokens",
      sources: {
        anthropic: expect.stringContaining("claude.com"),
        openai: expect.stringContaining("openai.com"),
      },
    });
  });

  it("estimates Anthropic Messages usage with current cache pricing", () => {
    const usage = estimateAnthropicMessagesUsage("claude-sonnet-4-6", {
      input_tokens: 1_000,
      output_tokens: 200,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 50,
    });

    expect(usage).toEqual({
      inputTokens: 1_000,
      outputTokens: 200,
      cacheReadTokens: 100,
      cacheCreationTokens: 50,
      costUsd: (1_000 * 3 + 100 * 0.3 + 50 * 3.75 + 200 * 15) / 1_000_000,
      uncachedCostUsd: ((1_000 + 100 + 50) * 3 + 200 * 15) / 1_000_000,
      cacheSavingsUsd:
        ((1_000 + 100 + 50) * 3 + 200 * 15) / 1_000_000 -
        (1_000 * 3 + 100 * 0.3 + 50 * 3.75 + 200 * 15) / 1_000_000,
    });
  });

  it("uses Anthropic's detailed cache-creation buckets when present", () => {
    const usage = estimateAnthropicMessagesUsage("claude-sonnet-4-6", {
      input_tokens: 1_000,
      output_tokens: 200,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 50,
      cache_creation: {
        ephemeral_5m_input_tokens: 10,
        ephemeral_1h_input_tokens: 40,
      },
    });

    expect(usage.costUsd).toBeCloseTo(
      (1_000 * 3 + 100 * 0.3 + 10 * 3.75 + 40 * 6 + 200 * 15) / 1_000_000,
    );
    expect(usage.uncachedCostUsd).toBeCloseTo(
      ((1_000 + 100 + 50) * 3 + 200 * 15) / 1_000_000,
    );
  });

  it("uses the current Opus 4.7 and Haiku 4.5 prices", () => {
    expect(
      estimateAnthropicMessagesUsage("claude-opus-4-7", {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }).costUsd,
    ).toBe(30);
    expect(
      estimateAnthropicMessagesUsage("claude-haiku-4-5", {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }).costUsd,
    ).toBe(6);
  });

  it("supports dated model snapshots without broad prefix fallbacks", () => {
    assertKnownDirectApiPricing("anthropic", "claude-sonnet-4-6-20260217");
    assertKnownDirectApiPricing("openai", "gpt-5.1-2025-11-13");

    expect(() =>
      assertKnownDirectApiPricing("openai", "gpt-5.1-codex-mini"),
    ).toThrow(/No direct API pricing configured/);
  });

  it("estimates OpenAI chat usage with published cached-token rates", () => {
    const usage = estimateOpenAIChatUsage("gpt-5.1", {
      prompt_tokens: 1_000,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 400 },
    });

    expect(usage).toEqual({
      inputTokens: 600,
      outputTokens: 100,
      cacheReadTokens: 400,
      cacheCreationTokens: 0,
      costUsd: (600 * 1.25 + 400 * 0.125 + 100 * 10) / 1_000_000,
      uncachedCostUsd: (1_000 * 1.25 + 100 * 10) / 1_000_000,
      cacheSavingsUsd:
        (1_000 * 1.25 + 100 * 10) / 1_000_000 -
        (600 * 1.25 + 400 * 0.125 + 100 * 10) / 1_000_000,
    });
  });

  it("throws for unknown models instead of estimating with a fallback rate", () => {
    expect(() =>
      estimateAnthropicMessagesUsage("claude-unknown", {
        input_tokens: 1,
        output_tokens: 1,
      }),
    ).toThrow(/No direct API pricing configured/);
    expect(() =>
      estimateOpenAIChatUsage("gpt-unknown", {
        prompt_tokens: 1,
        completion_tokens: 1,
      }),
    ).toThrow(/No direct API pricing configured/);
  });
});
