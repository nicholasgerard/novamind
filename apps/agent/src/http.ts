import { MAX_JSON_BODY_BYTES } from "@novamind/shared";
import type { Context } from "hono";

type JsonSchema<T> = {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ message: string }> } };
};

export async function parseJsonBody<T>(
  c: Context,
  schema: JsonSchema<T>,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<T | Response> {
  const text = await c.req.text();
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > maxBytes) {
    return c.json(
      { error: "PAYLOAD_TOO_LARGE", message: "Request body is too large." },
      413,
      { "cache-control": "no-store" },
    );
  }

  let json: unknown = {};
  if (text.trim().length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      return badRequest(c, "Request body must be valid JSON.");
    }
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return badRequest(c, parsed.error.issues[0]?.message ?? "Invalid request.");
  }

  return parsed.data;
}

function badRequest(c: Context, message: string): Response {
  return c.json({ error: "BAD_REQUEST", message }, 400, {
    "cache-control": "no-store",
  });
}
