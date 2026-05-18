import type {
  Query,
  SDKMessage,
  SDKUserMessage,
  WarmQuery,
} from "@anthropic-ai/claude-agent-sdk";

export type AgentSdkWarmProfileName = "literature" | "data-viz";

export type AgentSdkRuntimeStatus =
  | "empty"
  | "starting"
  | "ready"
  | "claimed"
  | "failed";

export type AgentSdkRuntimeTimingPhase =
  | "start"
  | "event"
  | "finish"
  | "error"
  | "skip";

export type AgentSdkRuntimeTimingEvent = {
  elapsedMs?: number;
  phase: AgentSdkRuntimeTimingPhase;
  profile: AgentSdkWarmProfileName;
  sdkEvent: string;
  stage: "agent_sdk_runtime";
  [key: string]: unknown;
};

export type AgentSdkRuntimeTimingSink = (
  event: AgentSdkRuntimeTimingEvent,
) => void;

export interface StartedWarmProfile<RunContext> {
  bind(runContext: RunContext): void;
  clear(): void;
  warmQuery: WarmQuery;
}

export interface AgentSdkWarmProfileDefinition<RunContext> {
  name: AgentSdkWarmProfileName;
  startWarmQuery(args: {
    abortController: AbortController;
    onTiming?: AgentSdkRuntimeTimingSink;
  }): Promise<StartedWarmProfile<RunContext>>;
}

export interface EnsureWarmProfileOptions {
  onTiming?: AgentSdkRuntimeTimingSink;
  reason?: string;
  waitForReady?: boolean;
}

export interface ClaimWarmProfileOptions {
  liveAbortController?: AbortController;
  maxStartupWaitMs?: number;
  onTiming?: AgentSdkRuntimeTimingSink;
  replenishOnFinish?: boolean;
}

export interface AgentSdkRuntimeProfileStatus {
  ageMs?: number;
  error?: string;
  generation: number;
  profile: AgentSdkWarmProfileName;
  status: AgentSdkRuntimeStatus;
}

type EmptyState = {
  generation: number;
  status: "empty";
};

type StartingState<RunContext> = {
  abortController: AbortController;
  generation: number;
  promise: Promise<void>;
  startedAt: number;
  status: "starting";
  target?: StartedWarmProfile<RunContext>;
};

type ReadyState<RunContext> = {
  abortController: AbortController;
  generation: number;
  readyAt: number;
  startedAt: number;
  status: "ready";
  target: StartedWarmProfile<RunContext>;
};

type ClaimedState = {
  claimedAt: number;
  generation: number;
  status: "claimed";
};

type FailedState = {
  error: string;
  failedAt: number;
  generation: number;
  status: "failed";
};

type ProfileState<RunContext = unknown> =
  | EmptyState
  | StartingState<RunContext>
  | ReadyState<RunContext>
  | ClaimedState
  | FailedState;

const DEFAULT_LIVE_STARTUP_WAIT_MS = 2_000;

export class AgentSdkRuntimeManager {
  private states = new Map<AgentSdkWarmProfileName, ProfileState>();
  private generations = new Map<AgentSdkWarmProfileName, number>();
  private startupQueue: Promise<void> = Promise.resolve();

  ensureWarmProfile<RunContext>(
    definition: AgentSdkWarmProfileDefinition<RunContext>,
    opts: EnsureWarmProfileOptions = {},
  ): Promise<AgentSdkRuntimeProfileStatus> {
    const current = this.state(definition.name);
    if (current.status === "ready") {
      emitRuntimeTiming(opts.onTiming, definition.name, "skip", {
        generation: current.generation,
        reason: opts.reason,
        sdkEvent: "startup_skipped_ready",
      });
      return Promise.resolve(this.profileStatus(definition.name));
    }
    if (current.status === "starting") {
      emitRuntimeTiming(opts.onTiming, definition.name, "event", {
        generation: current.generation,
        reason: opts.reason,
        sdkEvent: "startup_joined",
      });
      return opts.waitForReady
        ? current.promise
            .catch(() => undefined)
            .then(() => this.profileStatus(definition.name))
        : Promise.resolve(this.profileStatus(definition.name));
    }
    if (current.status === "claimed") {
      emitRuntimeTiming(opts.onTiming, definition.name, "skip", {
        generation: current.generation,
        reason: opts.reason,
        sdkEvent: "startup_skipped_claimed",
      });
      return Promise.resolve(this.profileStatus(definition.name));
    }

    const starting = this.startProfile(definition, opts);
    return opts.waitForReady
      ? starting.promise
          .catch(() => undefined)
          .then(() => this.profileStatus(definition.name))
      : Promise.resolve(this.profileStatus(definition.name));
  }

