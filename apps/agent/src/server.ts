import "./load-env";

import { serve } from "@hono/node-server";
import {
  buildCitationAccuracySpec,
  buildPlanStabilitySpec,
  HAIKU_JUDGE_MODEL,
  PLAN_SYNTHESIS_JUDGE_SCHEMA_NAME,
  runEvalEvents,
  type EvalSpec,
} from "@novamind/eval";
import {
  DataVizRunRequestSchema,
  EvalRunRequestSchema,
  LiteratureStreamRequestSchema,
  PromptImproverRequestSchema,
  type PromptImproverRequest,
} from "@novamind/shared";
import {
  agentSdkRuntimeStatus,
  ensureDemoAgentSdkWarmProfiles,
  improvePrompt,
  HYPOTHESIS_MODEL,
  HYPOTHESIS_MODEL_EFFORT,
  IMPROVE_DEFAULT_EFFORT,
  IMPROVE_MODEL,
  IMPROVE_SCHEMA_NAME,
  preloadDataVizResources,
  preloadRagResources,
  runDataVizAnalysis,
  runLiteratureAgent,
  type DataVizTimingEvent,
  type AgentSdkRuntimeTimingEvent,
  type LiteratureTimingEvent,
  type RagWarmupResult,
  type RunSummary,
} from "@novamind/pipeline";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { parseJsonBody } from "./http";
import { requireDemoAccess } from "./route-security";
import { assertAgentRuntimeMode, localAuthEnabled } from "./runtime-mode";
import { sseStream } from "./streams/sse";
import {
  createBootTelemetry,
  createRouteTelemetry,
  logDemoTiming,
  type RouteTelemetry,
} from "./telemetry";

const app = new Hono();
const DEFAULT_EVAL_CONCURRENCY = 3;
const DEFAULT_EVAL_CASE_TIMEOUT_MS = 75_000;
const LITERATURE_WARMUP_QUERY =
  "GLP-1 receptor agonists HbA1c reduction randomized controlled trials type 2 diabetes";
const CONTAINER_STARTED_AT = new Date().toISOString();

