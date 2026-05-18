# NovaMind Agent Demo

NovaMind Agent Demo is an agent-orchestrated biomedical research workflow
built on the [Claude Agent SDK][sdk]. The site is both a 10-stage
presentation and three live demos:

- **Research agent:** streams an orchestrated literature trajectory over a
  PubMed-derived GLP-1 corpus. One Sonnet Agent SDK orchestrator controls the
  run and calls scoped typed tools for direct RAG search, Haiku claim
  extraction, Haiku citation verification, and Opus hypothesis synthesis. It
  includes one intentionally unsupported demo claim so the verifier catch is
  visible before final synthesis.
- **Data visualization:** picks up the latest research-agent handoff, uses an
  official ClinicalTrials.gov API v2 snapshot with posted results, and runs a
  Claude Agent SDK report-builder that chooses trial-data analyses, streams a
  2×2 chart board, and writes the final recommendation from real
  study/outcome/adverse-event rows.
- **Eval harness:** demonstrates prompt hill-climbing on the hypothesis-only
  plan-stability axis, backed by the same eval package that also covers
  single-turn structured output, citation accuracy, and retrieval quality.

The live demos and eval harness share the same pipeline package, schemas, and
provider adapters, so the browser demo and reusable eval package stay aligned.

[sdk]: https://code.claude.com/docs/en/agent-sdk/typescript.md

## Live Demo Deployment

The live demo deployment uses Cloudflare Workers:

- Web example: <https://novamind.personal-901.workers.dev>
- Literature demo example:
  <https://novamind.personal-901.workers.dev/05-research-agent-demo>
- Data visualization demo example:
  <https://novamind.personal-901.workers.dev/06-data-visualization-demo>
- Eval demo example:
  <https://novamind.personal-901.workers.dev/08-eval-harness>
- Agent health example:
  <https://novamind-agent.personal-901.workers.dev/health>

Use these URLs to view the current hosted demo. When cloning the repository,
deploy your own Worker names for your copy and update `NOVAMIND_WEB_ORIGIN`
to match the deployed web Worker.

## Presentation Flow

The web app is organized as ten route-addressable stages:

1. `/01-welcome` — welcome frame for the 30-day research-agent launch.
2. `/02-workflows-to-agents` — workflow vs. agent operating model.
3. `/03-single-turn-evals` — failure modes missed by single-turn evals.
4. `/04-anthropic-agents` — Agent SDK building blocks.
5. `/05-research-agent-demo` — live orchestrated research agent.
6. `/06-data-visualization-demo` — visualization agent that consumes the latest
   research-agent handoff.
7. `/07-check-the-receipts` — model mix, cost, latency, and caching.
8. `/08-eval-harness` — hypothesis-prompt hill-climbing harness.
9. `/09-next-steps` — baseline, customer rollout, production loop.
10. `/10-resources` — repository manifest and follow-up actions.

## Repository Layout

```text
apps/web          Next.js 15 app — presentation routes, demo UI, Cloudflare Worker
apps/agent        Hono HTTP service — Cloudflare Worker + Container
packages/pipeline Research orchestrator, typed literature tools, retrieval, provider adapters
packages/eval     Multi-axis eval harness and the prompt-improvement loop
packages/corpus   PubMed ingest, embedding, and Cloudflare R2 upload scripts
packages/shared   Zod request/event schemas, canonical prompts, usage helpers
scripts/          Deployment, smoke-test, and observability helpers
docs/             Operating guides for Claude usage, dev, deployment, corpus, evals
```

## Quick Start

Requires Node 22+ and pnpm via Corepack.

```bash
corepack enable
pnpm install
cp .env.example .env
```

Fill the provider keys you need in `.env`, then run both apps:

```bash
pnpm dev
```

Local URLs:

- Web: <http://localhost:3000>
- Agent: <http://localhost:8787/health>

The literature demo uses the gitignored local corpus at
`internal/corpus/data/` when present. Stage 6 uses
`internal/clinical-trials/data/clinical-trials.json` or
`NOVAMIND_TRIALS_URL`. Local development falls back to small offline
fixtures when local/R2 artifacts are absent, or you can force that path with
`DEMO_FIXTURE_MODE=true`. Production fails closed unless the real artifacts
are configured or `DEMO_FIXTURE_MODE=true` is set explicitly.

The generated R2 artifacts are derived from official public sources:
PubMed through NCBI E-utilities and ClinicalTrials.gov API v2. See
[Corpus pipeline](docs/corpus.md) for the exact queries, normalization, and
R2 upload process.

