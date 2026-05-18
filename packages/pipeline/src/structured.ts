import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  type ModelUsage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { sumUsage, type TokenUsage } from "@novamind/shared";
import { isClaudeAvailable } from "./providers/claude";
import { getOpenAI } from "./providers/openai";
import {
  assertKnownDirectApiPricing,
  estimateAnthropicMessagesUsage,
  estimateUncachedClaudeCostUsd,
  estimateOpenAIChatUsage,
  withPromptCacheEconomics,
} from "./providers/pricing";
import { claudeModelSupportsEffort } from "./claude-model-capabilities";

const moduleRequire = createRequire(import.meta.url);
const MAX_STRUCTURED_RETRY_TOKENS = 8192;
const CLAUDE_TRANSPORT_RETRY_DELAYS_MS = [250, 1_000] as const;

export type StructuredProvider = "claude" | "openai";
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type StructuredOutputMode = "json_schema";
export type ClaudeCacheTtl = "5m" | "1h";

export interface ClaudeCacheControl {
  ttl?: ClaudeCacheTtl;
}

export interface StructuredPromptBlock {
  /** Text content for one prompt block. */
  text: string;
  /** Add an Anthropic prompt-cache breakpoint after this block. */
  cacheControl?: boolean | ClaudeCacheControl;
}

export interface StructuredCallArgs<T> {
  provider: StructuredProvider;
  model: string;
  systemPrompt: string;
  userPrompt: string | readonly StructuredPromptBlock[];
  schema: z.ZodType<T>;
  schemaName: string;
  schemaDescription?: string;
  effort?: ClaudeEffort;
  /** Optional post-response cost guard. Provider APIs cannot pre-authorize this value. */
  maxBudgetUsd?: number;
  /** Max output tokens. Default 2048. */
  maxTokens?: number;
  /** Optional cancellation signal propagated from request/SSE lifecycle. */
  signal?: AbortSignal;
  /** Add Anthropic prompt-cache breakpoints for stable large direct-call context. */
  cacheControl?: {
    systemPrompt?: boolean | ClaudeCacheControl;
    /** Applies to string userPrompt callers; block callers should mark the block. */
    userPrompt?: boolean | ClaudeCacheControl;
  };
}

export interface StructuredCallMetadata {
  finishReason?: string;
  initialFinishReason?: string;
  maxBudgetUsd?: number;
  model: string;
  outputMode: StructuredOutputMode;
  provider: StructuredProvider;
  requestedEffort?: ClaudeEffort;
  retryCount?: number;
  schemaName: string;
  sentEffort?: ClaudeEffort;
  /** True when the final provider response ended because the output token cap was hit. */
  truncated?: boolean;
}

export interface StructuredCallResult<T> {
  metadata: StructuredCallMetadata;
  output: T | undefined;
  usage: TokenUsage;
  rawJson: unknown;
  /** True if the model returned JSON that parsed cleanly against the Zod schema. */
  schemaValid: boolean;
  /** When schemaValid is false, the Zod parse error message. */
  parseError?: string;
}

/**
 * Provider-agnostic structured output: returns parsed Zod-typed data plus
 * provider-normalized token usage. Used by Axis 1 (structured-output) and any
 * future place that needs a typed response from a model.
 *
 * Implementation notes:
 *   - Claude uses Messages API JSON structured outputs (`output_config.format`)
 *     for direct one-shot model calls. Use Agent SDK structured outputs for
 *     multi-turn tool workflows.
 *   - OpenAI uses response_format=json_schema with strict mode.
 *   - On schema validation failure, returns schemaValid=false plus the raw
 *     output for inspection. Transport/provider failures and explicit budget
 *     guard breaches still throw.
 */
export async function callStructured<T>(
  args: StructuredCallArgs<T>,
): Promise<StructuredCallResult<T>> {
  if (args.provider === "claude") return callClaudeStructured(args);
  return callOpenAIStructured(args);
}

