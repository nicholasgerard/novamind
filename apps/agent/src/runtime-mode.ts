const truthy = new Set(["1", "true", "yes", "on"]);

/**
 * Explicit local-development opt-in for auth/CORS/rate-limit bypasses.
 * Production safety must not depend on NODE_ENV being populated correctly by
 * the host platform.
 */
export function localAuthEnabled(): boolean {
  return truthy.has(
    (process.env.NOVAMIND_ALLOW_LOCAL_AUTH ?? "").trim().toLowerCase(),
  );
}

/** Fail closed when the agent server is launched outside production mode. */
export function assertAgentRuntimeMode(): void {
  if (process.env.NODE_ENV === "production") return;
  if (localAuthEnabled()) return;
  throw new Error(
    "Agent server refuses to start outside NODE_ENV=production unless NOVAMIND_ALLOW_LOCAL_AUTH=1 is set.",
  );
}
