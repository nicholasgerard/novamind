# @novamind/eval

Multi-axis evaluation harness for the NovaMind research agent. Imports the
same `@novamind/pipeline` primitives that drive the live demo. The axes are
intentionally scoped: `citation-accuracy` runs the full literature agent,
`plan-stability` starts at the hypothesis handoff, `retrieval-quality` tests
retrieval only, and `single-turn-structured` tests one structured extraction
call across providers.

## Axes

| Axis                     | What it measures                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `single-turn-structured` | Strict-schema clinical-trial extraction across Claude vs GPT-5.1.                                                                                    |
| `citation-accuracy`      | Whether verifier-approved extracted claims are supported by their cited abstract (Haiku judge).                                                      |
| `plan-stability`         | Hypothesis-step evidence precision, gap handling, rejected-claim discipline, and confidence calibration across fixed handoff fixtures (Haiku judge). |
| `retrieval-quality`      | 0–3 relevance of top-K hits across BM25 / Voyage / OpenAI / hybrid (Haiku judge).                                                                    |

## Run

```bash
pnpm --filter @novamind/eval citation-accuracy
pnpm --filter @novamind/eval plan-stability -- --limit=3
pnpm --filter @novamind/eval prompt-improver-effort
pnpm --filter @novamind/eval single-turn-structured
pnpm --filter @novamind/eval retrieval-quality -- --methods=bm25,hybrid
```

Each script prints a per-case ledger, writes the full result to
`internal/eval/runs/<axis>-<timestamp>.json` (gitignored), and uploads the
result to Braintrust under the `novamind` project when
`BRAINTRUST_API_KEY` is set.

## Environment

Use the repo-root `.env`. Provider keys unlock richer axes; the harness
fails individual cases gracefully (with `score = 0` and an error string)
rather than aborting when a key is missing.

`BRAINTRUST_API_KEY` enables Braintrust traces. Local JSON output is
always written.

## Architecture Notes

- `runEval` returns results in input-order regardless of completion order
  (cases are stored by index). `runEvalEvents` emits an SSE-friendly
  stream of `EvalStreamEvent`s — the agent service forwards these from
  `POST /eval/run`; browser code parses them with lightweight guards derived
  from the `@novamind/shared` event contract so Zod stays out of client
  chunks. Request abort signals are passed through the eval runner into task
  and judge calls, so closing the browser stream stops provider work instead
  of only closing the transport.
- Axes are exposed as factories (`buildPlanStabilitySpec`, etc.) so the
  hill-climbing UI can pass a custom `hypothesisSystemPrompt` without
  forking the dataset.
- `plan-stability` starts at the hypothesis handoff with fixture
  `verified_claims` and `rejected_claims`; it does not run search, claim
  extraction, or citation verification. The fixtures cover indirect
  comparisons, off-question evidence, partial answers, rejected-claim lures,
  and mechanism boundaries.
- The live hill-climbing UI records the first successful three-case run as
  `v0`, then compares later prompt revisions against that same selected
  fixture set.
- Each prompt-improvement request uses the prompt currently loaded in the
  editor and the latest completed run summary. A repeated
  `run → improve → run → improve` loop therefore builds on the scored
  replacement prompt and recomputes the weakest target metric from the newest
  run.
- `prompt-improver-effort` is an opt-in live check that compares Sonnet 4.6
  `low` and `medium` effort on a representative prompt-improvement trace.
  Use it before changing the live improver effort default.
- `single-turn-structured` sets Claude to low effort because that axis
  measures schema-constrained extraction, not deep reasoning.
- Claude prompt, schema, effort, and structured-output conventions are
  documented in [Claude integration](../../docs/claude.md). Keep eval judges
  aligned with that guide: prompts describe rubric semantics, while schemas
  own response shape.
- The CLI scripts share `parseCliArgs`, `fmtPct`, `fmtCost`, `fmtMs`, and
  `persistRun` from `scripts/cli-utils.ts`.

See [`docs/evals.md`](../../docs/evals.md) for the full guide.
