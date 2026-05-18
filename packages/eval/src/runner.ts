import {
  ZERO_USAGE,
  addUsage,
  type EvalStreamEvent,
  type TokenUsage,
} from "@novamind/shared";
import { AsyncEventQueue } from "./async-queue";

export interface EvalCase<I> {
  /** Stable identifier — used for traces and reproducibility. */
  id: string;
  input: I;
  /** Optional human-readable label. */
  label?: string;
}

export interface EvalScorer<I, O> {
  name: string;
  /** Returns a number in [0, 1]. Higher is better. */
  score: (
    input: I,
    output: O,
    context?: EvalTaskContext,
  ) => Promise<number> | number;
}

export interface EvalTaskContext {
  /** Request/SSE cancellation signal propagated to provider calls. */
  signal?: AbortSignal;
  /** Optional per-case timeout. Timeouts fail only the current case. */
  caseTimeoutMs?: number;
}

export interface EvalSpec<I, O> {
  /** Human-readable name (used in console output and trace IDs). */
  name: string;
  cases: ReadonlyArray<EvalCase<I>>;
  task: (
    input: I,
    context?: EvalTaskContext,
  ) => Promise<{ output: O; usage?: TokenUsage }>;
  scorers: ReadonlyArray<EvalScorer<I, O>>;
}

export interface EvalCaseResult<I, O> {
  case: EvalCase<I>;
  output: O;
  usage?: TokenUsage;
  scores: Record<string, number>;
  elapsedMs: number;
  error?: string;
}

export interface EvalResult<I, O> {
  name: string;
  cases: EvalCaseResult<I, O>[];
  averageScores: Record<string, number>;
  totalUsage: TokenUsage;
  elapsedMs: number;
}

export interface RunOptions<I, O> {
  /** Optional per-case timeout in milliseconds. Timed-out cases score 0. */
  caseTimeoutMs?: number;
  /** Number of cases run in parallel. Default 1 (sequential). */
  concurrency?: number;
  /** Called as each case completes. Order matches completion order, not input order. */
  onCase?: (r: EvalCaseResult<I, O>) => void;
  /** Optional cancellation signal, usually owned by an HTTP/SSE request. */
  signal?: AbortSignal;
}

/** Run a single case, capturing scores + errors. Pure function — no side effects. */
async function runOneCase<I, O>(
  c: EvalCase<I>,
  spec: EvalSpec<I, O>,
  context: EvalTaskContext = {},
): Promise<EvalCaseResult<I, O>> {
  const t0 = Date.now();
  const caseAbort = caseAbortContext(context);
  let output: O = undefined as unknown as O;
  let usage: TokenUsage | undefined;
  let error: string | undefined;
  const scores: Record<string, number> = {};

  try {
    throwIfAborted(caseAbort.signal);
    const taskResult = await spec.task(c.input, {
      caseTimeoutMs: context.caseTimeoutMs,
      signal: caseAbort.signal,
    });
    throwIfAborted(caseAbort.signal);
    output = taskResult.output;
    usage = taskResult.usage;
    for (const scorer of spec.scorers) {
      throwIfAborted(caseAbort.signal);
      scores[scorer.name] = await scorer.score(c.input, output, {
        caseTimeoutMs: context.caseTimeoutMs,
        signal: caseAbort.signal,
      });
      throwIfAborted(caseAbort.signal);
    }
  } catch (err) {
    if (context.signal?.aborted) throw err;
    error = caseAbort.timedOut
      ? `Eval case timed out after ${context.caseTimeoutMs}ms.`
      : err instanceof Error
        ? err.message
        : String(err);
    for (const scorer of spec.scorers) scores[scorer.name] = 0;
  } finally {
    caseAbort.cleanup();
  }

  return {
    case: c,
    output,
    usage,
    scores,
    elapsedMs: Date.now() - t0,
    error,
  };
}

function computeAverageScores<I, O>(
  results: ReadonlyArray<EvalCaseResult<I, O>>,
  scorers: EvalSpec<I, O>["scorers"],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const scorer of scorers) {
    const vals = results.map((r) => r.scores[scorer.name] ?? 0);
    out[scorer.name] =
      vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return out;
}

/**
 * Run an eval spec, returning the full result. Cases execute with bounded
 * concurrency (default 1). Failures on individual cases don't abort the run —
 * they're recorded with their error string and contribute 0 to the average.
 *
 * Results are returned in input order regardless of completion order, so
 * downstream consumers can index by case position.
 */
