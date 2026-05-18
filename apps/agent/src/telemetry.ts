import { randomUUID } from "node:crypto";

import type { Context } from "hono";

type DemoLogFields = {
  action: string;
  elapsedMs?: number;
  event: string;
  route?: string;
  runId: string;
  [key: string]: unknown;
};

export interface RouteTelemetry {
  action: string;
  base: {
    action: string;
    route: string;
    runId: string;
  };
  route: string;
  runId: string;
  startedAt: number;
}

export function demoRunId(c: Context): string {
  return c.req.header("x-novamind-run-id") ?? randomUUID();
}

export function requestRoute(c: Context): string {
  return new URL(c.req.url).pathname;
}

export function createRouteTelemetry(
  c: Context,
  action: string,
): RouteTelemetry {
  const route = requestRoute(c);
  const runId = demoRunId(c);
  return {
    action,
    base: { action, route, runId },
    route,
    runId,
    startedAt: Date.now(),
  };
}

export function createBootTelemetry(): RouteTelemetry {
  return {
    action: "boot",
    base: { action: "boot", route: "container-start", runId: "boot" },
    route: "container-start",
    runId: "boot",
    startedAt: Date.now(),
  };
}

/** Emit agent-container timing logs with the same scope/runId as the web logs. */
export function logDemoTiming(fields: DemoLogFields): void {
  console.log(
    JSON.stringify({
      scope: "novamind.demo",
      worker: "agent-container",
      ts: new Date().toISOString(),
      ...fields,
    }),
  );
}
