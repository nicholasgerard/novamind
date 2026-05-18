# @novamind/shared

Shared contracts for the web app, agent service, pipeline, corpus scripts,
and eval harness.

## Owns

- Zod schemas for API requests and SSE events.
- Corpus and ClinicalTrials.gov data shapes.
- Token usage helpers for aggregating provider token counts and normalized
  cost telemetry.
- Access-domain helpers.
- Canonical hypothesis system prompt.

Keep schemas backward-compatible where practical. Web and agent routes use the
request schemas for Zod validation at service boundaries. Stream event schemas
define the canonical SSE contracts, while the browser uses lightweight guards
derived from the same event shapes to keep client bundles small.

See [API contracts](../../docs/api.md) and [Architecture](../../docs/architecture.md).
