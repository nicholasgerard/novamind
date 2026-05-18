import { Container } from "@cloudflare/containers";
import { DEFAULT_ACCESS_EMAIL_DOMAIN } from "@novamind/shared";

type ContainerStub = {
  destroy(): Promise<void>;
  fetch(request: Request): Promise<Response>;
  startAndWaitForPorts(options: {
    startOptions: { envVars: Record<string, string> };
  }): Promise<unknown>;
};

type ContainerNamespace = {
  getByName(name: string): ContainerStub;
};

interface Env {
  [key: string]: unknown;
  NOVAMIND_AGENT: ContainerNamespace;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  VOYAGE_API_KEY?: string;
  BRAINTRUST_API_KEY?: string;
  NCBI_API_KEY?: string;
  NCBI_TOOL?: string;
  NCBI_EMAIL?: string;
  NOVAMIND_PAPERS_URL?: string;
  NOVAMIND_VOYAGE_EMBEDDINGS_URL?: string;
  NOVAMIND_OPENAI_EMBEDDINGS_URL?: string;
  NOVAMIND_TRIALS_URL?: string;
  NOVAMIND_AGENT_INTERNAL_TOKEN?: string;
  NOVAMIND_WEB_ORIGIN?: string;
  NOVAMIND_ACCESS_EMAIL_DOMAIN?: string;
  CLOUDFLARE_ACCESS_AUD?: string;
  CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
  NOVAMIND_AGENT_INSTANCE?: string;
  CF_VERSION_METADATA?: {
    id?: string;
    tag?: string;
    timestamp?: string;
  };
  DEMO_FIXTURE_MODE?: string;
  NOVAMIND_AGENT_SDK_DEBUG?: string;
  NOVAMIND_AGENT_SDK_DEBUG_FILE?: string;
  NOVAMIND_CLAUDE_CONFIG_DIR?: string;
  NOVAMIND_CLAUDE_RUNTIME_CWD?: string;
  NOVAMIND_CLAUDE_RUNTIME_DIR?: string;
  NOVAMIND_ORCHESTRATOR_EFFORT?: string;
  NOVAMIND_ORCHESTRATOR_THINKING?: string;
  NOVAMIND_AGENT_SDK_STARTUP_TIMEOUT_MS?: string;
  NOVAMIND_AGENT_SDK_COLD_FIRST_MESSAGE_TIMEOUT_MS?: string;
  NOVAMIND_AGENT_SDK_WARM_FIRST_MESSAGE_TIMEOUT_MS?: string;
  NOVAMIND_AGENT_SDK_IDLE_TIMEOUT_MS?: string;
  NOVAMIND_AGENT_SDK_LIVE_STARTUP_WAIT_MS?: string;
  NOVAMIND_DATA_VIZ_FINAL_REPORT_GRACE_MS?: string;
  INJECT_UNVERIFIED_CLAIM?: string;
}

type InternalIdentity = {
  email: string;
};

const ENV_KEYS: Array<keyof Env> = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "VOYAGE_API_KEY",
  "BRAINTRUST_API_KEY",
  "NCBI_API_KEY",
  "NCBI_TOOL",
  "NCBI_EMAIL",
  "NOVAMIND_PAPERS_URL",
  "NOVAMIND_VOYAGE_EMBEDDINGS_URL",
  "NOVAMIND_OPENAI_EMBEDDINGS_URL",
  "NOVAMIND_TRIALS_URL",
  "NOVAMIND_AGENT_INTERNAL_TOKEN",
  "NOVAMIND_WEB_ORIGIN",
  "NOVAMIND_ACCESS_EMAIL_DOMAIN",
  "CLOUDFLARE_ACCESS_AUD",
  "CLOUDFLARE_ACCESS_TEAM_DOMAIN",
  "DEMO_FIXTURE_MODE",
  "NOVAMIND_AGENT_SDK_DEBUG",
  "NOVAMIND_AGENT_SDK_DEBUG_FILE",
  "NOVAMIND_CLAUDE_CONFIG_DIR",
  "NOVAMIND_CLAUDE_RUNTIME_CWD",
  "NOVAMIND_CLAUDE_RUNTIME_DIR",
  "NOVAMIND_ORCHESTRATOR_EFFORT",
  "NOVAMIND_ORCHESTRATOR_THINKING",
  "NOVAMIND_AGENT_SDK_STARTUP_TIMEOUT_MS",
  "NOVAMIND_AGENT_SDK_COLD_FIRST_MESSAGE_TIMEOUT_MS",
  "NOVAMIND_AGENT_SDK_WARM_FIRST_MESSAGE_TIMEOUT_MS",
  "NOVAMIND_AGENT_SDK_IDLE_TIMEOUT_MS",
  "NOVAMIND_AGENT_SDK_LIVE_STARTUP_WAIT_MS",
  "NOVAMIND_DATA_VIZ_FINAL_REPORT_GRACE_MS",
  "INJECT_UNVERIFIED_CLAIM",
];

