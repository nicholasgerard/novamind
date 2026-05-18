# Production Observability

This playbook shows how to inspect Cloudflare production telemetry for the
web Worker, agent Worker, and agent Container. It is written for anyone
cloning the repo: replace service names, origins, and environment values with
your deployment's values.

## What Gets Logged

Both Workers and the agent Container emit structured logs with:

- `scope: "novamind.demo"` — filter for application timing logs.
- `runId` — shared across browser-facing web Worker logs, service-binding
  agent Worker logs, and agent Container logs. The web API also returns it in
  `x-novamind-run-id`.
- `worker` — `web`, `agent-worker`, or `agent-container`.
- `event` — lifecycle event such as `request_start`, `stream_first_chunk`,
  `pipeline_stage`, `stream_proxy_heartbeat`, `stream_heartbeat`,
  `stream_event`, `stream_passthrough_event`, or `stream_complete`.
- `stage` / `stagePhase` / `stageElapsedMs` — pipeline stage timing details.
- `phase` / `status` / `label` — stream-event loop details, present for
  product-facing `agent_loop_event` milestones.

Cloudflare Observability also records platform fields under `$workers`,
`$container`, `$metadata`, and `$cf`.

The Stage 5 research demo also emits `agent_loop_event` SSE payloads for
product-facing loop milestones: SDK session startup, model planning or
structured-output finalization, tool selection, tool result return, recovery,
and completion. These events are for UI progress only; raw hidden thinking
text is never streamed to the browser.

## Prerequisites

Enable observability in both `wrangler.toml` files:

```toml
[observability]
enabled = true
head_sampling_rate = 1
```

Export a Cloudflare API token and account id before running the examples:

```bash
export CLOUDFLARE_ACCOUNT_ID="<account-id>"
export CLOUDFLARE_API_TOKEN="<api-token>"
```

The token needs Workers Observability access; Cloudflare currently documents
the telemetry query endpoint as requiring Workers Observability Write
permission.

Never commit real tokens, copied Access cookies, or raw logs containing user
identity. Keep local output in `/tmp` or another ignored path.

## Agent SDK Telemetry

The research orchestrator and data-viz report-builder use the Claude Agent SDK
in a deliberately bounded configuration: low effort by default, disabled
extended thinking by default, disabled tool search, disabled filesystem
settings, no SDK skills, disabled Claude Code memory auto-loading, strict MCP
config validation, and an isolated SDK working/config directory. The routes
still use the Agent SDK loop and typed MCP tools; the configuration removes
unrelated Claude Code startup context from the live-demo path. Tool handlers
return MCP `structuredContent` with concise text summaries, so each
orchestrator receives typed tool status and retry hints without relying on
JSON string parsing. Recoverable and fatal tool envelopes set MCP
`isError:true`; expected validation retries therefore show up as tool failures
in the agent loop, not as transport failures.

For the full rationale behind the Claude configuration, structured-output
adapter, prompt standards, and model/effort choices, see
[Claude integration](claude.md). This observability guide focuses on how to
verify those choices in production telemetry.

The data-viz report builder also logs a `structured_output` Agent SDK event
after the stream finishes. That timing record includes the SDK result subtype,
whether `structured_output` was present, the validated raw shape/keys, chart
count at completion, and any Zod validation error. Use it to distinguish SDK
structured-output retry failures from app-level chart-count or stream errors.

Useful runtime controls:

```bash
NOVAMIND_ORCHESTRATOR_EFFORT=low          # Sonnet routes support low | medium | high | max; xhigh only on supported models
NOVAMIND_ORCHESTRATOR_THINKING=disabled  # set to adaptive only for profiling
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
ENABLE_TOOL_SEARCH=false
NOVAMIND_CLAUDE_RUNTIME_DIR=/tmp/novamind-claude-agent-sdk
NOVAMIND_AGENT_SDK_STARTUP_TIMEOUT_MS=90000
NOVAMIND_AGENT_SDK_COLD_FIRST_MESSAGE_TIMEOUT_MS=90000
NOVAMIND_AGENT_SDK_WARM_FIRST_MESSAGE_TIMEOUT_MS=15000
NOVAMIND_AGENT_SDK_IDLE_TIMEOUT_MS=180000
NOVAMIND_AGENT_SDK_LIVE_STARTUP_WAIT_MS=2000
NOVAMIND_DATA_VIZ_FINAL_REPORT_GRACE_MS=10000
NOVAMIND_AGENT_SDK_DEBUG=false
NOVAMIND_AGENT_SDK_DEBUG_FILE=
```

