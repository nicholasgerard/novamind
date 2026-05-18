#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRIVATE_SECRET_PREFIX_PATTERN } from "./lib/private-env-patterns.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(repoRoot, "apps/web");
const openNextDir = join(appDir, ".open-next");
const rootEnvPath = join(repoRoot, ".env");
const command = process.argv[2];
const passthroughArgs = process.argv.slice(3);

const allowedWebKeys = new Set([
  "NOVAMIND_ACCESS_EMAIL_DOMAIN",
  "CLOUDFLARE_ACCESS_AUD",
  "CLOUDFLARE_ACCESS_TEAM_DOMAIN",
]);
const deployOnlyKeys = new Set([
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_API_TOKEN",
  "CF_ACCOUNT_ID",
]);
const knownPrivateKeys = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "VOYAGE_API_KEY",
  "BRAINTRUST_API_KEY",
  "NCBI_API_KEY",
  "NCBI_EMAIL",
  "NCBI_TOOL",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_API_TOKEN",
  "CF_ACCOUNT_ID",
  "NOVAMIND_PAPERS_URL",
  "NOVAMIND_VOYAGE_EMBEDDINGS_URL",
  "NOVAMIND_OPENAI_EMBEDDINGS_URL",
  "NOVAMIND_TRIALS_URL",
  "NOVAMIND_AGENT_INTERNAL_TOKEN",
  "DEMO_FIXTURE_MODE",
  "CLOUDFLARE_ACCESS_AUD",
  "CLOUDFLARE_ACCESS_TEAM_DOMAIN",
]);
const textFileExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".rsc",
  ".txt",
  ".wasm.txt",
  ".xml",
]);
const skippedBundleExtensions = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".map",
  ".png",
  ".webp",
  ".woff",
  ".woff2",
]);

if (!["build", "deploy"].includes(command)) {
  console.error(
    "Usage: node scripts/web-cloudflare.mjs <build|deploy> [args...]",
  );
  process.exit(1);
}

const rootEnv = parseDotEnv(
  existsSync(rootEnvPath) ? readFileSync(rootEnvPath, "utf8") : "",
);
const appEnvFiles = [
  ".env",
  ".env.local",
  ".env.production.local",
  ".env.development.local",
  ".env.test.local",
].map((file) => join(appDir, file));

const restoreState = appEnvFiles.map((file) => ({
  file,
  existed: existsSync(file),
  contents: existsSync(file) ? readFileSync(file, "utf8") : undefined,
}));

class BuildFailedError extends Error {}

try {
  const childEnv = sanitizedProcessEnv(rootEnv, command);
  const webEnv = buildWebEnv(rootEnv, childEnv);

  for (const file of appEnvFiles) {
    writeFileSync(file, webEnv);
  }

  const buildStartedAt = Date.now();
  cleanBundleOutput();
  const buildResult = runPnpm(
    [
      "exec",
      "opennextjs-cloudflare",
      "build",
      ...(command === "build" ? passthroughArgs : []),
    ],
    childEnv,
  );
  if (buildResult.status !== 0) {
    process.exitCode = buildResult.status ?? 1;
    throw new BuildFailedError();
  }
  assertBundleFresh(buildStartedAt);
  assertBundleHasNoPrivateEnv(rootEnv);

  if (command === "build") {
    process.exitCode = 0;
  } else {
    const result = runPnpm(
      [
        "exec",
        "opennextjs-cloudflare",
        "deploy",
        "--config",
        "wrangler.toml",
        ...passthroughArgs,
      ],
      childEnv,
    );
    process.exitCode = result.status ?? 1;
  }
} catch (err) {
  if (!(err instanceof BuildFailedError)) throw err;
} finally {
  for (const entry of restoreState) {
    if (entry.existed) {
      writeFileSync(entry.file, entry.contents ?? "");
    } else {
      rmSync(entry.file, { force: true });
    }
  }
}