  async ensureWarmProfiles(
    definitions: readonly AgentSdkWarmProfileDefinition<unknown>[],
    opts: EnsureWarmProfileOptions = {},
  ): Promise<AgentSdkRuntimeProfileStatus[]> {
    const runSequentially = async () => {
      const statuses: AgentSdkRuntimeProfileStatus[] = [];
      for (const definition of definitions) {
        statuses.push(
          await this.ensureWarmProfile(definition, {
            ...opts,
            waitForReady: true,
          }),
        );
      }
      return statuses;
    };

    if (!opts.waitForReady) {
      void runSequentially();
      return this.status();
    }

    return runSequentially();
  }

  async claimWarmProfile<RunContext>(
    definition: AgentSdkWarmProfileDefinition<RunContext>,
    runContext: RunContext,
    opts: ClaimWarmProfileOptions = {},
  ): Promise<AgentSdkWarmProfileClaim | null> {
    const maxStartupWaitMs =
      opts.maxStartupWaitMs ?? DEFAULT_LIVE_STARTUP_WAIT_MS;
    let current = this.state<RunContext>(definition.name);

    if (current.status === "starting") {
      emitRuntimeTiming(opts.onTiming, definition.name, "event", {
        generation: current.generation,
        sdkEvent: "startup_wait_for_live_run",
        waitMs: maxStartupWaitMs,
      });
      await waitForStartupOrTimeout(current.promise, maxStartupWaitMs);
      current = this.state(definition.name);
      if (current.status === "starting") {
        this.abortStartingProfile(
          definition.name,
          "live_run_started",
          opts.onTiming,
        );
        return null;
      }
    }

    if (current.status !== "ready") {
      emitRuntimeTiming(opts.onTiming, definition.name, "skip", {
        sdkEvent: "warm_claim_unavailable",
        status: current.status,
      });
      return null;
    }

    current.target.bind(runContext);
    const claimController = current.abortController;
    const detachLiveAbort = linkAbortControllers(
      opts.liveAbortController,
      claimController,
    );
    this.states.set(definition.name, {
      claimedAt: Date.now(),
      generation: current.generation,
      status: "claimed",
    });
    emitRuntimeTiming(opts.onTiming, definition.name, "event", {
      generation: current.generation,
      sdkEvent: "warm_claimed",
    });
    return new AgentSdkWarmProfileClaim({
      definition,
      generation: current.generation,
      manager: this,
      onTiming: opts.onTiming,
      replenishOnFinish: opts.replenishOnFinish ?? true,
      target: current.target,
      warmQuery: current.target.warmQuery,
      detachLiveAbort,
      abortController: claimController,
    });
  }

  status(): AgentSdkRuntimeProfileStatus[] {
    return (["literature", "data-viz"] satisfies AgentSdkWarmProfileName[]).map(
      (profile) => this.profileStatus(profile),
    );
  }

  private startProfile<RunContext>(
    definition: AgentSdkWarmProfileDefinition<RunContext>,
    opts: EnsureWarmProfileOptions,
  ): StartingState<RunContext> {
    const generation = this.nextGeneration(definition.name);
    const abortController = new AbortController();
    const startedAt = Date.now();
    const state: StartingState<RunContext> = {
      abortController,
      generation,
      promise: Promise.resolve(),
      startedAt,
      status: "starting",
    };
    this.states.set(definition.name, state);
    const priorStartup = this.startupQueue.catch(() => undefined);
    const promise = (async () => {
      await priorStartup;
      if (
        abortController.signal.aborted ||
        this.state(definition.name) !== state
      ) {
        return;
      }
      emitRuntimeTiming(opts.onTiming, definition.name, "start", {
        generation,
        reason: opts.reason,
        sdkEvent: "startup_started",
      });
      try {
        const target = await definition.startWarmQuery({
          abortController,
          onTiming: opts.onTiming,
        });
        state.target = target;
        const latest = this.state(definition.name);
        if (latest !== state) {
          target.clear();
          target.warmQuery.close();
          return;
        }
        this.states.set(definition.name, {
          abortController,
          generation,
          readyAt: Date.now(),
          startedAt,
          status: "ready",
          target,
        });
        emitRuntimeTiming(opts.onTiming, definition.name, "finish", {
          elapsedMs: Date.now() - startedAt,
          generation,
          reason: opts.reason,
          sdkEvent: "startup_ready",
        });
      } catch (err) {
        const latest = this.state(definition.name);
        const message = err instanceof Error ? err.message : String(err);
        if (latest === state) {
          this.states.set(definition.name, {
            error: message,
            failedAt: Date.now(),
            generation,
            status: "failed",
          });
        }
        emitRuntimeTiming(opts.onTiming, definition.name, "error", {
          elapsedMs: Date.now() - startedAt,
          error: message,
          generation,
          reason: opts.reason,
          sdkEvent: abortController.signal.aborted
            ? "startup_aborted"
            : "startup_failed",
        });
        throw err;
      }
    })();
    state.promise = promise;
    this.startupQueue = promise.catch(() => undefined);
    promise.catch(() => undefined);
    return state;
  }