export async function runEval<I, O>(
  spec: EvalSpec<I, O>,
  opts: RunOptions<I, O> = {},
): Promise<EvalResult<I, O>> {
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const t0 = Date.now();
  const cases: Array<EvalCaseResult<I, O> | undefined> = new Array(
    spec.cases.length,
  );
  let totalUsage: TokenUsage = { ...ZERO_USAGE };

  let nextIdx = 0;
  async function worker() {
    while (true) {
      throwIfAborted(opts.signal);
      const idx = nextIdx++;
      if (idx >= spec.cases.length) return;
      const r = await runOneCase(spec.cases[idx]!, spec, {
        caseTimeoutMs: opts.caseTimeoutMs,
        signal: opts.signal,
      });
      cases[idx] = r;
      totalUsage = addUsage(totalUsage, r.usage);
      opts.onCase?.(r);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Every slot was assigned by the worker before it exited.
  const ordered = cases as Array<EvalCaseResult<I, O>>;

  return {
    name: spec.name,
    cases: ordered,
    averageScores: computeAverageScores(ordered, spec.scorers),
    totalUsage,
    elapsedMs: Date.now() - t0,
  };
}

/**
 * Streaming variant of `runEval`. Yields `EvalStreamEvent` records suitable
 * for forwarding over SSE — `eval_started`, per-case `eval_case_started` /
 * `eval_case_complete` (in completion order), final `eval_complete`. On
 * unhandled error, yields a final `eval_error` and closes.
 */
export async function* runEvalEvents<I, O>(
  spec: EvalSpec<I, O>,
  opts: {
    caseTimeoutMs?: number;
    concurrency?: number;
    signal?: AbortSignal;
  } = {},
): AsyncIterable<EvalStreamEvent> {
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const queue = new AsyncEventQueue<EvalStreamEvent>();
  const t0 = Date.now();
  const cases: EvalCaseResult<I, O>[] = [];
  let totalUsage: TokenUsage = { ...ZERO_USAGE };

  queue.push({
    type: "eval_started",
    axis: spec.name,
    caseCount: spec.cases.length,
    concurrency,
    ts: Date.now(),
  });

  const work = (async () => {
    let nextIdx = 0;
    async function worker() {
      while (true) {
        throwIfAborted(opts.signal);
        const idx = nextIdx++;
        if (idx >= spec.cases.length) return;
        const c = spec.cases[idx]!;
        queue.push({
          type: "eval_case_started",
          caseId: c.id,
          caseIndex: idx,
          label: c.label,
          ts: Date.now(),
        });
        const r = await runOneCase(c, spec, {
          caseTimeoutMs: opts.caseTimeoutMs,
          signal: opts.signal,
        });
        throwIfAborted(opts.signal);
        cases.push(r);
        totalUsage = addUsage(totalUsage, r.usage);
        queue.push({
          type: "eval_case_complete",
          caseId: c.id,
          caseIndex: idx,
          scores: r.scores,
          output: r.output,
          usage: r.usage,
          elapsedMs: r.elapsedMs,
          error: r.error,
          ts: Date.now(),
        });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    throwIfAborted(opts.signal);
    queue.push({
      type: "eval_complete",
      averageScores: computeAverageScores(cases, spec.scorers),
      totalUsage,
      elapsedMs: Date.now() - t0,
      ts: Date.now(),
    });
    queue.finish();
  })().catch((err) => {
    if (isAbortError(err)) {
      queue.finish();
      return;
    }
    queue.push({
      type: "eval_error",
      message: err instanceof Error ? err.message : String(err),
      ts: Date.now(),
    });
    queue.finish();
  });

  for await (const event of queue) yield event;
  await work;
}

function caseAbortContext(context: EvalTaskContext): {
  cleanup: () => void;
  signal: AbortSignal | undefined;
  timedOut: boolean;
} {
  if (context.caseTimeoutMs === undefined) {
    return {
      cleanup: () => undefined,
      signal: context.signal,
      timedOut: false,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  if (context.signal?.aborted) {
    abortFromParent();
  } else {
    context.signal?.addEventListener("abort", abortFromParent, {
      once: true,
    });
  }

  timer = setTimeout(() => {
    timedOut = true;
    if (!controller.signal.aborted) controller.abort();
  }, context.caseTimeoutMs);

  return {
    cleanup: () => {
      if (timer) clearTimeout(timer);
      context.signal?.removeEventListener("abort", abortFromParent);
    },
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw abortError("Eval run aborted.");
}

function abortError(message: string): Error {
  const err = new Error(message);
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
