# Claude Integration Guide

This repo is intended to be example code for building with Claude. The goal is
not only to make the demos work, but to make the Claude architecture easy to
inspect, extend, and defend.

Use this guide when changing any Claude Agent SDK orchestration, direct Claude
Messages API call, prompt, schema, tool description, or telemetry field.

## Design Principles

- Use the Claude Agent SDK for bounded orchestration: multi-step trajectories,
  typed tool choice, recoverable tool errors, and product-facing loop progress.
- Use direct Claude Messages API JSON structured outputs for one-shot
  transformations: extraction, verification, judging, prompt improvement, and
  final bounded synthesis.
- Keep provider credentials and model calls on the agent service. Browser code
  should receive typed stream events and never provider keys or raw hidden
  model state.
- Let schemas own response shape. Prompts should explain role, task, inputs,
  evidence boundaries, rubrics, and field meaning, not restate JSON syntax.
- Keep typed local validation even when Claude is configured for structured
  output. Provider constraints guide generation; Zod validation protects
  application boundaries and makes tests deterministic.
- Optimize context before changing models. Send only the evidence, handoff,
  rubric, or dataset summary the call needs.
- Make latency decisions explicit. Model, effort, token budget, finish reason,
  retry count, and cost should be visible in logs for every live Claude call.

## When To Use The Agent SDK

Use `@anthropic-ai/claude-agent-sdk` when Claude needs to decide what to do
next. In this repo that includes:

- Stage 5 literature orchestration in
  `packages/pipeline/src/literature/orchestrator.ts`.
- Stage 6 report-builder orchestration in
  `packages/pipeline/src/data-viz/analysis.ts`.

These routes use the SDK because the model is coordinating tools, reading
typed tool results, recovering from recoverable tool errors, and producing a
trajectory users can watch.

Do not use the SDK for narrow calls that do not need a tool loop. Direct
structured Messages calls are faster, cheaper, easier to test, and easier to
profile for those cases.

### Agent SDK Configuration

The production SDK routes are intentionally bounded:

- Authenticated deck startup uses Agent SDK `startup()` for two warm profiles:
  `literature` and `data-viz`. Each profile's startup options match the live
  query options because `WarmQuery` accepts only the eventual prompt.
- Warm profiles are one-shot backend resources. The runtime manager
  single-flights repeated startup requests, sequences profile startup inside
  one container, lets live runs claim a ready handle, and replenishes the
  profile after use through the same startup queue.
- Live runs have priority over background startup. If a profile is still
  starting, the live route waits only `NOVAMIND_AGENT_SDK_LIVE_STARTUP_WAIT_MS`
  before aborting that warm startup and using a cold `query()` with the same
  options.
- SDK message streams are wrapped in first-message and idle-message timeouts
  (`NOVAMIND_AGENT_SDK_*_TIMEOUT_MS`) so startup or stream stalls become
  explicit errors with telemetry.
- `tools: []` disables built-in Claude Code tools on the main thread.
- `allowedTools` lists only route-specific MCP tools.
- `permissionMode: "dontAsk"` prevents server routes from waiting on
  interactive permission prompts.
