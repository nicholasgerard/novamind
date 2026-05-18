import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { logDemoTiming } from "../telemetry";

interface TaggedEvent {
  type: string;
}

interface StreamTelemetry {
  action: string;
  route: string;
  runId: string;
  startedAt: number;
}

const STREAM_HEARTBEAT_MS = 15_000;
const MAX_SSE_EVENT_BYTES = 64 * 1024;
// Public telemetry counters include "tokens" in the key name but are not
// credentials. Keep this allow-list narrow and tied to TokenUsageSchema.
const PUBLIC_USAGE_COUNTER_KEYS = new Set([
  "cachecreationtokens",
  "cachereadtokens",
  "inputtokens",
  "outputtokens",
]);
const SENSITIVE_KEY_TERMS = [
  "apikey",
  "credential",
  "jwt",
  "password",
  "secret",
  "token",
];
type EventSource<E extends TaggedEvent> =
  | AsyncIterable<E>
  | ((abortController: AbortController) => AsyncIterable<E>);

/**
 * Adapt any AsyncIterable of tagged events to a Hono SSE response. Each event
 * is serialized as JSON and emitted under its `type` as the SSE event name.
 * During long model turns, transport-level SSE comments are emitted as
 * heartbeats so Cloudflare and browsers do not classify the response as an
 * idle/hung stream while the backend is still working.
 *
 * Used by both `/literature/stream` (StreamEvent) and `/eval/run`
 * (EvalStreamEvent).
 */
export function sseStream<E extends TaggedEvent>(
  c: Context,
  events: EventSource<E>,
  telemetry?: StreamTelemetry,
): Response {
  if (telemetry) {
    c.header("x-novamind-run-id", telemetry.runId);
  }
  return streamSSE(c, async (stream) => {
    const abortController = new AbortController();
    let eventCount = 0;
    let heartbeatCount = 0;
    let abortLogged = false;
    let writeQueue: Promise<unknown> = Promise.resolve();
    const abortStream = (reason: string) => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
      if (!abortLogged && telemetry) {
        abortLogged = true;
        logDemoTiming({
          action: telemetry.action,
          elapsedMs: Date.now() - telemetry.startedAt,
          event: "stream_aborted",
          eventCount,
          reason,
          route: telemetry.route,
          runId: telemetry.runId,
        });
      }
    };
    stream.onAbort(() => abortStream("client_disconnect"));
    const enqueueWrite = (write: () => Promise<unknown>) => {
      const queued = writeQueue.then(write, write);
      writeQueue = queued.catch(() => undefined);
      return queued;
    };
    const heartbeat = setInterval(() => {
      if (stream.closed || stream.aborted) {
        abortStream("transport_closed");
        return;
      }
      heartbeatCount += 1;
      void enqueueWrite(async () => {
        if (stream.closed || stream.aborted) {
          abortStream("transport_closed");
          return;
        }
        await stream.write(`: heartbeat ${Date.now()}\n\n`);
        logHeartbeat(telemetry, heartbeatCount);
      }).catch((err) => {
        abortStream("heartbeat_write_failed");
        logStreamWriteError(err, telemetry);
      });
    }, STREAM_HEARTBEAT_MS);

    try {
      const iterable =
        typeof events === "function" ? events(abortController) : events;
      for await (const event of iterable) {
        if (abortController.signal.aborted || stream.closed || stream.aborted) {
          abortStream("transport_closed");
          break;
        }
        eventCount += 1;
        logStreamEvent(event, telemetry, eventCount);
        await enqueueWrite(() =>
          stream.writeSSE({
            event: event.type,
            data: safeEventJson(event),
          }),
        );
      }
      clearInterval(heartbeat);
      await writeQueue;
      if (abortController.signal.aborted) {
        return;
      }
      if (telemetry) {
        logDemoTiming({
          action: telemetry.action,
          elapsedMs: Date.now() - telemetry.startedAt,
          event: "stream_complete",
          eventCount,
          route: telemetry.route,
          runId: telemetry.runId,
        });
      }
    } catch (err) {
      clearInterval(heartbeat);
      if (abortController.signal.aborted || isAbortError(err)) {
        abortStream("upstream_abort");
        return;
      }
      if (telemetry) {
        logDemoTiming({
          action: telemetry.action,
          elapsedMs: Date.now() - telemetry.startedAt,
          error: err instanceof Error ? err.message : String(err),
          event: "stream_error",
          eventCount,
          route: telemetry.route,
          runId: telemetry.runId,
        });
      }
      throw err;
    }
  });
}

function safeEventJson<E extends TaggedEvent>(event: E): string {
  const json = JSON.stringify(redactSensitiveFields(event));
  if (json.length > MAX_SSE_EVENT_BYTES) {
    throw new Error(
      `SSE event ${event.type} exceeded ${MAX_SSE_EVENT_BYTES} bytes after redaction.`,
    );
  }
  return json;
}

function redactSensitiveFields(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = isSensitiveEventKey(key)
      ? "[redacted]"
      : redactSensitiveFields(item);
  }
  return out;
}

function isSensitiveEventKey(key: string): boolean {
  const normalized = normalizeEventKey(key);
  if (PUBLIC_USAGE_COUNTER_KEYS.has(normalized)) return false;
  return (
    normalized === "authorization" ||
    normalized === "cookie" ||
    SENSITIVE_KEY_TERMS.some((term) => normalized.includes(term))
  );
}

function normalizeEventKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

function logHeartbeat(
  telemetry: StreamTelemetry | undefined,
  heartbeatCount: number,
): void {
  if (!telemetry) return;
  logDemoTiming({
    action: telemetry.action,
    elapsedMs: Date.now() - telemetry.startedAt,
    event: "stream_heartbeat",
    heartbeatCount,
    route: telemetry.route,
    runId: telemetry.runId,
  });
}

function logStreamEvent<E extends TaggedEvent>(
  event: E,
  telemetry: StreamTelemetry | undefined,
  eventCount: number,
): void {
  if (!telemetry) return;
  const record = event as E & {
    caseId?: string;
    caseIndex?: number;
    elapsedMs?: number;
    label?: string;
    phase?: string;
    stage?: string;
    status?: string;
    tool?: string;
    totalUsage?: TokenUsageLike;
    ts?: number;
    usage?: TokenUsageLike;
  };
  const usage = record.usage ?? record.totalUsage;
  logDemoTiming({
    action: telemetry.action,
    caseId: record.caseId,
    caseIndex: record.caseIndex,
    elapsedMs: Date.now() - telemetry.startedAt,
    evalEventElapsedMs: record.elapsedMs,
    event: "stream_event",
    eventCount,
    eventElapsedMs:
      typeof record.ts === "number"
        ? record.ts - telemetry.startedAt
        : undefined,
    eventType: record.type,
    label: record.label,
    phase: record.phase,
    route: telemetry.route,
    runId: telemetry.runId,
    stage: record.stage,
    status: record.status,
    tool: record.tool,
    usageCostUsd: usage?.costUsd,
    usageInputTokens: usage?.inputTokens,
    usageOutputTokens: usage?.outputTokens,
  });
}

function logStreamWriteError(
  err: unknown,
  telemetry: StreamTelemetry | undefined,
): void {
  if (!telemetry) return;
  logDemoTiming({
    action: telemetry.action,
    elapsedMs: Date.now() - telemetry.startedAt,
    error: err instanceof Error ? err.message : String(err),
    event: "stream_write_error",
    route: telemetry.route,
    runId: telemetry.runId,
  });
}

interface TokenUsageLike {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}
