# API and Streaming Contracts

The browser never calls provider APIs directly. It calls web API routes under
`apps/web/app/api/*`; those routes validate access, validate JSON with Zod,
then proxy to the agent over the Cloudflare `AGENT_SERVICE` binding in
production.

All request schemas live in `packages/shared/src/api-requests.ts`; all stream
event schemas live in `packages/shared/src/*events.ts`.

## Web Routes

| Route                    | Method   | Body                      | Response                 | Purpose                                                                               |
| ------------------------ | -------- | ------------------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| `/api/auth/access-login` | `GET`    | none                      | `302`                    | Verifies Cloudflare Access identity and sets non-sensitive UI hint cookies.           |
| `/api/auth/access-login` | `DELETE` | none                      | `204`                    | Clears the UI hint cookies.                                                           |
| `/api/agent/startup`     | `POST`   | none                      | JSON                     | Starts the agent container and preloads demo RAG, trial data, and Agent SDK profiles. |
| `/api/agent/status`      | `GET`    | none                      | JSON                     | Returns current in-container Agent SDK warm-profile status for authenticated users.   |
| `/api/stream`            | `POST`   | `LiteratureStreamRequest` | SSE `StreamEvent`        | Runs the orchestrated research agent.                                                 |
| `/api/data-viz/run`      | `POST`   | `DataVizRunRequest`       | SSE `DataVizStreamEvent` | Runs the ClinicalTrials.gov report-builder agent against the research handoff.        |
| `/api/eval/run`          | `POST`   | `EvalRunRequest`          | SSE `EvalStreamEvent`    | Runs live eval axes for the harness.                                                  |
| `/api/eval/improve`      | `POST`   | `PromptImproverRequest`   | JSON                     | Calls the Sonnet prompt-improver.                                                     |

Every mutating web route rejects cross-origin browser requests and requires a
verified email in production. Local development bypasses Cloudflare Access
only when `NOVAMIND_ALLOW_LOCAL_AUTH=1` is set; the package `dev` scripts set
that flag for you.

Web routes share one route helper for access enforcement, request-start logs,
and validation-error telemetry. SSE routes then call the shared stream proxy,
which forwards the browser request's abort signal to the agent service.
Shared proxy helpers preserve upstream agent error status codes and bounded
retry/auth headers while replacing internal error details with a run-id
reference for logs.

## Agent Routes

| Route                | Method | Response                 | Purpose                                                     |
| -------------------- | ------ | ------------------------ | ----------------------------------------------------------- |
| `/health`            | `GET`  | JSON                     | Public liveness check.                                      |
| `/runtime/startup`   | `POST` | JSON                     | Preloads demo resources and starts Agent SDK warm profiles. |
| `/runtime/status`    | `GET`  | JSON                     | Returns current Agent SDK warm-profile status.              |
| `/literature/stream` | `POST` | SSE `StreamEvent`        | Research agent stream.                                      |
| `/data-viz/run`      | `POST` | SSE `DataVizStreamEvent` | Data-viz report-builder stream.                             |
| `/eval/run`          | `POST` | SSE `EvalStreamEvent`    | Eval stream.                                                |
| `/improve-prompt`    | `POST` | JSON                     | Prompt-improvement result.                                  |

The web Worker forwards `x-novamind-access-email` only after verifying
Cloudflare Access identity. The agent accepts that forwarded email only when
`x-novamind-internal-signature` validates against
`NOVAMIND_AGENT_INTERNAL_TOKEN`; the signature covers method, path, run id,
timestamp, and email with a short replay window. Direct public agent requests
must carry a valid Cloudflare Access JWT.

## Request Limits

`MAX_JSON_BODY_BYTES` is 256 KiB. User questions are limited to 1,000
characters, custom system prompts to 20,000 characters, live eval runs to 24
cases, explicit eval case selections to 24 IDs, and live eval concurrency to 4.
Eval requests may provide either explicit `caseIds` or a `limit`, not both.
Invalid JSON or schema mismatches return `400`; oversized bodies return `413`.

The agent applies in-memory per-email rate limits:

- Literature: 12 requests per minute.
- Runtime startup: 12 requests per minute.
- Data viz: 8 requests per minute.
- Eval run: 4 requests per minute.
- Prompt improvement: 6 requests per minute.

For production use beyond a single demo container, replace the in-memory
limiter with a shared store such as Cloudflare Durable Objects, D1, or Redis.

Runtime startup routes accept `?probe=0` to skip the one-hit literature
retrieval probe and `?wait=1` to wait for Agent SDK warm profiles to reach a
terminal ready/failed state before responding. Normal browser startup waits
for the idempotent resource preloads and schedules non-blocking SDK profile
startup; smoke tests use `?wait=1` when they need a synchronous SDK readiness
check. Warm profiles are backend-owned and single-flight inside the agent
container, so repeated browser reloads join or observe the same runtime state
instead of creating browser-scoped processes.

