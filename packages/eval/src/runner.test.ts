import { describe, expect, it, vi } from "vitest";
import {
  runEval,
  runEvalEvents,
  type EvalSpec,
  type EvalTaskContext,
} from "./runner";

describe("eval runner", () => {
  it("records per-case task failures without aborting the eval", async () => {
    const spec: EvalSpec<number, number> = {
      name: "failure-handling",
      cases: [
        { id: "ok", input: 2 },
        { id: "bad", input: 4 },
      ],
      task: vi.fn(async (input) => {
        if (input === 4) throw new Error("case failed");
        return { output: input * 2 };
      }),
      scorers: [
        {
          name: "exact",
          score: (_input, output) => (output === 4 ? 1 : 0),
        },
      ],
    };

    const result = await runEval(spec, { concurrency: 2 });

    expect(result.cases.map((item) => item.case.id)).toEqual(["ok", "bad"]);
    expect(result.cases[0]?.scores).toEqual({ exact: 1 });
    expect(result.cases[1]?.error).toBe("case failed");
    expect(result.cases[1]?.scores).toEqual({ exact: 0 });
  });

  it("records per-case timeouts without aborting the eval", async () => {
    const spec: EvalSpec<number, number> = {
      name: "timeout-handling",
      cases: [
        { id: "slow", input: 1 },
        { id: "ok", input: 2 },
      ],
      task: vi.fn(async (input, context) => {
        if (input === 2) return { output: 4 };
        await new Promise((_resolve, reject) => {
          context?.signal?.addEventListener(
            "abort",
            () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            },
            { once: true },
          );
        });
        return { output: 0 };
      }),
      scorers: [
        {
          name: "exact",
          score: (_input, output) => (output === 4 ? 1 : 0),
        },
      ],
    };

    const result = await runEval(spec, {
      caseTimeoutMs: 5,
      concurrency: 2,
    });

    expect(result.cases.map((item) => item.case.id)).toEqual(["slow", "ok"]);
    expect(result.cases[0]?.error).toBe("Eval case timed out after 5ms.");
    expect(result.cases[0]?.scores).toEqual({ exact: 0 });
    expect(result.cases[1]?.scores).toEqual({ exact: 1 });
  });

  it("passes cancellation signals into streaming eval tasks", async () => {
    const controller = new AbortController();
    const task = vi.fn(async (_input: number, context?: EvalTaskContext) => {
      expect(context?.signal).toBe(controller.signal);
      controller.abort();
      return { output: 1 };
    });
    const spec: EvalSpec<number, number> = {
      name: "stream-abort",
      cases: [
        { id: "first", input: 1 },
        { id: "second", input: 2 },
      ],
      task,
      scorers: [{ name: "ok", score: () => 1 }],
    };

    const events = await collectEvents(
      runEvalEvents(spec, { concurrency: 1, signal: controller.signal }),
    );

    expect(task).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual([
      "eval_started",
      "eval_case_started",
    ]);
  });

  it("does not start cases when the eval stream is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn(async () => ({ output: 1 }));
    const spec: EvalSpec<number, number> = {
      name: "pre-aborted",
      cases: [{ id: "first", input: 1 }],
      task,
      scorers: [{ name: "ok", score: () => 1 }],
    };

    const events = await collectEvents(
      runEvalEvents(spec, { signal: controller.signal }),
    );

    expect(task).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["eval_started"]);
  });
});

async function collectEvents<T>(source: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of source) events.push(event);
  return events;
}
