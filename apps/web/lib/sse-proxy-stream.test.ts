import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSseProxyStream,
  type SseProxyStreamStats,
} from "./sse-proxy-stream";

describe("createSseProxyStream", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the downstream SSE response active while upstream is quiet", async () => {
    vi.useFakeTimers();
    let upstreamController!: ReadableStreamDefaultController<Uint8Array>;
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        upstreamController = controller;
      },
    });
    const heartbeats: SseProxyStreamStats[] = [];
    const records: Array<{ index: number; type: unknown }> = [];
    const completions: SseProxyStreamStats[] = [];

    const downstream = createSseProxyStream(upstream, {
      heartbeatMs: 5,
      onComplete: (stats) => completions.push(stats),
      onHeartbeat: (stats) => heartbeats.push(stats),
      onSseRecord: (record, index) =>
        records.push({ index, type: record.type }),
    });
    const reader = downstream.getReader();

    const heartbeatRead = reader.read();
    await vi.advanceTimersByTimeAsync(5);
    const heartbeat = await heartbeatRead;
    expect(heartbeat.done).toBe(false);
    expect(decoder.decode(heartbeat.value)).toMatch(/^: proxy heartbeat \d+/);
    expect(heartbeats).toEqual([
      expect.objectContaining({ heartbeatCount: 1, sseRecordCount: 0 }),
    ]);

    const eventRead = reader.read();
    upstreamController.enqueue(
      encoder.encode(
        'event: tool_result\ndata: {"type":"tool_result","stage":"search","tool":"pubmed_corpus_search","ts":1}\n\n',
      ),
    );
    const event = await eventRead;
    expect(event.done).toBe(false);
    expect(decoder.decode(event.value)).toContain("event: tool_result");
    expect(records).toEqual([{ index: 1, type: "tool_result" }]);

    const doneRead = reader.read();
    upstreamController.close();
    expect(await doneRead).toEqual({ done: true, value: undefined });
    expect(completions).toEqual([
      expect.objectContaining({ heartbeatCount: 1, sseRecordCount: 1 }),
    ]);
  });
});
