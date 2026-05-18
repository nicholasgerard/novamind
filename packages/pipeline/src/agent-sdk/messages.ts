/** Returns the sanitized SDK metadata fields we index in Cloudflare logs. */
export function describeSdkMessage(
  message: { type: string },
  messageIndex: number,
): Record<string, unknown> {
  const record = message as unknown as Record<string, unknown>;
  return {
    contentBlockTypes: sdkContentBlockTypes(record),
    messageIndex,
    parentToolUseId: stringField(record, "parent_tool_use_id"),
    sdkMessageType: message.type,
    sessionId: stringField(record, "session_id"),
    subtype: typeof record.subtype === "string" ? record.subtype : undefined,
    toolUseNames: sdkToolUseNames(record),
    totalCostUsd:
      typeof record.total_cost_usd === "number"
        ? record.total_cost_usd
        : undefined,
    usageInputTokens: numericField(record.usage, [
      "input_tokens",
      "inputTokens",
    ]),
    usageOutputTokens: numericField(record.usage, [
      "output_tokens",
      "outputTokens",
    ]),
    uuid: stringField(record, "uuid"),
  };
}

/** Extract stable SDK content block types from either top-level or nested messages. */
export function sdkContentBlockTypes(
  message: Record<string, unknown>,
): string[] | undefined {
  const types = sdkContentBlocks(message).flatMap((block) =>
    typeof block.type === "string" ? [block.type] : [],
  );
  return types.length > 0 ? types : undefined;
}

/** Extract stable SDK tool-use names from either top-level or nested messages. */
export function sdkToolUseNames(
  message: Record<string, unknown>,
): string[] | undefined {
  const names = sdkContentBlocks(message).flatMap((block) =>
    block.type === "tool_use" && typeof block.name === "string"
      ? [block.name]
      : [],
  );
  return names.length > 0 ? names : undefined;
}

export function shortSdkToolName(toolName: string): string {
  return toolName.split("__").at(-1) ?? toolName;
}

export function isInternalSdkTool(toolName: string): boolean {
  return toolName === "StructuredOutput";
}

function sdkContentBlocks(
  message: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const nestedMessage = message.message;
  const content: unknown[] = Array.isArray(message.content)
    ? message.content
    : nestedMessage &&
        typeof nestedMessage === "object" &&
        Array.isArray((nestedMessage as Record<string, unknown>).content)
      ? ((nestedMessage as Record<string, unknown>).content as unknown[])
      : [];
  return content.filter(
    (block): block is Record<string, unknown> =>
      Boolean(block) && typeof block === "object" && !Array.isArray(block),
  );
}

function numericField(
  value: unknown,
  keys: readonly string[],
): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "number") return item;
  }
  return undefined;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