To export Agent SDK traces to an OTLP collector, configure the standard OTel
environment variables on the agent Worker/Container. The Worker forwards
`OTEL_*`, `CLAUDE_CODE_OTEL_*`, and the Claude telemetry toggles into the
Container; the pipeline merges `novamind.run_id`, `novamind.action`, and
service attributes into `OTEL_RESOURCE_ATTRIBUTES`.

```bash
CLAUDE_CODE_ENABLE_TELEMETRY=1
CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
ENABLE_BETA_TRACING_DETAILED=1
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com
OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer <token>"
```

Leave those unset for ordinary local development. Cloudflare structured logs
are usually enough to find route/container/tool latency; OTLP is useful when
you need per-SDK-span visibility inside the Agent SDK loop.
Cold Agent SDK queries include the live run id in resource attributes. Warm
profiles are configured at startup time, so use the application timing logs
for per-run correlation when a live route uses `sdkStartupMode=warm_query`.

Client disconnects are logged as `stream_aborted` and propagate through the
SSE-owned `AbortController` into the Agent SDK query and direct structured
model calls. Treat those as lifecycle events, not model failures, unless they
occur without a corresponding browser navigation or manual cancellation.

Authenticated deck startup calls `/api/agent/startup`, which forwards to the
agent's `/runtime/startup` route. Startup logs include:

- `container_runtime_check` / `container_runtime_stale` /
  `container_runtime_recheck` — Worker-side checks that the named Cloudflare
  Container was started by the current Worker version before live traffic is
  proxied into it.
- `runtime_startup_complete` — route-level readiness summary, including RAG
  mode, vector preload status, data-viz source mode, and warm-profile
  statuses.
- `rag_warmup_stage` — corpus, embedding-index, and optional probe timings.
- `data_viz_warmup_start` / `data_viz_warmup_ready` — ClinicalTrials.gov
  dataset preload summary.
- `agent_sdk_runtime_stage` — Agent SDK warm-profile lifecycle events such as
  `startup_started`, `startup_joined`, `startup_skipped_ready`,
  `startup_ready`, `startup_aborted_for_live_run`, `warm_claimed`, and
  `warm_released`.

Agent SDK `startup()` pays Claude Code subprocess spawn and initialize cost
before a prompt is available. The runtime manager owns those warm handles in
the agent container, sequences profile startup, and gives live SSE routes
priority over background startup work.

## Query Scripts

Root package scripts wrap the Cloudflare Observability API so profiling
commands are repeatable and do not require copy-pasted Node snippets. The
scripts load `.env` when present, but exported shell variables take
precedence.

```bash
pnpm obs:cf:events -- --minutes 30 --needle novamind.demo
pnpm obs:cf:fields
pnpm obs:cf:values -- --key source.worker
pnpm obs:cf:runs -- --minutes 60
pnpm obs:cf:timeline -- --run-id <run-id>
```

Use `--json` on any command for machine-readable output. Use `--limit`,
`--minutes`, and `--needle` to tune the query window. `obs:cf:values`
requires `--key <field>` and is useful after `obs:cf:fields` when you need
to confirm exact service, worker, route, or event names. Pass
`--type number` or `--type boolean` for non-string fields. `obs:cf:timeline`
also accepts `RUN_ID=<run-id>` instead of `--run-id`.

## Find Recent Runs

Use `obs:cf:runs` to group recent logs by `runId` and pick the failed or
slow run to inspect:

```bash
pnpm obs:cf:runs -- --minutes 90
```

## Build A Run Timeline

When the UI shows an error, copy the `x-novamind-run-id` response header if
available. Cloudflare often uses the same value as the request `cf-ray`.

```bash
pnpm obs:cf:timeline -- --run-id <run-id>
```

## Interpreting Latency

Use the stage names to locate the bottleneck:

- `agent_endpoint_resolved` / `agent_response` — web Worker proxy and service
  binding overhead.
- `container_start_wait` / `container_ready` — Cloudflare Container wake-up.
- `rag_warmup_stage` with `corpus`, `embedding_index`, or
  `probe_retrieval` — corpus/vector preload and startup probe.
- `data_viz_warmup_ready` — trial dataset preload for the report-builder
  demo.
- `agent_sdk_runtime_stage` — warm-profile startup, claim, release, and
  abort lifecycle.
- `orchestrator_sdk` / `agent_sdk` with `sdkStartupMode=warm_query` or
  `cold_query` — live SDK route path. Long gaps before the first
  `system:init` point to SDK/session startup; long gaps after init and before
  `tool_use` point to model turn latency. `first_message_timeout` and
  `idle_timeout` are explicit SDK stream timeouts, not silent stalls.
