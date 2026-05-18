# Corpus Pipeline

The literature corpus is a PubMed-derived collection focused on GLP-1 receptor
agonists and peptide therapeutics. The data-viz demo uses a separate
ClinicalTrials.gov API v2 snapshot of GLP-1-related studies with posted
results. The offline fixtures are local fallbacks, not the normal
demo path.

Generated artifacts are gitignored. The deployment operator runs the build,
uploads to R2, and copies the public URLs into the agent's environment.

## Source Provenance

The generated corpora are reproducible from public biomedical sources and are
not checked into git because the embeddings are large generated artifacts.

- **Literature corpus:** PubMed records fetched through
  [NCBI E-utilities](https://www.ncbi.nlm.nih.gov/home/develop/api/) using
  `esearch.fcgi` followed by `efetch.fcgi`. The ingestion query is:

  ```text
  ("GLP-1 receptor agonists"[MeSH] OR semaglutide OR tirzepatide OR retatrutide OR liraglutide OR "glucagon-like peptide-1")
  OR
  ("peptide therapeutic*" OR "peptide drug conjugate*" OR "peptide modification*" OR lipidation OR PEGylation)
  ```

  `papers.json` preserves PMID, title, abstract, year, journal, authors, and
  MeSH terms. It does not include full-text articles.

- **Clinical-trials corpus:** ClinicalTrials.gov records fetched from the
  [official API v2](https://clinicaltrials.gov/data-about-studies/learn-about-api)
  with:

  ```text
  query.term=(semaglutide OR tirzepatide OR retatrutide OR liraglutide OR dulaglutide OR exenatide OR GLP-1)
  filter.advanced=AREA[HasResults]true
  ```

  The normalized `clinical-trials.json` includes protocol metadata, posted
  outcome measurements, and adverse-event rows used by the Stage 6
  report-builder tools.

Both generated files include source metadata (`_generated`, `_query`, and for
ClinicalTrials.gov, `_sourceApiVersion` / `_sourceDataTimestamp`) so a clone
can inspect exactly when and how a snapshot was produced.

## Files

Generated PubMed files live under `internal/corpus/data/`:

- `papers.json` — cleaned PubMed records with title, abstract, year,
  journal, authors, MeSH terms.
- `embeddings.voyage.json` — Voyage-3 document embeddings keyed by PMID.
- `embeddings.openai.json` — `text-embedding-3-large` document embeddings.

Generated trial data lives under `internal/clinical-trials/data/`:

- `clinical-trials.json` — normalized ClinicalTrials.gov studies, outcome
  measurements, and adverse-event rows for Stage 6.

The runtime loader (`packages/pipeline/src/rag/`) resolves these files in
this order by default:

1. **Cloudflare R2** — `NOVAMIND_PAPERS_URL`,
   `NOVAMIND_VOYAGE_EMBEDDINGS_URL`, `NOVAMIND_OPENAI_EMBEDDINGS_URL`.
2. **Local filesystem** — `internal/corpus/data/` by default. Override with
   `NOVAMIND_CORPUS_DIR` when running outside the monorepo layout.
3. **Offline 12-paper fixture** — `packages/pipeline/src/rag/fixtures.json`.

`DEMO_FIXTURE_MODE=true` forces the fixture and disables vector retrieval,
even when R2 or local files are available. Production fails closed before
this fallback unless `DEMO_FIXTURE_MODE=true` is set explicitly.

The Stage 6 trial loader resolves data in this order:

1. **Cloudflare R2** — `NOVAMIND_TRIALS_URL`.
2. **Local filesystem** — `internal/clinical-trials/data/` by default.
   Override with `NOVAMIND_TRIALS_DIR`.
3. **Offline fixture** — `packages/pipeline/src/data-viz/trials-fixture.json`.

Production fails closed before this fallback unless `DEMO_FIXTURE_MODE=true`
is set explicitly.

## Environment

Required for the embedding step:

- `VOYAGE_API_KEY`
- `OPENAI_API_KEY`

Optional (recommended) for PubMed ingest — improves rate limits and
identifies the client politely per NCBI guidance:

- `NCBI_API_KEY`
- `NCBI_TOOL` (defaults to `novamind-corpus`)
- `NCBI_EMAIL`

The ingest client sends a `User-Agent` and `tool` value on every NCBI request.
Set `NCBI_EMAIL` for a production rebuild so NCBI can identify the operator
for rate-limit or policy issues.

Required for R2 upload via the Cloudflare API token path:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Alternative R2 S3-compatible credentials are still accepted
(`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`); they are not required when
the API token is set.

No API key is required for the ClinicalTrials.gov snapshot. It uses the
official public API v2.

## Rebuild Corpus

```bash
pnpm --filter @novamind/corpus ingest --retmax=500
pnpm --filter @novamind/corpus embed
pnpm --filter @novamind/corpus clinical-trials --retmax=250
pnpm --filter @novamind/corpus upload-r2
```

With `CLOUDFLARE_API_TOKEN`, `upload-r2` creates the configured bucket if
needed, uploads `papers.json`, both embedding files, and
`clinical-trials.json` when present, enables the public `r2.dev` URL unless
disabled, and prints these values to copy into your environment:

- `NOVAMIND_PAPERS_URL`
- `NOVAMIND_VOYAGE_EMBEDDINGS_URL`
- `NOVAMIND_OPENAI_EMBEDDINGS_URL`
- `NOVAMIND_TRIALS_URL`

Set `R2_SKIP_DEV_URL=true` if you do not want `r2.dev` enabled (e.g. when
you intend to front the bucket with a custom domain).

When using the S3-compatible R2 credential path, the script uploads objects
but does not create buckets or enable public access. Create the bucket and
public URL separately in Cloudflare, then set the same `NOVAMIND_*_URL`
values manually.

The R2 bucket should contain only public, derived demo artifacts. Do not
upload secrets, private user data, PHI, customer documents, or raw materials
that are not meant to be publicly retrievable.

## Scaling Notes

The current corpus is small enough (≈500 papers) to load into memory at
agent boot. The rough breaking point is around 10K papers, where
`embeddings.voyage.json` starts to push tens of MB and the cosine-loop in
`vector.ts` becomes the bottleneck. The next step is Cloudflare Vectorize
(or any managed vector store) plus a database-backed metadata + FTS
index. The current boundaries in `packages/pipeline/src/rag/` are
deliberately narrow so that swap is local.
