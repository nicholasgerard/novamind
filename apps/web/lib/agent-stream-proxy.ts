import { agentEndpoint, agentForwardHeaders } from "@/lib/agent-endpoint";
import {
  agentProxyErrorJsonResponse,
  agentProxyErrorStatus,
} from "@/lib/agent-proxy-response";
import {
  demoRunId,
  logDemoTiming,
  streamSseWithDemoTelemetry,
} from "@/lib/demo-telemetry";

interface AgentStreamProxyArgs {
  accessEmail: string;
  action: string;
  body: unknown;
  path: `/${string}`;
  request: Request;
  runId?: string;
  startedAt?: number;
}

/**
 * Proxy an authenticated browser SSE request to the agent service while
 * preserving one run id across web Worker logs, agent Worker logs, and the
 * browser response header. This is the main latency-correlation boundary for
 * live demo streams.
 */
export async function proxyAgentStream({
  accessEmail,
  action,
  body,
  path,
  request,
  runId: providedRunId,
  startedAt: providedStartedAt,
}: AgentStreamProxyArgs): Promise<Response> {
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
      method: "POST",
      headers: await agentForwardHeaders(
        accessEmail,
        agent,
        "POST",
        path,
        runId,
      ),
      body: JSON.stringify(body),
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

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    logDemoTiming({
      ...baseLog,
      elapsedMs: Date.now() - startedAt,
      endpoint: agent.label,
      event: "agent_error_response",
      status: upstream.status,
      upstreamBodyBytes: detail.length,
    });
    return agentProxyErrorJsonResponse({
      error: "AGENT_ERROR",
      message: `Agent request failed. Reference run id: ${runId}.`,
      runId,
      status: agentProxyErrorStatus(upstream.status),
      upstream,
    });
  }

  if (!upstream.body) {
    logDemoTiming({
      ...baseLog,
      elapsedMs: Date.now() - startedAt,
      endpoint: agent.label,
      event: "agent_error_response",
      status: upstream.status,
      upstreamBodyBytes: 0,
    });
    return agentProxyErrorJsonResponse({
      error: "AGENT_EMPTY_RESPONSE",
      message: `Agent request failed. Reference run id: ${runId}.`,
      runId,
      status: 502,
      upstream,
    });
  }

  return new Response(
    streamSseWithDemoTelemetry(upstream.body, {
      ...baseLog,
      endpoint: agent.label,
      startedAt,
    }),
    {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-novamind-run-id": runId,
      },
    },
  );
}
