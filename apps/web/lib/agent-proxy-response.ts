const SAFE_UPSTREAM_HEADERS = [
  "retry-after",
  "x-novamind-auth-required",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
] as const;

export function agentProxyErrorStatus(upstreamStatus: number): number {
  return upstreamStatus >= 400 && upstreamStatus <= 599 ? upstreamStatus : 502;
}

export function agentProxyErrorHeaders(
  upstream: Response | undefined,
  runId: string,
): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "x-novamind-run-id": runId,
  });
  if (!upstream) return headers;

  for (const name of SAFE_UPSTREAM_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export function agentProxyErrorJsonResponse({
  error,
  message,
  runId,
  status,
  upstream,
}: {
  error: string;
  message: string;
  runId: string;
  status: number;
  upstream?: Response;
}): Response {
  return Response.json(
    { error, message },
    {
      headers: agentProxyErrorHeaders(upstream, runId),
      status,
    },
  );
}
