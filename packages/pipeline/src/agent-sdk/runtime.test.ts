import { describe, expect, it, vi } from "vitest";
import type {
  Query,
  SDKMessage,
  WarmQuery,
} from "@anthropic-ai/claude-agent-sdk";
import {
  AgentSdkMessageTimeoutError,
  AgentSdkRuntimeManager,
  withAgentSdkMessageTimeouts,
  type AgentSdkWarmProfileDefinition,
  type StartedWarmProfile,
} from "./runtime";

interface TestRunContext {
  id: string;
}

describe("AgentSdkRuntimeManager", () => {
  it("single-flights repeated startup requests for the same profile", async () => {
    const manager = new AgentSdkRuntimeManager();
    let resolveStart:
      | ((target: StartedWarmProfile<TestRunContext>) => void)
      | undefined;
    const target = fakeStartedWarmProfile<TestRunContext>();
    const profile: AgentSdkWarmProfileDefinition<TestRunContext> = {
      name: "literature",
      startWarmQuery: vi.fn<
        AgentSdkWarmProfileDefinition<TestRunContext>["startWarmQuery"]
      >(
        () =>
          new Promise<StartedWarmProfile<TestRunContext>>((resolve) => {
            resolveStart = resolve;
          }),
      ),
    };

    const first = manager.ensureWarmProfile(profile, { waitForReady: true });
    const second = manager.ensureWarmProfile(profile, { waitForReady: true });
    await waitForMicrotasks();

    expect(profile.startWarmQuery).toHaveBeenCalledTimes(1);
    resolveStart?.(target);
    await Promise.all([first, second]);

    expect(
      manager.status().find((item) => item.profile === "literature"),
    ).toMatchObject({ status: "ready" });
  });

  it("sequences non-blocking startup requests across profiles", async () => {
    const manager = new AgentSdkRuntimeManager();
    let resolveFirst:
      | ((target: StartedWarmProfile<unknown>) => void)
      | undefined;
    const firstProfile: AgentSdkWarmProfileDefinition<unknown> = {
      name: "literature",
      startWarmQuery: vi.fn(
        () =>
          new Promise<StartedWarmProfile<unknown>>((resolve) => {
            resolveFirst = resolve;
          }),
      ),
    };
    const secondTarget = fakeStartedWarmProfile<unknown>();
    const secondProfile: AgentSdkWarmProfileDefinition<unknown> = {
      name: "data-viz",
      startWarmQuery: vi.fn(async () => secondTarget),
    };

    await manager.ensureWarmProfiles([firstProfile, secondProfile], {
      waitForReady: false,
    });
    await waitForMicrotasks();

    expect(firstProfile.startWarmQuery).toHaveBeenCalledTimes(1);
    expect(secondProfile.startWarmQuery).not.toHaveBeenCalled();

    resolveFirst?.(fakeStartedWarmProfile<unknown>());
    await waitForMicrotasks();

    expect(secondProfile.startWarmQuery).toHaveBeenCalledTimes(1);
  });

  it("serializes direct startup calls across profiles", async () => {
    const manager = new AgentSdkRuntimeManager();
    let resolveFirst:
      | ((target: StartedWarmProfile<unknown>) => void)
      | undefined;
    const firstProfile: AgentSdkWarmProfileDefinition<unknown> = {
      name: "literature",
      startWarmQuery: vi.fn(
        () =>
          new Promise<StartedWarmProfile<unknown>>((resolve) => {
            resolveFirst = resolve;
          }),
      ),
    };
    const secondProfile: AgentSdkWarmProfileDefinition<unknown> = {
      name: "data-viz",
      startWarmQuery: vi.fn(async () => fakeStartedWarmProfile<unknown>()),
    };

    void manager.ensureWarmProfile(firstProfile);
    void manager.ensureWarmProfile(secondProfile);
    await waitForMicrotasks();

    expect(firstProfile.startWarmQuery).toHaveBeenCalledTimes(1);
    expect(secondProfile.startWarmQuery).not.toHaveBeenCalled();

    resolveFirst?.(fakeStartedWarmProfile<unknown>());
    await waitForMicrotasks();

    expect(secondProfile.startWarmQuery).toHaveBeenCalledTimes(1);
  });

  it("claims a ready warm profile once and clears its bound context on finish", async () => {
    const manager = new AgentSdkRuntimeManager();
    const target = fakeStartedWarmProfile<TestRunContext>();
    const profile: AgentSdkWarmProfileDefinition<TestRunContext> = {
      name: "literature",
      startWarmQuery: vi.fn(async () => target),
    };
    await manager.ensureWarmProfile(profile, { waitForReady: true });

    const claim = await manager.claimWarmProfile(profile, { id: "run-1" });

    expect(claim).not.toBeNull();
    expect(target.bind).toHaveBeenCalledWith({ id: "run-1" });
    claim?.query("Run now");
    claim?.finish({ replenish: false });
    expect(target.clear).toHaveBeenCalledTimes(1);
    expect(
      manager.status().find((item) => item.profile === "literature"),
    ).toMatchObject({ status: "empty" });
  });

  it("closes an unused warm query when a claim is released before query start", async () => {
    const manager = new AgentSdkRuntimeManager();
    const target = fakeStartedWarmProfile<TestRunContext>();
    const profile: AgentSdkWarmProfileDefinition<TestRunContext> = {
      name: "literature",
      startWarmQuery: vi.fn(async () => target),
    };
    await manager.ensureWarmProfile(profile, { waitForReady: true });

    const claim = await manager.claimWarmProfile(profile, { id: "run-1" });
    claim?.finish({ replenish: false });

    expect(target.warmQuery.close).toHaveBeenCalledTimes(1);
  });

  it("aborts a startup that blocks a live run beyond the grace window", async () => {
    const manager = new AgentSdkRuntimeManager();
    let startupAborted = false;
    const profile: AgentSdkWarmProfileDefinition<TestRunContext> = {
      name: "data-viz",
      startWarmQuery: vi.fn<
        AgentSdkWarmProfileDefinition<TestRunContext>["startWarmQuery"]
      >(
        ({ abortController }) =>
          new Promise<StartedWarmProfile<TestRunContext>>((resolve) => {
            abortController.signal.addEventListener("abort", () => {
              startupAborted = true;
              resolve(fakeStartedWarmProfile<TestRunContext>());
            });
          }),
      ),
    };
    void manager.ensureWarmProfile(profile);
    await waitForMicrotasks();

    const claim = await manager.claimWarmProfile(
      profile,
      { id: "run-2" },
      { maxStartupWaitMs: 1 },
    );

    expect(claim).toBeNull();
    expect(startupAborted).toBe(true);
  });

  it("records failed state when startup throws before returning a warm query", async () => {
    const manager = new AgentSdkRuntimeManager();
    const profile: AgentSdkWarmProfileDefinition<TestRunContext> = {
      name: "literature",
      startWarmQuery: vi.fn(() => {
        throw new Error("startup exploded");
      }),
    };

    const status = await manager.ensureWarmProfile(profile, {
      waitForReady: true,
    });

    expect(status).toMatchObject({
      error: "startup exploded",
      status: "failed",
    });
  });

  it("reports a first-message timeout when the SDK stream does not start", async () => {
    const onTimeout = vi.fn();
    const source = stalledAsyncIterable<SDKMessage>();

    await expect(
      collectAsync(
        withAgentSdkMessageTimeouts(source, {
          firstMessageTimeoutMs: 1,
          onTimeout,
          profile: "literature",
        }),
      ),
    ).rejects.toBeInstanceOf(AgentSdkMessageTimeoutError);

    expect(onTimeout).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutKind: "first_message" }),
    );
    expect(source.return).toHaveBeenCalledTimes(1);
  });

  it("can stop a stalled SDK stream without waiting for the idle timeout", async () => {
    const onTimeout = vi.fn();
    const stopController = new AbortController();
    const source = stalledAsyncIterable<SDKMessage>();
    const collected = collectAsync(
      withAgentSdkMessageTimeouts(source, {
        firstMessageTimeoutMs: 60_000,
        onTimeout,
        profile: "data-viz",
        stopSignal: stopController.signal,
      }),
    );

    stopController.abort();

    await expect(collected).rejects.toMatchObject({ name: "AbortError" });
    expect(onTimeout).not.toHaveBeenCalled();
    expect(source.return).toHaveBeenCalledTimes(1);
  });
});

function fakeStartedWarmProfile<RunContext>(): StartedWarmProfile<RunContext> {
  return {
    bind: vi.fn(),
    clear: vi.fn(),
    warmQuery: fakeWarmQuery(),
  };
}

function fakeWarmQuery(): WarmQuery {
  const close = vi.fn();
  return {
    query: vi.fn(() => fakeQuery()),
    close,
    async [Symbol.asyncDispose]() {
      close();
    },
  } as unknown as WarmQuery;
}

function fakeQuery(): Query {
  const iterator = (async function* () {})() as Query;
  return Object.assign(iterator, {
    close: vi.fn(),
  }) as Query;
}

async function waitForMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function collectAsync<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

function stalledAsyncIterable<T>(): AsyncIterable<T> & {
  return: (value?: unknown) => Promise<IteratorResult<T>>;
} {
  const returnFn = vi.fn(
    async (): Promise<IteratorResult<T>> => ({
      done: true,
      value: undefined as T,
    }),
  );
  return {
    return: returnFn,
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<T>>(() => undefined),
        return: returnFn,
      };
    },
  };
}
