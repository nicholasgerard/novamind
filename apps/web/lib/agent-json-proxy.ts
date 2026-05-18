import { agentEndpoint, agentForwardHeaders } from "@/lib/agent-endpoint";
import {
  agentProxyErrorJsonResponse,
  agentProxyErrorStatus,
} from "@/lib/agent-proxy-response";
import { demoRunId, logDemoTiming } from "@/lib/demo-telemetry";

interface AgentJsonProxyArgs {
  accessEmail: string;
  action: string;
  body?: unknown;
  method?: "GET" | "POST";
  path: `/${string}`;
  request: Request;
  runId?: string;
  startedAt?: number;
}

/**
 * Proxy an authenticated JSON request to the agent service while preserving
 * run-id telemetry. Streaming routes use `proxyAgentStream`; this helper is
 * for short synchronous agent calls such as prompt improvement and runtime
 * startup.
 */
export async function proxyAgentJson({
  accessEmail,
  action,
  body,
  method = "POST",
  path,
  request,
  runId: providedRunId,
  startedAt: providedStartedAt,
}: AgentJsonProxyArgs): Promise<Response> {
  const route = new URL(request.url).pathname;
  const runId = providedRunId ?? demoRunId(request);
  const startedAt = providedStartedAt ?? Date.now();
  const baseLog = { action, route, runId };

  logDemoTiming({
    ...baseLog,
    elapsedMs: Date.now() - startedAt,
    event: "proxy_start",
  });

  const agent = await agentEndpoint();
  logDemoTiming({
    ...baseLog,
    elapsedMs: Date.now() - startedAt,
    endpoint: agent.label,
    event: "agent_endpoint_resolved",
  });

  let upstream: Response;
  try {
    upstream = await agent.fetch(path, {
      method,
      headers: await agentForwardHeaders(
        accessEmail,
        agent,
        method,
        path,
        runId,
      ),
      body:
        body === undefined || method === "GET"
          ? undefined
          : JSON.stringify(body),
      signal: request.signal,
      cache: "no-store",
    });
  } catch (err) {
    logDemoTiming({
      ...baseLog,
      elapsedMs: Date.now() - startedAt,
      endpoint: agent.label,
      error: err instanceof Error ? err.message : String(err),
      event: "agent_fetch_error",
    });
    return agentProxyErrorJsonResponse({
      error: "AGENT_UNREACHABLE",
      message: `Agent request failed. Reference run id: ${runId}.`,
      runId,
      status: 502,
    });
  }

  logDemoTiming({
    ...baseLog,
    elapsedMs: Date.now() - startedAt,
    endpoint: agent.label,
    event: "agent_response",
    status: upstream.status,
  });

  let bodyText = "";
  try {
    bodyText = await upstream.text();
  } catch (err) {
    logDemoTiming({
      ...baseLog,
      elapsedMs: Date.now() - startedAt,
      endpoint: agent.label,
      error: err instanceof Error ? err.message : String(err),
      event: "agent_body_read_error",
      status: upstream.status,
    });
    return agentProxyErrorJsonResponse({
      error: "AGENT_RESPONSE_READ_FAILED",
      message: `Agent response could not be read. Reference run id: ${runId}.`,
      runId,
      status: 502,
    });
  }

  logDemoTiming({
    ...baseLog,
    bodyBytes: bodyText.length,
    elapsedMs: Date.now() - startedAt,
    endpoint: agent.label,
    event: "agent_body_buffered",
    status: upstream.status,
  });

  if (!upstream.ok) {
    return agentProxyErrorJsonResponse({
      error: "AGENT_ERROR",
      message: `Agent request failed. Reference run id: ${runId}.`,
      runId,
      status: agentProxyErrorStatus(upstream.status),
      upstream,
    });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    logDemoTiming({
      ...baseLog,
      elapsedMs: Date.now() - startedAt,
      endpoint: agent.label,
      event: "agent_unexpected_content_type",
      status: upstream.status,
    });
    return agentProxyErrorJsonResponse({
      error: "AGENT_UNEXPECTED_CONTENT_TYPE",
      message: `Agent returned an unexpected response. Reference run id: ${runId}.`,
      runId,
      status: 502,
      upstream,
    });
  }

  return new Response(bodyText, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      "x-novamind-run-id": runId,
    },
    status: upstream.status,
    statusText: upstream.statusText,
  });
}