async function callClaudeStructured<T>(
  args: StructuredCallArgs<T>,
): Promise<StructuredCallResult<T>> {
  if (!isClaudeAvailable()) {
    throw new Error("ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN not set");
  }
  const jsonSchema = claudeStructuredOutputSchema(args.schema);
  const sentEffort = supportedClaudeEffort(args.model, args.effort);
  const metadata = structuredCallMetadata(args, sentEffort);
  const initialMaxTokens = args.maxTokens ?? 2048;
  const first = await fetchClaudeStructured(
    args,
    jsonSchema,
    sentEffort,
    initialMaxTokens,
  );
  let rawResponse = first.rawResponse;
  let rawJson = claudeStructuredRawJson(rawResponse);
  let parsed = args.schema.safeParse(rawJson);
  let retryCount = 0;
  let usage = first.usage;
  assertStructuredBudget(args, usage);

  if (
    !parsed.success &&
    rawResponse.stop_reason === "max_tokens" &&
    initialMaxTokens < MAX_STRUCTURED_RETRY_TOKENS
  ) {
    const retry = await fetchClaudeStructured(
      args,
      jsonSchema,
      sentEffort,
      Math.min(
        MAX_STRUCTURED_RETRY_TOKENS,
        Math.max(initialMaxTokens * 2, initialMaxTokens + 1024),
      ),
    );
    retryCount = 1;
    rawResponse = retry.rawResponse;
    rawJson = claudeStructuredRawJson(rawResponse);
    parsed = args.schema.safeParse(rawJson);
    usage = sumStructuredUsage(usage, retry.usage);
    assertStructuredBudget(args, usage);
  }

  const responseMetadata = {
    ...metadata,
    finishReason: rawResponse.stop_reason,
    initialFinishReason: retryCount > 0 ? "max_tokens" : undefined,
    retryCount,
    ...(claudeResponseTruncated(rawResponse.stop_reason)
      ? { truncated: true }
      : {}),
  };
  if (parsed.success) {
    return {
      metadata: responseMetadata,
      output: parsed.data,
      usage,
      rawJson,
      schemaValid: true,
    };
  }
  return {
    metadata: responseMetadata,
    output: undefined,
    usage,
    rawJson,
    schemaValid: false,
    parseError: structuredParseError(
      rawResponse.stop_reason,
      parsed.error.message,
    ),
  };
}

async function fetchClaudeStructured<T>(
  args: StructuredCallArgs<T>,
  jsonSchema: Record<string, unknown>,
  sentEffort: ClaudeEffort | undefined,
  maxTokens: number,
): Promise<{ rawResponse: ClaudeMessagesResponse; usage: TokenUsage }> {
  assertKnownDirectApiPricing("anthropic", args.model);
  const response = await fetchClaudeMessagesWithRetry(args, {
    model: args.model,
    max_tokens: maxTokens,
    system: claudePromptContent(
      args.systemPrompt,
      args.cacheControl?.systemPrompt,
    ),
    messages: [
      {
        role: "user",
        content: claudePromptContent(
          args.userPrompt,
          args.cacheControl?.userPrompt,
        ),
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: jsonSchema,
      },
      ...(sentEffort ? { effort: sentEffort } : {}),
    },
  });

  if (!response.ok) {
    await response.text().catch(() => "");
    throw new Error(`Claude structured call failed: HTTP ${response.status}`);
  }

  const rawResponse = (await response.json()) as ClaudeMessagesResponse;
  return {
    rawResponse,
    usage: estimateAnthropicMessagesUsage(
      args.model,
      {
        input_tokens: rawResponse.usage?.input_tokens ?? 0,
        output_tokens: rawResponse.usage?.output_tokens ?? 0,
        cache_read_input_tokens: rawResponse.usage?.cache_read_input_tokens,
        cache_creation_input_tokens:
          rawResponse.usage?.cache_creation_input_tokens,
        cache_creation: rawResponse.usage?.cache_creation,
      },
      { cacheWriteTtl: requestedCacheWriteTtl(args) },
    ),
  };
}

