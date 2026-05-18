import "./load-env";

import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { clinicalTrialsDataDir, corpusDataDir, repoRoot } from "./paths";

/**
 * Upload the ingested corpus + embeddings to a Cloudflare R2 bucket.
 *
 * Supports two auth modes:
 *
 * Preferred for the demo repo:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN
 *
 * S3-compatible fallback:
 *   CLOUDFLARE_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID  (Cloudflare → R2 → Manage API tokens → Create token)
 *   R2_SECRET_ACCESS_KEY
 *
 * Optional:
 *   R2_BUCKET         (default: "novamind-corpus")
 *   R2_SKIP_DEV_URL=true to skip enabling the public r2.dev URL
 *
 * After upload:
 *   1. The Wrangler path creates the bucket if needed and enables r2.dev.
 *   2. Set NOVAMIND_PAPERS_URL=https://pub-<hash>.r2.dev/papers.json
 *      and  NOVAMIND_VOYAGE_EMBEDDINGS_URL=https://pub-<hash>.r2.dev/embeddings.voyage.json
 *      in the agent's deployed env. The agent will fetch on startup.
 */

const dataDir = corpusDataDir();

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET ?? "novamind-corpus";

interface FileSpec {
  local: string;
  remote: string;
  contentType: string;
  /** If true, upload only when file exists; warn-and-skip otherwise. */
  optional?: boolean;
}

const FILES: ReadonlyArray<FileSpec> = [
  {
    local: "papers.json",
    remote: "papers.json",
    contentType: "application/json",
  },
  {
    local: "embeddings.voyage.json",
    remote: "embeddings.voyage.json",
    contentType: "application/json",
  },
  {
    local: "embeddings.openai.json",
    remote: "embeddings.openai.json",
    contentType: "application/json",
    optional: true,
  },
];

const TRIAL_FILES: ReadonlyArray<FileSpec> = [
  {
    local: "clinical-trials.json",
    remote: "clinical-trials.json",
    contentType: "application/json",
    optional: true,
  },
];

function fmtSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function localPath(file: FileSpec, baseDir = dataDir): string {
  const path = resolve(baseDir, file.local);
  if (!existsSync(path)) {
    if (file.optional) {
      console.log(`[upload-r2] skip ${file.local} (not present)`);
      return "";
    }
    throw new Error(`required file missing: ${path}`);
  }
  return path;
}

function describeUpload(file: FileSpec, path: string): void {
  const stat = statSync(path);
  console.log(
    `[upload-r2] ${file.local} (${fmtSize(stat.size)}) -> r2://${bucket}/${file.remote}`,
  );
}

async function uploadViaS3(
  file: FileSpec,
  client: S3Client,
  baseDir = dataDir,
): Promise<void> {
  const path = resolve(baseDir, file.local);
  if (!existsSync(path)) {
    if (file.optional) {
      console.log(`[upload-r2] skip ${file.local} (not present)`);
      return;
    }
    throw new Error(`required file missing: ${path}`);
  }
  describeUpload(file, path);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: file.remote,
      Body: createReadStream(path),
      ContentType: file.contentType,
    }),
  );
  console.log(`[upload-r2] ✓ ${file.remote}`);
}

async function runWrangler(
  args: string[],
  options: { allowAlreadyExists?: boolean } = {},
) {
  return new Promise<{ stdout: string; stderr: string }>(
    (resolveRun, rejectRun) => {
      const child = spawn("pnpm", ["exec", "wrangler", ...args], {
        cwd: repoRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        const text = String(chunk);
        stdout += text;
        process.stdout.write(text);
      });
      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        process.stderr.write(text);
      });
      child.on("error", rejectRun);
      child.on("close", (code) => {
        if (
          code === 0 ||
          (options.allowAlreadyExists &&
            /already exists|already own/i.test(`${stdout}\n${stderr}`))
        ) {
          resolveRun({ stdout, stderr });
          return;
        }
        rejectRun(
          new Error(`wrangler ${args.join(" ")} failed with exit code ${code}`),
        );
      });
    },
  );
}

async function ensureBucketViaWrangler(): Promise<void> {
  console.log(`[upload-r2] ensuring bucket ${bucket}`);
  await runWrangler(["r2", "bucket", "create", bucket], {
    allowAlreadyExists: true,
  });
}

async function uploadViaWrangler(
  file: FileSpec,
  baseDir = dataDir,
): Promise<void> {
  const path = localPath(file, baseDir);
  if (!path) return;
  describeUpload(file, path);
  await runWrangler([
    "r2",
    "object",
    "put",
    `${bucket}/${file.remote}`,
    "--file",
    path,
    "--content-type",
    file.contentType,
    "--remote",
    "--force",
  ]);
  console.log(`[upload-r2] ✓ ${file.remote}`);
}

function extractR2DevUrl(output: string): string | undefined {
  return output.match(/https:\/\/[^\s"'<>]+\.r2\.dev/)?.[0];
}

async function enableAndPrintDevUrl(): Promise<void> {
  if (process.env.R2_SKIP_DEV_URL === "true") {
    console.log("[upload-r2] skipped r2.dev public URL enablement");
    return;
  }

  console.log(`[upload-r2] enabling public r2.dev URL for ${bucket}`);
  await runWrangler(["r2", "bucket", "dev-url", "enable", bucket]);
  const { stdout, stderr } = await runWrangler([
    "r2",
    "bucket",
    "dev-url",
    "get",
    bucket,
  ]);
  const baseUrl = extractR2DevUrl(`${stdout}\n${stderr}`);
  if (!baseUrl) {
    console.log(
      "[upload-r2] uploaded corpus. Run `pnpm exec wrangler r2 bucket dev-url get " +
        `${bucket}\` to copy the public hostname.`,
    );
    return;
  }
  console.log(
    `\n[upload-r2] public corpus URLs:\n` +
      `  NOVAMIND_PAPERS_URL=${baseUrl}/papers.json\n` +
      `  NOVAMIND_VOYAGE_EMBEDDINGS_URL=${baseUrl}/embeddings.voyage.json\n` +
      `  NOVAMIND_OPENAI_EMBEDDINGS_URL=${baseUrl}/embeddings.openai.json\n` +
      `  NOVAMIND_TRIALS_URL=${baseUrl}/clinical-trials.json`,
  );
}

async function main() {
  if (!accountId) throw new Error("missing CLOUDFLARE_ACCOUNT_ID");

  if (accessKeyId && secretAccessKey) {
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    for (const file of FILES) await uploadViaS3(file, client);
    for (const file of TRIAL_FILES) {
      await uploadViaS3(file, client, clinicalTrialsDataDir());
    }
  } else {
    if (!process.env.CLOUDFLARE_API_TOKEN) {
      throw new Error(
        "missing CLOUDFLARE_API_TOKEN, or provide R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY",
      );
    }
    await ensureBucketViaWrangler();
    for (const file of FILES) await uploadViaWrangler(file);
    for (const file of TRIAL_FILES) {
      await uploadViaWrangler(file, clinicalTrialsDataDir());
    }
    await enableAndPrintDevUrl();
  }

  console.log(`\n[upload-r2] done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