app.use(
  "*",
  cors({
    origin: (origin) => (isAllowedCorsOrigin(origin) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: [
      "content-type",
      "cf-access-jwt-assertion",
      "x-novamind-access-email",
      "x-novamind-internal-signature",
      "x-novamind-internal-timestamp",
      "x-novamind-run-id",
    ],
    credentials: true,
    maxAge: 600,
  }),
);

app.get("/health", (c) =>
  c.json({ status: "ok", runtime: agentRuntimeIdentity() }),
);

app.get("/runtime/status", async (c) => {
  const telemetry = createRouteTelemetry(c, "runtime-status");
  setRunIdHeader(c, telemetry);
  logDemoTiming({ ...telemetry.base, event: "request_start" });
  const access = await requireDemoAccess(c, telemetry, {
    action: "runtime-status",
    limit: 30,
    windowMs: 60_000,
  });
  if (access instanceof Response) return access;
  return c.json({
    ok: true,
    profiles: agentSdkRuntimeStatus(),
    runtime: agentRuntimeIdentity(),
  });
});

app.post("/runtime/startup", async (c) => {
  const telemetry = createRouteTelemetry(c, "runtime-startup");
  setRunIdHeader(c, telemetry);
  const includeProbe = c.req.query("probe") !== "0";
  const waitForReady = c.req.query("wait") === "1";
  logDemoTiming({
    ...telemetry.base,
    event: "request_start",
    includeProbe,
    waitForReady,
  });
  const access = await requireDemoAccess(c, telemetry, {
    action: "runtime-startup",
    limit: 12,
    windowMs: 60_000,
  });
  if (access instanceof Response) return access;

  try {
    const profilesPromise = ensureDemoAgentSdkWarmProfiles({
      onTiming: (event) => logAgentSdkRuntimeTiming(telemetry, event),
      waitForReady,
    });
    const ragPromise = warmLiteratureResources(telemetry, {
      includeProbe,
    });
    const dataVizPromise = warmDataVizResources(telemetry);
    const [rag, dataViz, initialProfiles] = await Promise.all([
      ragPromise,
      dataVizPromise,
      profilesPromise,
    ]);
    const profiles = waitForReady ? initialProfiles : agentSdkRuntimeStatus();
    logDemoTiming({
      ...telemetry.base,
      elapsedMs: Date.now() - telemetry.startedAt,
      event: "runtime_startup_complete",
      corpusMode: rag.corpus.mode,
      corpusPapers: rag.corpus.papers,
      dataVizSourceMode: dataViz.sourceMode,
      dataVizStudies: dataViz.studyCount,
      profileStatuses: profiles.map((profile) => profile.status).join(","),
      vectorLoaded: rag.vector.loaded,
      vectorProvider: rag.vector.provider,
      probeHits: rag.probe?.hitCount,
    });
    return c.json({
      ok: true,
      result: { dataViz, rag, profiles, runtime: agentRuntimeIdentity() },
    });
  } catch (err) {
    logDemoTiming({
      ...telemetry.base,
      elapsedMs: Date.now() - telemetry.startedAt,
      error: err instanceof Error ? err.message : String(err),
      event: "runtime_startup_error",
    });
    return c.json(
      {
        error: "RUNTIME_STARTUP_FAILED",
        message: "Agent runtime startup failed.",
        runId: telemetry.runId,
      },
      500,
      { "cache-control": "no-store" },
    );
  }
});

app.post("/literature/stream", async (c) => {
  const telemetry = createRouteTelemetry(c, "literature");
  setRunIdHeader(c, telemetry);
  logDemoTiming({ ...telemetry.base, event: "request_start" });
  const access = await requireDemoAccess(c, telemetry, {
    action: "literature",
    limit: 12,
    windowMs: 60_000,
  });
  if (access instanceof Response) return access;

  const body = await parseJsonBodyWithTelemetry(
    c,
    telemetry,
    LiteratureStreamRequestSchema,
  );
  if (body instanceof Response) {
    return body;
  }

  const question = body.question ?? "What is the latest on tirzepatide?";
  logDemoTiming({
    ...telemetry.base,
    elapsedMs: Date.now() - telemetry.startedAt,
    event: "stream_start",
  });
  return sseStream(
    c,
    (abortController) =>
      runLiteratureAgent({
        abortController,
        hypothesisSystemPrompt: body.hypothesisSystemPrompt,
        onTiming: (event) => logLiteratureTiming(telemetry, event),
        question,
        runId: telemetry.runId,
      }),
    telemetry,
  );
});

app.post("/data-viz/run", async (c) => {
  const telemetry = createRouteTelemetry(c, "data-viz");
  setRunIdHeader(c, telemetry);
  logDemoTiming({ ...telemetry.base, event: "request_start" });
  const access = await requireDemoAccess(c, telemetry, {
    action: "data-viz",
    limit: 8,
    windowMs: 60_000,
  });
  if (access instanceof Response) return access;

  const body = await parseJsonBodyWithTelemetry(
    c,
    telemetry,
    DataVizRunRequestSchema,
  );
  if (body instanceof Response) {
    return body;
  }

  logDemoTiming({
    ...telemetry.base,
    elapsedMs: Date.now() - telemetry.startedAt,
    event: "stream_start",
    hasResearchHandoff: Boolean(body.researchHandoff),
  });
  return sseStream(
    c,
    (abortController) =>
      runDataVizAnalysis({
        abortController,
        onTiming: (event) => logDataVizTiming(telemetry, event),
        question: body.question,
        researchHandoff: body.researchHandoff,
        runId: telemetry.runId,
      }),
    telemetry,
  );
});

app.post("/eval/run", async (c) => {
  const telemetry = createRouteTelemetry(c, "eval-run");
  setRunIdHeader(c, telemetry);
  logDemoTiming({ ...telemetry.base, event: "request_start" });
  const access = await requireDemoAccess(c, telemetry, {
    action: "eval-run",
    limit: 4,
    windowMs: 60_000,
  });
  if (access instanceof Response) return access;

  const body = await parseJsonBodyWithTelemetry(
    c,
    telemetry,
    EvalRunRequestSchema,
  );
  if (body instanceof Response) {
    return body;
  }

  const concurrency = body.concurrency ?? DEFAULT_EVAL_CONCURRENCY;

  let spec: EvalSpec<unknown, unknown>;
  switch (body.axis) {
    case "plan-stability":
      spec = buildPlanStabilitySpec({
        hypothesisSystemPrompt: body.hypothesisSystemPrompt,
      }) as EvalSpec<unknown, unknown>;
      break;
    case "citation-accuracy":
      spec = buildCitationAccuracySpec({
        hypothesisSystemPrompt: body.hypothesisSystemPrompt,
      }) as EvalSpec<unknown, unknown>;
      break;
    default:
      return c.json({ error: `unknown axis: ${body.axis as never}` }, 400);
  }

  if (body.caseIds !== undefined) {
    const casesById = new Map(
      spec.cases.map((caseItem) => [caseItem.id, caseItem]),
    );
    const cases = body.caseIds.flatMap((id) => {
      const caseItem = casesById.get(id);
      return caseItem ? [caseItem] : [];
    });
    const missing = body.caseIds.filter((id) => !casesById.has(id));
    if (missing.length > 0) {
      return c.json(
        { error: `unknown eval case id: ${missing.join(", ")}` },
        400,
      );
    }
    spec = {
      ...spec,
      cases,
    };
  } else if (body.limit !== undefined) {
    spec = { ...spec, cases: spec.cases.slice(0, body.limit) };
  }

  logDemoTiming({
    ...telemetry.base,
    axis: body.axis,
    cases: spec.cases.length,
    concurrency,
    elapsedMs: Date.now() - telemetry.startedAt,
    event: "stream_start",
    caseTimeoutMs: DEFAULT_EVAL_CASE_TIMEOUT_MS,
    hypothesisEffort:
      body.axis === "plan-stability" || body.axis === "citation-accuracy"
        ? HYPOTHESIS_MODEL_EFFORT
        : undefined,
    hypothesisModel:
      body.axis === "plan-stability" || body.axis === "citation-accuracy"
        ? HYPOTHESIS_MODEL
        : undefined,
    judgeModel: body.axis === "plan-stability" ? HAIKU_JUDGE_MODEL : undefined,
    schemaName:
      body.axis === "plan-stability"
        ? PLAN_SYNTHESIS_JUDGE_SCHEMA_NAME
        : undefined,
    structuredOutputMode:
      body.axis === "plan-stability" ? "json_schema" : undefined,
  });
  return sseStream(
    c,
    (abortController) =>
      runEvalEvents(spec, {
        caseTimeoutMs: DEFAULT_EVAL_CASE_TIMEOUT_MS,
        concurrency,
        signal: abortController.signal,
      }),
    telemetry,
  );
});

app.post("/improve-prompt", async (c) => {
  const telemetry = createRouteTelemetry(c, "improve-prompt");
  setRunIdHeader(c, telemetry);
  logDemoTiming({ ...telemetry.base, event: "request_start" });
  const access = await requireDemoAccess(c, telemetry, {
    action: "improve-prompt",
    limit: 6,
    windowMs: 60_000,
  });
  if (access instanceof Response) return access;

  const body = await parseJsonBodyWithTelemetry(
    c,
    telemetry,
    PromptImproverRequestSchema,
  );
  if (body instanceof Response) {
    return body;
  }

  try {
    logDemoTiming({
      ...telemetry.base,
      elapsedMs: Date.now() - telemetry.startedAt,
      event: "model_start",
      model: IMPROVE_MODEL,
      requestedEffort: IMPROVE_DEFAULT_EFFORT,
      schemaName: IMPROVE_SCHEMA_NAME,
      structuredOutputMode: "json_schema",
    });
    const result = await improvePrompt({
      currentPrompt: body.currentPrompt,
      runSummary: toRunSummary(body),
    });
    logDemoTiming({
      ...telemetry.base,
      elapsedMs: Date.now() - telemetry.startedAt,
      event: "model_complete",
      finishReason: result.metadata.finishReason,
      initialFinishReason: result.metadata.initialFinishReason,
      inputTokens: result.usage.inputTokens,
      maxBudgetUsd: result.metadata.maxBudgetUsd,
      model: result.metadata.model,
      outputTokens: result.usage.outputTokens,
      provider: result.metadata.provider,
      requestedEffort: result.metadata.requestedEffort,
      retryCount: result.metadata.retryCount,
      schemaName: result.metadata.schemaName,
      sentEffort: result.metadata.sentEffort,
      structuredOutputMode: result.metadata.outputMode,
      usageCostUsd: result.usage.costUsd,
    });
    return c.json({
      newPrompt: result.output.newPrompt,
      rationale: result.output.rationale,
      targetedMetric: result.output.targetedMetric,
      usage: result.usage,
    });
  } catch (err) {
    logDemoTiming({
      ...telemetry.base,
      elapsedMs: Date.now() - telemetry.startedAt,
      error: err instanceof Error ? err.message : String(err),
      event: "model_error",
      model: IMPROVE_MODEL,
      requestedEffort: IMPROVE_DEFAULT_EFFORT,
      schemaName: IMPROVE_SCHEMA_NAME,
      structuredOutputMode: "json_schema",
    });
    return c.json(
      {
        error: "PROMPT_IMPROVEMENT_FAILED",
        message: "Prompt improvement failed.",
        runId: telemetry.runId,
      },
      500,
      { "cache-control": "no-store" },
    );
  }
});

// Eager-load the literature corpus and Voyage embedding index before
// accepting requests so cold-start retrieval latency happens once at boot.
// Production fails closed here if real corpus data is unavailable and
// DEMO_FIXTURE_MODE was not set explicitly.
assertAgentRuntimeMode();
const bootTelemetry = createBootTelemetry();
await warmLiteratureResources(bootTelemetry, { includeProbe: false });

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`agent listening on http://localhost:${port}`);
});

