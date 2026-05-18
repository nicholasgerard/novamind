# @novamind/agent

Hono service that runs the live agent workloads. It deploys as a Cloudflare
Worker with a Cloudflare Container for the Node process.

## Owns

- `/health` liveness route.
- `/runtime/startup` authenticated RAG/vector, ClinicalTrials.gov, and Agent
  SDK warm-profile startup route for the demo runtime.
- `/runtime/status` authenticated Agent SDK warm-profile status route.
- `/literature/stream` research-agent SSE stream.
- `/data-viz/run` ClinicalTrials.gov report-builder SSE stream.
- `/eval/run` eval harness SSE stream.
- `/improve-prompt` prompt-improver JSON route.
- Production auth, CORS, same-origin mutation checks, and per-email rate
  limits for direct agent routes. `route-security.ts` keeps the
  access/rate-limit/logging path shared across every protected route.

## Runtime Contract

The agent is the only service that uses provider keys. It loads corpus
artifacts from R2 at boot, with local `internal/` data available for
development. It preloads the Voyage embedding index, then runs the pipeline
and eval packages for each request. The authenticated `/runtime/startup`
route repeats the literature preload, can execute one cheap retrieval probe,
preloads the trial dataset, and starts single-flight Agent SDK warm profiles
for the literature and data-viz agents. Production fails closed when real
corpus or trial data is unavailable unless `DEMO_FIXTURE_MODE=true` is set
explicitly. The Worker checks the container `/health` runtime identity against
Cloudflare version metadata before proxying requests, and restarts a stale
container process once. SSE routes cancel their upstream work when the browser
disconnects, so abandoned demo runs do not keep provider calls alive.
When `INJECT_UNVERIFIED_CLAIM=true`, the literature claim-extraction tool
wrapper appends the verifier-check claim after the extractor model returns.
The UI stream labels that claim, but Agent SDK prompts and tool return values
do not expose demo metadata to the orchestrator.

Web-to-agent calls are trusted only when the forwarded identity is signed with
an HMAC derived from `NOVAMIND_AGENT_INTERNAL_TOKEN`. The Worker verifies
direct internal smoke requests and forwards a fresh signed identity to the
container. Other direct public requests must carry a valid Cloudflare Access
JWT.

## Commands

```bash
pnpm --filter @novamind/agent dev
pnpm --filter @novamind/agent lint
pnpm --filter @novamind/agent typecheck
pnpm --filter @novamind/agent build
pnpm --filter @novamind/agent deploy:cf
```

See [Architecture](../../docs/architecture.md),
[Claude integration](../../docs/claude.md),
[Deployment](../../docs/deployment.md), and
[Security model](../../docs/security.md).
