# Deployment

Both services deploy to Cloudflare Workers. The agent Worker owns a
Cloudflare Container running the Hono service. Corpus artifacts live in
Cloudflare R2.

## GitHub Secrets

Set these as repository **secrets** (encrypted, used in deploy workflows):

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `VOYAGE_API_KEY`
- `NOVAMIND_AGENT_INTERNAL_TOKEN`

Optional repository secrets:

- `BRAINTRUST_API_KEY` — enables Braintrust trace uploads for eval runs.
- `NCBI_API_KEY` — raises PubMed E-utilities ingest rate limits.
- `NCBI_EMAIL` — identifies corpus ingest traffic to NCBI.

Optional smoke-test secrets when the public agent hostname is protected by a
Cloudflare Access service-token policy:

- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

## GitHub Variables

Set these as repository **variables** (plaintext, visible to the build):

- `NOVAMIND_PAPERS_URL`
- `NOVAMIND_VOYAGE_EMBEDDINGS_URL`
- `NOVAMIND_TRIALS_URL`
- `NOVAMIND_ACCESS_EMAIL_DOMAIN`
- `CLOUDFLARE_ACCESS_AUD`
- `CLOUDFLARE_ACCESS_TEAM_DOMAIN`
- `NOVAMIND_WEB_ORIGIN`
- `NOVAMIND_AGENT_ORIGIN`

Optional repository variables:

- `NOVAMIND_OPENAI_EMBEDDINGS_URL` — fallback embedding index when OpenAI
  embeddings are selected.

The R2 URLs are printed by `pnpm --filter @novamind/corpus upload-r2`.
`NOVAMIND_TRIALS_URL` points at the uploaded ClinicalTrials.gov snapshot for
Stage 6. `NOVAMIND_WEB_ORIGIN` must be the exact deployed web origin without
a trailing slash. `NOVAMIND_AGENT_ORIGIN` is the exact deployed agent Worker
origin and is used by CI startup smoke tests; the workflow also accepts an
existing `AGENT_BASE_URL` repository variable for that same origin. Generate
`NOVAMIND_AGENT_INTERNAL_TOKEN` with `openssl rand -hex 32`.

Production deployments should set `NOVAMIND_PAPERS_URL`,
`NOVAMIND_VOYAGE_EMBEDDINGS_URL`, and `NOVAMIND_TRIALS_URL` to the R2
artifacts printed by the corpus uploader. Use
`DEMO_FIXTURE_MODE=true` only when you intentionally want a fixture-backed
demo and are prepared to label it that way.

Set `INJECT_UNVERIFIED_CLAIM=true` for the hosted Stage 5 demo if you want
the verifier-check claim appended inside the agent-side tool wrapper. The UI
labels that claim for the audience, while model prompts and Agent SDK tool
returns omit demo metadata.

`.env.example` is the canonical environment reference for local and
production tunables. Optional Agent SDK runtime overrides such as
`NOVAMIND_CLAUDE_RUNTIME_DIR`, `NOVAMIND_CLAUDE_RUNTIME_CWD`, and
`NOVAMIND_CLAUDE_CONFIG_DIR` are not required for standard Cloudflare
deployments; set them only when your container image needs a different
writable runtime path.

Claude model, effort, structured-output, and Agent SDK decisions are
documented in [Claude integration](claude.md). Keep that guide and
`.env.example` in sync when adding runtime toggles.

## Manual Cloudflare Deploy

From a local machine with `.env` populated:

```bash
pnpm --filter @novamind/corpus upload-r2     # only when corpus changed
pnpm --filter @novamind/agent deploy:cf
pnpm --filter @novamind/web build:cf         # optional preflight
pnpm --filter @novamind/web deploy:cf
```

The web build/deploy commands must use the package scripts. They call
`scripts/web-cloudflare.mjs`, which masks the root `.env` so private
provider keys never reach the OpenNext bundle. The deploy script always
performs a fresh OpenNext build, asserts that the `.open-next` output is
newer than the command start time, scans the full generated bundle for private
values and known key prefixes, and only then calls Cloudflare deploy.

## GitHub Actions Deploy

Two workflows trigger on `push` to `main` (or via `workflow_dispatch`):

- `.github/workflows/deploy-agent.yml` — runs when `apps/agent`,
  `packages/{pipeline,eval,shared,corpus}`, `Dockerfile.agent`, `.dockerignore`,
  root package/lock/workspace config, or this workflow file change.
- `.github/workflows/deploy-web.yml` — runs when `apps/web`,
  `packages/shared`, `scripts/web-cloudflare.mjs`, root package/lock/workspace
  config, or this workflow file change.

Both workflows install with `pnpm install --frozen-lockfile`, validate that
all required deploy secrets and variables are non-empty, and fail before
deploying if required configuration is missing. The web workflow calls
`deploy:cf`, whose wrapper builds and scans before deploying. The agent
workflow receives the provider keys, R2 URLs, Access metadata, and
`NOVAMIND_WEB_ORIGIN`; the web workflow receives only web-safe Access build
values plus its runtime HMAC secret. After deploying, each workflow uploads
the needed runtime secrets/vars to Wrangler one key at a time with
`wrangler secret put` over stdin. Optional values are uploaded only when
present; required values are never silently skipped.

