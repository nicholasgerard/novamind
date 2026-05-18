import { EvalRunRequestSchema } from "@novamind/shared";
import { proxyAgentStream } from "@/lib/agent-stream-proxy";
import {
  createWebRouteContext,
  logWebRouteStart,
  parseWebJsonRequest,
  requireWebRouteAccess,
} from "@/lib/web-route";

/**
 * SSE proxy: POST /api/eval/run forwards to the agent service's /eval/run,
 * streaming `EvalStreamEvent`s back to the browser.
 */
export async function POST(req: Request): Promise<Response> {
  const action = "eval-run";
  const context = createWebRouteContext(req, action);
  logWebRouteStart(context);

  const access = await requireWebRouteAccess(req, context);
  if (access instanceof Response) return access;

  const body = await parseWebJsonRequest(req, EvalRunRequestSchema, context);
  if (body instanceof Response) return body;

  return proxyAgentStream({
    accessEmail: access.email,
    action,
    body,
    path: "/eval/run",
    request: req,
    runId: context.runId,
    startedAt: context.startedAt,
  });
}