async function fetchClaudeMessagesWithRetry(
  args: { signal?: AbortSignal },
  body: Record<string, unknown>,
): Promise<Response> {
  const url = `${anthropicBaseUrl().replace(/\/+$/, "")}/v1/messages`;
  let lastStatus: number | undefined;
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt <= CLAUDE_TRANSPORT_RETRY_DELAYS_MS.length;
    attempt++
  ) {
    try {
      const response = await fetch(url, {
        method: "POST",
        signal: args.signal,
        headers: {
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          ...anthropicAuthHeaders(),
        },
        body: JSON.stringify(body),
      });
      if (
        response.ok ||
        !retryableClaudeStatus(response.status) ||
        attempt === CLAUDE_TRANSPORT_RETRY_DELAYS_MS.length
      ) {
        return response;
      }
      lastStatus = response.status;
      await response.text().catch(() => "");
      await sleep(cloudRetryDelayMs(response, attempt), args.signal);
    } catch (err) {
      if (
        isAbortError(err) ||
        attempt === CLAUDE_TRANSPORT_RETRY_DELAYS_MS.length
      ) {
        throw err;
      }
      lastError = err;
      await sleep(
        CLAUDE_TRANSPORT_RETRY_DELAYS_MS[attempt] ??
          CLAUDE_TRANSPORT_RETRY_DELAYS_MS.at(-1)!,
        args.signal,
      );
    }
  }

  throw new Error(
    lastStatus
      ? `Claude structured call failed: HTTP ${lastStatus}`
      : `Claude structured call failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function claudePromptContent(
  prompt: string | readonly StructuredPromptBlock[],
  cacheControl: boolean | ClaudeCacheControl | undefined,
): string | Array<ClaudeTextBlock> {
  if (typeof prompt !== "string") {
    return prompt.map((block) => ({
      type: "text",
      text: block.text,
      ...(block.cacheControl
        ? { cache_control: claudeCacheControl(block.cacheControl) }
        : {}),
    }));
  }
  if (!cacheControl) return prompt;
  return [
    {
      type: "text",
      text: prompt,
      cache_control: claudeCacheControl(cacheControl),
    },
  ];
}

function claudeCacheControl(
  cacheControl: boolean | ClaudeCacheControl,
): ClaudeTextBlock["cache_control"] {
  if (typeof cacheControl === "boolean") return { type: "ephemeral" };
  return {
    type: "ephemeral",
    ...(cacheControl.ttl ? { ttl: cacheControl.ttl } : {}),
  };
}

function requestedCacheWriteTtl<T>(args: StructuredCallArgs<T>): "5m" | "1h" {
  const controls: Array<boolean | ClaudeCacheControl | undefined> = [
    args.cacheControl?.systemPrompt,
    args.cacheControl?.userPrompt,
  ];
  if (typeof args.userPrompt !== "string") {
    controls.push(...args.userPrompt.map((block) => block.cacheControl));
  }
  return controls.some(
    (cacheControl) =>
      typeof cacheControl === "object" && cacheControl.ttl === "1h",
  )
    ? "1h"
    : "5m";
}

function promptText(prompt: string | readonly StructuredPromptBlock[]): string {
  return typeof prompt === "string"
    ? prompt
    : prompt.map((block) => block.text).join("\n\n");
}

function retryableClaudeStatus(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

function cloudRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const parsed = retryAfterDelayMs(retryAfter);
  if (parsed !== null) return parsed;
  const base = CLAUDE_TRANSPORT_RETRY_DELAYS_MS[attempt] ?? 1_000;
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function retryAfterDelayMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1_000, 5_000);
  }
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), 5_000);
  }
  return null;
}

async function sleep(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    let cleanup = () => undefined;
    const abort = () => {
      cleanup();
      reject(abortError());
    };
    cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function claudeStructuredRawJson(rawResponse: ClaudeMessagesResponse): unknown {
  return normalizeStructuredRawJson(
    rawResponse.content.find(
      (block): block is ClaudeTextBlock => block.type === "text",
    )?.text ?? null,
  );
}

type ClaudeContentBlock = ClaudeTextBlock;

interface ClaudeTextBlock {
  cache_control?: { ttl?: ClaudeCacheTtl; type: "ephemeral" };
  text: string;
  type: "text";
}

interface ClaudeMessagesResponse {
  content: ClaudeContentBlock[];
  stop_reason?: string;
  usage?: {
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number | null;
      ephemeral_1h_input_tokens?: number | null;
    } | null;
    input_tokens: number;
    output_tokens: number;
  };
}

function anthropicBaseUrl(): string {
  return process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
}

function anthropicAuthHeaders(): Record<string, string> {
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (authToken) return { authorization: `Bearer ${authToken}` };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? { "x-api-key": apiKey } : {};
}

function abortError(): Error {
  const err = new Error("Structured model call aborted.");
  err.name = "AbortError";
  return err;
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

export function resolveClaudeExecutablePath(): string | undefined {
  const configured =
    process.env.NOVAMIND_CLAUDE_EXECUTABLE_PATH ??
    process.env.CLAUDE_CODE_EXECUTABLE_PATH;
  if (configured) return configured;
  if (process.platform !== "linux") return undefined;
  if (process.arch !== "x64" && process.arch !== "arm64") return undefined;

  // The SDK resolves linux-musl before linux-glibc. In Debian containers this
  // can select a musl binary whose interpreter is absent, causing spawn ENOENT.
  const glibcFirst = hasGlibcRuntime();
  const glibcPackage = `@anthropic-ai/claude-agent-sdk-linux-${process.arch}/claude`;
  const muslPackage = `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl/claude`;
  const candidates = glibcFirst
    ? [glibcPackage, muslPackage]
    : [muslPackage, glibcPackage];
  const sdkRequire = createRequire(
    moduleRequire.resolve("@anthropic-ai/claude-agent-sdk"),
  );

  for (const candidate of candidates) {
    try {
      return sdkRequire.resolve(candidate);
    } catch {
      // Try the next platform package.
    }
  }
  return undefined;
}

function hasGlibcRuntime(): boolean {
  const report = process.report?.getReport?.() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  const header = report?.header;
  return Boolean(header?.glibcVersionRuntime);
}

/**
 * Builds the environment for the Claude Agent SDK child process. We forward
 * provider auth, proxy/cert settings, and opt-in telemetry variables while
 * defaulting off Claude Code features that add unrelated context to this
 * bounded server-side route.
 */
export interface ClaudeAgentRuntimePaths {
  /** Minimal working directory for the bounded Agent SDK subprocess. */
  cwd: string;
  /** Isolated Claude config directory; intentionally separate from user config. */
  configDir: string;
}

export function claudeAgentRuntimePaths(
  profile?: "literature" | "data-viz",
): ClaudeAgentRuntimePaths {
  const root =
    process.env.NOVAMIND_CLAUDE_RUNTIME_DIR ??
    join(tmpdir(), "novamind-claude-agent-sdk");
  const profileRoot = profile ? join(root, profile) : root;
  return {
    cwd: process.env.NOVAMIND_CLAUDE_RUNTIME_CWD ?? profileRoot,
    configDir:
      process.env.NOVAMIND_CLAUDE_CONFIG_DIR ?? join(profileRoot, "config"),
  };
}

export function claudeAgentEnv(
  resourceAttributes: Record<string, string | undefined> = {},
  runtimePaths: ClaudeAgentRuntimePaths = claudeAgentRuntimePaths(),
): Record<string, string> {
  const passthroughKeys = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_EXECUTABLE_PATH",
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
    "CLAUDE_CODE_ENABLE_TELEMETRY",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA",
    "CLAUDE_CODE_OTEL_TRACE_PRICING",
    "ENABLE_BETA_TRACING_DETAILED",
    "ENABLE_TOOL_SEARCH",
    "BETA_TRACING_ENDPOINT",
    "HOME",
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
    "API_TIMEOUT_MS",
    "CLAUDE_CODE_MAX_RETRIES",
    "CLAUDE_ENABLE_STREAM_WATCHDOG",
    "CLAUDE_STREAM_IDLE_TIMEOUT_MS",
    "CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS",
    "ENABLE_PROMPT_CACHING_1H",
  ];
  const env: Record<string, string> = {
    API_TIMEOUT_MS: "120000",
    CLAUDE_AGENT_SDK_CLIENT_APP: "novamind/0.0.0",
    CLAUDE_CODE_MAX_RETRIES: "2",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_ENABLE_STREAM_WATCHDOG: "1",
    CLAUDE_CONFIG_DIR: runtimePaths.configDir,
    CLAUDE_STREAM_IDLE_TIMEOUT_MS: "300000",
    ENABLE_TOOL_SEARCH: "false",
    OTEL_SERVICE_NAME: "novamind-claude-agent-sdk",
  };

  for (const key of Object.keys(process.env)) {
    const value = process.env[key];
    if (!shouldForwardClaudeAgentEnv(key, passthroughKeys)) continue;
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  env.OTEL_RESOURCE_ATTRIBUTES = mergeOtelResourceAttributes(
    process.env.OTEL_RESOURCE_ATTRIBUTES,
    {
      "service.namespace": "novamind",
      "service.name": env.OTEL_SERVICE_NAME,
      "novamind.component": "agent-sdk",
      ...resourceAttributes,
    },
  );

  return env;
}

function shouldForwardClaudeAgentEnv(
  key: string,
  passthroughKeys: readonly string[],
): boolean {
  return (
    passthroughKeys.includes(key) ||
    key.startsWith("OTEL_") ||
    key.startsWith("CLAUDE_CODE_OTEL_")
  );
}

function mergeOtelResourceAttributes(
  existing: string | undefined,
  attributes: Record<string, string | undefined>,
): string {
  const pairs = new Map<string, string>();
  if (existing) {
    for (const item of existing.split(",")) {
      const [rawKey, ...rawValue] = item.split("=");
      const key = rawKey?.trim();
      const value = rawValue.join("=").trim();
      if (key && value) pairs.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (value) pairs.set(key, sanitizeOtelAttributeValue(value));
  }

  return Array.from(pairs, ([key, value]) => `${key}=${value}`).join(",");
}

function sanitizeOtelAttributeValue(value: string): string {
  return value.replace(/[=,\n\r]/g, "_");
}

export interface AgentResultUsageOptions {
  /** Model used for this Agent SDK query when the result lacks per-model usage. */
  fallbackModel?: string;
}

export function usageFromAgentResult(
  result: SDKResultMessage,
  options: AgentResultUsageOptions = {},
): TokenUsage {
  // Agent SDK cost fields are SDK-provided estimates for the completed query.
  const modelUsageEntries = Object.entries(
    (result.modelUsage ?? {}) as Record<string, ModelUsage>,
  );
  if (modelUsageEntries.length > 0) {
    const modelUsage = modelUsageEntries.map((entry) => entry[1]);
    const hasPerModelCost = modelUsage.every(
      (u) => typeof u.costUSD === "number",
    );
    const totals = modelUsage.reduce<TokenUsage>(
      (acc, u) => ({
        inputTokens: acc.inputTokens + (u.inputTokens ?? 0),
        outputTokens: acc.outputTokens + (u.outputTokens ?? 0),
        cacheReadTokens: acc.cacheReadTokens + (u.cacheReadInputTokens ?? 0),
        cacheCreationTokens:
          acc.cacheCreationTokens + (u.cacheCreationInputTokens ?? 0),
        costUsd: acc.costUsd + (u.costUSD ?? 0),
      }),
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
      },
    );
    const usage = {
      ...totals,
      costUsd: hasPerModelCost ? totals.costUsd : (result.total_cost_usd ?? 0),
    };
    return withAgentSdkPromptCacheEconomics(
      usage,
      agentSdkUncachedCostUsd(modelUsageEntries, options.fallbackModel),
    );
  }

  const rawUsage = (result.usage ?? {}) as unknown as Record<
    string,
    number | undefined
  >;
  const usage = {
    inputTokens: rawUsage.input_tokens ?? rawUsage.inputTokens ?? 0,
    outputTokens: rawUsage.output_tokens ?? rawUsage.outputTokens ?? 0,
    cacheReadTokens:
      rawUsage.cache_read_input_tokens ?? rawUsage.cacheReadInputTokens ?? 0,
    cacheCreationTokens:
      rawUsage.cache_creation_input_tokens ??
      rawUsage.cacheCreationInputTokens ??
      0,
    costUsd: result.total_cost_usd ?? 0,
  };
  return withAgentSdkPromptCacheEconomics(
    usage,
    usage.cacheReadTokens > 0
      ? agentSdkUncachedCostUsdFromUsage(usage, options.fallbackModel)
      : undefined,
  );
}

function agentSdkUncachedCostUsd(
  modelUsageEntries: Array<[string, ModelUsage]>,
  fallbackModel?: string,
): number | undefined {
  const hasCacheRead = modelUsageEntries.some(
    ([, usage]) => (usage.cacheReadInputTokens ?? 0) > 0,
  );
  if (!hasCacheRead) return undefined;

  let total = 0;
  for (const [model, usage] of modelUsageEntries) {
    const uncached = agentSdkUncachedCostUsdFromUsageWithFallbacks(
      tokenUsageFromAgentModelUsage(usage),
      [model, fallbackModel],
    );
    if (uncached === undefined) return undefined;
    total += uncached;
  }
  return total;
}

function tokenUsageFromAgentModelUsage(usage: ModelUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.cacheReadInputTokens ?? 0,
    cacheCreationTokens: usage.cacheCreationInputTokens ?? 0,
    costUsd: usage.costUSD ?? 0,
  };
}

function agentSdkUncachedCostUsdFromUsage(
  usage: Pick<
    TokenUsage,
    "cacheCreationTokens" | "cacheReadTokens" | "inputTokens" | "outputTokens"
  >,
  model?: string,
): number | undefined {
  if (!model) return undefined;
  try {
    return estimateUncachedClaudeCostUsd(model, {
      inputTokens:
        usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens,
      outputTokens: usage.outputTokens,
    });
  } catch {
    return undefined;
  }
}

function agentSdkUncachedCostUsdFromUsageWithFallbacks(
  usage: Pick<
    TokenUsage,
    "cacheCreationTokens" | "cacheReadTokens" | "inputTokens" | "outputTokens"
  >,
  models: Array<string | undefined>,
): number | undefined {
  for (const model of models) {
    const uncached = agentSdkUncachedCostUsdFromUsage(usage, model);
    if (uncached !== undefined) return uncached;
  }
  return undefined;
}

function withAgentSdkPromptCacheEconomics(
  usage: TokenUsage,
  uncachedCostUsd: number | undefined,
): TokenUsage {
  return uncachedCostUsd === undefined
    ? usage
    : withPromptCacheEconomics(usage, uncachedCostUsd);
}

async function callOpenAIStructured<T>(
  args: StructuredCallArgs<T>,
): Promise<StructuredCallResult<T>> {
  assertKnownDirectApiPricing("openai", args.model);
  const client = getOpenAI();
  const jsonSchema = toJsonSchema(args.schema);
  const metadata = structuredCallMetadata(args);

  const response = await client.chat.completions.create(
    {
      model: args.model,
      max_completion_tokens: args.maxTokens ?? 2048,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: promptText(args.userPrompt) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: args.schemaName,
          description: args.schemaDescription,
          schema: jsonSchema as Record<string, unknown>,
          strict: true,
        },
      },
    },
    { signal: args.signal },
  );

  const usage = estimateOpenAIChatUsage(args.model, response.usage);
  assertStructuredBudget(args, usage);
  const content = response.choices[0]?.message?.content;
  const responseMetadata = {
    ...metadata,
    finishReason: response.choices[0]?.finish_reason ?? undefined,
    ...(openAIResponseTruncated(response.choices[0]?.finish_reason)
      ? { truncated: true }
      : {}),
  };
  if (!content) {
    return {
      metadata: responseMetadata,
      output: undefined,
      usage,
      rawJson: null,
      schemaValid: false,
      parseError: structuredParseError(
        responseMetadata.finishReason,
        "empty completion",
      ),
    };
  }

  let json: unknown;
  try {
    json = normalizeStructuredRawJson(JSON.parse(content));
  } catch (err) {
    return {
      metadata: responseMetadata,
      output: undefined,
      usage,
      rawJson: content,
      schemaValid: false,
      parseError: structuredParseError(
        responseMetadata.finishReason,
        `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      ),
    };
  }

  const parsed = args.schema.safeParse(json);
  if (parsed.success) {
    return {
      metadata: responseMetadata,
      output: parsed.data,
      usage,
      rawJson: json,
      schemaValid: true,
    };
  }
  return {
    metadata: responseMetadata,
    output: undefined,
    usage,
    rawJson: json,
    schemaValid: false,
    parseError: structuredParseError(
      responseMetadata.finishReason,
      parsed.error.message,
    ),
  };
}

