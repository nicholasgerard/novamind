const truthy = new Set(["1", "true", "yes", "on"]);

/**
 * Explicit local-development opt-in for the web auth bypass and public
 * AGENT_BASE_URL fallback. Production fails closed unless the Cloudflare
 * service binding and Access configuration are present.
 */
export function localAuthEnabled(): boolean {
  const raw =
    process.env.NOVAMIND_ALLOW_LOCAL_AUTH ??
    process.env.NEXT_PUBLIC_NOVAMIND_ALLOW_LOCAL_AUTH ??
    "";
  return truthy.has(raw.trim().toLowerCase());
}