type JsonBodySchema<T> = Parameters<typeof parseJsonBody<T>>[1];

function setRunIdHeader(c: Context, telemetry: RouteTelemetry): void {
  c.header("x-novamind-run-id", telemetry.runId);
}

function agentRuntimeIdentity(): {
  containerStartedAt: string;
  workerVersionId?: string;
  workerVersionTag?: string;
  workerVersionTimestamp?: string;
} {
  return {
    containerStartedAt: CONTAINER_STARTED_AT,
    workerVersionId: stringFromEnv("NOVAMIND_AGENT_WORKER_VERSION_ID"),
    workerVersionTag: stringFromEnv("NOVAMIND_AGENT_WORKER_VERSION_TAG"),
    workerVersionTimestamp: stringFromEnv(
      "NOVAMIND_AGENT_WORKER_VERSION_TIMESTAMP",
    ),
  };
}

function stringFromEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

async function parseJsonBodyWithTelemetry<T>(
  c: Context,
  telemetry: RouteTelemetry,
  schema: JsonBodySchema<T>,
): Promise<T | Response> {
  const body = await parseJsonBody(c, schema);
  if (body instanceof Response) {
    logDemoTiming({
      ...telemetry.base,
      elapsedMs: Date.now() - telemetry.startedAt,
      event: "invalid_request",
      status: body.status,
    });
  }
  return body;
}

