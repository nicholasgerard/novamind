import { describe, expect, it } from "vitest";
import {
  agentProxyErrorHeaders,
  agentProxyErrorJsonResponse,
  agentProxyErrorStatus,
} from "./agent-proxy-response";

describe("agent proxy error responses", () => {
  it("preserves upstream auth and rate-limit statuses", () => {
    expect(agentProxyErrorStatus(401)).toBe(401);
    expect(agentProxyErrorStatus(403)).toBe(403);
    expect(agentProxyErrorStatus(429)).toBe(429);
    expect(agentProxyErrorStatus(503)).toBe(503);
  });

  it("falls back to bad gateway for non-error upstream statuses", () => {
    expect(agentProxyErrorStatus(200)).toBe(502);
    expect(agentProxyErrorStatus(302)).toBe(502);
  });

  it("forwards only safe control headers from agent failures", () => {
    const upstream = new Response("nope", {
      headers: {
        "retry-after": "30",
        "set-cookie": "secret=value",
        "x-novamind-auth-required": "1",
        "x-ratelimit-remaining": "0",
      },
      status: 401,
    });

    const headers = agentProxyErrorHeaders(upstream, "run-1");

    expect(headers.get("x-novamind-run-id")).toBe("run-1");
    expect(headers.get("x-novamind-auth-required")).toBe("1");
    expect(headers.get("retry-after")).toBe("30");
    expect(headers.get("x-ratelimit-remaining")).toBe("0");
    expect(headers.get("set-cookie")).toBeNull();
  });

  it("returns JSON error envelopes with safe proxy headers", async () => {
    const upstream = new Response("nope", {
      headers: { "retry-after": "30" },
      status: 429,
    });

    const response = agentProxyErrorJsonResponse({
      error: "AGENT_ERROR",
      message: "Agent request failed. Reference run id: run-1.",
      runId: "run-1",
      status: 429,
      upstream,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("retry-after")).toBe("30");
    await expect(response.json()).resolves.toEqual({
      error: "AGENT_ERROR",
      message: "Agent request failed. Reference run id: run-1.",
    });
  });
});