const verifiedContainerVersions = new Map<string, string>();
const INTERNAL_SIGNATURE_WINDOW_MS = 2 * 60 * 1000;
const seenWorkerInternalSignatures = new Map<string, number>();

/** Cloudflare Container wrapper for the Node/Hono agent process. */
export class NovaMindAgent extends Container {
  defaultPort = 8787;
  sleepAfter = "45m";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const startedAt = Date.now();
    const runId =
      request.headers.get("x-novamind-run-id") ??
      globalThis.crypto.randomUUID();
    const route = new URL(request.url).pathname;
    const logBase = { route, runId };
    const internalIdentity = await incomingInternalIdentity(request, env);
    if (internalIdentity === "invalid") return internalAuthFailed(runId);

    const instanceName = env.NOVAMIND_AGENT_INSTANCE ?? "demo-primary";
    const container = env.NOVAMIND_AGENT.getByName(instanceName);
    const version = workerVersion(env);
    const startEnv = containerStartEnv(env, version);
    await startContainer({
      container,
      envVars: startEnv,
      event: "container_start_wait",
      instanceName,
      logBase,
      startedAt,
      versionId: version.id,
    });
    logWorkerTiming({
      ...logBase,
      elapsedMs: Date.now() - startedAt,
      event: "container_ready",
      instanceName,
      versionId: version.id,
    });

    const runtimeCheck = await verifyContainerRuntime({
      container,
      envVars: startEnv,
      instanceName,
      logBase,
      request,
      runId,
      startedAt,
      versionId: version.id,
    });
    if (runtimeCheck instanceof Response) return runtimeCheck;

    const containerRequest = await requestForContainer(
      request,
      env,
      runId,
      internalIdentity,
    );
    if (containerRequest instanceof Response) return containerRequest;

    const response = await container.fetch(containerRequest);
    logWorkerTiming({
      ...logBase,
      elapsedMs: Date.now() - startedAt,
      event: "container_response",
      instanceName,
      status: response.status,
      versionId: version.id,
    });
    const headers = new Headers(response.headers);
    headers.set("x-novamind-run-id", runId);
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  },
};

async function startContainer({
  container,
  envVars,
  event,
  instanceName,
  logBase,
  startedAt,
  versionId,
}: {
  container: ContainerStub;
  envVars: Record<string, string>;
  event: string;
  instanceName: string;
  logBase: { route: string; runId: string };
  startedAt: number;
  versionId?: string;
}): Promise<void> {
  logWorkerTiming({
    ...logBase,
    elapsedMs: Date.now() - startedAt,
    event,
    instanceName,
    versionId,
  });
  await container.startAndWaitForPorts({
    startOptions: { envVars },
  });
}

async function verifyContainerRuntime({
  container,
  envVars,
  instanceName,
  logBase,
  request,
  runId,
  startedAt,
  versionId,
}: {
  container: ContainerStub;
  envVars: Record<string, string>;
  instanceName: string;
  logBase: { route: string; runId: string };
  request: Request;
  runId: string;
  startedAt: number;
  versionId?: string;
}): Promise<Response | null> {
  if (!versionId) return null;
  if (verifiedContainerVersions.get(instanceName) === versionId) return null;

  const first = await readContainerHealth(container, request, runId);
  logWorkerTiming({
    ...logBase,
    actualVersionId: first.versionId,
    elapsedMs: Date.now() - startedAt,
    error: first.error,
    event: "container_runtime_check",
    healthStatus: first.status,
    instanceName,
    versionId,
  });
  if (first.ok && first.versionId === versionId) {
    verifiedContainerVersions.set(instanceName, versionId);
    return null;
  }

  logWorkerTiming({
    ...logBase,
    actualVersionId: first.versionId,
    elapsedMs: Date.now() - startedAt,
    error: first.error,
    event: "container_runtime_stale",
    healthStatus: first.status,
    instanceName,
    versionId,
  });
  try {
    await container.destroy();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWorkerTiming({
      ...logBase,
      elapsedMs: Date.now() - startedAt,
      error: message,
      event: "container_destroy_error",
      instanceName,
      versionId,
    });
    return Response.json(
      {
        error: "AGENT_CONTAINER_DESTROY_FAILED",
        message: "The stale agent container could not be restarted.",
      },
      {
        headers: {
          "cache-control": "no-store",
          "x-novamind-run-id": runId,
        },
        status: 503,
      },
    );
  }
  verifiedContainerVersions.delete(instanceName);
  await startContainer({
    container,
    envVars,
    event: "container_restart_wait",
    instanceName,
    logBase,
    startedAt,
    versionId,
  });

  const second = await readContainerHealth(container, request, runId);
  logWorkerTiming({
    ...logBase,
    actualVersionId: second.versionId,
    elapsedMs: Date.now() - startedAt,
    error: second.error,
    event: "container_runtime_recheck",
    healthStatus: second.status,
    instanceName,
    versionId,
  });
  if (second.ok && second.versionId === versionId) {
    verifiedContainerVersions.set(instanceName, versionId);
    return null;
  }

  return Response.json(
    {
      error: "AGENT_CONTAINER_VERSION_MISMATCH",
      message:
        "The agent container did not start with the current Worker version.",
      actualVersionId: second.versionId,
      expectedVersionId: versionId,
    },
    {
      headers: {
        "cache-control": "no-store",
        "x-novamind-run-id": runId,
      },
      status: 503,
    },
  );
}

