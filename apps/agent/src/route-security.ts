import type { Context } from "hono";
import { requireAccess, type AgentAccessIdentity } from "./access";
import { enforceRateLimit } from "./rate-limit";
import { logDemoTiming, type RouteTelemetry } from "./telemetry";

interface DemoAccessOptions {
  action: string;
  limit: number;
  windowMs: number;
}

/**
 * Shared access-control boundary for agent routes. It keeps every live-demo
 * route on the same authorization, rate-limit, and timing-log path while
 * leaving request validation and route-specific work inside the handlers.
 */
export async function requireDemoAccess(
  c: Context,
  telemetry: RouteTelemetry,
  options: DemoAccessOptions,
): Promise<AgentAccessIdentity | Response> {
  const access = await requireAccess(c);
  if (access instanceof Response) {
    logDemoTiming({
      ...telemetry.base,
      elapsedMs: Date.now() - telemetry.startedAt,
      event: "access_denied",
      status: access.status,
    });
    return access;
  }

  const rateLimited = enforceRateLimit(c, access, options);
  if (rateLimited) {
    logDemoTiming({
      ...telemetry.base,
      elapsedMs: Date.now() - telemetry.startedAt,
      event: "rate_limited",
      status: rateLimited.status,
    });
    return rateLimited;
  }

  return access;
}