  private abortStartingProfile(
    profile: AgentSdkWarmProfileName,
    reason: string,
    onTiming?: AgentSdkRuntimeTimingSink,
  ): void {
    const current = this.state(profile);
    if (current.status !== "starting") return;
    current.abortController.abort();
    this.states.set(profile, {
      generation: current.generation,
      status: "empty",
    });
    emitRuntimeTiming(onTiming, profile, "event", {
      generation: current.generation,
      reason,
      sdkEvent: "startup_aborted_for_live_run",
    });
  }

  finishClaim<RunContext>(
    definition: AgentSdkWarmProfileDefinition<RunContext>,
    generation: number,
    opts: {
      onTiming?: AgentSdkRuntimeTimingSink;
      replenish: boolean;
      target: StartedWarmProfile<RunContext>;
    },
  ): void {
    opts.target.clear();
    const current = this.state(definition.name);
    if (current.status === "claimed" && current.generation === generation) {
      this.states.set(definition.name, { generation, status: "empty" });
    }
    emitRuntimeTiming(opts.onTiming, definition.name, "event", {
      generation,
      replenish: opts.replenish,
      sdkEvent: "warm_released",
    });
    if (opts.replenish) {
      void this.ensureWarmProfile(definition, {
        onTiming: opts.onTiming,
        reason: "replenish_after_live_run",
      });
    }
  }

  private nextGeneration(profile: AgentSdkWarmProfileName): number {
    const next = (this.generations.get(profile) ?? 0) + 1;
    this.generations.set(profile, next);
    return next;
  }

  private state<RunContext>(
    profile: AgentSdkWarmProfileName,
  ): ProfileState<RunContext> {
    return (
      (this.states.get(profile) as ProfileState<RunContext> | undefined) ?? {
        generation: this.generations.get(profile) ?? 0,
        status: "empty",
      }
    );
  }

  private profileStatus(
    profile: AgentSdkWarmProfileName,
  ): AgentSdkRuntimeProfileStatus {
    const state = this.state(profile);
    const now = Date.now();
    switch (state.status) {
      case "starting":
        return {
          ageMs: now - state.startedAt,
          generation: state.generation,
          profile,
          status: state.status,
        };
      case "ready":
        return {
          ageMs: now - state.readyAt,
          generation: state.generation,
          profile,
          status: state.status,
        };
      case "claimed":
        return {
          ageMs: now - state.claimedAt,
          generation: state.generation,
          profile,
          status: state.status,
        };
      case "failed":
        return {
          ageMs: now - state.failedAt,
          error: state.error,
          generation: state.generation,
          profile,
          status: state.status,
        };
      case "empty":
        return {
          generation: state.generation,
          profile,
          status: state.status,
        };
    }
  }
}

export class AgentSdkWarmProfileClaim {
  private activeQuery: Query | undefined;
  private closed = false;
  private released = false;

  constructor(
    private readonly args: {
      abortController: AbortController;
      definition: AgentSdkWarmProfileDefinition<unknown>;
      detachLiveAbort: () => void;
      generation: number;
      manager: AgentSdkRuntimeManager;
      onTiming?: AgentSdkRuntimeTimingSink;
      replenishOnFinish: boolean;
      target: StartedWarmProfile<unknown>;
      warmQuery: WarmQuery;
    },
  ) {}

  get abortController(): AbortController {
    return this.args.abortController;
  }

  query(prompt: string | AsyncIterable<SDKUserMessage>): Query {
    if (this.activeQuery) {
      throw new Error("Warm profile claim query can only be started once.");
    }
    this.activeQuery = this.args.warmQuery.query(prompt);
    return this.activeQuery;
  }

  abort(): void {
    if (!this.args.abortController.signal.aborted) {
      this.args.abortController.abort();
    }
    this.closeQuery();
  }

