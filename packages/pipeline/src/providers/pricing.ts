import type { TokenUsage } from "@novamind/shared";

const TOKENS_PER_MILLION = 1_000_000;
let pricingReviewWarningEmitted = false;

export type DirectApiPricingProvider = "anthropic" | "openai";
export type AnthropicCacheWriteTtl = "5m" | "1h";

export interface AnthropicMessagesUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
}

export interface OpenAIChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
}

/**
 * Explicit direct-API pricing catalog for cost estimates where the provider
 * response reports tokens but not dollars. Values are USD per million tokens.
 *
 * Keep this intentionally small: it should include the models this repo
 * actually calls through direct APIs. Unknown models fail before the provider
 * request so pricing drift cannot silently produce wrong demo telemetry.
 */
export const DIRECT_API_PRICING = {
  asOf: "2026-05-14",
  reviewAfter: "2026-08-14",
  unit: "usd_per_million_tokens",
  sources: {
    anthropic: "https://platform.claude.com/docs/en/about-claude/pricing",
    openai: "https://developers.openai.com/api/docs/pricing",
  },
  anthropicMessages: {
    "claude-opus-4-7": {
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite5m: 6.25,
      cacheWrite1h: 10,
    },
    "claude-opus-4-6": {
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite5m: 6.25,
      cacheWrite1h: 10,
    },
    "claude-opus-4-5": {
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite5m: 6.25,
      cacheWrite1h: 10,
    },
    "claude-sonnet-4-6": {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite5m: 3.75,
      cacheWrite1h: 6,
    },
    "claude-sonnet-4-5": {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite5m: 3.75,
      cacheWrite1h: 6,
    },
    "claude-haiku-4-5": {
      input: 1,
      output: 5,
      cacheRead: 0.1,
      cacheWrite5m: 1.25,
      cacheWrite1h: 2,
    },
  },
  openaiChat: {
    "gpt-5.1": {
      input: 1.25,
      cachedInput: 0.125,
      output: 10,
    },
    "gpt-5": {
      input: 1.25,
      cachedInput: 0.125,
      output: 10,
    },
    "gpt-5-mini": {
      input: 0.25,
      cachedInput: 0.025,
      output: 2,
    },
  },
} as const;

type AnthropicMessagesRate =
  (typeof DIRECT_API_PRICING.anthropicMessages)[keyof typeof DIRECT_API_PRICING.anthropicMessages];
type OpenAIChatRate =
  (typeof DIRECT_API_PRICING.openaiChat)[keyof typeof DIRECT_API_PRICING.openaiChat];
type DirectApiRate = AnthropicMessagesRate | OpenAIChatRate;

/** Assert that a direct provider/model pair has an explicit rate-card entry. */
export function assertKnownDirectApiPricing(
  provider: DirectApiPricingProvider,
  model: string,
): void {
  warnIfPricingReviewOverdue();
  if (provider === "anthropic") {
    findAnthropicMessagesRate(model);
    return;
  }
  findOpenAIChatRate(model);
}

/**
 * Convert Anthropic Messages API token usage into normalized usage telemetry.
 * The Messages API response does not include request-level dollars, so this
 * uses `DIRECT_API_PRICING`; Agent SDK result costs are handled separately.
 */
export function estimateAnthropicMessagesUsage(
  model: string,
  usage: AnthropicMessagesUsage,
  options: { cacheWriteTtl?: AnthropicCacheWriteTtl } = {},
): TokenUsage {
  const rates = findAnthropicMessagesRate(model);
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const cacheWriteCostUsd = anthropicCacheWriteCostUsd(
    rates,
    usage,
    options.cacheWriteTtl ?? "5m",
  );
  const costUsd =
    (usage.input_tokens * rates.input +
      cacheRead * rates.cacheRead +
      usage.output_tokens * rates.output) /
      TOKENS_PER_MILLION +
    cacheWriteCostUsd;
  const totalInputTokens = usage.input_tokens + cacheRead + cacheCreate;
  const uncachedCostUsd = estimateUncachedClaudeCostUsd(model, {
    inputTokens: totalInputTokens,
    outputTokens: usage.output_tokens,
  });

  return withPromptCacheEconomics(
    {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreate,
      costUsd,
    },
    uncachedCostUsd,
  );
}

