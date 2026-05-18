import { MAX_JSON_BODY_BYTES } from "@novamind/shared";
import type { z } from "zod";

export async function parseJsonRequest<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<T | Response> {
  const contentLength = contentLengthBytes(request);
  if (contentLength !== undefined && contentLength > maxBytes) {
    return payloadTooLarge();
  }

  const text = await request.text();
  if (utf8ByteLength(text) > maxBytes) return payloadTooLarge();

  let json: unknown = {};
  if (text.trim().length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      return validationError("Request body must be valid JSON.");
    }
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return validationError(
      parsed.error.issues[0]?.message ?? "Invalid request.",
    );
  }

  return parsed.data;
}

function contentLengthBytes(request: Request): number | undefined {
  const raw = request.headers.get("content-length");
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function payloadTooLarge(): Response {
  return Response.json(
    { error: "PAYLOAD_TOO_LARGE", message: "Request body is too large." },
    { status: 413, headers: { "cache-control": "no-store" } },
  );
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function validationError(message: string): Response {
  return Response.json(
    { error: "BAD_REQUEST", message },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}
