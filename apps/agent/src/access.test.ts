import { createHmac, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { requireAccess } from "./access";

describe("agent access", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts signed internal forwarding headers", async () => {
    vi.stubEnv("NOVAMIND_ALLOW_LOCAL_AUTH", "0");
    vi.stubEnv("NOVAMIND_AGENT_INTERNAL_TOKEN", "test-secret");
    vi.stubEnv("NOVAMIND_ACCESS_EMAIL_DOMAIN", "example.com");
    vi.stubEnv("NOVAMIND_WEB_ORIGIN", "https://web.example");
    const app = testApp();
    const path = "/test?x=1";
    const headers = signedInternalHeaders({
      email: "presenter@example.com",
      method: "POST",
      path,
      secret: "test-secret",
    });

    const res = await app.request(`https://agent.example${path}`, {
      body: "{}",
      headers: {
        ...headers,
        "content-type": "application/json",
        origin: "https://web.example",
      },
      method: "POST",
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      email: "presenter@example.com",
      source: "internal-forward",
    });
  });

  it("rejects raw internal token headers", async () => {
    vi.stubEnv("NOVAMIND_ALLOW_LOCAL_AUTH", "0");
    vi.stubEnv("NOVAMIND_AGENT_INTERNAL_TOKEN", "test-secret");
    vi.stubEnv("NOVAMIND_ACCESS_EMAIL_DOMAIN", "example.com");
    vi.stubEnv("NOVAMIND_WEB_ORIGIN", "https://web.example");
    const res = await testApp().request("https://agent.example/test", {
      body: "{}",
      headers: {
        "content-type": "application/json",
        origin: "https://web.example",
        "x-novamind-access-email": "presenter@example.com",
        "x-novamind-internal-token": "test-secret",
      },
      method: "POST",
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: "INVALID_INTERNAL_AUTH",
    });
  });

  it("rejects replayed internal forwarding signatures", async () => {
    vi.stubEnv("NOVAMIND_ALLOW_LOCAL_AUTH", "0");
    vi.stubEnv("NOVAMIND_AGENT_INTERNAL_TOKEN", "test-secret");
    vi.stubEnv("NOVAMIND_ACCESS_EMAIL_DOMAIN", "example.com");
    vi.stubEnv("NOVAMIND_WEB_ORIGIN", "https://web.example");
    const app = testApp();
    const path = "/test?x=1";
    const headers = signedInternalHeaders({
      email: "presenter@example.com",
      method: "POST",
      path,
      secret: "test-secret",
    });
    const init = {
      body: "{}",
      headers: {
        ...headers,
        "content-type": "application/json",
        origin: "https://web.example",
      },
      method: "POST",
    };

    const first = await app.request(`https://agent.example${path}`, init);
    const replay = await app.request(`https://agent.example${path}`, init);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(401);
    await expect(replay.json()).resolves.toMatchObject({
      error: "INVALID_INTERNAL_AUTH",
    });
  });
});

function testApp(): Hono {
  const app = new Hono();
  app.post("/test", async (c) => {
    const identity = await requireAccess(c);
    if (identity instanceof Response) return identity;
    return c.json(identity);
  });
  return app;
}

function signedInternalHeaders({
  email,
  method,
  path,
  secret,
}: {
  email: string;
  method: string;
  path: string;
  secret: string;
}): Record<string, string> {
  const runId = randomUUID();
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret)
    .update([method.toUpperCase(), path, runId, timestamp, email].join("\n"))
    .digest("hex");
  return {
    "x-novamind-access-email": email,
    "x-novamind-internal-signature": signature,
    "x-novamind-internal-timestamp": timestamp,
    "x-novamind-run-id": runId,
  };
}