async function warmLiteratureResources(
  telemetry: RouteTelemetry,
  opts: { includeProbe: boolean },
): Promise<RagWarmupResult> {
  logDemoTiming({
    ...telemetry.base,
    elapsedMs: Date.now() - telemetry.startedAt,
    event: "rag_warmup_start",
    includeProbe: opts.includeProbe,
  });
  const result = await preloadRagResources({
    provider: "voyage",
    probeQuery: opts.includeProbe ? LITERATURE_WARMUP_QUERY : undefined,
    onTiming: (event) => {
      logDemoTiming({
        ...telemetry.base,
        elapsedMs: Date.now() - telemetry.startedAt,
        event: "rag_warmup_stage",
        ragElapsedMs: event.elapsedMs,
        ragPhase: event.phase,
        ragStage: event.stage,
        ...omitTimingKeys(event, ["elapsedMs", "phase", "stage"]),
      });
    },
  });
  logDemoTiming({
    ...telemetry.base,
    elapsedMs: Date.now() - telemetry.startedAt,
    event: "rag_warmup_ready",
    corpusMode: result.corpus.mode,
    corpusPapers: result.corpus.papers,
    includeProbe: opts.includeProbe,
    vectorLoaded: result.vector.loaded,
    vectorProvider: result.vector.provider,
  });
  return result;
}

