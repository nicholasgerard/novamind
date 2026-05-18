import type * as Jose from "jose";
import type { JWTPayload } from "jose";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  ACCESS_COOKIE_MAX_AGE_SECONDS,
  ACCESS_EMAIL_COOKIE,
  ACCESS_STATUS_COOKIE,
  ACCESS_UNAUTHORIZED_STATUS,
  configuredAccessEmailDomain,
  DEFAULT_ACCESS_EMAIL_DOMAIN,
} from "@novamind/shared";
import { logDemoTiming } from "./demo-telemetry";
import { localAuthEnabled } from "./runtime-mode";

export interface AccessIdentity {
  email: string;
}

type Jwks = ReturnType<typeof Jose.createRemoteJWKSet>;

const jwksCache = new Map<string, Jwks>();
const ACCESS_FETCH_TIMEOUT_MS = 5_000;

type CloudflareEnv = {
  CLOUDFLARE_ACCESS_AUD?: string;
  CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
  NOVAMIND_ACCESS_EMAIL_DOMAIN?: string;
};

interface AccessConfig {
  audience?: string;
  emailDomain: string;
  teamDomain?: string;
}

export interface AccessState {
  authenticated: boolean;
  authorized: boolean;
  email: string | null;
  identity: AccessIdentity | null;
}

type AccessDeniedReason = "unauthenticated" | "unauthorized";

export async function requireAccess(
  request: Request,
): Promise<AccessIdentity | Response> {
  const crossOrigin = rejectCrossOriginMutation(request);
  if (crossOrigin) return crossOrigin;

  const config = await accessConfig();
  const access = await getAccessState(request, config);
  if (access.identity) return access.identity;
  return accessDeniedResponse(
    request,
    access.authenticated ? "unauthorized" : "unauthenticated",
  );
}

export async function getAccessIdentity(
  request: Request,
  config?: AccessConfig,
): Promise<AccessIdentity | null> {
  return (await getAccessState(request, config)).identity;
}

export async function getAccessState(
  request: Request,
  config?: AccessConfig,
): Promise<AccessState> {
  if (localAuthEnabled()) {
    const email =
      process.env.NOVAMIND_DEV_ACCESS_EMAIL ??
      `local@${configuredAccessEmailDomain()}`;
    return {
      authenticated: true,
      authorized: true,
      email,
      identity: { email },
    };
  }

  const resolved = config ?? (await accessConfig());
  const identity = await getRawAccessIdentity(request, resolved);
  const email = identity?.email ?? null;
  const authorized = isAllowedEmailDomain(email, resolved.emailDomain);
  return {
    authenticated: Boolean(email),
    authorized,
    email,
    identity: authorized && identity ? identity : null,
  };
}

async function getRawAccessIdentity(
  request: Request,
  resolved: AccessConfig,
): Promise<AccessIdentity | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  const { audience, teamDomain } = resolved;
  if (teamDomain && audience && token) {
    const headerEmail = request.headers
      .get("cf-access-authenticated-user-email")
      ?.trim()
      .toLowerCase();
    const identity = await identityFromJwt({
      token,
      teamDomain,
      audience,
      expectedEmail: headerEmail,
    }).catch((err) => {
      logAccessIdentityFailure(request, "header_token", err);
      return null;
    });
    if (identity) return identity;
  }

  if (teamDomain && audience) {
    const cookieToken = accessCookieValue(request.headers.get("cookie"));
    if (cookieToken) {
      const headerEmail = request.headers
        .get("cf-access-authenticated-user-email")
        ?.trim()
        .toLowerCase();
      const identity = await identityFromJwt({
        token: cookieToken,
        teamDomain,
        audience,
        expectedEmail: headerEmail,
      }).catch((err) => {
        logAccessIdentityFailure(request, "cookie_token", err);
        return null;
      });
      if (identity) return identity;
    }

    const cookieIdentity = await getCookieIdentity(request, teamDomain).catch(
      (err) => {
        logAccessIdentityFailure(request, "identity_endpoint", err);
        return null;
      },
    );
    if (cookieIdentity) return cookieIdentity;
  }

  return null;
}

export function accessDeniedResponse(
  request: Request,
  reason: AccessDeniedReason = "unauthenticated",
): Response {
  const unauthorized = reason === "unauthorized";
  const headers = new Headers({
    "cache-control": "no-store",
    "x-novamind-auth-required": "1",
  });
  headers.append(
    "set-cookie",
    unauthorized ? accessStatusCookieHeader() : clearAccessStatusCookieHeader(),
  );
  return Response.json(
    {
      error: unauthorized ? "ACCESS_DENIED" : "AUTH_REQUIRED",
      message: unauthorized
        ? "You're not authorized to do that."
        : "Only authorized users are allowed to run this demo. Please log in.",
      loginUrl: accessLoginPath(request),
    },
    {
      status: unauthorized ? 403 : 401,
      headers,
    },
  );
}