- `strictMcpConfig: true` fails fast when MCP registration is malformed.
- `settingSources: []`, `skills: []`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`,
  and profile-specific isolated `CLAUDE_CONFIG_DIR` values keep user Claude
  Code settings, skills, and memory out of production context.
- `ENABLE_TOOL_SEARCH=false` keeps a small fixed tool catalog visible without
  tool-search overhead.
- Top-level route instructions use `systemPrompt` on the SDK session. Programmatic
  `agents` are reserved for actual subagents; the Stage 5 and Stage 6
  orchestrators are each the main session agent and expose their scoped MCP
  tools directly at that session boundary.
- Every Agent SDK route uses `outputFormat` for its terminal contract. The
  pipeline validates returned JSON with Zod before accepting the run. A
  successful SDK result must include `structured_output`; plain result text is
  not accepted as a substitute.
- Keep terminal Agent SDK contracts as small as the route allows. The
  literature orchestrator returns only completion/failure status because the
  substantive hypothesis handoff is produced by the typed synthesis tool and
  emitted as `pipeline_result`. The data-viz report-builder returns the final
  recommendation, rationale, and caveats because that top-level agent owns the
  report.
- `persistSession:false` is used for these one-shot demo tasks. They do not
  need resume/fork behavior or a shared `sessionStore`; durable handoff state
  is the typed application payload passed from Stage 5 to Stage 6.
- `thinking` is disabled by default for latency-sensitive demos. Enable
  adaptive thinking only when profiling or intentionally exploring a more
  complex orchestration problem.
- `NOVAMIND_ORCHESTRATOR_EFFORT` defaults to `low`. Sonnet 4.6 routes accept
  `low`, `medium`, `high`, or `max`; `xhigh` is passed only for models that
  support it. Unsupported values fall back to `low`.

The agent container uses one vCPU, 3 GiB RAM, and 5 GB disk. This keeps the
Claude Agent SDK startup path responsive while satisfying Cloudflare
Containers' memory and disk validation rules for a custom one-vCPU instance.
SDK environment defaults enable the stream watchdog, bound API
timeouts/retries, and keep SDK prompt caching on the default ephemeral cache.
Set `ENABLE_PROMPT_CACHING_1H=1` only when your deployment benefits from
one-hour cache writes enough to justify their higher write cost.

Agent SDK terminal contracts use Claude-compatible JSON schemas generated by
`claudeStructuredOutputSchema()`. Tool progress and user-visible loop status
are streamed separately through typed SSE events, with backend-owned labels so
browser clients render progress instead of inferring orchestration state from
stage order.

### MCP Tool Design

Tool descriptions should be specific enough for Claude to route correctly
without large prompt blocks. Each tool description should say:

- when the tool should be called;
- what inputs matter;
- what the tool owns deterministically;
- what the tool does not do;
- when `retryReason` is appropriate.

Tool handlers return MCP `structuredContent` plus concise text summaries. This
lets Claude read typed status, data, and retry hints without parsing JSON
prose. Non-OK envelopes set MCP `isError:true`; recoverable validation
failures therefore appear as tool failures inside the agent loop and can be
retried by the orchestrator.

The literature tools intentionally mutate in-memory run state and emit stream
events, so they are not documented as read-only even when their underlying data
access is read-only.

## When To Use Direct Structured Calls

Use `callStructured()` from `packages/pipeline/src/structured.ts` for bounded
single-turn calls. Current Claude direct-call users include:

- Haiku claim extraction.
- Haiku citation verification.
- Opus hypothesis synthesis.
- Haiku eval judges.
- Sonnet prompt improvement.
- CLI/provider comparison structured extraction.

Claude direct calls use Messages API JSON structured outputs via
`output_config.format`. The adapter then parses the returned text and validates
it with the original Zod schema.

The high-reuse literature model tools attach Anthropic `cache_control`
breakpoints to the retrieved-paper block with a 1-hour TTL. Claim extraction
and citation verification share the same stable Haiku prefix, so the verifier
can reuse the papers the extractor just loaded, and repeat demo runs can reuse
the same paper prefix while the presenter moves through the deck. The
hypothesis tool keeps its synthesis prompt but applies the same paper-block
cache pattern for repeat Opus runs. Callers opt into breakpoints explicitly
through `callStructured({ cacheControl })` for stable system prompts or
cache-marked `userPrompt` blocks; smaller or frequently changing prompts skip
caching.

### Structured Output Rules

- Define the application contract in Zod near the call site.
- Use `.strict()` for object outputs unless extra provider fields are
  intentionally accepted.
- Use field `.describe()` text for semantic guidance and allowed meanings.
- Do not put "return JSON", "match this schema", or "do not use prose" in the
  prompt when structured outputs already configure the shape.
- It is fine to keep semantic cardinality instructions in prompts, such as
  "extract one claim per paper" or "return one verdict per evidence ID"; those
  describe the task, not JSON syntax.
- Keep normalizers narrowly scoped to real provider variation. They should map
  likely aliases into canonical fields, not silently accept arbitrary shapes.

Claude's JSON-schema subset does not support every constraint generated from
Zod. `claudeStructuredOutputSchema()` removes unsupported constraints before
sending the schema and appends those constraints to field descriptions. For
Agent SDK final outputs, keep the local Zod validator aligned with the schema
the SDK can enforce: use JSON Schema for machine shape and required fields, and
put presentation constraints such as "concise" or "no more than four caveats"
in field descriptions, prompts, and UI rendering.

### Error Handling

Direct structured calls return `schemaValid:false` for schema mismatches and
include `rawJson`, `parseError`, usage, finish reason, effort, schema name,
and retry metadata. Transport failures and explicit budget-guard failures
throw.

The Claude Messages transport retries transient `429`, `529`, and `5xx`
responses with short jittered backoff and honors `retry-after` up to a bounded
delay. Abort signals are still respected during backoff so browser
cancellation stops the request path promptly.

If Claude stops with `stop_reason: "max_tokens"` before producing locally
valid output, `callStructured()` retries once with a larger output-token
budget. The final metadata records `initialFinishReason: "max_tokens"` and
`retryCount: 1`; if the final provider response is still token-capped, it
also records `truncated: true` so callers can distinguish truncation from
ordinary schema-invalid output.

Tool wrappers convert structured-call validation failures into typed
recoverable tool errors when the orchestrator can reasonably try again with a
repair instruction. Fatal failures become stream errors instead of being
hidden behind mocked output.

The SSE lifecycle owns an `AbortController`. Browser disconnects propagate
into the Agent SDK query and direct structured model calls so abandoned runs
do not continue spending tokens.

### Budgeting And Telemetry

Agent SDK orchestration and direct Messages API calls report cost through
different paths:

- Agent SDK result messages include SDK-estimated cost fields
  (`modelUsage.costUSD` and `total_cost_usd`). The literature and data-viz
  orchestrators use those SDK values for top-level agent usage. Prompt-cache
  savings are derived server-side from SDK cache-read token counts and the
  configured agent model, while the SDK-reported value remains the actual
  `costUsd`.
- Direct Messages API responses report token usage, not dollars. The
  structured-call adapter estimates direct-call cost from the centralized
  `DIRECT_API_PRICING` catalog in
  `packages/pipeline/src/providers/pricing.ts`. That catalog is date-stamped,
  includes a review date, links to the official provider pricing pages, and
  throws on unknown model IDs instead of applying a default rate.

Direct Messages API calls cannot pre-authorize a per-call spend ceiling. The
adapter enforces `maxBudgetUsd` as a post-response guard against the same
rate-card estimate and logs the budget with usage metadata so regressions are
visible. In production systems that need billing reconciliation, pair this
per-request telemetry with the Claude Usage and Cost API rather than making
the live request path depend on an admin billing endpoint.

Every live Claude call should expose:

- model;
- provider;
- schema name;
- structured-output mode;
- requested effort;
- sent effort;
- max output tokens where relevant;
- finish reason;
- retry count;
- input/output tokens;
- cost.

Use `docs/observability.md` and the root `obs:cf:*` scripts to profile
production runs.

## Prompting Standards

Prompts should be clear, direct, and task-specific. Prefer this structure:

1. Role and domain.
2. Inputs, usually wrapped in XML tags.
3. Evidence boundaries and source-of-truth rules.
4. Decision or scoring rubric.
5. Field meaning, when structured output fields need semantic interpretation.

Avoid this structure:

- JSON examples that duplicate the schema.
- Repeated "valid JSON only" instructions.
- Long defensive schema-adherence boilerplate.
- Hidden implementation history or demo mechanics that the model does not
  need to know.
- Broad "be careful" language without concrete criteria.

Use XML tags for large structured inputs (`<papers>`, `<claims>`,
`<verified_claims>`, `<rejected_claims>`, `<rubric>`). This keeps model
context readable and reduces ambiguity without forcing brittle string parsing.

### Schema Versus Prompt Responsibility

Use the schema for:

- field names;
- field types;
- enum values;
- required/optional fields;
- local validation constraints.

Use the prompt for:

- what counts as evidence;
- how to choose among valid options;
- what a score means;
- when to abstain, lower confidence, or name a limitation;
- how to treat rejected or missing evidence.

This division is important. If a prompt explains JSON shape that the provider
already enforces, it adds tokens and gives reviewers a reason to question
whether the code is relying on prompts instead of structured outputs.

## Current Model Choices

| Workload                    | Model path                                    | Why                                                                                 |
| --------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Literature orchestrator     | Sonnet 4.6 Agent SDK, low effort              | Coordinates the tool trajectory and recovery while keeping first-token latency low. |
| Report-builder orchestrator | Sonnet 4.6 Agent SDK, low effort              | Chooses analyses and chart tools from a bounded catalog.                            |
| Claim extraction            | Haiku 4.5 direct structured call              | Concrete extraction from retrieved abstracts; no tool loop needed.                  |
| Citation verification       | Haiku 4.5 direct structured call              | Batched claim-vs-abstract verification; fast and cheap enough for live demo.        |
| Hypothesis synthesis        | Opus 4.7 direct structured call, high effort  | Deep synthesis over verified/rejected evidence with explicit confidence scoring.    |
| Eval judges                 | Haiku 4.5 direct structured calls             | Strict rubric scoring at low cost.                                                  |
| Prompt improver             | Sonnet 4.6 direct structured call, low effort | Produces targeted prompt edits from eval traces with good latency.                  |

Haiku calls omit `effort` because that model does not support the parameter.
Sonnet/Opus calls set effort explicitly where latency or reasoning depth
matters.

## Context Shaping

The research demo deliberately narrows each context:

1. The Agent SDK orchestrator sees the question, tool catalog, and typed tool
   results.
2. Search is deterministic hybrid RAG; the orchestrator supplies the query,
   but no LLM rewrites the query.
3. The extractor sees retrieved abstracts and returns one candidate claim per
   paper.
4. The extractor wrapper can append the verifier-check claim when
   `INJECT_UNVERIFIED_CLAIM=true`; model prompts and orchestrator handoffs do
   not reveal demo metadata.
5. The verifier sees candidate claims and their matching abstracts in one
   batched call.
6. The hypothesis model sees retrieved abstracts for context, verified claims
   as the only allowed evidence, and rejected claims only for limitations and
   confidence calibration.
7. TypeScript assembles final evidence from supported verifier verdicts only.

The data-viz demo follows the same pattern. Claude chooses analysis intent;
TypeScript tools inspect the handoff, profile the trial dataset, aggregate raw
ClinicalTrials.gov rows, and stream chart data. The model writes the final
recommendation from tool-returned numbers instead of inventing chart values.
The final recommendation remains an Agent SDK structured output rather than a
tool call, which keeps domain tools focused on deterministic data access and
leaves final report shape to the explicit output schema. That terminal schema
is intentionally small: after the fourth chart succeeds, the report-builder is
prompted to return a one-sentence recommendation, one-sentence rationale, and
at most two short caveats instead of spending another turn writing a narrative
report.

## Extension Checklist

When adding or changing a Claude call:

1. Decide whether it needs Agent SDK orchestration or a direct structured call.
2. Put schemas next to the call site and export only what other packages need.
3. Add `.describe()` text for semantic fields and `.strict()` for object
   schemas.
4. Remove prompt text that duplicates response shape.
5. Wrap large inputs in XML tags and prune context to the minimum useful set.
6. Set model, effort, token budget, and budget guard intentionally.
7. Ensure abort signals propagate.
8. Log model, schema, effort, finish reason, retries, usage, and cost.
9. Add deterministic unit tests for adapter behavior or validation logic.
10. Update the relevant public guide in `docs/`.

## References

- Anthropic Claude Agent SDK TypeScript:
  <https://code.claude.com/docs/en/agent-sdk/typescript.md>
- Anthropic Claude Agent SDK hosting:
  <https://code.claude.com/docs/en/agent-sdk/hosting.md>
- Anthropic Claude Agent SDK sessions:
  <https://code.claude.com/docs/en/agent-sdk/sessions.md>
- Anthropic Agent SDK structured outputs:
  <https://code.claude.com/docs/en/agent-sdk/structured-outputs.md>
- Anthropic Agent SDK system prompts:
  <https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts.md>
- Anthropic Agent SDK MCP:
  <https://code.claude.com/docs/en/agent-sdk/mcp.md>
- Anthropic Agent SDK cost tracking:
  <https://code.claude.com/docs/en/agent-sdk/cost-tracking>
- Anthropic Claude API pricing:
  <https://platform.claude.com/docs/en/about-claude/pricing>
- Anthropic Usage and Cost API:
  <https://platform.claude.com/docs/en/manage-claude/usage-cost-api>
- Anthropic prompt engineering best practices:
  <https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/claude-prompting-best-practices>
- Anthropic strict tool use:
  <https://docs.claude.com/en/docs/agents-and-tools/tool-use/strict-tool-use>
