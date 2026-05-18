#!/usr/bin/env node

import { createHmac, randomUUID } from "node:crypto";
import { loadRepoEnv } from "./lib/env.mjs";
import { optionNumber, parseArgs, readEnv } from "./lib/cli.mjs";

loadRepoEnv();

const { options, positionals } = parseArgs(process.argv.slice(2));
const command = positionals[0] ?? "help";
const timeoutMs = optionNumber(options.timeoutMs, 30_000);

try {
  switch (command) {
    case "agent-health":
      await agentHealth();
      break;
    case "agent-startup":
      await jsonPost({
        body: {},
        expectReadyProfiles: true,
        origin: agentOrigin(),
        path: "/runtime/startup?probe=0&wait=1",
      });
      break;
    case "agent-literature":
      await streamFirstChunk({
        body: {
          question:
            "Compare HbA1c reduction across recent GLP-1 receptor agonist trials.",
        },
        origin: agentOrigin(),
        path: "/literature/stream",
      });
      break;
    case "agent-data-viz":
      await streamFirstChunk({
        body: dataVizSmokeBody(),
        origin: agentOrigin(),
        path: "/data-viz/run",
      });
      break;
    case "agent-eval":
      await streamFirstChunk({
        body: { axis: "plan-stability", concurrency: 1, limit: 1 },
        origin: agentOrigin(),
        path: "/eval/run",
      });
      break;
    case "pages":
      await smokePages();
      break;
    case "startup":
      await jsonPost({
        body: {},
        expectReadyProfiles: true,
        origin: webOrigin(),
        path: "/api/agent/startup?probe=0&wait=1",
      });
      break;
    case "literature":
      await streamFirstChunk({
        body: {
          question:
            "Compare HbA1c reduction across recent GLP-1 receptor agonist trials.",
        },
        origin: webOrigin(),
        path: "/api/stream",
      });
      break;
    case "data-viz":
      await streamFirstChunk({
        body: dataVizSmokeBody(),
        origin: webOrigin(),
        path: "/api/data-viz/run",
      });
      break;
    case "eval":
      await streamFirstChunk({
        body: { axis: "plan-stability", concurrency: 1, limit: 1 },
        origin: webOrigin(),
        path: "/api/eval/run",
      });
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      throw new Error(`Unknown command "${command}". Run with "help".`);
  }
} catch (err) {
  if (err instanceof DOMException && err.name === "AbortError") {
    console.error(`Timed out after ${timeoutMs}ms`);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
}

async function agentHealth() {
  const res = await fetch(`${agentOrigin()}/health`, {
    signal: timeoutSignal(),
  });
  const text = await res.text();
  console.log(`${res.status} ${res.headers.get("content-type") ?? ""}`);
  console.log(text);
  if (!res.ok) process.exitCode = 1;
}

async function smokePages() {
  const origin = webOrigin();
  const paths = [
    "/05-research-agent-demo",
    "/06-data-visualization-demo",
    "/08-eval-harness",
  ];
  for (const path of paths) {
    const res = await fetch(`${origin}${path}`, { signal: timeoutSignal() });
    console.log(`${res.status} ${path}`);
    if (!res.ok) process.exitCode = 1;
  }
}

async function jsonPost({ body, expectReadyProfiles = false, origin, path }) {
  const res = await fetch(`${origin}${path}`, {
    body: JSON.stringify(body),
    headers: authHeaders({ method: "POST", path }),
    method: "POST",
    signal: timeoutSignal(),
  });
  const text = await res.text();
  console.log(`${res.status} ${res.headers.get("content-type") ?? ""}`);
  console.log(
    `x-novamind-run-id: ${res.headers.get("x-novamind-run-id") ?? ""}`,
  );
  console.log(text.slice(0, 1000));
  if (!res.ok) {
    process.exitCode = 1;
    return;
  }
  if (expectReadyProfiles) assertReadyProfiles(text);
}

async function streamFirstChunk({ body, origin, path }) {
  const res = await fetch(`${origin}${path}`, {
    body: JSON.stringify(body),
    headers: authHeaders({ method: "POST", path }),
    method: "POST",
    signal: timeoutSignal(),
  });
  const contentType = res.headers.get("content-type") ?? "";
  console.log(`${res.status} ${contentType}`);
  console.log(
    `x-novamind-run-id: ${res.headers.get("x-novamind-run-id") ?? ""}`,
  );

  if (!res.ok || !contentType.toLowerCase().includes("text/event-stream")) {
    const text = await res.text().catch(() => "");
    console.log(text.slice(0, 1000));
    process.exitCode = 1;
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    console.log(text.slice(0, 1000));
    process.exitCode = 1;
    return;
  }

  const { value } = await reader.read();
  await reader.cancel().catch(() => {});
  if (value) {
    console.log(new TextDecoder().decode(value).slice(0, 1000));
  }
}

function authHeaders({ method, path }) {
  const headers = { "content-type": "application/json" };
  const jwt = process.env.CF_ACCESS_JWT;
  const cookie = process.env.CF_AUTHORIZATION_COOKIE;
  const clientId = process.env.CF_ACCESS_CLIENT_ID;
  const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  const internalToken = process.env.NOVAMIND_AGENT_INTERNAL_TOKEN;
  const email = process.env.NOVAMIND_DEV_ACCESS_EMAIL;
  if (jwt) headers["Cf-Access-Jwt-Assertion"] = jwt;
  if (cookie) headers.cookie = cookie;
  if (clientId && clientSecret) {
    headers["CF-Access-Client-Id"] = clientId;
    headers["CF-Access-Client-Secret"] = clientSecret;
  }
  if (internalToken && email) {
    const runId = randomUUID();
    const timestamp = String(Date.now());
    headers["x-novamind-access-email"] = email;
    headers["x-novamind-run-id"] = runId;
    headers["x-novamind-internal-timestamp"] = timestamp;
    headers["x-novamind-internal-signature"] = createHmac(
      "sha256",
      internalToken,
    )
      .update([method.toUpperCase(), path, runId, timestamp, email].join("\n"))
      .digest("hex");
  }
  return headers;
}

function assertReadyProfiles(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Startup response was not JSON");
  }
  const profiles = parsed?.result?.profiles ?? parsed?.profiles;
  if (!Array.isArray(profiles)) {
    throw new Error("Startup response did not include profile status");
  }
  const notReady = profiles.filter((profile) => profile?.status !== "ready");
  if (notReady.length > 0) {
    throw new Error(
      `Startup profiles not ready: ${notReady
        .map((profile) => `${profile?.profile ?? "unknown"}=${profile?.status}`)
        .join(", ")}`,
    );
  }
}

