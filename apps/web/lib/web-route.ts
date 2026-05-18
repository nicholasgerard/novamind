import type { z } from "zod";
import { requireAccess, type AccessIdentity } from "@/lib/access-server";
import { parseJsonRequest } from "@/lib/api-validation";
import { demoRunId, logDemoTiming } from "@/lib/demo-telemetry";

export interface WebRouteContext {
  action: string;
  baseLog: {
    action: string;
    route: string;
    runId: string;
  };
  route: string;
  runId: string;
  startedAt: number;
}

export function createWebRouteContext(
  request: Request,
  action: string,
): WebRouteContext {
  const route = new URL(request.url).pathname;
  const runId = demoRunId(request);
  return {
    action,
    baseLog: { action, route, runId },
    route,
    runId,
    startedAt: Date.now(),
  };
}

export function logWebRouteStart(
  context: WebRouteContext,
  fields: Record<string, unknown> = {},
): void {
  logDemoTiming({ ...fields, ...context.baseLog, event: "request_start" });
}

export async function requireWebRouteAccess(
  request: Request,
  context: WebRouteContext,
): Promise<AccessIdentity | Response> {
  const access = await requireAccess(request);
  if (access instanceof Response) {
    logDemoTiming({
      ...context.baseLog,
      elapsedMs: Date.now() - context.startedAt,
      event: "access_denied",
      status: access.status,
    });
  }
  return access;
}

export async function parseWebJsonRequest<T>(
  request: Request,
  schema: z.ZodType<T>,
  context: WebRouteContext,
): Promise<T | Response> {
  const body = await parseJsonRequest(request, schema);
  if (body instanceof Response) {
    logDemoTiming({
      ...context.baseLog,
      elapsedMs: Date.now() - context.startedAt,
      event: "invalid_request",
      status: body.status,
    });
  }
  return body;
}
