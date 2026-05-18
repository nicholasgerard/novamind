import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@cloudflare/containers", () => ({
  Container: class {},
}));

const { default: worker } = await import("./worker");

describe("agent worker internal forwarding", () => {
  it("verifies direct internal auth and forwards a fresh container signature", async () => {
    const secret = "test-secret";
    const runId = randomUUID();
    const email = "deploy-smoke@example.com";
    const path = "/runtime/startup?probe=0&wait=1";
    let forwarded: Request | undefined;
    const env = testEnv({
      fetch: async (request) => {
        forwarded = request;
        return Response.json({ ok: true });
      },
      secret,
    });

    const res = await worker.fetch(
      new Request(`https://agent.example${path}`, {
        body: "{}",
        headers: signedHeaders({ email, method: "POST", path, runId, secret }),
        method: "POST",
      }),
      env,
    );

    expect(res.status).toBe(200);
    expect(forwarded).toBeDefined();
    const headers = forwarded?.headers;
    const forwardedTimestamp = headers?.get("x-novamind-internal-timestamp");
    const forwardedSignature = headers?.get("x-novamind-internal-signature");
    expect(headers?.get("x-novamind-access-email")).toBe(email);
    expect(headers?.get("x-novamind-run-id")).toBe(runId);
    expect(headers?.get("x-novamind-internal-token")).toBeNull();
    expect(forwardedTimestamp).toBeTruthy();
    expect(forwardedSignature).toBe(
      sign({
        email,
        method: "POST",
        path,
        runId,
        secret,
        timestamp: forwardedTimestamp ?? "",
      }),
    );
  });

  it("rejects invalid internal auth before forwarding to the container", async () => {
    let fetchCount = 0;
    const env = testEnv({
      fetch: async () => {
        fetchCount += 1;
        return Response.json({ ok: true });
      },
      secret: "test-secret",
    });

    const res = await worker.fetch(
      new Request("https://agent.example/runtime/startup", {
        body: "{}",
        headers: {
          "content-type": "application/json",
          "x-novamind-access-email": "deploy-smoke@example.com",
          "x-novamind-internal-signature": "bad-signature",
          "x-novamind-internal-timestamp": String(Date.now()),
          "x-novamind-run-id": randomUUID(),
        },
        method: "POST",
      }),
      env,
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: "INVALID_INTERNAL_AUTH",
    });
    expect(fetchCount).toBe(0);
  });

  it("rejects replayed direct internal auth before forwarding to the container", async () => {
    const secret = "test-secret";
    const runId = randomUUID();
    const email = "deploy-smoke@example.com";
    const path = "/runtime/startup?probe=0";
    let fetchCount = 0;
    const env = testEnv({
      fetch: async () => {
        fetchCount += 1;
        return Response.json({ ok: true });
      },
      secret,
    });
    const headers = signedHeaders({
      email,
      method: "POST",
      path,
      runId,
      secret,
    });

    const first = await worker.fetch(
      new Request(`https://agent.example${path}`, {
        body: "{}",
        headers,
        method: "POST",
      }),
      env,
    );
    const replay = await worker.fetch(
      new Request(`https://agent.example${path}`, {
        body: "{}",
        headers,
        method: "POST",
      }),
      env,
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(401);
    expect(fetchCount).toBe(1);
  });
});

function testEnv({
  fetch,
  secret,
}: {
  fetch: (request: Request) => Promise<Response>;
  secret: string;
}) {
  return {
    NOVAMIND_ACCESS_EMAIL_DOMAIN: "example.com",
    NOVAMIND_AGENT: {
      getByName: () => ({
        destroy: async () => {},
        fetch,
        startAndWaitForPorts: async () => {},
      }),
    },
    NOVAMIND_AGENT_INTERNAL_TOKEN: secret,
  } as Parameters<typeof worker.fetch>[1];
}

function signedHeaders({
  email,
  method,
  path,
  runId,
  secret,
}: {
  email: string;
  method: string;
  path: string;
  runId: string;
  secret: string;
}): Record<string, string> {
  const timestamp = String(Date.now());
  return {
    "content-type": "application/json",
    "x-novamind-access-email": email,
    "x-novamind-internal-signature": sign({
      email,
      method,
      path,
      runId,
      secret,
      timestamp,
    }),
    "x-novamind-internal-timestamp": timestamp,
    "x-novamind-run-id": runId,
  };
}

function sign({
  email,
  method,
  path,
  runId,
  secret,
  timestamp,
}: {
  email: string;
  method: string;
  path: string;
  runId: string;
  secret: string;
  timestamp: string;
}): string {
  return createHmac("sha256", secret)
    .update([method.toUpperCase(), path, runId, timestamp, email].join("\n"))
    .digest("hex");
}
