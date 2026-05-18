# Agent Operating Guide

This file is the root instruction index for AI coding agents working in this
repo. Keep it short. Put durable project knowledge in `docs/` and link to it
from here instead of duplicating details.

## Start Here

1. Read `README.md` for the product purpose, slide flow, repo map, and common
   commands.
2. Read the guide that matches the task:
   - Architecture and runtime flow: `docs/architecture.md`
   - Claude usage, prompts, structured outputs, and Agent SDK: `docs/claude.md`
   - Local setup and smoke tests: `docs/local-development.md`
   - Cloudflare deploys and Access: `docs/deployment.md`
   - Production telemetry and latency profiling: `docs/observability.md`
   - API and SSE event contracts: `docs/api.md`
   - Corpus/R2 rebuilds: `docs/corpus.md`
   - Eval harness and hill climbing: `docs/evals.md`
   - Security and public-readiness checks: `docs/security.md`
3. For package-specific work, read the nearest README:
   - `apps/web/README.md`
   - `apps/agent/README.md`
   - `packages/pipeline/README.md`
   - `packages/eval/README.md`
   - `packages/corpus/README.md`
   - `packages/shared/README.md`

## Project Invariants

- This repository is both a live demo and a cloneable template. Do not hide
  hosted demo URLs or remove intentionally visible demo behavior.
- The research demo is a real orchestrated agent flow. Keep one Claude Agent
  SDK orchestrator in control of the trajectory; scoped tools may be
  deterministic or narrow structured model calls when that improves speed.
- The injected verifier-check claim in the research demo is intentional. The
  extractor returns abstract-derived claims; the tool wrapper appends the
  demo claim so the verifier can visibly reject it before synthesis.
- Do not casually improve `HYPOTHESIS_SYSTEM_PROMPT`. The hill-climbing demo
  depends on the starter prompt having real, repairable gaps.
- Keep public docs audience-safe. Explain current behavior and extension
  points; do not describe private iteration history or local-only decisions.
- `internal/` is gitignored local maintainer material. Do not rely on it as a
  public source of truth, and do not edit local background/context files
  unless explicitly asked.

## Development Practices

- Prefer existing package boundaries and helper APIs over new abstractions.
- Keep schemas and stream contracts centralized in `packages/shared`.
- Keep provider credentials and private runtime behavior on the agent side;
  web code must not expose provider keys.
- For Claude work, follow `docs/claude.md`: schemas own output shape, prompts
  own semantics, Agent SDK is for orchestration, and direct structured
  Messages calls are for bounded one-shot transformations.
- Use `rg` for code search. Use `pnpm` package scripts for validation.
- If behavior changes, update the relevant public guide in `docs/` in the
  same change.
- Keep `.env.example` as the canonical environment-variable reference. Link
  to it from docs instead of duplicating long variable lists.
- For Cloudflare production debugging, use `docs/observability.md` and the
  root `obs:cf:*` scripts; keep run IDs, secrets, and raw logs out of
  committed docs.

## Validation Checklist

Run the smallest relevant checks while iterating, then broaden before
handoff:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For production-like web packaging, use:

```bash
pnpm --filter @novamind/web build:cf
```

Never commit `.env`, generated OpenNext output, `.wrangler/`, or `internal/`
artifacts.