function dataVizSmokeBody() {
  return {
    researchHandoff: {
      question:
        "Compare HbA1c reduction, weight loss, and tolerability signals across recent GLP-1 receptor agonist trials.",
      hypothesis:
        "Verified GLP-1 evidence supports meaningful glycemic and weight improvements, while tolerability remains a key constraint for translating the signal into recommendations.",
      confidence: 0.72,
      evidence: [
        {
          citation: "PMID:40619508",
          claim:
            "Tirzepatide trials report clinically meaningful HbA1c and body-weight improvements.",
        },
        {
          citation: "PMID:40746012",
          claim:
            "GLP-1 therapies show consistent weight-loss effects across trial populations.",
        },
        {
          citation: "PMID:37828829",
          claim:
            "Gastrointestinal adverse events remain a common tolerability consideration.",
        },
      ],
      completedAt: Date.now(),
    },
  };
}

function timeoutSignal() {
  return AbortSignal.timeout(timeoutMs);
}

function webOrigin() {
  return readEnv("WEB_ORIGIN", "http://localhost:3000");
}

function agentOrigin() {
  return readEnv("AGENT_ORIGIN", "http://localhost:8787");
}

function printHelp() {
  console.log(`NovaMind smoke helper

Usage:
  pnpm smoke:agent
  pnpm smoke:agent:startup
  pnpm smoke:agent:literature
  pnpm smoke:agent:data-viz
  pnpm smoke:agent:eval
  pnpm smoke:pages
  pnpm smoke:literature
  pnpm smoke:data-viz
  pnpm smoke:eval
  pnpm smoke:startup

Environment:
  WEB_ORIGIN defaults to http://localhost:3000.
  AGENT_ORIGIN defaults to http://localhost:8787.
  CF_ACCESS_JWT, CF_AUTHORIZATION_COOKIE, or CF_ACCESS_CLIENT_ID/SECRET can authenticate production smoke calls.
  NOVAMIND_AGENT_INTERNAL_TOKEN + NOVAMIND_DEV_ACCESS_EMAIL HMAC-sign direct agent smoke calls.
  Startup smoke exits nonzero unless both Agent SDK warm profiles report ready.

Options:
  --timeout-ms <n>   Request timeout. Default: 30000.
`);
}