  finish(opts: { replenish?: boolean } = {}): void {
    if (this.released) return;
    this.released = true;
    this.args.detachLiveAbort();
    this.closeQuery();
    this.args.manager.finishClaim(this.args.definition, this.args.generation, {
      onTiming: this.args.onTiming,
      replenish: opts.replenish ?? this.args.replenishOnFinish,
      target: this.args.target,
    });
  }

  private closeQuery(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.activeQuery) this.activeQuery.close();
    else this.args.warmQuery.close();
  }
}

export class AgentSdkMessageTimeoutError extends Error {
  constructor(
    message: string,
    readonly timeoutKind: "first_message" | "idle",
  ) {
    super(message);
    this.name = "AgentSdkMessageTimeoutError";
  }
}

export async function* withAgentSdkMessageTimeouts<
  Message extends SDKMessage = SDKMessage,
>(
  source: AsyncIterable<Message>,
  opts: {
    firstMessageTimeoutMs: number;
    idleTimeoutMs?: number;
    onTimeout?: (err: AgentSdkMessageTimeoutError) => void;
    profile: AgentSdkWarmProfileName;
    stopSignal?: AbortSignal;
  },
): AsyncIterable<Message> {
  const iterator = source[Symbol.asyncIterator]();
  let messageCount = 0;
  try {
    for (;;) {
      const timeoutKind = messageCount === 0 ? "first_message" : "idle";
      const timeoutMs =
        timeoutKind === "first_message"
          ? opts.firstMessageTimeoutMs
          : opts.idleTimeoutMs;
      let next: IteratorResult<Message>;
      try {
        next =
          timeoutMs !== undefined || opts.stopSignal
            ? await nextWithTimeout(
                iterator.next(),
                timeoutMs,
                timeoutKind,
                opts.profile,
                opts.stopSignal,
              )
            : await iterator.next();
      } catch (err) {
        if (err instanceof AgentSdkMessageTimeoutError) {
          opts.onTimeout?.(err);
        }
        throw err;
      }
      if (next.done) break;
      messageCount += 1;
      yield next.value;
    }
  } finally {
    await iterator.return?.();
  }
}

const agentSdkRuntimeManager = new AgentSdkRuntimeManager();

export function getAgentSdkRuntimeManager(): AgentSdkRuntimeManager {
  return agentSdkRuntimeManager;
}

async function waitForStartupOrTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function nextWithTimeout<Message>(
  promise: Promise<IteratorResult<Message>>,
  timeoutMs: number | undefined,
  timeoutKind: "first_message" | "idle",
  profile: AgentSdkWarmProfileName,
  stopSignal?: AbortSignal,
): Promise<IteratorResult<Message>> {
  return new Promise<IteratorResult<Message>>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      stopSignal?.removeEventListener("abort", stop);
    };
    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      return true;
    };
    const resolveOnce = (value: IteratorResult<Message>) => {
      if (!settle()) return;
      resolve(value);
    };
    const rejectOnce = (err: Error) => {
      if (!settle()) return;
      reject(err);
    };
    const stop = () => {
      const err = new Error(`Claude Agent SDK ${profile} stream was stopped.`);
      err.name = "AbortError";
      rejectOnce(err);
    };

    if (stopSignal?.aborted) {
      stop();
      return;
    }

    promise.then(
      (value) => resolveOnce(value),
      (err) => rejectOnce(err instanceof Error ? err : new Error(String(err))),
    );
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        rejectOnce(
          new AgentSdkMessageTimeoutError(
            `Claude Agent SDK ${profile} ${timeoutKind.replace("_", " ")} timed out after ${timeoutMs}ms.`,
            timeoutKind,
          ),
        );
      }, timeoutMs);
    }
    stopSignal?.addEventListener("abort", stop, { once: true });
  });
}

function linkAbortControllers(
  source: AbortController | undefined,
  target: AbortController,
): () => void {
  if (!source) return () => undefined;
  if (source.signal.aborted) {
    target.abort();
    return () => undefined;
  }
  const abort = () => target.abort();
  source.signal.addEventListener("abort", abort, { once: true });
  return () => source.signal.removeEventListener("abort", abort);
}

function emitRuntimeTiming(
  sink: AgentSdkRuntimeTimingSink | undefined,
  profile: AgentSdkWarmProfileName,
  phase: AgentSdkRuntimeTimingEvent["phase"],
  fields: Omit<
    Partial<AgentSdkRuntimeTimingEvent>,
    "phase" | "profile" | "stage"
  >,
): void {
  sink?.({
    ...fields,
    phase,
    profile,
    stage: "agent_sdk_runtime",
  } as AgentSdkRuntimeTimingEvent);
}
