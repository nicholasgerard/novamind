import { PromptImproverRequestSchema } from "@novamind/shared";
import { proxyAgentJson } from "@/lib/agent-json-proxy";
import {
  createWebRouteContext,
  logWebRouteStart,
  parseWebJsonRequest,
  requireWebRouteAccess,
} from "@/lib/web-route";

/**
 * Proxy: POST /api/eval/improve forwards to the agent service's
 * /improve-prompt. Synchronous (returns JSON, not SSE) since the call is
 * a single short LLM round-trip.
 */
export async function POST(req: Request): Promise<Response> {
  const action = "improve-prompt";
  const context = createWebRouteContext(req, action);
  logWebRouteStart(context);

  const access = await requireWebRouteAccess(req, context);
  if (access instanceof Response) return access;

  const body = await parseWebJsonRequest(
    req,
    PromptImproverRequestSchema,
    context,
  );
  if (body instanceof Response) return body;

  return proxyAgentJson({
    accessEmail: access.email,
    action,
    body,
    path: "/improve-prompt",
    request: req,
    runId: context.runId,
    startedAt: context.startedAt,
  });
}
