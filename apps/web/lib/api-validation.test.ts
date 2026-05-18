import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonRequest } from "./api-validation";

describe("API request validation", () => {
  it("rejects oversized requests from content-length before reading the body", async () => {
    const request = new Request("https://web.example/api/demo", {
      body: "{}",
      headers: { "content-length": "1024", "content-type": "application/json" },
      method: "POST",
    });

    const result = await parseJsonRequest(request, z.object({}), 16);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });

  it("measures UTF-8 byte length after reading requests without content-length", async () => {
    const request = new Request("https://web.example/api/demo", {
      body: JSON.stringify({ value: "éééé" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    const result = await parseJsonRequest(
      request,
      z.object({ value: z.string() }),
      16,
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
    expect(request.bodyUsed).toBe(true);
  });
});