function anthropicCacheWriteCostUsd(
  rates: AnthropicMessagesRate,
  usage: AnthropicMessagesUsage,
  defaultTtl: AnthropicCacheWriteTtl,
): number {
  const detailed5m = usage.cache_creation?.ephemeral_5m_input_tokens;
  const detailed1h = usage.cache_creation?.ephemeral_1h_input_tokens;
  if (detailed5m !== undefined || detailed1h !== undefined) {
    return (
      ((detailed5m ?? 0) * rates.cacheWrite5m +
        (detailed1h ?? 0) * rates.cacheWrite1h) /
      TOKENS_PER_MILLION
    );
  }

  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const cacheWriteRate =
    defaultTtl === "1h" ? rates.cacheWrite1h : rates.cacheWrite5m;
  return (cacheCreate * cacheWriteRate) / TOKENS_PER_MILLION;
}

/**
 * Convert OpenAI chat-completion token usage into normalized usage telemetry.
 * OpenAI returns cached-token counts but not request-level dollars on this
 * path, so cost is estimated from the shared direct-API pricing catalog.
 */
export function estimateOpenAIChatUsage(
  model: string,
  usage: OpenAIChatUsage | null | undefined,
): TokenUsage {
  const rates = findOpenAIChatRate(model);
  if (!usage) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
    };
  }

  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncached = Math.max(0, usage.prompt_tokens - cached);
  const costUsd =
    (uncached * rates.input +
      cached * rates.cachedInput +
      usage.completion_tokens * rates.output) /
    TOKENS_PER_MILLION;
  const uncachedCostUsd =
    (usage.prompt_tokens * rates.input +
      usage.completion_tokens * rates.output) /
    TOKENS_PER_MILLION;

  return withPromptCacheEconomics(
    {
      inputTokens: uncached,
      outputTokens: usage.completion_tokens,
      cacheReadTokens: cached,
      cacheCreationTokens: 0,
      costUsd,
    },
    uncachedCostUsd,
  );
}

/**
 * Estimate what a Claude request would have cost if cached input tokens had
 * been billed as ordinary input. Used for display-only prompt-cache savings;
 * provider-reported/SDK actual cost remains the source of truth for `costUsd`.
 */
export function estimateUncachedClaudeCostUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const rates = findAnthropicMessagesRate(model);
  return (
    (usage.inputTokens * rates.input + usage.outputTokens * rates.output) /
    TOKENS_PER_MILLION
  );
}

export function withPromptCacheEconomics(
  usage: TokenUsage,
  uncachedCostUsd: number,
): TokenUsage {
  const cacheSavingsUsd = uncachedCostUsd - usage.costUsd;
  if (cacheSavingsUsd <= 0) return usage;
  return {
    ...usage,
    uncachedCostUsd,
    cacheSavingsUsd,
  };
}

function warnIfPricingReviewOverdue(): void {
  if (pricingReviewWarningEmitted) return;
  if (Date.now() <= Date.parse(DIRECT_API_PRICING.reviewAfter)) return;
  pricingReviewWarningEmitted = true;
  console.warn(
    `[pricing] DIRECT_API_PRICING review is overdue; catalog as of ${DIRECT_API_PRICING.asOf}, reviewAfter ${DIRECT_API_PRICING.reviewAfter}.`,
  );
}

function findAnthropicMessagesRate(model: string): AnthropicMessagesRate {
  return findConfiguredRate(
    "anthropic",
    model,
    DIRECT_API_PRICING.anthropicMessages,
  );
}

function findOpenAIChatRate(model: string): OpenAIChatRate {
  return findConfiguredRate("openai", model, DIRECT_API_PRICING.openaiChat);
}

function findConfiguredRate<R extends Record<string, DirectApiRate>>(
  provider: DirectApiPricingProvider,
  model: string,
  rates: R,
): R[keyof R] {
  for (const configuredModel of Object.keys(rates) as Array<keyof R & string>) {
    if (matchesConfiguredModel(model, configuredModel)) {
      return rates[configuredModel];
    }
  }
  throw new Error(
    `No direct API pricing configured for ${provider} model "${model}". ` +
      `Update DIRECT_API_PRICING before using this model for cost telemetry ` +
      `(catalog as of ${DIRECT_API_PRICING.asOf}; source ${DIRECT_API_PRICING.sources[provider]}).`,
  );
}

function matchesConfiguredModel(
  model: string,
  configuredModel: string,
): boolean {
  const normalizedModel = model.trim();
  return (
    normalizedModel === configuredModel ||
    normalizedModel.startsWith(`${configuredModel}-20`)
  );
}