function sanitizedProcessEnv(dotEnv, mode) {
  const env = { ...process.env };

  for (const key of new Set([...Object.keys(dotEnv), ...knownPrivateKeys])) {
    const keepDeployKey = mode === "deploy" && deployOnlyKeys.has(key);
    if (
      !allowedWebKeys.has(key) &&
      !keepDeployKey &&
      !key.startsWith("NEXT_PUBLIC_")
    ) {
      delete env[key];
    }
  }

  for (const key of allowedWebKeys) {
    env[key] ??= dotEnv[key];
  }

  if (mode === "deploy") {
    for (const key of deployOnlyKeys) {
      env[key] ??= dotEnv[key];
    }
  }

  return env;
}

function buildWebEnv(dotEnv, env) {
  const allKeys = new Set([
    ...Object.keys(dotEnv),
    ...knownPrivateKeys,
    ...allowedWebKeys,
  ]);
  const lines = [
    "# Generated temporarily by scripts/web-cloudflare.mjs.",
    "# This prevents OpenNext from copying monorepo root secrets into the web Worker.",
  ];

  for (const key of [...allKeys].sort()) {
    if (key.startsWith("NEXT_PUBLIC_") || allowedWebKeys.has(key)) {
      lines.push(`${key}=${formatEnvValue(env[key] ?? dotEnv[key] ?? "")}`);
    } else {
      lines.push(`${key}=`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function parseDotEnv(contents) {
  const values = {};

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const [, key, rawValue = ""] = match;
    values[key] = stripQuotes(rawValue.trim());
  }

  return values;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function formatEnvValue(value) {
  if (!value) return "";
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function cleanBundleOutput() {
  rmSync(openNextDir, { force: true, recursive: true });
}

function runPnpm(args, env) {
  return spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd: appDir,
    env,
    stdio: "inherit",
  });
}

function assertBundleFresh(startedAt) {
  if (!existsSync(openNextDir)) {
    throw new Error("OpenNext build did not produce apps/web/.open-next.");
  }

  const newestMtime = newestMtimeMs(openNextDir);
  if (newestMtime < startedAt - 1_000) {
    throw new Error(
      "OpenNext build output appears stale; refusing to continue with deployment.",
    );
  }
}

function assertBundleHasNoPrivateEnv(dotEnv) {
  if (!existsSync(openNextDir)) return;

  const leaks = [];
  const literalSecrets = privateLiteralSecrets(dotEnv);

  for (const file of bundleTextFiles(openNextDir)) {
    const contents = readFileSync(file, "utf8");
    for (const [key, value] of literalSecrets) {
      if (contents.includes(value)) {
        leaks.push(`${key} in ${relative(appDir, file)}`);
      }
    }
    const prefixHits = contents.match(PRIVATE_SECRET_PREFIX_PATTERN) ?? [];
    for (const hit of prefixHits) {
      leaks.push(`${hit.slice(0, 8)}… in ${relative(appDir, file)}`);
    }
  }

  if (leaks.length > 0) {
    throw new Error(
      `Refusing to deploy web bundle with private env values: ${leaks.slice(0, 12).join(", ")}.`,
    );
  }
}

function privateLiteralSecrets(dotEnv) {
  const entries = [];
  const keys = new Set([
    ...Object.keys(dotEnv),
    ...Object.keys(process.env),
    ...knownPrivateKeys,
  ]);

  for (const key of keys) {
    if (allowedWebKeys.has(key) || key.startsWith("NEXT_PUBLIC_")) continue;
    if (!shouldScanLiteralValue(key)) continue;
    const value = process.env[key] ?? dotEnv[key];
    if (value) entries.push([key, value]);
  }

  return entries;
}

function shouldScanLiteralValue(key) {
  return /(?:API_KEY|AUTH_TOKEN|INTERNAL_TOKEN|SECRET|PASSWORD|PRIVATE)$/i.test(
    key,
  );
}

function bundleTextFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...bundleTextFiles(path));
      continue;
    }
    if (!entry.isFile()) continue;
    if (shouldSkipBundleFile(path)) continue;
    files.push(path);
  }
  return files;
}

function shouldSkipBundleFile(path) {
  const ext = extname(path).toLowerCase();
  if (skippedBundleExtensions.has(ext)) return true;
  if (textFileExtensions.has(ext)) return false;
  return statSync(path).size > 2 * 1024 * 1024;
}

function newestMtimeMs(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtimeMs(path));
    } else if (entry.isFile()) {
      newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}
