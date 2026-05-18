import { describe, expect, it } from "vitest";
import type { TokenUsage } from "./events";
import { addUsage, sumUsage } from "./usage";

describe("usage helpers", () => {
  it("preserves prompt-cache savings on aggregate usage", () => {
    const total = sumUsage([
      usage({ costUsd: 0.01 }),
      usage({ costUsd: 0.02, cacheSavingsUsd: 0.005 }),
    ]);

    expect(total).toMatchObject({
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.03,
      cacheSavingsUsd: 0.005,
    });
    expect(total.uncachedCostUsd).toBeCloseTo(0.035);
  });

  it("omits display-only cache economics when there are no savings", () => {
    const total = addUsage(usage({ costUsd: 0.01 }), usage({ costUsd: 0.02 }));

    expect(total).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.03,
    });
  });
});

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    ...overrides,
  };
}