function structuredCallMetadata<T>(
  args: StructuredCallArgs<T>,
  sentEffort?: ClaudeEffort,
): StructuredCallMetadata {
  return {
    model: args.model,
    maxBudgetUsd: args.maxBudgetUsd,
    outputMode: "json_schema",
    provider: args.provider,
    requestedEffort: args.effort,
    schemaName: args.schemaName,
    sentEffort,
  };
}

function structuredParseError(
  finishReason: string | undefined,
  detail: string,
): string {
  return finishReason ? `finish_reason=${finishReason}; ${detail}` : detail;
}

function claudeResponseTruncated(finishReason: string | undefined): boolean {
  return finishReason === "max_tokens";
}

function openAIResponseTruncated(finishReason: string | undefined): boolean {
  return finishReason === "length";
}

function assertStructuredBudget<T>(
  args: StructuredCallArgs<T>,
  usage: TokenUsage,
): void {
  if (args.maxBudgetUsd === undefined) return;
  if (usage.costUsd <= args.maxBudgetUsd) return;
  throw new Error(
    `Structured ${args.provider} call exceeded budget for ${args.schemaName}: $${usage.costUsd.toFixed(6)} > $${args.maxBudgetUsd.toFixed(6)}`,
  );
}

function sumStructuredUsage(first: TokenUsage, second: TokenUsage): TokenUsage {
  return sumUsage([first, second]);
}

