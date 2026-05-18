# Local Development

## Prerequisites

- Node 22+
- pnpm via Corepack
- Optional: provider keys in `.env` (see [.env.example](../.env.example))

```bash
corepack enable
pnpm install
cp .env.example .env
```

## Run The App

```bash
pnpm dev
```

This starts the web Next dev server and the agent Hono server side-by-side
through Turborepo:

- Web: <http://localhost:3000>
- Agent: <http://localhost:8787>

Useful local routes:

- <http://localhost:3000/01-welcome> (cover slide; arrow keys navigate stages)
- <http://localhost:3000/05-research-agent-demo> (orchestrated research agent)
- <http://localhost:3000/06-data-visualization-demo> (research handoff to report-builder demo)
- <http://localhost:3000/08-eval-harness> (hill-climbing harness)
- <http://localhost:8787/health> (agent liveness)

The presentation routes render without provider keys. Live actions that spend
tokens or build embeddings require the relevant keys in `.env`: Anthropic for
Claude Agent SDK and structured Claude calls, Voyage/OpenAI for corpus
embedding and vector retrieval paths, and Braintrust only for optional eval
trace uploads. The app surfaces provider or data-configuration failures rather
than silently replacing live work with mock output.

## Environment Loading

Use [.env.example](../.env.example) as the environment-variable reference.
Copy it to `.env` and fill only the providers and deployment values you need
for the task you are running.

The agent loads the root `.env` directly at runtime via
`apps/agent/src/load-env.ts` (with `dotenv override:true` so an empty shell
variable does not shadow a populated `.env`).

The web app does **not** load the full root `.env` during Cloudflare builds.
Always go through `pnpm --filter @novamind/web build:cf` — the wrapper at
`scripts/web-cloudflare.mjs` masks private values so they never reach the
OpenNext bundle.

For plain local `next dev`, `lib/agent-base-url.ts` falls back to
`AGENT_BASE_URL` (default `http://localhost:8787` in `.env.example`) only when
`NOVAMIND_ALLOW_LOCAL_AUTH=1` is set. The package `dev` scripts set
`NOVAMIND_ALLOW_LOCAL_AUTH=1` automatically; production and CI deploys should
leave it unset so auth and service-binding checks fail closed.

## Corpus Behavior

The literature demo loads its corpus in this order:

1. Cloudflare R2 — when `NOVAMIND_PAPERS_URL` (and the embedding URLs) are
   set.
2. Local filesystem — `internal/corpus/data/papers.json` plus the embedding
   files. The directory is gitignored; rebuild with
   [Corpus pipeline](corpus.md).
3. Offline 12-paper fixture in `packages/pipeline/src/rag/fixtures.json`.

Set `DEMO_FIXTURE_MODE=true` to force the fixture even when R2 or local
corpus files are available — useful when the meeting network is unreliable.
Production does not silently fall back to this fixture; it fails closed unless
real data is configured or fixture mode is explicitly enabled.

Set `INJECT_UNVERIFIED_CLAIM=true` when running the Stage 5 live demo locally
so the agent-side claim-extraction wrapper appends the verifier-check claim.
Keep it off for eval/debug runs that should use only model-extracted claims.

The agent preloads the literature corpus and Voyage embedding index at boot.
When an authorized user loads the deck, the web app also calls
`/api/agent/startup`; that starts the agent container if needed, runs one
cheap literature retrieval probe, preloads the ClinicalTrials.gov dataset,
and starts Agent SDK warm profiles for the literature and data-viz agents.
Follow-up startup pings fire every 10 minutes with the retrieval probe
disabled while the deck remains open.

The data-viz demo has a separate ClinicalTrials.gov dataset path, but the
normal presentation flow expects Stage 5 to run first. Stage 6 reads the
latest completed research-agent run from browser storage and disables chart
generation until that handoff exists. The report-builder agent receives only
the question, hypothesis, verified evidence, and confidence; chart tools read
the trial dataset and stream generated charts back to the browser.

