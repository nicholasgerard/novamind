# @novamind/corpus

Build-time pipeline for the GLP-1 + peptide therapeutics PubMed corpus and
the ClinicalTrials.gov snapshot used by the demos. Nothing in this package
runs at agent runtime; it produces artifacts that the deployed agent consumes
from Cloudflare R2 or local gitignored data.

The generated artifacts are public-source derivatives and are intentionally
not committed. Literature data comes from PubMed through NCBI E-utilities;
trial data comes from the official ClinicalTrials.gov API v2. See
[`docs/corpus.md`](../../docs/corpus.md) for exact source queries and
normalization details.

## Topic

GLP-1 receptor agonists as the primary focus (semaglutide, tirzepatide,
retatrutide, multi-receptor agonists), with broader peptide therapeutics
for retrieval coverage (modifications, PK, peptide-drug conjugates).

## Pipeline

1. **Ingest** — PubMed E-utilities → `internal/corpus/data/papers.json`.
2. **Embed** — Voyage-3 + OpenAI text-embedding-3-large in parallel →
   `internal/corpus/data/embeddings.{voyage,openai}.json`.
3. **Clinical trials** — ClinicalTrials.gov API v2 →
   `internal/clinical-trials/data/clinical-trials.json`.
4. **Upload** — push the gitignored corpus artifacts to Cloudflare R2 so
   the deployed agent can fetch them on boot.

## Run

```bash
# Required env (see .env.example at repo root):
#   NCBI_API_KEY (optional but recommended for ingest rate limits)
#   NCBI_EMAIL (recommended for production ingest identification)
#   VOYAGE_API_KEY
#   OPENAI_API_KEY
#   CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (or R2 S3 keys) for upload-r2

pnpm --filter @novamind/corpus ingest --retmax=500
pnpm --filter @novamind/corpus embed
pnpm --filter @novamind/corpus clinical-trials --retmax=250
pnpm --filter @novamind/corpus upload-r2
```

Output writes to `internal/corpus/data/`, which is gitignored. The runtime
loader in `@novamind/pipeline` normally resolves R2 first, then local
`internal/corpus/data/`, then the offline 12-paper fixture at
`packages/pipeline/src/rag/fixtures.json`. Production fails closed before
fixture fallback unless `DEMO_FIXTURE_MODE=true` is set explicitly.

`upload-r2` supports either Cloudflare R2 S3 keys or `CLOUDFLARE_API_TOKEN`.
With the API token path it creates the `novamind-corpus` bucket if needed,
uploads the PubMed files plus `clinical-trials.json` when present, enables
the public r2.dev URL, and prints the
`NOVAMIND_*_URL` values to copy into the agent environment.

With S3-compatible R2 keys, create the bucket and public URL yourself; that
path uploads objects only.

See [`docs/corpus.md`](../../docs/corpus.md) for the full operating guide.