async function warmDataVizResources(
  telemetry: RouteTelemetry,
): Promise<Awaited<ReturnType<typeof preloadDataVizResources>>> {
  logDemoTiming({
    ...telemetry.base,
    elapsedMs: Date.now() - telemetry.startedAt,
    event: "data_viz_warmup_start",
  });
  const result = await preloadDataVizResources();
  logDemoTiming({
    ...telemetry.base,
    elapsedMs: Date.now() - telemetry.startedAt,
    event: "data_viz_warmup_ready",
    sourceMode: result.sourceMode,
    sourceName: result.sourceName,
    studies: result.studyCount,
    outcomes: result.outcomeCount,
    adverseEvents: result.adverseEventCount,
  });
  return result;
}

function logAgentSdkRuntimeTiming(
  telemetry: RouteTelemetry,
  timing: AgentSdkRuntimeTimingEvent,
): void {
  logDemoTiming({
    ...telemetry.base,
    elapsedMs: Date.now() - telemetry.startedAt,
    event: "agent_sdk_runtime_stage",
    profile: timing.profile,
    sdkElapsedMs: timing.elapsedMs,
    sdkEvent: timing.sdkEvent,
    sdkPhase: timing.phase,
    sdkStage: timing.stage,
    ...omitTimingKeys(timing, [
      "elapsedMs",
      "phase",
      "profile",
      "sdkEvent",
      "stage",
    ]),
  });
}

function logLiteratureTiming(
  telemetry: RouteTelemetry,
  timing: LiteratureTimingEvent,
): void {
  logDemoTiming({
    ...telemetry.base,
    elapsedMs: Date.now() - telemetry.startedAt,
    event: "pipeline_stage",
    stage: timing.stage,
    stageElapsedMs: timing.elapsedMs,
    stagePhase: timing.phase,
    ...omitTimingKeys(timing, ["elapsedMs", "phase", "stage"]),
  });
}

function logDataVizTiming(
  telemetry: RouteTelemetry,
  timing: DataVizTimingEvent,
): void {
  logDemoTiming({
    ...telemetry.base,
    elapsedMs: Date.now() - telemetry.startedAt,
    event: "data_viz_stage",
    stage: timing.stage,
    stageElapsedMs: timing.elapsedMs,
    stagePhase: timing.phase,
    ...omitTimingKeys(timing, ["elapsedMs", "phase", "stage"]),
  });
}

function omitTimingKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!keys.includes(key)) out[key] = item;
  }
  return out;
}

function isAllowedCorsOrigin(origin: string): boolean {
  if (!origin) return false;
  if (localAuthEnabled() && isLocalWebOrigin(origin)) {
    return true;
  }
  const configured = process.env.NOVAMIND_WEB_ORIGIN?.trim();
  return configured ? origin === configured.replace(/\/+$/, "") : false;
}

function isLocalWebOrigin(origin: string): boolean {
  return (
    origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000"
  );
}

function toRunSummary(body: PromptImproverRequest): RunSummary {
  return {
    axis: body.runSummary.axis,
    averageScores: body.runSummary.averageScores,
    cases: body.runSummary.cases,
  };
}
