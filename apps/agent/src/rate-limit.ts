import type { Context } from "hono";
import type { AgentAccessIdentity } from "./access";
import { localAuthEnabled } from "./runtime-mode";

interface RateLimitOptions {
  action: string;
  limit: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function enforceRateLimit(
  c: Context,
  identity: AgentAccessIdentity,
  options: RateLimitOptions,
): Response | null {
  if (localAuthEnabled()) return null;

  const now = Date.now();
  pruneExpiredBuckets(now);

  const key = `${options.action}:${identity.email}`;
  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + options.windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(0, options.limit - bucket.count);
  c.header("x-ratelimit-limit", String(options.limit));
  c.header("x-ratelimit-remaining", String(remaining));
  c.header("x-ratelimit-reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count <= options.limit) return null;

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((bucket.resetAt - now) / 1000),
  );
  return c.json(
    {
      error: "RATE_LIMITED",
      message: "Too many demo runs. Please wait and try again.",
    },
    429,
    {
      "cache-control": "no-store",
      "retry-after": String(retryAfterSeconds),
    },
  );
}

function pruneExpiredBuckets(now: number): void {
  if (buckets.size < 1_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
