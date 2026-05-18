/**
 * Consume complete SSE blocks from a text buffer and return the trailing
 * partial block. SSE frames are separated by a blank line; callers decide
 * whether each block is telemetry, a typed JSON event, or a comment heartbeat.
 */
export function consumeCompleteSseBlocks(
  buffer: string,
  onBlock: (block: string) => void,
): string {
  const parts = buffer.split(/\r?\n\r?\n/);
  const remainder = parts.pop() ?? "";
  for (const block of parts) {
    onBlock(block);
  }
  return remainder;
}

/**
 * Return the joined `data:` payload for one SSE block. Comment heartbeats and
 * event-only frames return an empty string and are intentionally ignored by
 * JSON stream consumers.
 */
export function sseDataFromBlock(block: string): string {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}
