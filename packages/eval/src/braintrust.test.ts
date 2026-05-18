import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenUsage } from "@novamind/shared";
import type { EvalResult } from "./runner";

const logMock = vi.hoisted(() => vi.fn());
const summarizeMock = vi.hoisted(() => vi.fn());
const initMock = vi.hoisted(() =>
  vi.fn(() => ({ log: logMock, summarize: summarizeMock })),
);

vi.mock("braintrust", () => ({
  init: initMock,
}));

import { uploadEvalResult } from "./braintrust";

const usage: TokenUsage = {
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0.02,
  inputTokens: 100,
  outputTokens: 20,
};

const result: EvalResult<{ question: string }, { answer: string }> = {
  averageScores: { quality: 0.9 },
  cases: [
    {
      case: {
        id: "case-1",
        input: { question: "What is supported?" },
        label: "Case 1",
      },
      elapsedMs: 123,
      output: { answer: "Supported answer" },
      scores: { quality: 0.9 },
      usage,
    },
  ],
  elapsedMs: 456,
  name: "plan-stability",
  totalUsage: usage,
};

describe("Braintrust upload", () => {
  const originalKey = process.env.BRAINTRUST_API_KEY;

  beforeEach(() => {
    delete process.env.BRAINTRUST_API_KEY;
    initMock.mockClear();
    logMock.mockClear();
    summarizeMock.mockClear();
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.BRAINTRUST_API_KEY;
    } else {
      process.env.BRAINTRUST_API_KEY = originalKey;
    }
  });

  it("is a no-op without a Braintrust API key", async () => {
    await expect(
      uploadEvalResult("plan-stability", result),
    ).resolves.toBeNull();

    expect(initMock).not.toHaveBeenCalled();
  });

  it("logs each eval case and returns the experiment URL", async () => {
    process.env.BRAINTRUST_API_KEY = "test-key";
    summarizeMock.mockResolvedValue({
      experimentUrl: "https://braintrust.dev/app/novamind/experiments/demo",
    });

    const upload = await uploadEvalResult("plan-stability", result, {
      source: "test",
    });

    expect(upload?.experimentName).toMatch(/^plan-stability-/);
    expect(upload?.url).toBe(
      "https://braintrust.dev/app/novamind/experiments/demo",
    );
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          axis: "plan-stability",
          caseCount: 1,
          source: "test",
        }),
        project: "novamind",
      }),
    );
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { question: "What is supported?" },
        metadata: expect.objectContaining({
          caseId: "case-1",
          elapsedMs: 123,
          label: "Case 1",
          usage,
        }),
        output: { answer: "Supported answer" },
        scores: { quality: 0.9 },
      }),
    );
  });
});
