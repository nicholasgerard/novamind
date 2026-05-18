import { DataVizRunRequestSchema } from "@novamind/shared";
import { proxyAgentStream } from "@/lib/agent-stream-proxy";
import {
  createWebRouteContext,
  logWebRouteStart,
  parseWebJsonRequest,
  requireWebRouteAccess,
} from "@/lib/web-route";

/**
 * SSE proxy: POST /api/data-viz/run forwards to the agent service's
 * /data-viz/run and streams `DataVizStreamEvent`s back to the browser.
 */
export async function POST(req: Request): Promise<Response> {
  const action = "data-viz";
  const context = createWebRouteContext(req, action);
  logWebRouteStart(context);

  const access = await requireWebRouteAccess(req, context);
  if (access instanceof Response) return access;

  const body = await parseWebJsonRequest(req, DataVizRunRequestSchema, context);
  if (body instanceof Response) return body;

  return proxyAgentStream({
    accessEmail: access.email,
    action,
    body,
    path: "/data-viz/run",
    request: req,
    runId: context.runId,
    startedAt: context.startedAt,
  });
}