async function readContainerHealth(
  container: ContainerStub,
  request: Request,
  runId: string,
): Promise<{
  error?: string;
  ok: boolean;
  status: number;
  versionId?: string;
}> {
  const healthUrl = new URL(request.url);
  healthUrl.pathname = "/health";
  healthUrl.search = "";
  let res: Response;
  try {
    res = await container.fetch(
      new Request(healthUrl.toString(), {
        headers: { "x-novamind-run-id": runId },
        method: "GET",
      }),
    );
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      ok: false,
      status: 0,
    };
  }
  const text = await res.text().catch(() => "");
  let versionId: string | undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && isRecord(parsed.runtime)) {
      const rawVersion = parsed.runtime.workerVersionId;
      if (typeof rawVersion === "string" && rawVersion.length > 0) {
        versionId = rawVersion;
      }
    }
  } catch {
    versionId = undefined;
  }
  return { ok: res.ok, status: res.status, versionId };
}

async function requestForContainer(
  request: Request,
  env: Env,
  runId: string,
  internalIdentity: InternalIdentity | null,
): Promise<Request | Response> {
  const headers = new Headers(request.headers);
  headers.set("x-novamind-run-id", runId);

  if (internalIdentity) {
    const secret = cleanString(env.NOVAMIND_AGENT_INTERNAL_TOKEN);
    if (!secret) return internalAuthFailed(runId);
    const timestamp = String(Date.now());
    const path = requestPath(request);
    headers.set("x-novamind-access-email", internalIdentity.email);
    headers.set("x-novamind-internal-timestamp", timestamp);
    headers.set(
      "x-novamind-internal-signature",
      await internalSignature({
        email: internalIdentity.email,
        method: request.method.toUpperCase(),
        path,
        runId,
        secret,
        timestamp,
      }),
    );
    headers.delete("x-novamind-internal-token");
  }

  return new Request(request, { headers });
}

function internalAuthFailed(runId: string): Response {
  return Response.json(
    {
      error: "INVALID_INTERNAL_AUTH",
      message: "Internal agent authentication failed.",
    },
    {
      headers: {
        "cache-control": "no-store",
        "x-novamind-run-id": runId,
      },
      status: 401,
    },
  );
}

async function incomingInternalIdentity(
  request: Request,
  env: Env,
): Promise<InternalIdentity | "invalid" | null> {
  const headers = request.headers;
  const rawTokenHeader = headers.get("x-novamind-internal-token");
  const signature = headers.get("x-novamind-internal-signature");
  const timestamp = headers.get("x-novamind-internal-timestamp");
  const email = headers.get("x-novamind-access-email")?.trim().toLowerCase();
  const hasInternalHeaders = Boolean(
    rawTokenHeader || signature || timestamp || email,
  );
  if (!hasInternalHeaders) return null;

  const secret = cleanString(env.NOVAMIND_AGENT_INTERNAL_TOKEN);
  if (!secret || rawTokenHeader || !signature || !timestamp || !email) {
    return "invalid";
  }
  if (!isAllowedAccessEmail(email, env)) return "invalid";
  if (!internalTimestampAllowed(timestamp)) return "invalid";

  const expected = await internalSignature({
    email,
    method: request.method.toUpperCase(),
    path: requestPath(request),
    runId: headers.get("x-novamind-run-id")?.trim() ?? "",
    secret,
    timestamp,
  });
  if (!constantTimeHexEqual(expected, signature)) return "invalid";
  if (workerSignatureSeen(signature, Number(timestamp))) return "invalid";
  return { email };
}