1. Cloudflare R2 — `NOVAMIND_TRIALS_URL`.
2. Local filesystem — `internal/clinical-trials/data/clinical-trials.json`;
   override with `NOVAMIND_TRIALS_DIR`.
3. Offline fixture — only as an offline fallback, or when
   `DEMO_FIXTURE_MODE=true`.

Production follows the same fail-closed rule for the ClinicalTrials.gov
snapshot.

Rebuild the trial snapshot with:

```bash
pnpm --filter @novamind/corpus clinical-trials --retmax=250
pnpm --filter @novamind/corpus upload-r2
```

Normal local demos should keep provider keys populated. Stage 5 and Stage 6
surface errors when model calls fail instead of silently replacing them with
mocked output.

For local Claude tuning, follow [Claude integration](claude.md). In
particular, use `NOVAMIND_ORCHESTRATOR_EFFORT` and
`NOVAMIND_ORCHESTRATOR_THINKING` for explicit Agent SDK experiments instead
of relying on provider defaults, and run `pnpm test:live:improver-effort`
before changing the prompt-improver effort default.

## Access Gate

Local development bypasses the Cloudflare Access requirement only when
`NOVAMIND_ALLOW_LOCAL_AUTH=1` is set. Set `NOVAMIND_DEV_ACCESS_EMAIL` if you
want local API logs to use a specific allowed email; otherwise the web API uses
`local@<NOVAMIND_ACCESS_EMAIL_DOMAIN>`. The default domain in `.env.example`
is `thebkapp.co`; change `NOVAMIND_ACCESS_EMAIL_DOMAIN` and
`NEXT_PUBLIC_NOVAMIND_ACCESS_EMAIL_DOMAIN` when reusing the repo for another
organization.

## Validation

Run the same checks CI runs:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @novamind/web build:cf
```

## Test Strategy

The unit suite is organized around public contracts rather than line-count
coverage. Add deterministic tests when a change touches one of these
boundaries:

- request schemas and browser-visible SSE event guards;
- Cloudflare Access, internal web-to-agent signing, replay rejection, and
  cross-origin mutation checks;
- Agent SDK warm-profile lifecycle, first-message timeouts, and structured
  final outputs;
- direct Claude structured-call metadata, retries, prompt caching, budget
  guards, and pricing;
- retrieval, citation verification, verified-evidence assembly, chart
  builders, and eval runner cancellation.

Keep provider-backed behavior in smoke scripts unless a unit test can mock the
transport while still asserting the real adapter contract. Avoid sleeps,
snapshots, or broad UI rendering tests for streaming flows; prefer small tests
that validate typed events, cache reconstruction, and user-visible state
transitions.

## Smoke Tests

Agent liveness:

```bash
pnpm smoke:agent
pnpm smoke:agent:startup
```

When the web app is running, `pnpm smoke:startup` exercises the public
`/api/agent/startup` proxy path that the authenticated deck uses.

Agent SDK structured output:

```bash
pnpm smoke:agent-sdk:structured-output
```

This live smoke matrix verifies that cold `query()` and warm `startup()` runs
return SDK `structured_output` for both plain top-level prompts and MCP-backed
top-level agent loops.

Literature SSE:

```bash
pnpm smoke:agent:literature
```

Data-viz SSE:

```bash
pnpm smoke:agent:data-viz
```

The data-viz smoke command posts a compact research-handoff fixture so it
matches the normal Stage 5 → Stage 6 presentation flow without requiring a
browser-local cached run.

Eval SSE:

```bash
pnpm smoke:agent:eval
```

The smoke helper defaults to `AGENT_ORIGIN=http://localhost:8787` and
`WEB_ORIGIN=http://localhost:3000`. Pass `-- --timeout-ms <n>` to any smoke
script when a local model call needs a longer first chunk window. Startup
smoke commands wait for both Agent SDK warm profiles to report `ready`.
