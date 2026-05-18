# @novamind/web

Next.js 15 App Router application for the 10-stage presentation and browser
demo surfaces. It deploys to Cloudflare Workers through OpenNext.

## Owns

- Presentation routes under `app/(presentation)`.
- Demo UI components for literature, data visualization, and evals.
- Server routes under `app/api/*` that authenticate, validate requests, and
  proxy to the agent.
- Browser security headers in `next.config.ts`.

## Component Structure

- `components/stages/*` keeps each presentation stage small and route-focused.
- `components/literature-chat/*` owns the streamed research-agent transcript,
  Agent SDK loop trace, tool-stage metadata, SSE-derived view helpers, and
  evidence modals. Live progress renders backend-owned stream labels and uses
  event phase/status/tool fields only for presentation tone and icons.
- `components/data-viz-demo/*` owns chart rendering, stream-to-activity
  timeline mapping, the report-builder agent control panel, source/status UI,
  and recommendation modal for Stage 6.
- `components/check-the-receipts/*` maps cached demo runs into the Stage 7
  receipt view. Keep telemetry adaptation in `live-adapter.ts` and visual
  rendering in `receipt.tsx`.
- `components/eval-harness/*` owns the live hill-climbing workbench, including
  prompt editing, stream state, chart math, case inspection, and prompt diffs.
- `components/ui/*` contains shared primitives such as `Button`, `Modal`, and
  the sliding-tab indicator hook. Keep accessibility behavior here when it can
  benefit more than one stage.
- `lib/web-route.ts` centralizes web API route access checks, request-start
  telemetry, and schema-validation failure logging so route files only own
  endpoint-specific behavior.
- `lib/agent-stream-proxy.ts` and `lib/agent-json-proxy.ts` centralize
  authenticated web-to-agent proxying, run-id propagation, and timing logs for
  SSE and short JSON routes respectively.
- `lib/sse-proxy-stream.ts` is the schema-agnostic Cloudflare/browser SSE
  transport helper. It passes upstream bytes through, inserts comment
  heartbeats during quiet model turns, and exposes optional hooks for telemetry
  mirroring.
- `lib/sse-framing.ts`, `lib/client-stream-events.ts`, and `lib/sse-client.ts`
  keep browser stream parsing lightweight: API routes run request validation,
  while the client uses shared SSE framing plus small event guards.
- `lib/demo-run-cache.ts` persists completed demo state as a browser-only
  convenience. It revalidates cached stream events and snapshots before
  hydrating UI state; localStorage is never treated as authoritative input.
- `lib/use-abortable-request.ts` is the standard client lifecycle helper for
  fetches that can outlive a slide. Use it for streaming demo runs, prompt
  improvement, and future long-running UI calls so reset, replacement, and
  unmount all abort upstream work.

## Runtime Contract

In production, web API routes require Cloudflare Access identity and proxy to
the agent through the `AGENT_SERVICE` Cloudflare service binding. The web app
does not call Anthropic, OpenAI, Voyage, Braintrust, PubMed, or
ClinicalTrials.gov directly.

Local development falls back to `AGENT_BASE_URL` when
`NOVAMIND_ALLOW_LOCAL_AUTH=1` is set, so `pnpm dev` can run both apps without
Cloudflare while production still fails closed if the service binding is
missing.

Long-running browser calls must pass an `AbortSignal` to `fetch()` and use the
shared SSE reader. Web API routes forward `request.signal` through the proxy,
which lets a slide transition or reset close the browser stream, web Worker
proxy, and agent-side model/tool run together. The stream proxy emits SSE
comment heartbeats while upstream agent events are quiet, so long model turns
stay active without adding browser-visible event types.

## Bundle Hygiene

- Keep route-specific demo code under the stage or demo component that owns it;
  the shared presentation shell should stay small because it loads on every
  slide.
- Do not import provider SDKs, Zod schemas, or server-only helpers into client
  components. Browser code should use the lightweight stream guards in
  `lib/client-stream-events.ts`.
- Lazy-load heavy route-only UI. The eval harness prompt editor uses a dynamic
  Monaco import so the editor bundle does not affect initial deck navigation.
- Use `pnpm --filter @novamind/web build:cf` as the production bundle check;
  it exercises the OpenNext Cloudflare packaging path and prints per-route
  first-load sizes.
- Run `pnpm lint` separately from builds. CI does this before `next build`, so
  Next's build-time ESLint wrapper is disabled to avoid duplicate lint passes
  with incomplete flat-config detection.

## Commands

```bash
pnpm --filter @novamind/web dev
pnpm --filter @novamind/web lint
pnpm --filter @novamind/web typecheck
pnpm --filter @novamind/web build
pnpm --filter @novamind/web build:cf
pnpm --filter @novamind/web deploy:cf
```

Always use `build:cf` / `deploy:cf` for Cloudflare deployments. The wrapper
script masks private root `.env` values before OpenNext runs, scans the full
generated bundle for private values, and deploys only fresh build output.

See [Architecture](../../docs/architecture.md), [API contracts](../../docs/api.md),
and [Security model](../../docs/security.md).