function isAllowedAccessEmail(email: string, env: Env): boolean {
  const domain = (
    cleanString(env.NOVAMIND_ACCESS_EMAIL_DOMAIN) ?? DEFAULT_ACCESS_EMAIL_DOMAIN
  )
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  return email.endsWith(`@${domain}`);
}

function requestPath(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

async function internalSignature({
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
}): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const payload = [method, path, runId, timestamp, email].join("\n");
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return bufferToHex(signature);
}

function internalTimestampAllowed(raw: string): boolean {
  const timestamp = Number(raw);
  return (
    Number.isSafeInteger(timestamp) &&
    Math.abs(Date.now() - timestamp) <= INTERNAL_SIGNATURE_WINDOW_MS
  );
}

function workerSignatureSeen(signature: string, timestamp: number): boolean {
  const now = Date.now();
  for (const [key, expiresAt] of seenWorkerInternalSignatures) {
    if (expiresAt <= now) seenWorkerInternalSignatures.delete(key);
  }
  if (seenWorkerInternalSignatures.has(signature)) return true;
  seenWorkerInternalSignatures.set(
    signature,
    timestamp + INTERNAL_SIGNATURE_WINDOW_MS,
  );
  return false;
}

function constantTimeHexEqual(expected: string, actual: string): boolean {
  const normalizedActual = actual
    .padEnd(expected.length, "\0")
    .slice(0, expected.length);
  let diff = expected.length ^ actual.length;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ normalizedActual.charCodeAt(index);
  }
  return diff === 0;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function logWorkerTiming(fields: {
  actualVersionId?: string;
  elapsedMs?: number;
  error?: string;
  event: string;
  healthStatus?: number;
  instanceName?: string;
  route: string;
  runId: string;
  status?: number;
  versionId?: string;
}): void {
  console.log({
    scope: "novamind.demo",
    worker: "agent-worker",
    ts: new Date().toISOString(),
    ...fields,
  });
}

function containerStartEnv(
  env: Env,
  version: ReturnType<typeof workerVersion>,
): Record<string, string> {
  return {
    NODE_ENV: "production",
    PORT: "8787",
    NOVAMIND_CLAUDE_RUNTIME_DIR: "/tmp/novamind-claude-agent-sdk",
    ...runtimeEnv(env),
    ...(version.id ? { NOVAMIND_AGENT_WORKER_VERSION_ID: version.id } : {}),
    ...(version.tag ? { NOVAMIND_AGENT_WORKER_VERSION_TAG: version.tag } : {}),
    ...(version.timestamp
      ? { NOVAMIND_AGENT_WORKER_VERSION_TIMESTAMP: version.timestamp }
      : {}),
  };
}

/**
 * Forward only explicit runtime bindings into the container. This keeps
 * Cloudflare platform bindings out of the Node process while preserving the
 * provider keys, corpus URLs, Access config, and internal HMAC secret the
 * agent needs.
 */
function runtimeEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  for (const [key, value] of Object.entries(env)) {
    if (key in out || !shouldForwardDynamicRuntimeEnv(key)) continue;
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

function shouldForwardDynamicRuntimeEnv(key: string): boolean {
  return (
    key.startsWith("OTEL_") ||
    key.startsWith("CLAUDE_CODE_OTEL_") ||
    key === "CLAUDE_CODE_ENABLE_TELEMETRY" ||
    key === "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA" ||
    key === "CLAUDE_CODE_DISABLE_AUTO_MEMORY" ||
    key === "CLAUDE_CODE_MAX_RETRIES" ||
    key === "CLAUDE_ENABLE_STREAM_WATCHDOG" ||
    key === "CLAUDE_STREAM_IDLE_TIMEOUT_MS" ||
    key === "CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS" ||
    key === "API_TIMEOUT_MS" ||
    key === "ENABLE_PROMPT_CACHING_1H" ||
    key === "ENABLE_BETA_TRACING_DETAILED" ||
    key === "ENABLE_TOOL_SEARCH" ||
    key === "BETA_TRACING_ENDPOINT"
  );
}

function workerVersion(env: Env): {
  id?: string;
  tag?: string;
  timestamp?: string;
} {
  return {
    id: cleanString(env.CF_VERSION_METADATA?.id),
    tag: cleanString(env.CF_VERSION_METADATA?.tag),
    timestamp: cleanString(env.CF_VERSION_METADATA?.timestamp),
  };
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
