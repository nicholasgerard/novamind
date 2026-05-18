# Eval Harness

The eval harness lives in `packages/eval` and imports `@novamind/pipeline`
directly, so local eval runs exercise the same research-agent orchestrator,
typed tools, and provider adapters that drive the live demo. Some axes isolate
one tool handoff with a fixed fixture so prompt changes can be measured
without upstream noise.

Eval runs pass `injectUnverifiedClaim:false`; the research-agent verifier-check claim is a
live demo affordance and is not included in eval scoring.
Generated eval JSON files are written under `internal/eval/runs/`, which is
gitignored. Publish only sanitized aggregate results when sharing eval output.

## Axes

| Axis                     | What it measures                                                                                                                                 | LLM judge                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `single-turn-structured` | Strict-schema clinical-trial extraction across Claude vs GPT-5.1.                                                                                | None — schema validity + field completeness |
| `citation-accuracy`      | Whether verifier-approved extracted claims are actually supported by the cited abstract.                                                         | Haiku                                       |
| `plan-stability`         | Hypothesis-step behavior across fixed handoff fixtures: evidence precision, gap handling, rejected-claim discipline, and confidence calibration. | Haiku                                       |
| `retrieval-quality`      | 0–3 relevance of top-K hits across BM25 / Voyage / OpenAI / hybrid.                                                                              | Haiku                                       |

Each scorer is a `name → number-in-[0, 1]` function on `EvalSpec`. Cases
fail with `score = 0` rather than aborting the run.

`EvalSpec.task` receives an optional context with `signal`; live SSE routes
pass the browser request signal through `runEvalEvents`. Long-running axes
should forward that signal into Agent SDK calls, structured model calls, and
LLM judges so a cancelled browser stream stops upstream work promptly.

## Code Path Map

- `citation-accuracy` runs the full Stage 5 literature agent through
  `collectLiteratureAgentRun()` with demo mode disabled, then asks a Haiku
  judge whether the final verifier-approved evidence is
  supported by the cited abstracts.
- `plan-stability` starts where the research agent's hypothesis tool starts:
  fixed handoff fixtures provide the research question, retrieved abstracts,
  `verified_claims`, and `rejected_claims`. This keeps prompt hill-climbing
  focused on synthesis behavior instead of retrieval or extraction variance.
- `retrieval-quality` calls the RAG layer directly across BM25, vector, and
  hybrid methods, then uses a Haiku relevance judge for top-K hit quality.
- `single-turn-structured` calls the provider-agnostic structured output
  adapter on clinical-trial records and scores schema validity plus field
  completeness without an LLM judge. Claude runs with explicit low effort
  because this axis tests schema adherence and extraction discipline, not deep
  deliberation.

The live `/08-eval-harness` page exposes `plan-stability` as the main
hill-climb demo and accepts `citation-accuracy` through the same streaming
endpoint. The other two axes remain CLI-oriented because they compare provider
or retrieval-method variants rather than one editable prompt.

## Run Locally

Default tests are deterministic and do not call external providers:

```bash
pnpm test
```

Live eval scripts call Claude/OpenAI/Voyage/Braintrust where relevant and
require the corresponding API keys in `.env`. They are documented as opt-in
checks rather than CI requirements.

```bash
pnpm --filter @novamind/eval citation-accuracy
pnpm --filter @novamind/eval plan-stability -- --limit=3
pnpm --filter @novamind/eval prompt-improver-effort
pnpm --filter @novamind/eval single-turn-structured
pnpm --filter @novamind/eval retrieval-quality -- --methods=bm25,hybrid
```

`--limit=N` truncates the curated dataset to the first `N` cases (useful
during development). Each script:

1. Prints a per-case ledger to the console.
2. Writes the full result to `internal/eval/runs/<axis>-<timestamp>.json`
   (gitignored).
3. Uploads the result to Braintrust under the `novamind` project when
   `BRAINTRUST_API_KEY` is set, and prints the experiment URL.

The CLI helpers used by all four scripts live in
[`packages/eval/scripts/cli-utils.ts`](../packages/eval/scripts/cli-utils.ts) —
keep new axes consistent by importing from there.

## Live UI

The hill-climbing demo at `/08-eval-harness` calls:

- `POST /api/eval/run` on the web Worker (proxies to the agent's
  `POST /eval/run`). The endpoint streams `EvalStreamEvent`s.
- `POST /api/eval/improve` on the web Worker (proxies to the agent's
  `POST /improve-prompt`). Synchronous JSON.

