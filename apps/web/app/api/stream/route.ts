import { LiteratureStreamRequestSchema } from "@novamind/shared";
import { proxyAgentStream } from "@/lib/agent-stream-proxy";
import {
  createWebRouteContext,
  logWebRouteStart,
  parseWebJsonRequest,
  requireWebRouteAccess,
} from "@/lib/web-route";

/**
 * SSE proxy: POST /api/stream forwards to the agent service's
 * /literature/stream and pipes `StreamEvent`s back to the browser. Forwards
 * the request's abort signal so the upstream connection closes when the
 * browser navigates away or cancels.
 */
export async function POST(req: Request): Promise<Response> {
  const action = "literature";
  const context = createWebRouteContext(req, action);
  logWebRouteStart(context);

  const access = await requireWebRouteAccess(req, context);
  if (access instanceof Response) return access;

  const body = await parseWebJsonRequest(
    req,
    LiteratureStreamRequestSchema,
    context,
  );
  if (body instanceof Response) return body;

  return proxyAgentStream({
    accessEmail: access.email,
    action,
    body,
    path: "/literature/stream",
    request: req,
    runId: context.runId,
    startedAt: context.startedAt,
  });
}
