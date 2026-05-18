import { consumeCompleteSseBlocks, sseDataFromBlock } from "./sse-framing";

export interface SseProxyStreamStats {
  bytes: number;
  heartbeatCount: number;
  sseRecordCount: number;
}

interface SseProxyStreamOptions {
  heartbeatComment?: (now: number) => string;
  heartbeatMs?: number;
  onCancel?: (reason: unknown, stats: SseProxyStreamStats) => void;
  onComplete?: (stats: SseProxyStreamStats) => void;
  onError?: (err: unknown, stats: SseProxyStreamStats) => void;
  onFirstChunk?: (stats: SseProxyStreamStats) => void;
  onHeartbeat?: (stats: SseProxyStreamStats) => void;
  onSseRecord?: (record: Record<string, unknown>, index: number) => void;
}

const DEFAULT_PROXY_HEARTBEAT_MS = 10_000;

/**
 * Pass an upstream SSE stream through a Cloudflare Worker while emitting SSE
 * comment heartbeats during quiet upstream intervals. The comments are
 * transport keepalives only: browser parsers ignore them because they contain
 * no `data:` field, while Cloudflare still observes response progress.
 *
 * The helper is intentionally event-schema agnostic. Callers can observe JSON
 * `data:` records for telemetry, but the byte stream itself is forwarded
 * unchanged except for inserted comment frames.
 */
export function createSseProxyStream(
  body: ReadableStream<Uint8Array>,
  options: SseProxyStreamOptions = {},
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_PROXY_HEARTBEAT_MS;
  const heartbeatComment =
    options.heartbeatComment ?? ((now: number) => `proxy heartbeat ${now}`);
  const stats: SseProxyStreamStats = {
    bytes: 0,
    heartbeatCount: 0,
    sseRecordCount: 0,
  };
  let buffer = "";
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  const snapshot = (): SseProxyStreamStats => ({ ...stats });

  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    closed = true;
  };

  const releaseReader = () => {
    try {
      reader?.releaseLock();
    } catch {
      return;
    }
    reader = undefined;
  };

  const notify = (
    callback: ((stats: SseProxyStreamStats) => void) | undefined,
  ) => {
    try {
      callback?.(snapshot());
    } catch {
      // Observability callbacks must never affect stream delivery.
    }
  };

  const notifyError = (
    callback: ((err: unknown, stats: SseProxyStreamStats) => void) | undefined,
    err: unknown,
  ) => {
    try {
      callback?.(err, snapshot());
    } catch {
      // Preserve the original stream error/cancellation semantics.
    }
  };

  const notifyCancel = (reason: unknown) => {
    try {
      options.onCancel?.(reason, snapshot());
    } catch {
      // Cancellation must continue even if telemetry fails.
    }
  };

  const notifySseRecord = (record: Record<string, unknown>) => {
    stats.sseRecordCount += 1;
    try {
      options.onSseRecord?.(record, stats.sseRecordCount);
    } catch {
      // Telemetry mirroring must never affect stream delivery.
    }
  };

  const observeRecords = (chunk: Uint8Array) => {
    stats.bytes += chunk.byteLength;
    buffer += decoder.decode(chunk, { stream: true });
    buffer = consumeCompleteSseBlocks(buffer, (block) => {
      const record = parseSseJsonBlock(block);
      if (!record) return;
      notifySseRecord(record);
    });
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      reader = body.getReader();

      const enqueueHeartbeat = () => {
        if (closed) return;
        stats.heartbeatCount += 1;
        try {
          controller.enqueue(
            encoder.encode(`: ${heartbeatComment(Date.now())}\n\n`),
          );
          notify(options.onHeartbeat);
        } catch (err) {
          stopHeartbeat();
          notifyError(options.onError, err);
        }
      };

      if (heartbeatMs > 0) {
        heartbeat = setInterval(enqueueHeartbeat, heartbeatMs);
      }

      void (async () => {
        try {
          let sawFirstChunk = false;
          while (true) {
            const { done, value } = await reader!.read();
            if (done) break;
            observeRecords(value);
            if (!sawFirstChunk) {
              sawFirstChunk = true;
              notify(options.onFirstChunk);
            }
            controller.enqueue(value);
          }

          const trailing = `${buffer}${decoder.decode()}`.trim();
          if (trailing) {
            const record = parseSseJsonBlock(trailing);
            if (record) {
              notifySseRecord(record);
            }
          }
          stopHeartbeat();
          notify(options.onComplete);
          releaseReader();
          controller.close();
        } catch (err) {
          stopHeartbeat();
          notifyError(options.onError, err);
          releaseReader();
          controller.error(err);
        }
      })();
    },
    cancel(reason) {
      stopHeartbeat();
      notifyCancel(reason);
      const activeReader = reader;
      return activeReader?.cancel(reason).finally(releaseReader);
    },
  });
}

function parseSseJsonBlock(block: string): Record<string, unknown> | null {
  const data = sseDataFromBlock(block);
  if (!data) return null;

  try {
    const parsed = JSON.parse(data);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // Malformed upstream telemetry should not alter byte delivery.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