`/health`, `/runtime/status`, and `/runtime/startup` include a runtime
identity object. In production, the agent Worker compares that identity with
its `CF_VERSION_METADATA` binding before proxying live traffic so stale
Cloudflare Container processes are restarted automatically.

## Event Shapes

`StreamEvent` values are:

- `literature_stage_started`
- `literature_stage_message`
- `agent_loop_event` (product-safe Agent SDK loop milestone)
- `tool_call`
- `tool_result`
- `literature_stage_finished`
- `pipeline_result`
- `error`

`agent_loop_event` exposes bounded loop state for the Stage 5 transcript:
`phase` (`session`, `model`, `tool`, `recovery`, or `complete`), `status`,
human-readable `label`, optional `detail`, optional elapsed milliseconds, and
optional tool name. It intentionally does not expose hidden model thinking
content; it gives users progress visibility while keeping the agent contract
stable. Labels are produced by the agent service and should be rendered by
clients as the source of truth; clients should use `phase`, `status`, and
`tool` for tone/icon selection rather than deriving agent state from stage
ordering.

`DataVizStreamEvent` values are:

- `data_viz_agent_event`
- `data_viz_started`
- `data_viz_tool_call`
- `data_viz_tool_result`
- `data_viz_step`
- `data_viz_chart`
- `data_viz_complete`
- `data_viz_error`

`data_viz_started.source` includes `sourceMode` (`r2`, `local`, or
`fixture`), `sourceName`, `isFixture`, source timestamp, and row counts so
clients and logs can distinguish real R2/local data from explicit fixture
mode. The presentation UI shows the row counts and keeps source-mode detail in
the stream payload rather than adding an extra badge to the stage.

`data_viz_agent_event` exposes product-safe Agent SDK progress for the
report-builder session. `data_viz_tool_call` / `data_viz_tool_result` expose
the scoped handoff inspection, dataset profiling, and chart-building tool
boundaries. `data_viz_chart` is emitted once per completed chart so the
browser can render the report board incrementally. `data_viz_complete` prefers
the Agent SDK final `structured_output` after it validates against the report
schema. Once all four charts have been generated, the stream will also emit
`data_viz_complete` from the completed chart set if that final SDK turn stalls
or returns invalid structured output. The agent is instructed to build the full
chart set before finalizing; if the SDK returns a valid final report after
fewer chart events, the stream emits a warning step and still returns the
validated report instead of discarding it.

`DataVizRunRequest` accepts an optional `researchHandoff` containing the
latest research question, synthesized hypothesis, verified evidence claims,
and confidence. The Stage 6 browser UI supplies that handoff from its local
demo cache and disables generation until a Stage 5 research run has
completed.

`EvalStreamEvent` values are:

- `eval_started`
- `eval_case_started`
- `eval_case_complete` (scores plus optional axis-specific case output)
- `eval_complete`
- `eval_error`

The event schemas are the canonical contracts for server producers, tests, and
client guards. Request bodies are Zod-validated at web and agent service
boundaries. Browser code uses lightweight runtime guards derived from the
same event contracts before rendering streamed payloads, which keeps the UI
resilient to contract drift without pulling the full Zod validator into
client bundles. Terminal event guard failures are treated as stream errors
instead of being silently dropped, so a malformed final result cannot make a
demo appear to finish without its final card.

Stream completion events include `TokenUsage`: regular input tokens, output
tokens, cache-read tokens, cache-creation tokens, and `costUsd`. When
prompt-cache economics can be computed server-side, usage may also include
`uncachedCostUsd` and `cacheSavingsUsd` for display-only comparisons; actual
cost accounting always uses `costUsd`. Agent SDK routes use the SDK result cost
estimate as the actual cost. Direct structured model calls use the
date-stamped direct-API pricing catalog in `@novamind/pipeline` because those
provider responses report tokens but not request-level dollars.

The web stream proxy and agent SSE adapter may emit transport-level comment
heartbeats during long model turns. They are not JSON events and are
intentionally ignored by the browser parser; their purpose is to keep
Cloudflare and browser streams active while a backend model call is still
running.

`PromptImproverRequest.runSummary` is scoped to the `plan-stability` axis.
Its `cases[]` entries may include a short generated hypothesis excerpt and
`gradingNotes` keyed by metric. The agent recomputes the weakest average
metric, keeps only the worst few cases for that metric, and uses the relevant
notes to turn a weak eval pattern into a targeted system-prompt edit. Eval
setup text and metric semantics live with the server-side prompt improver, not
in the browser request.

`EvalRunRequest.caseIds` is optional. When present, the agent runs those cases
in the requested order instead of taking the first `limit` cases from the axis.
