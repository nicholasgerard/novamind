import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { sseStream } from "./sse";

describe("agent SSE stream", () => {
  it("redacts sensitive event fields before sending them to the browser", async () => {
    const app = new Hono();
    app.get("/stream", (c) => sseStream(c, eventSource()));

    async function* eventSource() {
      yield {
        type: "demo_event",
        nested: {
          accessToken: "access-token",
          apiKey: "provider-key",
          credential: "provider-credential",
          safe: "visible",
        },
        refreshTokens: ["refresh-token"],
        sessionJwt: "session-jwt",
        token: "bearer-token",
        values: [{ password: "secret-password" }],
      };
    }

    const res = await app.request("https://agent.example/stream");
    const body = await res.text();

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: demo_event");
    expect(body).toContain('"apiKey":"[redacted]"');
    expect(body).toContain('"accessToken":"[redacted]"');
    expect(body).toContain('"credential":"[redacted]"');
    expect(body).toContain('"refreshTokens":"[redacted]"');
    expect(body).toContain('"sessionJwt":"[redacted]"');
    expect(body).toContain('"token":"[redacted]"');
    expect(body).toContain('"password":"[redacted]"');
    expect(body).toContain('"safe":"visible"');
    expect(body).not.toContain("access-token");
    expect(body).not.toContain("provider-credential");
    expect(body).not.toContain("provider-key");
    expect(body).not.toContain("refresh-token");
    expect(body).not.toContain("session-jwt");
    expect(body).not.toContain("bearer-token");
    expect(body).not.toContain("secret-password");
  });

  it("preserves normalized token-usage counters in stream events", async () => {
    const app = new Hono();
    app.get("/stream", (c) =>
      sseStream(c, async function* eventSource() {
        yield {
          type: "literature_stage_finished",
          stage: "hypothesis",
          usage: {
            inputTokens: 123,
            outputTokens: 45,
            cacheReadTokens: 6,
            cacheCreationTokens: 7,
            costUsd: 0.0123,
          },
          ts: 1,
        };
      }),
    );

    const res = await app.request("https://agent.example/stream");
    const body = await res.text();

    expect(body).toContain('"inputTokens":123');
    expect(body).toContain('"outputTokens":45');
    expect(body).toContain('"cacheReadTokens":6');
    expect(body).toContain('"cacheCreationTokens":7');
    expect(body).toContain('"costUsd":0.0123');
    expect(body).not.toContain('"inputTokens":"[redacted]"');
  });

  it("preserves terminal result usage telemetry after redaction", async () => {
    const app = new Hono();
    app.get("/stream", (c) =>
      sseStream(c, async function* eventSource() {
        yield {
          type: "pipeline_result",
          result: {
            hypothesis: "Supported hypothesis.",
            confidence: 0.8,
            evidence: [
              {
                citation: "PMID:1",
                claim: "A supported claim.",
                verified: true,
              },
            ],
          },
          totalUsage: {
            inputTokens: 200,
            outputTokens: 80,
            cacheReadTokens: 20,
            cacheCreationTokens: 0,
            costUsd: 0.0456,
          },
          ts: 1,
        };
      }),
    );

    const res = await app.request("https://agent.example/stream");
    const body = await res.text();

    expect(body).toContain("event: pipeline_result");
    expect(body).toContain('"totalUsage"');
    expect(body).toContain('"inputTokens":200');
    expect(body).toContain('"outputTokens":80');
    expect(body).toContain('"cacheReadTokens":20');
    expect(body).toContain('"costUsd":0.0456');
    expect(body).not.toContain("[redacted]");
  });
});