## Cloudflare Access

The presentation routes stay publicly viewable. Paid or stateful demo actions
are gated in two places:

1. Cloudflare Access protects the web Worker API paths:
   `<your-web-origin>/api/*`.
2. Direct public agent run paths require Cloudflare Access credentials and can
   also be protected at the edge:
   `<your-agent-origin>/runtime/*`, `<your-agent-origin>/literature/*`,
   `<your-agent-origin>/data-viz/*`, `<your-agent-origin>/eval/*`, and
   `<your-agent-origin>/improve-prompt`.

Use a Cloudflare Access policy that authenticates users with One-Time PIN,
then let the web and agent Workers enforce `NOVAMIND_ACCESS_EMAIL_DOMAIN` (for
the hosted demo, `@thebkapp.co`). Copy the web Access application's AUD tag
into `CLOUDFLARE_ACCESS_AUD`, and set `CLOUDFLARE_ACCESS_TEAM_DOMAIN` to the
team domain, for example `https://<team-name>.cloudflareaccess.com`.

The first slide includes a sign-in modal. The modal sends users through
`/api/auth/access-login`, which is inside the protected `/api/*` path; after
Access authenticates the user, the route sets a non-sensitive UI cookie and
returns to the presentation. The web API routes still validate the Access
header/cookie JWT or recover the identity from Cloudflare's Access identity
endpoint before forwarding work to the agent service. The UI cookie is only a
client-side hint for the modal; server authorization never trusts it. The
Access app should be limited to the One-Time PIN identity provider with
instant redirect enabled. Leave the organization login design at Cloudflare's
default styling; do not set `login_design` colors unless the full Access page
render has been verified.

Direct public agent routes verify the Cloudflare Access JWT against the same
team domain and AUD tag. Internal service-binding and smoke-test requests are
trusted only when they carry an HMAC signature generated from
`NOVAMIND_AGENT_INTERNAL_TOKEN`. The signature covers the HTTP method, path,
run id, timestamp, and forwarded email with a short replay window; the shared
secret itself is never sent as a request header. The edge Worker verifies
direct internal requests and stamps a fresh signed identity for the container,
keeping the container's authorization path the same for web and smoke traffic.

Mutating demo routes also reject browser requests whose `Origin` is not the
deployed web origin. In production, set `NOVAMIND_WEB_ORIGIN` to the exact
web origin without a trailing slash; localhost origins are accepted only when
`NOVAMIND_ALLOW_LOCAL_AUTH=1` is set explicitly.

## Service Binding

`apps/web/wrangler.toml` declares a service binding:

```toml
[[services]]
binding = "AGENT_SERVICE"
service = "novamind-agent"
```

In production, `apps/web/lib/agent-endpoint.ts` requires the binding and
fails closed if it is missing. Local development can fall back to public
`fetch(AGENT_BASE_URL + path)` only when `NOVAMIND_ALLOW_LOCAL_AUTH=1` is set.
Keep the binding in place — Cloudflare restricts public Worker-to-Worker
traffic in common configurations and the binding sidesteps the issue at no
cost.

The web Worker forwards the signed-in email to the agent with
`x-novamind-access-email`, `x-novamind-run-id`,
`x-novamind-internal-timestamp`, and `x-novamind-internal-signature`. The
agent Worker and container both recompute the HMAC using
`NOVAMIND_AGENT_INTERNAL_TOKEN`; missing or invalid signatures fail with
`401`.

Authenticated deck load sends `/api/agent/startup` through the same service
binding. That route starts the container, preloads the literature corpus and
Voyage index, runs one retrieval probe for the seeded HbA1c GLP-1 demo query,
preloads the ClinicalTrials.gov dataset, and starts the Claude Agent SDK warm
profiles used by the literature and data-viz agents. Use it shortly before a
live demo if the container may have slept. The deck then sends cheap
probe-free startup pings every 10 minutes while it remains open.

The agent container is configured as a custom Cloudflare Container instance
with 1 vCPU, 3 GiB memory, and 5 GB disk. Cloudflare requires at least 3 GiB
memory for a one-vCPU custom instance and caps disk at 2x the memory allotment,
so this profile keeps the Agent SDK startup path responsive while remaining
deployable. The Worker keeps the container warm for 45 minutes after activity;
tune that value against your demo cadence and container budget.

## Container Rollovers

The agent Worker names its Cloudflare Container Durable Object instance with
`NOVAMIND_AGENT_INSTANCE` from `apps/agent/wrangler.toml`. That stable name
keeps one warm demo runtime alive across browser reloads and startup pings.

