import { getCloudflareContext } from "@opennextjs/cloudflare";

import { agentBaseUrl } from "@/lib/agent-base-url";
import { localAuthEnabled } from "@/lib/runtime-mode";

type AgentServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type CloudflareEnv = {
  AGENT_SERVICE?: AgentServiceBinding;
  NOVAMIND_AGENT_INTERNAL_TOKEN?: string;
};

type AgentEndpoint = {
  label: string;
  internalToken?: string;
  fetch(path: `/${string}`, init: RequestInit): Promise<Response>;
};

export async function agentEndpoint(): Promise<AgentEndpoint> {
  const env = await cloudflareEnv();
  const internalToken = agentInternalToken(env);
  const service = agentServiceBinding(env);
  if (service) {
    return {
      label: "AGENT_SERVICE",
      internalToken,
      fetch: (path, init) =>
        service.fetch(
          new Request(new URL(path, "https://novamind-agent.internal"), init),
        ),
    };
  }

  if (!localAuthEnabled()) {
    throw new Error(
      "AGENT_SERVICE binding is required outside local auth mode",
    );
  }

  const baseUrl = agentBaseUrl();
  return {
    label: baseUrl,
    internalToken,
    fetch: (path, init) => fetch(`${baseUrl}${path}`, init),
  };
}

export function agentForwardHeaders(
  accessEmail: string,
  endpoint: AgentEndpoint,
  method: string,
  path: `/${string}`,
  runId?: string,
): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-novamind-access-email": accessEmail,
  };
  if (runId) {
    headers["x-novamind-run-id"] = runId;
  }
  if (endpoint.internalToken) {
    const timestamp = String(Date.now());
    headers["x-novamind-internal-timestamp"] = timestamp;
    return signInternalHeaders({
      email: accessEmail,
      headers,
      method,
      path,
      runId: runId ?? "",
      secret: endpoint.internalToken,
      timestamp,
    });
  }
  return Promise.resolve(headers);
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

function agentServiceBinding(
  env: CloudflareEnv | undefined,
): AgentServiceBinding | undefined {
  const service = env?.AGENT_SERVICE;
  return typeof service?.fetch === "function" ? service : undefined;
}

function agentInternalToken(
  env: CloudflareEnv | undefined,
): string | undefined {
  if (localAuthEnabled()) return undefined;

  const token =
    env?.NOVAMIND_AGENT_INTERNAL_TOKEN ??
    process.env.NOVAMIND_AGENT_INTERNAL_TOKEN;
  if (!token) {
    throw new Error("NOVAMIND_AGENT_INTERNAL_TOKEN is required in production");
  }
  return token;
}

async function signInternalHeaders({
  email,
  headers,
  method,
  path,
  runId,
  secret,
  timestamp,
}: {
  email: string;
  headers: Record<string, string>;
  method: string;
  path: string;
  runId: string;
  secret: string;
  timestamp: string;
}): Promise<Record<string, string>> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const payload = [method.toUpperCase(), path, runId, timestamp, email].join(
    "\n",
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  headers["x-novamind-internal-signature"] = bufferToHex(signature);
  return headers;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