- `search_literature` / `rag_retrieve` — deterministic retrieval latency.
- `extract_candidate_claims` — narrow claim-extraction model call.
- `verify_citations` — narrow citation-verification model call.
- `synthesize_hypothesis` — final hypothesis model call.
- `eval-run` `stream_start` — eval axis, case count, concurrency, hypothesis
  model/effort, judge model, schema name, and structured-output mode.
- `eval-run` `stream_event` — per-case and final eval timing plus token/cost
  rollups from the streamed `EvalStreamEvent`.
- `improve-prompt` `model_start` / `model_complete` — Sonnet prompt-improver
  model, requested/sent effort, schema name, structured-output mode, token
  usage, finish reason, structured-output retry count, direct-API rate-card
  cost estimate, and the configured post-response budget guard.
- `stream_first_chunk`, `stream_proxy_heartbeat`, `stream_heartbeat`, and
  `stream_complete` — browser stream delivery health through the web Worker
  proxy and agent SSE adapter. Proxy heartbeats are comment frames generated
  by the web Worker while an upstream model/tool turn is quiet.
- `stream_passthrough_event` — web Worker mirror of each upstream SSE event.
  Use it when agent Container stdout logs are delayed or missing; it records
  event type, stage/tool/phase metadata, error messages, and source event
  timestamps without copying large model payloads.

If the agent Container logs `pipeline_result` but the browser reports that the
stream ended before a final result, inspect the web Worker logs for platform
errors such as `failed to pipe response` or `Worker's code had hung`. That
points to a proxy/stream-idle issue rather than a missing backend result.

## Profiling Checklist

1. Open the deck while authenticated so `/api/agent/startup` fires.
2. Confirm startup logs show `corpusMode: "r2"`, expected `corpusPapers`,
   `vectorLoaded: true`, a successful probe when `probe` is enabled,
   `dataVizSourceMode: "r2"`, and `agent_sdk_runtime_stage` events reaching
   `startup_ready` for the warm profiles.
3. Start the live run and capture the `x-novamind-run-id` response header or
   Cloudflare `cf-ray`.
4. Build the run timeline with the command above.
5. Compare stage elapsed times:
   - Container wake should be small after startup.
   - RAG retrieval should be much smaller than model stages.
   - Long quiet intervals should still show `stream_proxy_heartbeat` at the web
     Worker and may also show agent-side `stream_heartbeat`.
   - The final stream should include both agent `pipeline_result` and web
     `stream_complete`.
6. If a stage regresses, inspect the prompt/context payload for that stage in
   code before changing models or architecture.

## Common Failure Signatures

- **`/api/agent/startup` returns 404:** the web deployment is stale or routed
  to a build without the runtime startup route. Redeploy the web Worker and
  confirm `docs/deployment.md` workflow paths are correct. If the agent
  Worker logs `container_runtime_stale`, it should destroy the stale
  container and retry once before returning traffic to the route.
- **Startup succeeds but first run spends time in `container_start_wait`:** the
  container instance changed or slept before the run. Trigger startup shortly
  before the demo and confirm post-deploy startup smoke passed for the current
  agent Worker version.
- **Live run uses `sdkStartupMode=cold_query`:** the warm profile was not
  ready, was already claimed, or was aborted so the visible run could proceed.
  Check preceding `agent_sdk_runtime_stage` events for
  `startup_joined`, `startup_aborted_for_live_run`, or `startup_failed`.
- **`first_message_timeout` appears:** the SDK query did not produce an init
  or content message within the configured first-message window. Inspect
  container resource pressure, Claude API reachability, and profile-specific
  runtime directories before widening the timeout.
- **`pipeline_result` exists in agent logs but browser missed it:** the web
  Worker/proxy stream ended early or the browser rejected a malformed terminal
  payload. Check for platform errors, verify SSE heartbeats are present during
  long model turns, and inspect the browser error text for an
  `invalid terminal event payload` contract failure.
- **Claim extractor/verifier schema errors:** inspect the retry path in
  `packages/pipeline/src/literature/tools.ts` and the normalization/validation
  logic in `packages/pipeline/src/literature/model-tools.ts`.
- **Fixture data in production:** check R2 URLs and `DEMO_FIXTURE_MODE`.
  Production should fail closed unless fixture mode is explicitly enabled.

## References

- Cloudflare Workers Observability telemetry query:
  <https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/>
- Deployment and Access setup: `docs/deployment.md`
- Architecture and stage timing map: `docs/architecture.md`
- API and stream contracts: `docs/api.md`