The interactive UI focuses on the hypothesis prompt because it is the clearest
"edit one prompt → rerun → watch the score move" loop. It runs three curated
`plan-stability` cases by default so all cases can execute in parallel and the
demo reaches the hill-climb moment quickly. Each case starts at the same
contract the research demo's hypothesis tool receives after upstream work is
complete: a question, retrieved abstracts for context, `verified_claims`, and
`rejected_claims`. The live fixtures focus on partial answers, rejected-claim
lures, and mechanism boundaries. The synthesis prompt should select only
relevant evidence, name missing or indirect support, keep rejected claims out
of factual support, and calibrate confidence to the case.

The `plan-stability` Haiku judge emphasizes auditable evidence boundaries.
Full credit requires every material facet of the question to be visibly
classified as directly supported, indirect, missing, off-question, or blocked
by a rejected claim. This rewards synthesis that a downstream scientist can
inspect rather than generic caution.

The UI captures the first run with at least one successfully scored case as
the visible `v0` baseline, then appends later reruns to the hill-climb trace.
The chart shows the aggregate score as the primary line over stacked
metric-contribution bars; hovering a segment explains the metric score and
its contribution to the aggregate. If one live case errors, the chart and
prompt improver use the completed cases only so transient provider failures
do not block the hill-climb flow. The case inspector lets reviewers select a
run and one of the live cases to inspect the hypothesis, selected evidence
IDs, confidence, grader notes, or the case-level error. Live eval routes also
apply a per-case timeout, so one wedged model call is recorded as a failed case
instead of holding the whole run open.

The prompt improver runs a single Sonnet 4.6 structured call that returns a
full replacement system prompt plus rationale and the metric it targets. The
pipeline deterministically selects the weakest average metric, compacts the
latest run into the worst few cases for that metric, and sends only short
answer excerpts plus the relevant grader note. That keeps the improvement turn
fast while still targeting the observed failure pattern rather than just the
aggregate score. In the live UI, the recommendation opens in a modal while the
editor loads the replacement prompt and highlights the changed lines for
inspection.

Repeated hill-climb loops are supported. Each **Run** sends the prompt that is
currently loaded in the editor, and each **Improve** sends that same current
prompt plus the latest completed run summary. The second
`run → improve → run → improve` cycle therefore builds on the first replacement
prompt after it has been scored, then recomputes the weakest average metric
from the new run before asking for the next edit. Pressing **Improve** again
without rerunning is allowed, but it reuses the last completed run's score
trace and should be treated as an edit refinement rather than a newly measured
hill-climb step.

The improver uses the same provider adapter as the narrow research tools:
Claude Messages API JSON structured outputs (`output_config.format`) with
local Zod validation after the response. Direct-call budgets are enforced as
post-response guards, truncation retries happen once with a larger
`max_tokens` budget, and telemetry records provider finish reason so schema
failures are diagnosable. The improver keeps a stable output schema across
runs so Claude's structured-output grammar cache can be reused; the selected
target metric is enforced in local validation after the provider response.
Prompt text describes the semantic task and field meaning; the
structured-output schema owns response shape. This is intentional example-code
architecture: use
Agent SDK structured outputs for multi-turn tool workflows, and use direct
JSON structured outputs for one-shot model calls where no tool loop is needed.
Sonnet 4.6 effort is set explicitly so API defaults do not silently move
latency; the live default is `low`, which the included effort check keeps as a
lightweight prompt-engineering recommendation. Use
`pnpm test:live:improver-effort` to compare `low` and `medium` on a
representative failure trace before changing that default.

The prompt and schema discipline here follows the shared project standard in
[Claude integration](claude.md): eval prompts describe rubric semantics and
field meaning, while `callStructured()` and Zod own response shape,
validation, retry metadata, finish-reason telemetry, and direct-API cost
estimates from the shared pricing catalog.

## Braintrust

Set `BRAINTRUST_API_KEY` to enable Braintrust logging on every CLI run.
Local JSON output continues to be written even without Braintrust, which is
useful for offline development and public walkthroughs.

The provider-comparison CLI can run OpenAI direct structured calls. Those runs
use the same `DIRECT_API_PRICING` catalog as the live Claude calls for
request-level cost estimates; the catalog links to the current
[OpenAI pricing page](https://developers.openai.com/api/docs/pricing) and
fails unknown model IDs explicitly.

## Adding A New Axis

1. Add `packages/eval/src/axes/<axis>.ts` exporting a `buildXSpec()`
   factory plus a default `xSpec` instance for CLI use.
2. If you need a Haiku judge, add it under `packages/eval/src/scorers/`
   following the cache-by-key pattern in the existing judges.
3. Add `packages/eval/scripts/<axis>.ts` using `parseCliArgs`, `runEval`,
   and `persistRun` from `cli-utils.ts`.
4. Wire the package script under `packages/eval/package.json`.
5. To expose it in the live UI, extend the `axis` switch in
   `apps/agent/src/server.ts` and add the route to the harness controls.
