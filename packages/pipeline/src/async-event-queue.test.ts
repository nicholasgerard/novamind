import { describe, expect, it } from "vitest";
import { AsyncEventQueue } from "./async-event-queue";

describe("AsyncEventQueue", () => {
  it("yields queued events in order", async () => {
    const queue = new AsyncEventQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.finish();

    const seen: number[] = [];
    for await (const item of queue) seen.push(item);

    expect(seen).toEqual([1, 2]);
  });

  it("fails fast when the producer exceeds the configured buffer", async () => {
    const queue = new AsyncEventQueue<number>({
      label: "test queue",
      maxBuffer: 1,
    });
    queue.push(1);

    expect(() => queue.push(2)).toThrow(
      "test queue exceeded its buffer limit.",
    );
    await expect(queue[Symbol.asyncIterator]().next()).rejects.toThrow(
      "test queue exceeded its buffer limit.",
    );
  });
});
