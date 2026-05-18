import { proxyAgentJson } from "@/lib/agent-json-proxy";
import {
  createWebRouteContext,
  logWebRouteStart,
  requireWebRouteAccess,
} from "@/lib/web-route";

/**
 * Authenticated startup ping for the hosted demo runtime. It starts the agent
 * container if needed, preloads demo datasets, and asks the container-local
 * Agent SDK runtime manager to keep profile-specific WarmQuery handles ready.
 */
export async function POST(req: Request): Promise<Response> {
  const action = "runtime-startup";
  const url = new URL(req.url);
  const includeProbe = url.searchParams.get("probe") !== "0";
  const waitForReady = url.searchParams.get("wait") === "1";
  const context = createWebRouteContext(req, action);
  logWebRouteStart(context, { includeProbe, waitForReady });

  const access = await requireWebRouteAccess(req, context);
  if (access instanceof Response) return access;

  return proxyAgentJson({
    accessEmail: access.email,
    action,
    path: startupAgentPath({ includeProbe, waitForReady }),
    request: req,
    runId: context.runId,
    startedAt: context.startedAt,
  });
}

function startupAgentPath({
  includeProbe,
  waitForReady,
}: {
  includeProbe: boolean;
  waitForReady: boolean;
}): "/runtime/startup" | `/runtime/startup?${string}` {
  const params = new URLSearchParams();
  if (!includeProbe) params.set("probe", "0");
  if (waitForReady) params.set("wait", "1");
  const query = params.toString();
  return query ? `/runtime/startup?${query}` : "/runtime/startup";
}
