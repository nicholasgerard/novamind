#!/usr/bin/env node

import { loadRepoEnv } from "./lib/env.mjs";
import { optionNumber, parseArgs, printJson, requiredEnv } from "./lib/cli.mjs";

loadRepoEnv();

const { options, positionals } = parseArgs(process.argv.slice(2));
const command = positionals[0] ?? "help";

try {
  switch (command) {
    case "events":
      await printEvents();
      break;
    case "fields":
      await printFields();
      break;
    case "values":
      await printValues();
      break;
    case "runs":
      await printRuns();
      break;
    case "timeline":
      await printTimeline();
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
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

async function printEvents() {
  const events = await queryEvents({
    limit: optionNumber(options.limit, 200),
    minutes: optionNumber(options.minutes, 30),
    needle: String(options.needle ?? "novamind.demo"),
    queryId: "novamind-recent-demo-events",
  });

  if (options.json) {
    printJson(events);
    return;
  }
  for (const event of normalizeEvents(events)) {
    console.log(eventLine(event));
  }
}

async function printFields() {
  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = requiredEnv("CLOUDFLARE_API_TOKEN");
  const limit = optionNumber(options.limit, 200);
  const json = await cloudflareFetch(
    accountId,
    token,
    "/workers/observability/telemetry/keys",
    { limit },
  );

  const fields = json.result ?? [];
  if (options.json) {
    printJson(fields);
    return;
  }
  for (const key of fields) {
    const lastSeen = key.lastSeenAt
      ? new Date(key.lastSeenAt).toISOString()
      : "";
    console.log([key.key, key.type, lastSeen].filter(Boolean).join("\t"));
  }
}

async function printValues() {
  const key = String(options.key ?? "");
  if (!key)
    throw new Error("Pass --key <field>, for example --key source.worker");

  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = requiredEnv("CLOUDFLARE_API_TOKEN");
  const now = Date.now();
  const limit = optionNumber(options.limit, 100);
  const minutes = optionNumber(options.minutes, 60);
  const type = String(options.type ?? "string");
  const json = await cloudflareFetch(
    accountId,
    token,
    "/workers/observability/telemetry/values",
    {
      key,
      limit,
      needle:
        options.needle !== undefined
          ? { value: String(options.needle) }
          : undefined,
      timeframe: { from: now - minutes * 60 * 1000, to: now },
      type,
    },
  );

  const values = json.result ?? [];
  if (options.json) {
    printJson(values);
    return;
  }
  for (const row of values) {
    console.log(
      [row.key ?? key, row.type, row.value].filter(Boolean).join("\t"),
    );
  }
}

async function printRuns() {
  const events = await queryEvents({
    limit: optionNumber(options.limit, 2000),
    minutes: optionNumber(options.minutes, 60),
    needle: String(options.needle ?? "novamind.demo"),
    queryId: "novamind-run-groups",
  });
  const groups = groupRuns(events);

  if (options.json) {
    printJson(groups);
    return;
  }
  for (const group of groups) {
    console.log(
      [
        group.last,
        group.id,
        `events=${group.count}`,
        `workers=${group.workers.join(",")}`,
        `routes=${group.routes.join(",")}`,
        group.terminal.at(-1)?.event
          ? `last=${group.terminal.at(-1).event}`
          : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }
}

async function printTimeline() {
  const runId = String(options.runId ?? process.env.RUN_ID ?? "");
  if (!runId) throw new Error("Set RUN_ID or pass --run-id <id>");

  const events = await queryEvents({
    limit: optionNumber(options.limit, 500),
    minutes: optionNumber(options.minutes, 120),
    needle: runId,
    queryId: "novamind-run-timeline",
  });
  const timeline = normalizeEvents(events).sort((a, b) =>
    String(a.ts).localeCompare(String(b.ts)),
  );

  if (options.json) {
    printJson(timeline);
    return;
  }
  for (const event of timeline) {
    console.log(eventLine(event));
  }
}

async function queryEvents({ limit, minutes, needle, queryId }) {
  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = requiredEnv("CLOUDFLARE_API_TOKEN");
  const now = Date.now();
  const json = await cloudflareFetch(
    accountId,
    token,
    "/workers/observability/telemetry/query",
    {
      queryId,
      timeframe: { from: now - minutes * 60 * 1000, to: now },
      dry: true,
      view: "events",
      limit,
      parameters: { needle: { value: needle } },
    },
  );
  return json.result?.events?.events ?? [];
}

async function cloudflareFetch(accountId, token, path, body) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const json = await res.json();
  if (!json.success) {
    throw new Error(JSON.stringify(json.errors ?? json, null, 2));
  }
  return json;
}

function groupRuns(rawEvents) {
  const groups = new Map();
  for (const event of normalizeEvents(rawEvents)) {
    const id = event.source.runId ?? event.meta.requestId ?? "(none)";
    const group = groups.get(id) ?? {
      id,
      count: 0,
      first: event.ts,
      last: event.ts,
      routes: new Set(),
      workers: new Set(),
      terminal: [],
    };
    group.count += 1;
    group.first = event.ts < group.first ? event.ts : group.first;
    group.last = event.ts > group.last ? event.ts : group.last;
    if (event.source.route) group.routes.add(event.source.route);
    if (event.source.worker) group.workers.add(event.source.worker);
    if (
      [
        "stream_complete",
        "stream_error",
        "pipeline_stage",
        "stream_event",
      ].includes(event.source.event)
    ) {
      group.terminal.push({
        elapsedMs: event.source.elapsedMs,
        error: event.source.error,
        event: event.source.event,
        eventType: event.source.eventType,
        phase: event.source.stagePhase ?? event.source.phase,
        stage: event.source.stage,
        status: event.source.status,
        ts: event.ts,
        worker: event.source.worker,
      });
    }
    groups.set(id, group);
  }

  return [...groups.values()]
    .sort((a, b) => String(b.last).localeCompare(String(a.last)))
    .slice(0, optionNumber(options.limitRuns, 12))
    .map((group) => ({
      ...group,
      routes: [...group.routes],
      terminal: group.terminal.slice(-6),
      workers: [...group.workers],
    }));
}

function normalizeEvents(events) {
  return events.map((event) => ({
    dataset: event.dataset,
    meta: event.$metadata ?? {},
    source: event.source ?? {},
    ts: event.source?.ts ?? new Date(event.timestamp).toISOString(),
  }));
}

function eventLine({ dataset, meta, source, ts }) {
  return [
    ts,
    dataset,
    source.worker ?? meta.service ?? "",
    source.route ?? "",
    source.event ?? "",
    source.eventType ? `eventType=${source.eventType}` : "",
    source.stage ? `stage=${source.stage}` : "",
    source.stagePhase ? `stagePhase=${source.stagePhase}` : "",
    source.phase ? `phase=${source.phase}` : "",
    source.label ? `label=${source.label}` : "",
    source.sdkEvent ? `sdk=${source.sdkEvent}` : "",
    source.sdkMessageType ? `sdkType=${source.sdkMessageType}` : "",
    source.tool ? `tool=${source.tool}` : "",
    source.status ? `status=${source.status}` : "",
    source.elapsedMs !== undefined ? `elapsed=${source.elapsedMs}` : "",
    source.stageElapsedMs !== undefined
      ? `stageElapsed=${source.stageElapsedMs}`
      : "",
    source.eventCount !== undefined ? `count=${source.eventCount}` : "",
    source.error ? `ERROR=${source.error}` : "",
    meta.error ? `META_ERROR=${meta.error}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function printHelp() {
  console.log(`Cloudflare Observability helper

Usage:
  pnpm obs:cf:events -- --minutes 30 --needle novamind.demo
  pnpm obs:cf:runs -- --minutes 60
  pnpm obs:cf:timeline -- --run-id <run-id>
  pnpm obs:cf:fields
  pnpm obs:cf:values -- --key source.worker

Options:
  --minutes <n>      Lookback window. Defaults vary by command.
  --limit <n>        Cloudflare event/field limit.
  --needle <text>    Search needle for events/runs.
  --key <field>      Field to inspect for values, for example source.worker.
  --type <type>      Field type for values. Defaults to string.
  --run-id <id>      Run id for timeline. RUN_ID env also works.
  --json             Print raw JSON instead of line-oriented output.

Environment:
  CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.
`);
}