You can inspect the presentation shell without provider keys. Running the
live research, visualization, eval, and prompt-improvement flows requires the
provider keys for the model or embedding paths those flows exercise. Use
`DEMO_FIXTURE_MODE=true` only when you intentionally want fixture-backed local
data; production fails closed unless real artifacts are configured or fixture
mode is explicitly enabled.

## Common Commands

```bash
pnpm typecheck      # typecheck every workspace package
pnpm lint           # run ESLint across the workspace
pnpm test           # deterministic Vitest unit tests; no live provider calls
pnpm format:check   # verify Prettier formatting
pnpm build          # build all packages/apps

pnpm --filter @novamind/web build:cf
pnpm --filter @novamind/web deploy:cf
pnpm --filter @novamind/agent deploy:cf
pnpm --filter @novamind/corpus upload-r2

pnpm smoke:pages
pnpm smoke:literature
pnpm smoke:agent-sdk:structured-output
pnpm obs:cf:runs
pnpm obs:cf:values -- --key source.worker
pnpm obs:cf:timeline -- --run-id <run-id>
```

Optional live eval scripts are intentionally not part of default CI because
they call external providers and require API keys:

```bash
pnpm test:live:eval:plan-stability
pnpm test:live:eval:citation-accuracy
pnpm test:live:improver-effort
```

## Architecture Summary

The deployed web app is a Cloudflare Worker built with
`@opennextjs/cloudflare`. It talks to the agent through a Cloudflare service
binding (`AGENT_SERVICE`), which avoids the platform's public Worker-to-Worker
fetch restrictions. The agent Worker owns a Cloudflare Container running the
Hono service. R2 stores the generated PubMed corpus, embeddings, and
ClinicalTrials.gov snapshot; local gitignored files and offline fixtures are
development fallbacks.

The web build always goes through `scripts/web-cloudflare.mjs` so provider
credentials never reach the OpenNext bundle. Runtime web-to-agent calls use
the Cloudflare `AGENT_SERVICE` binding plus signed internal identity headers;
direct public agent routes verify Cloudflare Access JWTs or signed deploy
smoke identity.

See [Architecture](docs/architecture.md) for the full topology, runtime
startup path, Agent SDK configuration, data-resolution order, and stream
contracts.
See [Claude integration](docs/claude.md) for the model-call architecture,
prompting standards, structured-output decisions, and Agent SDK configuration
used throughout the repo.

## Reuse Checklist

When adapting this repo for another domain:

1. Rename the Cloudflare Worker, Container, R2 bucket, and Access resources
   for your deployment. Keep `NOVAMIND_WEB_ORIGIN`, `NOVAMIND_AGENT_ORIGIN`,
   and the `AGENT_SERVICE` binding aligned with those names.
2. Change `NOVAMIND_ACCESS_EMAIL_DOMAIN` and
   `NEXT_PUBLIC_NOVAMIND_ACCESS_EMAIL_DOMAIN` in `.env`, GitHub variables,
   and Cloudflare Access policy settings.
3. Replace the domain corpus: rebuild or replace generated artifacts under
   `internal/`, upload them to R2, and set the printed `NOVAMIND_*_URL`
   values.
4. Update the prompts, eval fixtures, and UI copy that encode the GLP-1 /
   peptide-therapeutics example domain. Keep request schemas, stream events,
   and package boundaries centralized unless the product contract changes.
5. Keep generated data, raw exports, local eval runs, OpenNext output, and
   `.wrangler/` artifacts out of git.
6. Keep provider credentials on the agent side and never expose them through
   the web build.
7. Run the validation suite in this README, including
   `pnpm --filter @novamind/web build:cf`, before deploying or publishing a
   derivative.

## Guides

- [Architecture](docs/architecture.md)
- [Claude integration](docs/claude.md)
- [Local development](docs/local-development.md)
- [Deployment](docs/deployment.md)
- [Production observability](docs/observability.md)
- [Corpus pipeline](docs/corpus.md)
- [API and streaming contracts](docs/api.md)
- [Eval harness](docs/evals.md)
- [Security model](docs/security.md)

## Environment

Use `.env.example` as the reference. The root `.env` is gitignored and used
by local dev scripts. The agent reads it directly in local runtime; the web
build wrapper exposes only web-safe runtime values to OpenNext.

GitHub Actions deployment uses repository secrets and variables documented
in [Deployment](docs/deployment.md).

## Validation

Run these before deploying or handing off:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter @novamind/web build:cf
```