function supportedClaudeEffort(
  model: string,
  effort: ClaudeEffort | undefined,
): ClaudeEffort | undefined {
  if (!effort) return undefined;
  return claudeModelSupportsEffort(model, effort) ? effort : undefined;
}

export function normalizeStructuredRawJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parsed = tryParseJson(value);
  if (parsed !== undefined) return normalizeStructuredRawJson(parsed);

  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (!fenced) return value;
  const fencedParsed = tryParseJson(fenced);
  return fencedParsed === undefined
    ? value
    : normalizeStructuredRawJson(fencedParsed);
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, {
    target: "draft-07",
    unrepresentable: "any",
    cycles: "throw",
    reused: "inline",
  }) as Record<string, unknown>;

  const jsonSchema = { ...generated };
  delete jsonSchema["$schema"];
  return jsonSchema;
}

export function claudeStructuredOutputSchema(
  schema: z.ZodType,
): Record<string, unknown> {
  return sanitizeClaudeJsonSchema(toJsonSchema(schema)) as Record<
    string,
    unknown
  >;
}

const CLAUDE_DESCRIPTION_CONSTRAINTS = new Set([
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "pattern",
  "uniqueItems",
]);

function sanitizeClaudeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeClaudeJsonSchema(item));
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const constraints: string[] = [];
  for (const [key, item] of Object.entries(record)) {
    if (CLAUDE_DESCRIPTION_CONSTRAINTS.has(key)) {
      constraints.push(describeJsonSchemaConstraint(key, item));
      continue;
    }
    out[key] = sanitizeClaudeJsonSchema(item);
  }

  if (constraints.length > 0) {
    const base =
      typeof out.description === "string" && out.description.trim()
        ? out.description.trim()
        : "";
    out.description = [base, `Constraints: ${constraints.join("; ")}.`]
      .filter(Boolean)
      .join(" ");
  }

  return out;
}

function describeJsonSchemaConstraint(key: string, value: unknown): string {
  return `${key}=${String(value)}`;
}
