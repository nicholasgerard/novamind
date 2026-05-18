import { createHmac, timingSafeEqual } from "node:crypto";
import type * as Jose from "jose";
import type { JWTPayload } from "jose";
import type { Context } from "hono";
import { ACCESS_EMAIL_DOMAIN, isAllowedAccessEmail } from "@novamind/shared";
import { localAuthEnabled } from "./runtime-mode";

export interface AgentAccessIdentity {
  email: string;
  source: "cloudflare-access" | "internal-forward" | "local-dev";
}

type Jwks = ReturnType<typeof Jose.createRemoteJWKSet>;

const jwksCache = new Map<string, Jwks>();
const INTERNAL_SIGNATURE_WINDOW_MS = 2 * 60 * 1000;
const seenInternalSignatures = new Map<string, number>();

export async function requireAccess(
  c: Context,
): Promise<AgentAccessIdentity | Response> {
  const crossOrigin = rejectCrossOriginMutation(c);
  if (crossOrigin) return crossOrigin;

  if (localAuthEnabled()) {
    return { email: `local@${ACCESS_EMAIL_DOMAIN}`, source: "local-dev" };
  }

  const internalIdentity = internalForwardIdentity(c);
  if (internalIdentity instanceof Response) return internalIdentity;
  if (internalIdentity) return internalIdentity;

  const cloudflareIdentity = await cloudflareAccessIdentity(c).catch(
    () => null,
  );
  if (cloudflareIdentity) return cloudflareIdentity;

  return c.json(
    {
      error: "AUTH_REQUIRED",
      message:
        "Only authorized users are allowed to run this demo. Please log in.",
    },
    401,
    {
      "cache-control": "no-store",
      "x-novamind-auth-required": "1",
    },
  );
}

function rejectCrossOriginMutation(c: Context): Response | null {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method.toUpperCase())) {
    return null;
  }

  const origin = c.req.header("origin");
  if (!origin) return null;

  if (isAllowedRequestOrigin(origin)) return null;

  return c.json(
    {
      error: "FORBIDDEN_ORIGIN",
      message: "Cross-origin demo actions are not allowed.",
    },
    403,
    {
      "cache-control": "no-store",
    },
  );
}

function isAllowedRequestOrigin(origin: string): boolean {
  if (localAuthEnabled()) {
    return (
      origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000"
    );
  }

  const configured = process.env.NOVAMIND_WEB_ORIGIN?.trim();
  return configured ? origin === configured.replace(/\/+$/, "") : false;
}

function internalForwardIdentity(
  c: Context,
): AgentAccessIdentity | Response | null {
  const expectedSecret = process.env.NOVAMIND_AGENT_INTERNAL_TOKEN;
  const rawTokenHeader = c.req.header("x-novamind-internal-token");
  const signature = c.req.header("x-novamind-internal-signature");
  const timestamp = c.req.header("x-novamind-internal-timestamp");
  const email = c.req.header("x-novamind-access-email")?.trim().toLowerCase();
  const runId = c.req.header("x-novamind-run-id")?.trim() ?? "";
  const hasInternalHeaders = Boolean(
    rawTokenHeader || signature || timestamp || email,
  );
  if (!hasInternalHeaders) return null;
  if (!expectedSecret || rawTokenHeader || !signature || !timestamp || !email) {
    return internalAuthFailed(c);
  }
  if (!isAllowedAccessEmail(email)) return internalAuthFailed(c);
  if (!internalTimestampAllowed(timestamp)) return internalAuthFailed(c);

  const url = new URL(c.req.url);
  const expectedSignature = internalSignature({
    email,
    method: c.req.method.toUpperCase(),
    path: `${url.pathname}${url.search}`,
    runId,
    secret: expectedSecret,
    timestamp,
  });
  if (!constantTimeEqual(expectedSignature, signature)) {
    return internalAuthFailed(c);
  }
  if (signatureSeen(signature, Number(timestamp))) return internalAuthFailed(c);

  return { email, source: "internal-forward" };
}

async function cloudflareAccessIdentity(
  c: Context,
): Promise<AgentAccessIdentity | null> {
  const token = c.req.header("cf-access-jwt-assertion");
  const teamDomain = normalizedTeamDomain();
  const audience = process.env.CLOUDFLARE_ACCESS_AUD?.trim();
  if (!token || !teamDomain || !audience) return null;

  const payload = await verifyAccessJwt(token, teamDomain, audience);
  const tokenEmail = emailFromPayload(payload);
  if (!tokenEmail || !isAllowedAccessEmail(tokenEmail)) return null;

  const headerEmail = c.req
    .header("cf-access-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  if (headerEmail && headerEmail !== tokenEmail) return null;

  return { email: tokenEmail, source: "cloudflare-access" };
}

function normalizedTeamDomain(): string | undefined {
  const raw = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
  if (!raw) return undefined;
  const withoutTrailingSlash = raw.replace(/\/+$/, "");
  const normalized = withoutTrailingSlash.startsWith("https://")
    ? withoutTrailingSlash
    : `https://${withoutTrailingSlash}`;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    return host.endsWith(".cloudflareaccess.com")
      ? `https://${host}`
      : undefined;
  } catch {
    return undefined;
  }
}

async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  audience: string,
): Promise<JWTPayload> {
  const { createRemoteJWKSet, jwtVerify } = await import("jose");
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`), {
      timeoutDuration: 5_000,
    });
    jwksCache.set(teamDomain, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, {
    issuer: teamDomain,
    audience,
  });
  return payload;
}

function emailFromPayload(payload: JWTPayload): string | null {
  const email = payload.email;
  return typeof email === "string" ? email.trim().toLowerCase() : null;
}

function constantTimeEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualRawBuffer = Buffer.from(actual);
  const actualBuffer = Buffer.alloc(expectedBuffer.length);
  actualRawBuffer.copy(actualBuffer, 0, 0, expectedBuffer.length);
  return (
    actualRawBuffer.length === expectedBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function internalSignature({
  email,
  method,
  path,
  runId,
  secret,
  timestamp,
}: {
  email: string;
  method: string;
  path: string;
  runId: string;
  secret: string;
  timestamp: string;
}): string {
  return createHmac("sha256", secret)
    .update([method, path, runId, timestamp, email].join("\n"))
    .digest("hex");
}

function internalTimestampAllowed(raw: string): boolean {
  const timestamp = Number(raw);
  return (
    Number.isSafeInteger(timestamp) &&
    Math.abs(Date.now() - timestamp) <= INTERNAL_SIGNATURE_WINDOW_MS
  );
}

function signatureSeen(signature: string, timestamp: number): boolean {
  const now = Date.now();
  for (const [key, expiresAt] of seenInternalSignatures) {
    if (expiresAt <= now) seenInternalSignatures.delete(key);
  }
  // Replay detection must check for an existing signature before inserting it.
  if (seenInternalSignatures.has(signature)) return true;
  seenInternalSignatures.set(
    signature,
    timestamp + INTERNAL_SIGNATURE_WINDOW_MS,
  );
  return false;
}

function internalAuthFailed(c: Context): Response {
  return c.json(
    {
      error: "INVALID_INTERNAL_AUTH",
      message: "Internal agent authentication failed.",
    },
    401,
    { "cache-control": "no-store" },
  );
}