Cloudflare Workers expose version metadata through the `CF_VERSION_METADATA`
binding, and the agent Worker passes that version id into the container start
environment. The container returns the value from `/health`. Before proxying a
demo request, the Worker checks that the running container matches the current
Worker version; a mismatch or missing runtime identity means the named
Durable Object is serving a container with a different Worker version, so the
Worker destroys it and starts one fresh container. The deploy workflow then runs
`pnpm smoke:agent:startup -- --timeout-ms 150000` against
`NOVAMIND_AGENT_ORIGIN` and fails if the literature and data-viz warm
profiles are not ready. The workflow retries that smoke briefly because
Cloudflare can reset the named Durable Object while the Worker code and
container image roll forward.

Use a different `NOVAMIND_AGENT_INSTANCE` when you intentionally want an
independent warm runtime, such as a staging demo or an isolated rehearsal
environment. Normal production deploys can keep the stable instance name and
let the runtime identity check handle image rollovers.

## Post-Deploy Smoke Tests

The page-level smoke tests below are public. The API smoke tests that follow
hit `/api/*`, so in production they require a valid Cloudflare Access session
cookie or `Cf-Access-Jwt-Assertion` header. A `401` from those command-line
scripts without Access credentials is the expected secure behavior. For
unauthenticated command-line checks, run the same scripts against local dev.

```bash
export WEB_ORIGIN="https://<your-web-worker>.<your-subdomain>.workers.dev"
export AGENT_ORIGIN="https://<your-agent-worker>.<your-subdomain>.workers.dev"

pnpm smoke:agent
pnpm smoke:pages
```

For an authenticated production shell, export either `CF_ACCESS_JWT` or a
captured `CF_AUTHORIZATION_COOKIE` before running the API snippets:

```bash
export CF_ACCESS_JWT="<valid Cf-Access-Jwt-Assertion>"
# or:
export CF_AUTHORIZATION_COOKIE="CF_Authorization=<cookie-value>"
```

Runtime startup smoke:

```bash
pnpm smoke:startup
```

Direct agent startup smoke can use the internal HMAC secret instead of a
browser Access session when your agent Access policy allows the smoke
request. If the public agent hostname is edge-protected, provide
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` for a Cloudflare Access
service-token policy, or provide `CF_ACCESS_JWT` / `CF_AUTHORIZATION_COOKIE`
from an authenticated session.

```bash
export NOVAMIND_AGENT_INTERNAL_TOKEN="<hmac-secret>"
export NOVAMIND_DEV_ACCESS_EMAIL="presenter@<allowed-domain>"
# Optional for Access edge-protected agent origins:
export CF_ACCESS_CLIENT_ID="<access-service-token-id>"
export CF_ACCESS_CLIENT_SECRET="<access-service-token-secret>"
pnpm smoke:agent:startup -- --timeout-ms 150000
```

Literature SSE smoke (writes the first chunk to stdout, aborts after 30s):

```bash
pnpm smoke:literature
```

Data-viz SSE smoke:

```bash
pnpm smoke:data-viz
```

This posts a compact research-handoff fixture to exercise the Stage 6
report-builder route without depending on browser local storage.

Eval SSE smoke (single plan-stability case, sequential):

```bash
pnpm smoke:eval
```

All smoke scripts accept `-- --timeout-ms <n>` and print the
`x-novamind-run-id` header when the route returns one. Use that run id with
`pnpm obs:cf:timeline -- --run-id <id>` for latency debugging.

For latency profiling, stream failures, and Cloudflare telemetry queries, see
[Production observability](observability.md).

## Security Notes

- Never commit `.env` or generated OpenNext output. Both are gitignored.
- Rotate any credential that may have appeared in a built artifact —
  `scripts/web-cloudflare.mjs` will refuse to deploy if it detects a
  private value in the OpenNext bundle, but rotate anyway.
- The R2 bucket is for public, derived PubMed / ClinicalTrials.gov demo
  artifacts only. Do not upload secrets, user data, PHI, or private customer
  documents. Set `R2_SKIP_DEV_URL=true` if the bucket should not expose an
  `r2.dev` URL.
- Keep provider keys on the agent side; the web Worker only needs
  `NOVAMIND_AGENT_INTERNAL_TOKEN`, the Access values, and the
  `AGENT_SERVICE` binding.
- Keep `NOVAMIND_AGENT_INTERNAL_TOKEN` out of build-time env. It is uploaded
  as a runtime secret after deploy and is masked by `scripts/web-cloudflare.mjs`.
- The deploy workflows push runtime secrets with per-key
  `wrangler secret put` calls over stdin and fail if any required value is
  empty. Do not echo secret values or write them into files.
- The web app emits baseline security headers from `next.config.ts` rather
  than relying on a Cloudflare `_headers` file, because the app is rendered by
  Worker code.
- The agent uses the Claude Agent SDK's bundled native executable. If a
  nonstandard container base image cannot run the auto-resolved binary,
  set `NOVAMIND_CLAUDE_EXECUTABLE_PATH` to an explicit path.
- The Agent SDK subprocess uses an isolated runtime/config directory by
  default. Override `NOVAMIND_CLAUDE_RUNTIME_DIR` only when a container needs
  a different writable `/tmp` path.
