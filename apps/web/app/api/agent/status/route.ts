import { proxyAgentJson } from "@/lib/agent-json-proxy";
import {
  createWebRouteContext,
  logWebRouteStart,
  requireWebRouteAccess,
} from "@/lib/web-route";

export async function GET(req: Request): Promise<Response> {
  const action = "runtime-status";
  const context = createWebRouteContext(req, action);
  logWebRouteStart(context);

  const access = await requireWebRouteAccess(req, context);
  if (access instanceof Response) return access;

  return proxyAgentJson({
    accessEmail: access.email,
    action,
    method: "GET",
    path: "/runtime/status",
    request: req,
    runId: context.runId,
    startedAt: context.startedAt,
  });
}
