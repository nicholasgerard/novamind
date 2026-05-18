import type { TokenUsage } from "./events";

/**
 * Identity element for `TokenUsage` accumulation. Use `{ ...ZERO_USAGE }` when
 * starting an accumulator so the shared constant is never mutated.
 */
export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
};

/**
 * Sum a list of `TokenUsage` records into a single total. Used by the
 * pipeline (per tool stage), the eval runner (per case), and the web hook
 * (per streamed case event) so token / cost accounting is consistent.
 */
export function sumUsage(usages: readonly TokenUsage[]): TokenUsage {
  return usages.reduce<TokenUsage>(
    (acc, u) =>
      withOptionalCacheEconomics({
        inputTokens: acc.inputTokens + u.inputTokens,
        outputTokens: acc.outputTokens + u.outputTokens,
        cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
        cacheCreationTokens: acc.cacheCreationTokens + u.cacheCreationTokens,
        costUsd: acc.costUsd + u.costUsd,
        cacheSavingsUsd: sumOptional(acc.cacheSavingsUsd, u.cacheSavingsUsd),
      }),
    { ...ZERO_USAGE },
  );
}

/**
 * Two-argument variant of `sumUsage` for cases where the second operand may
 * be undefined (e.g. an event without usage). Returns `a` unchanged when
 * `b` is undefined.
 */
export function addUsage(a: TokenUsage, b: TokenUsage | undefined): TokenUsage {
  if (!b) return a;
  return withOptionalCacheEconomics({
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    costUsd: a.costUsd + b.costUsd,
    cacheSavingsUsd: sumOptional(a.cacheSavingsUsd, b.cacheSavingsUsd),
  });
}

function sumOptional(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

function withOptionalCacheEconomics(usage: TokenUsage): TokenUsage {
  const cacheSavingsUsd = usage.cacheSavingsUsd;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    costUsd: usage.costUsd,
    ...(cacheSavingsUsd === undefined || cacheSavingsUsd <= 0
      ? {}
      : {
          uncachedCostUsd: usage.costUsd + cacheSavingsUsd,
          cacheSavingsUsd,
        }),
  };
}
