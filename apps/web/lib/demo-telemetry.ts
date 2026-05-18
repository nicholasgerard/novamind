import {
  createSseProxyStream,
  type SseProxyStreamStats,
} from "./sse-proxy-stream";

type DemoLogFields = {
  action: string;
  elapsedMs?: number;
  event: string;
  route?: string;
  runId: string;
  [key: string]: unknown;
};

type StreamTimingFields = {
  action: string;
  route?: string;
  runId: string;
  startedAt: number;
  [key: string]: unknown;
};

export function demoRunId(request: Request): string {
  return (
    request.headers.get("x-novamind-run-id") ??
    request.headers.get("cf-ray") ??
    globalThis.crypto.randomUUID()
  );
}

/** Emit structured timing logs that can be filtered in Cloudflare by scope. */
export function logDemoTiming(fields: DemoLogFields): void {
  console.log({
    scope: "novamind.demo",
    worker: "web",
    ts: new Date().toISOString(),
    ...fields,
  });
}

/**
 * Pass through the upstream SSE body, mirror stream telemetry, and keep the
 * browser-facing response active while the agent is inside a long model/tool
 * turn. The heartbeat is an SSE comment, so client parsers ignore it while
 * Cloudflare still sees downstream bytes.
 */
export function streamSseWithDemoTelemetry(
  body: ReadableStream<Uint8Array>,
  fields: StreamTimingFields,
): ReadableStream<Uint8Array> {
  const { action, route, runId, startedAt, ...extraFields } = fields;

  return createSseProxyStream(body, {
    onCancel(reason) {
      logDemoTiming({
        action,
        elapsedMs: Date.now() - startedAt,
        event: "stream_proxy_cancelled",
        reason: String(reason ?? "consumer_cancelled"),
        route,
        runId,
        ...extraFields,
      });
    },
    onComplete(stats) {
      logDemoTiming({
        action,
        elapsedMs: Date.now() - startedAt,
        event: "stream_complete",
        ...streamStatsFields(stats),
        route,
        runId,
        ...extraFields,
      });
    },
    onError(err, stats) {
      logDemoTiming({
        action,
        elapsedMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
        event: "stream_proxy_error",
        ...streamStatsFields(stats),
        route,
        runId,
        ...extraFields,
      });
    },
    onFirstChunk(stats) {
      logDemoTiming({
        action,
        elapsedMs: Date.now() - startedAt,
        event: "stream_first_chunk",
        ...streamStatsFields(stats),
        route,
        runId,
        ...extraFields,
      });
    },
    onHeartbeat(stats) {
      logDemoTiming({
        action,
        elapsedMs: Date.now() - startedAt,
        event: "stream_proxy_heartbeat",
        ...streamStatsFields(stats),
        route,
        runId,
        ...extraFields,
      });
    },
    onSseRecord(record, eventIndex) {
      logMirroredSseEvent(record, {
        action,
        eventIndex,
        route,
        runId,
        startedAt,
        ...extraFields,
      });
    },
  });
}

function streamStatsFields(stats: SseProxyStreamStats) {
  return {
    bytes: stats.bytes,
    heartbeatCount: stats.heartbeatCount,
    mirroredEvents: stats.sseRecordCount,
  };
}

function logMirroredSseEvent(
  record: Record<string, unknown>,
  fields: StreamTimingFields & { eventIndex: number },
): void {
  const { action, route, runId, startedAt, eventIndex, ...extraFields } =
    fields;
  const eventType = stringField(record, "type");
  if (!eventType) return;
  const eventTimestampMs = numberField(record, "ts");
  const usageCostUsd =
    usageCost(record["usage"]) ?? usageCost(record["totalUsage"]);

  logDemoTiming({
    action,
    elapsedMs: Date.now() - startedAt,
    event: "stream_passthrough_event",
    eventElapsedMs:
      eventTimestampMs === undefined ? undefined : eventTimestampMs - startedAt,
    eventIndex,
    eventType,
    label: stringField(record, "label"),
    message: stringField(record, "message"),
    phase: stringField(record, "phase"),
    route,
    runId,
    stage: stringField(record, "stage"),
    status: stringField(record, "status"),
    tool: stringField(record, "tool"),
    usageCostUsd,
    ...extraFields,
  });
}

function usageCost(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const cost = value["costUsd"];
  return typeof cost === "number" ? cost : undefined;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
