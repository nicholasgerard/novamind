# Claude Guide

Use `AGENTS.md` as the canonical root operating guide. It points to the
source-of-truth docs for architecture, deployment, observability, evals,
security, and package boundaries.

Claude-specific reminders:

- `docs/claude.md` is the source of truth for Claude Agent SDK usage,
  Messages API structured outputs, prompt standards, model/effort choices,
  error handling, context shaping, and telemetry expectations.
- This repo demonstrates Claude Agent SDK orchestration plus scoped typed
  tools. Preserve that architecture unless the user explicitly asks for a
  different direction.
- Production latency/debugging work should start with
  `docs/observability.md` and the root `obs:cf:*` scripts, then the relevant
  code paths in `apps/web`, `apps/agent`, and `packages/pipeline`.
- For Agent SDK configuration changes, keep `docs/architecture.md`,
  `docs/security.md`, `docs/observability.md`, and `.env.example` in sync.
- For prompt/context work, inspect every LLM call site in
  `packages/pipeline` and `packages/eval`, but do not tune the shared
  hypothesis prompt unless explicitly requested.
- Keep root instructions lightweight. If you learn something durable, add it
  to the relevant guide under `docs/` and link to it from `AGENTS.md` only
  when it changes agent behavior.
