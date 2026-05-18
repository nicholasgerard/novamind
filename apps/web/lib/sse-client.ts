import { consumeCompleteSseBlocks, sseDataFromBlock } from "./sse-framing";

type ParseEvent<T> = (value: unknown) => T | null;
type IsTerminalEventPayload = (value: unknown) => value is { type: string };

interface ReadSseStreamOptions<T> {
  body: ReadableStream<Uint8Array>;
  isTerminalEventPayload?: IsTerminalEventPayload;
  onEvent: (event: T) => void;
  parseEvent: ParseEvent<T>;
  streamName: string;
}

type SseBlockOptions<T> = Omit<ReadSseStreamOptions<T>, "body">;

/**
 * Read JSON Server-Sent Events from a browser `fetch()` response body.
 *
 * Server routes own canonical Zod validation. This helper centralizes the
 * lightweight client framing/parsing layer used by each live demo so malformed
 * chunks do not leave three subtly different stream readers in the app.
 */
export async function readJsonSseStream<T>({
  body,
  isTerminalEventPayload,
  onEvent,
  parseEvent,
  streamName,
}: ReadSseStreamOptions<T>): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = processCompleteBlocks(buffer, {
        isTerminalEventPayload,
        onEvent,
        parseEvent,
        streamName,
      });
    }

    const trailing = `${buffer}${decoder.decode()}`.trim();
    if (trailing.length > 0) {
      processSseBlock(trailing, {
        isTerminalEventPayload,
        onEvent,
        parseEvent,
        streamName,
      });
    }
    completed = true;
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

function processCompleteBlocks<T>(
  buffer: string,
  options: SseBlockOptions<T>,
): string {
  return consumeCompleteSseBlocks(buffer, (block) =>
    processSseBlock(block, options),
  );
}

function processSseBlock<T>(
  block: string,
  {
    isTerminalEventPayload,
    onEvent,
    parseEvent,
    streamName,
  }: SseBlockOptions<T>,
): void {
  const data = sseDataFromBlock(block);
  if (!data) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      reportClientStreamWarning(streamName, "malformed JSON event", err);
    }
    return;
  }

  const event = parseEvent(parsed);
  if (event) {
    onEvent(event);
    return;
  }
  if (isTerminalEventPayload?.(parsed)) {
    throw new Error(
      `[${streamName}] invalid terminal event payload: ${parsed.type}`,
    );
  }
  if (process.env.NODE_ENV !== "production") {
    reportClientStreamWarning(streamName, "invalid event payload", parsed);
  }
}

export function reportClientStreamWarning(
  streamName: string,
  message: string,
  detail: unknown,
): void {
  if (process.env.NODE_ENV === "production") return;
  console.warn(`[${streamName}] ${message}`, detail);
}
