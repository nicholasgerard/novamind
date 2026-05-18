# Security Model

The presentation pages are public. Anything that can spend tokens, run agent
tools, or mutate demo state is protected in both the UI and the server.

## Authentication

- Client components call `requireAccess()` before starting the literature,
  data-viz, eval, or prompt-improvement flows. This is only a UX gate.
- Web API routes call `requireAccess(request)` before parsing or forwarding
  work. In production, this validates Cloudflare Access identity through the
  `Cf-Access-Jwt-Assertion` header, the `CF_Authorization` Access cookie JWT,
  or the Access identity endpoint.
- The UI cookies set by `/api/auth/access-login` are only display hints for
  the modal, including whether the last login was authenticated but
  unauthorized. Server authorization never trusts them.
- Direct public agent routes verify the Cloudflare Access JWT themselves and
  can also sit behind a Cloudflare Access edge policy.
- Web-to-agent service-binding calls and direct deploy smoke requests sign the
  forwarded identity with `NOVAMIND_AGENT_INTERNAL_TOKEN`. The token is an
  HMAC secret, not a bearer header; signatures cover method, path, run id,
  timestamp, and email. The edge Worker verifies direct internal requests
  before stamping a fresh signed identity for the container.

Set `NOVAMIND_ACCESS_EMAIL_DOMAIN` and
`NEXT_PUBLIC_NOVAMIND_ACCESS_EMAIL_DOMAIN` to the allowed email domain for
your deployment. Cloudflare Access should authenticate users; the Workers
still enforce the allowed email domain after JWT verification.

## Origin Controls

Production agent CORS accepts only `NOVAMIND_WEB_ORIGIN`. Mutating demo
routes reject browser requests whose `Origin` does not match the expected web
origin. Localhost origins and unauthenticated local API access are enabled
only by the explicit `NOVAMIND_ALLOW_LOCAL_AUTH=1` development opt-in.

## Agent SDK Isolation

The research and report-builder demos use the Claude Agent SDK, but each route
runs it as a bounded server-side orchestrator rather than as a general Claude
Code session:

- Built-in Claude Code tools are disabled with `tools: []`.
- Each orchestrator allowlist contains only the in-process MCP tools needed by
  that route: literature search/model tools for Stage 5, and handoff
  inspection, trial profiling, and chart building for Stage 6.
- `permissionMode: "dontAsk"` prevents the route from waiting on interactive
  approvals; unexpected tool calls are denied.
- `strictMcpConfig: true` fails fast when tool registration is wrong.
- Filesystem settings, SDK skills, tool search, and Claude Code memory
  autoloading are disabled for this route.
- Each SDK profile receives an isolated working directory and
  `CLAUDE_CONFIG_DIR`, so local user Claude config does not become implicit
  production context and the literature/data-viz profiles do not share
  runtime writes.
- Warm Agent SDK startup is backend-owned and single-flight. Repeated browser
  reloads observe the same in-container warm-profile state instead of
  launching browser-scoped SDK processes.
- SSE cancellation propagates into the Agent SDK query and direct structured
  model calls so abandoned browser sessions do not keep spending provider
  tokens.

See [Claude integration](claude.md) for the full model-call architecture,
including the distinction between Agent SDK orchestration and direct
structured Messages calls.

## Secret Handling

- Root `.env` is gitignored.
- `internal/` is gitignored and is the default location for generated corpora
  and local eval runs.
- Provider keys stay on the agent. The web build wrapper
  `scripts/web-cloudflare.mjs` masks private env values before OpenNext runs,
  removes stale OpenNext output, asserts that the generated bundle is fresh,
  and refuses to deploy if private values or known key prefixes appear in the
  generated web bundle.
- GitHub Actions uploads runtime secrets one key at a time with
  `wrangler secret put` over stdin; secrets are not written to repository files
  or embedded at build time. Required deploy values are validated before each
  deploy so an empty secret cannot leave stale runtime configuration in place.

## R2 Data

R2 stores public derived artifacts: PubMed metadata/abstract records,
embeddings for those records, and normalized ClinicalTrials.gov rows. These
objects may be exposed through `r2.dev` or a custom domain because they are
not secrets and should not contain user data or PHI.

Do not use the same bucket pattern for private corpora without adding an
authenticated fetch layer and removing public bucket access.

## Headers

The web app emits baseline browser security headers from `next.config.ts`:

- `Content-Security-Policy` with explicit defaults for scripts, styles,
  connections, images, fonts, workers, base URI, forms, objects, and frame
  ancestors.
- `Cross-Origin-Opener-Policy`.
- `Cross-Origin-Resource-Policy`.
- `Permissions-Policy`.
- `Referrer-Policy`.
- `Strict-Transport-Security`.
- `X-Content-Type-Options`.
- `X-Frame-Options`.
- `X-XSS-Protection: 0`.

The production CSP is intentionally conservative while still allowing the
inline script and style behavior Next needs for this app. Development adds the
extra eval and websocket allowances required by the local Next dev server.
Move to nonce/hash-based scripts before embedding this app in a broader
multi-tenant product.

## Public Readiness Checks

Before sharing the repo:

```bash
git ls-files internal
git ls-files | rg '(^internal/|\\.next/|\\.open-next/|\\.wrangler/|/dist/|coverage/|playwright-report|test-results)'
rg -n "ANTHROPIC_API_KEY=\\S+|OPENAI_API_KEY=\\S+|VOYAGE_API_KEY=\\S+|BEGIN .*PRIVATE KEY|sk-[A-Za-z0-9_-]{20,}" \
  -g '!docs/security.md' \
  -g '!.env.example' \
  -g '!pnpm-lock.yaml' \
  -g '!.next/**' \
  -g '!.open-next/**' \
  -g '!.wrangler/**' \
  -g '!node_modules/**'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @novamind/web build:cf
pnpm audit --prod --audit-level high
```

The `git ls-files` artifact checks should print nothing. The secret scan
should only find documentation examples or empty placeholders.
