# @novamind/pipeline

Reusable agent implementation shared by the live demos and eval harness.
This package has no HTTP server and no React code; callers import functions
and decide how to stream or persist results.

## Owns

- Literature RAG initialization and hybrid retrieval.
- Claude Agent SDK literature orchestrator plus scoped typed tools for direct
  RAG search, claim extraction, citation verification, and hypothesis
  synthesis. Tool calls return MCP structured content, share the caller's
  abort controller, and emit product-safe `agent_loop_event` milestones plus
  Cloudflare/OTel-correlatable timing records. The top-level SDK terminal
  output is a compact completion/failure contract; the substantive research
  handoff comes from the validated hypothesis tool result.
- Prompt improvement for the eval harness.
- ClinicalTrials.gov data-viz analysis: load dataset, run a Claude Agent SDK
  report-builder, let scoped tools profile and aggregate raw trial rows, and
  stream charts plus the final recommendation.
- Provider adapter for structured Claude/OpenAI calls. Claude one-shot calls
  use Messages API JSON structured outputs with explicit effort where
  supported, then validate with the local Zod schema before returning. The
  adapter records finish reason, sent effort, schema name, and normalized
  usage, then applies caller budgets as post-response guards. Agent SDK runs
  use SDK-reported cost telemetry; direct API calls estimate cost from the
  centralized `DIRECT_API_PRICING` rate card, which is date-stamped, sourced,
  and strict about model IDs. The same helper simplifies unsupported Claude
  JSON Schema constraints into descriptions for direct calls and Agent SDK
  final outputs while leaving Zod validation intact. Direct Claude calls retry
  once with a larger output-token budget when truncation prevents valid
  structured output, and mark final token-capped responses as truncated in
  call metadata. Prompt-cache savings are normalized into `TokenUsage` on the
  server side so UI code can render savings without carrying provider rate
  cards. Agent SDK actual costs come from SDK result fields; cache-savings
  display uses SDK cache-read tokens plus the configured agent model to
  reconstruct the uncached baseline. For Anthropic Messages responses,
  `input_tokens` is treated as regular uncached input after the last cache
  breakpoint, while `cache_read_input_tokens` and
  `cache_creation_input_tokens` are accounted for separately.

## Public Entry Points

- `runLiteratureAgent()` — async generator of `StreamEvent` values from the
  orchestrated research agent.
- `ensureDemoAgentSdkWarmProfiles()` — starts the literature and data-viz
  Agent SDK warm profiles with backend-owned single-flight lifecycle
  management.
- `agentSdkRuntimeStatus()` — reports current warm-profile state for
  authenticated runtime status routes.
- `runDataVizAnalysis()` — async generator of `DataVizStreamEvent` values.
- `preloadDataVizResources()` — resolves the ClinicalTrials.gov dataset for
  startup routes and returns a compact source summary.
- `improvePrompt()` — structured prompt-improvement call.
- `ensureRagReady()`, `preloadRagResources()`, and RAG exports for evals,
  diagnostics, and demo startup.

When the agent runtime has `INJECT_UNVERIFIED_CLAIM=true`, the Stage 5
claim-extraction tool wrapper appends the deterministic verifier-check claim
outside the Haiku extractor. Extracted claims remain abstract-derived, the UI
stream labels the demo claim for the audience, and model/tool handoffs omit
demo metadata so the orchestrator treats the resulting verifier rejection like
any other rejected claim. Evals pass `injectUnverifiedClaim:false` so scoring
uses only extracted claims.

`runDataVizAnalysis()` accepts an optional research handoff from the Stage 5
browser cache. The handoff includes the research question, synthesized
hypothesis, verified evidence, and confidence. The report-builder agent is a
top-level Agent SDK profile with a static prompt; the handoff arrives in the
run prompt. It inspects that handoff, profiles the ClinicalTrials.gov
snapshot, and calls a chart-building tool four times so numeric filtering and
aggregation stay in code rather than model context. Its final recommendation
uses the Agent SDK JSON-schema `outputFormat` and is accepted only when the SDK
returns a validated `structured_output` object with the success fields the UI
needs.

Agent SDK warm profiles are one-shot `WarmQuery` handles. The runtime manager
single-flights repeated startup calls, sequences profile startup inside one
container, lets live routes claim ready profiles, aborts background startup
when it blocks live work, and replenishes a profile after use.

Agent SDK tools return typed MCP `structuredContent` with concise text
summaries. Non-OK envelopes set MCP `isError:true` and include a typed
`retryHint`, which keeps recovery agentic without making Claude parse
free-form JSON text.

Direct model calls intentionally do not use the Agent SDK. Claim extraction,
citation verification, hypothesis synthesis, eval judges, and prompt
improvement are bounded single-turn transformations, so they go through
`callStructured()` instead. Keep that distinction when adding new demos:
Agent SDK for orchestration and recovery, direct structured Messages calls
for narrow typed transformations. The literature orchestrator emits a
deterministic completion note from typed run state instead of asking the
top-level agent to write a second narrative summary. Haiku calls omit effort
because the model does not support that parameter; Sonnet/Opus calls pass
explicit effort where
latency or reasoning depth matters. Prompts explain role, inputs, evidence
boundaries, and field meaning; schemas own output shape.

The project-wide Claude standards live in
[Claude integration](../../docs/claude.md). Read that guide before changing
Agent SDK options, direct structured-call behavior, prompt structure, model
choices, or telemetry fields.

## Data Resolution

RAG data normally loads from Cloudflare R2, then local
`internal/corpus/data/`, then the offline fixture. Production deployments
should use R2 for the generated PubMed and embedding artifacts.
ClinicalTrials.gov data follows the same
R2/local/fixture pattern through `NOVAMIND_TRIALS_URL`. Production fails
closed before fixture fallback unless `DEMO_FIXTURE_MODE=true` is set
explicitly.

See [Architecture](../../docs/architecture.md),
[Claude integration](../../docs/claude.md),
[Corpus pipeline](../../docs/corpus.md), and
[Eval harness](../../docs/evals.md).