function rejectCrossOriginMutation(request: Request): Response | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    return null;
  }

  const origin = request.headers.get("origin");
  if (!origin) return null;

  const requestOrigin = new URL(request.url).origin;
  if (origin === requestOrigin) return null;

  return Response.json(
    {
      error: "FORBIDDEN_ORIGIN",
      message: "Cross-origin demo actions are not allowed.",
    },
    {
      status: 403,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

export function accessLoginPath(request: Request): string {
  const url = new URL(request.url);
  const returnTo = `${url.pathname}${url.search}`;
  return `/api/auth/access-login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function accessCookieHeader(email: string): string {
  const parts = [
    `${ACCESS_EMAIL_COOKIE}=${encodeURIComponent(email.trim().toLowerCase())}`,
    `Max-Age=${ACCESS_COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
    "Secure",
  ];
  return parts.join("; ");
}

export function clearAccessCookieHeader(): string {
  return `${ACCESS_EMAIL_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
}

export function accessStatusCookieHeader(): string {
  const parts = [
    `${ACCESS_STATUS_COOKIE}=${ACCESS_UNAUTHORIZED_STATUS}`,
    `Max-Age=${ACCESS_COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
    "Secure",
  ];
  return parts.join("; ");
}

export function clearAccessStatusCookieHeader(): string {
  return `${ACCESS_STATUS_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
}

async function accessConfig(): Promise<AccessConfig> {
  const env = await cloudflareEnv();
  return {
    audience: stringValue(
      env?.CLOUDFLARE_ACCESS_AUD ?? process.env.CLOUDFLARE_ACCESS_AUD,
    ),
    emailDomain: normalizedEmailDomain(
      env?.NOVAMIND_ACCESS_EMAIL_DOMAIN ??
        process.env.NOVAMIND_ACCESS_EMAIL_DOMAIN ??
        process.env.NEXT_PUBLIC_NOVAMIND_ACCESS_EMAIL_DOMAIN,
    ),
    teamDomain: normalizedTeamDomain(
      env?.CLOUDFLARE_ACCESS_TEAM_DOMAIN ??
        process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
    ),
  };
}

async function cloudflareEnv(): Promise<CloudflareEnv | undefined> {
  if (localAuthEnabled()) return undefined;

  try {
    const { env } = await getCloudflareContext({ async: true });
    return env as CloudflareEnv;
  } catch {
    return undefined;
  }
}

function normalizedTeamDomain(
  rawValue: string | undefined,
): string | undefined {
  const raw = rawValue?.trim();
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

function normalizedEmailDomain(rawValue: string | undefined): string {
  const normalized = rawValue?.trim().toLowerCase().replace(/^@/, "");
  return normalized || DEFAULT_ACCESS_EMAIL_DOMAIN;
}

function stringValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
      timeoutDuration: ACCESS_FETCH_TIMEOUT_MS,
    });
    jwksCache.set(teamDomain, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, {
    issuer: teamDomain,
    audience,
  });
  return payload;
}

async function identityFromJwt({
  token,
  teamDomain,
  audience,
  expectedEmail,
}: {
  token: string;
  teamDomain: string;
  audience: string;
  expectedEmail?: string;
}): Promise<AccessIdentity | null> {
  const payload = await verifyAccessJwt(token, teamDomain, audience);
  const tokenEmail = emailFromPayload(payload);
  if (!tokenEmail) return null;
  if (expectedEmail && expectedEmail !== tokenEmail) return null;
  return { email: tokenEmail };
}

function emailFromPayload(payload: JWTPayload | null): string | null {
  const email = payload?.email;
  return typeof email === "string" ? email.trim().toLowerCase() : null;
}

async function getCookieIdentity(
  request: Request,
  teamDomain: string,
): Promise<AccessIdentity | null> {
  const cookie = accessCookieValue(request.headers.get("cookie"));
  if (!cookie) return null;

  const res = await fetch(`${teamDomain}/cdn-cgi/access/get-identity`, {
    headers: {
      cookie: `CF_Authorization=${cookie}`,
    },
    signal: AbortSignal.timeout(ACCESS_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;

  const identity = (await res.json()) as { email?: unknown };
  const email =
    typeof identity.email === "string"
      ? identity.email.trim().toLowerCase()
      : null;
  return email ? { email } : null;
}

function logAccessIdentityFailure(
  request: Request,
  path: "cookie_token" | "header_token" | "identity_endpoint",
  err: unknown,
): void {
  logDemoTiming({
    action: "access_identity",
    errorName: err instanceof Error ? err.name : typeof err,
    event:
      path === "identity_endpoint"
        ? "access_identity_endpoint_failed"
        : "access_jwt_verify_failed",
    path,
    route: new URL(request.url).pathname,
    runId:
      request.headers.get("x-novamind-run-id") ??
      request.headers.get("cf-ray") ??
      "access",
  });
}

function accessCookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("CF_Authorization="));
  if (!cookie) return null;
  const value = cookie.slice("CF_Authorization=".length);
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isAllowedEmailDomain(
  email: string | null | undefined,
  emailDomain: string,
): boolean {
  return email?.trim().toLowerCase().endsWith(`@${emailDomain}`) ?? false;
}
