import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
import type { Paper } from "@novamind/shared";

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const NCBI_TIMEOUT_MS = 20_000;
const NCBI_RETRY_DELAYS_MS = [500, 1_500, 3_000] as const;

function withNcbiAuth(url: URL): URL {
  if (process.env.NCBI_API_KEY)
    url.searchParams.set("api_key", process.env.NCBI_API_KEY);
  url.searchParams.set("tool", process.env.NCBI_TOOL || "novamind-corpus");
  if (process.env.NCBI_EMAIL)
    url.searchParams.set("email", process.env.NCBI_EMAIL);
  return url;
}

const ESearchResultSchema = z.object({
  esearchresult: z.object({
    idlist: z.array(z.string()),
    count: z.string(),
  }),
});

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  trimValues: true,
});

export async function searchPubMed(
  query: string,
  opts: { retmax?: number; sort?: "pub date" | "relevance" } = {},
): Promise<string[]> {
  const url = withNcbiAuth(new URL(`${NCBI_BASE}/esearch.fcgi`));
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("term", query);
  url.searchParams.set("retmode", "json");
  url.searchParams.set("retmax", String(opts.retmax ?? 50));
  url.searchParams.set("sort", opts.sort ?? "relevance");

  const res = await fetchNcbi(url);
  if (!res.ok) {
    throw new Error(`PubMed esearch failed: ${res.status} ${res.statusText}`);
  }
  const data = ESearchResultSchema.parse(await res.json());
  return data.esearchresult.idlist;
}

export async function fetchPubMedAbstracts(pmids: string[]): Promise<Paper[]> {
  if (pmids.length === 0) return [];
  const url = withNcbiAuth(new URL(`${NCBI_BASE}/efetch.fcgi`));
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", pmids.join(","));
  url.searchParams.set("rettype", "abstract");
  url.searchParams.set("retmode", "xml");

  const res = await fetchNcbi(url);
  if (!res.ok) {
    throw new Error(`PubMed efetch failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  return parsePubMedXml(xml);
}

async function fetchNcbi(url: URL): Promise<Response> {
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt <= NCBI_RETRY_DELAYS_MS.length; attempt++) {
    const signal = AbortSignal.timeout(NCBI_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": ncbiUserAgent(),
        },
        signal,
      });
      if (
        res.ok ||
        !retryableNcbiStatus(res.status) ||
        attempt === NCBI_RETRY_DELAYS_MS.length
      ) {
        return res;
      }
      lastStatus = res.status;
    } catch (err) {
      if (attempt === NCBI_RETRY_DELAYS_MS.length) throw err;
    }
    await sleep(NCBI_RETRY_DELAYS_MS[attempt] ?? NCBI_RETRY_DELAYS_MS.at(-1)!);
  }
  throw new Error(`NCBI request failed after retries: HTTP ${lastStatus}`);
}

function retryableNcbiStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function ncbiUserAgent(): string {
  const email = process.env.NCBI_EMAIL?.trim();
  return email ? `novamind-corpus/0.0 (${email})` : "novamind-corpus/0.0";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function parsePubMedXml(xml: string): Paper[] {
  const root = asRecord(xmlParser.parse(xml));
  const articles = asArray(
    asRecord(root?.PubmedArticleSet)?.PubmedArticle ?? root?.PubmedArticle,
  );
  return articles
    .map(parsePubMedArticle)
    .filter((paper): paper is Paper => Boolean(paper));
}

function parsePubMedArticle(value: unknown): Paper | undefined {
  const articleRoot = asRecord(value);
  const citation = asRecord(articleRoot?.MedlineCitation);
  const article = asRecord(citation?.Article);
  const pmid = textContent(citation?.PMID);
  if (!pmid || !article) return undefined;

  return {
    pmid,
    title: textContent(article.ArticleTitle),
    abstract: abstractText(article.Abstract),
    year: articleYear(article),
    journal: textContent(asRecord(article.Journal)?.Title),
    authors: authorNames(asRecord(article.AuthorList)?.Author),
    meshTerms: meshTerms(asRecord(citation?.MeshHeadingList)?.MeshHeading),
  };
}

function abstractText(value: unknown): string {
  const abstract = asRecord(value);
  if (!abstract) return "";
  return asArray(abstract.AbstractText)
    .map((section) => {
      const record = asRecord(section);
      const label = record
        ? textContent(record["@Label"] ?? record["@NlmCategory"])
        : "";
      const body = textContent(section);
      return label && body ? `${label}: ${body}` : body;
    })
    .filter(Boolean)
    .join("\n");
}

function articleYear(article: Record<string, unknown>): number {
  const journalIssue = asRecord(asRecord(article.Journal)?.JournalIssue);
  const pubDate = asRecord(journalIssue?.PubDate);
  const explicitYear =
    textContent(pubDate?.Year) ||
    textContent(asRecord(asArray(article.ArticleDate)[0])?.Year);
  if (explicitYear) return Number(explicitYear) || 0;
  const medlineDate = textContent(pubDate?.MedlineDate);
  return Number(medlineDate.match(/\b(19|20)\d{2}\b/)?.[0] ?? "0") || 0;
}

function authorNames(value: unknown): string[] {
  return asArray(value)
    .map((item) => {
      const author = asRecord(item);
      if (!author) return "";
      const collective = textContent(author.CollectiveName);
      if (collective) return collective;
      const lastName = textContent(author.LastName);
      if (!lastName) return "";
      const initials = textContent(author.Initials);
      return initials ? `${lastName} ${initials}` : lastName;
    })
    .filter(Boolean);
}

function meshTerms(value: unknown): string[] {
  return asArray(value)
    .map((item) => textContent(asRecord(item)?.DescriptorName))
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textContent(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") {
    return String(value).replace(/\s+/g, " ").trim();
  }
  if (Array.isArray(value)) {
    return value.map(textContent).filter(Boolean).join(" ").trim();
  }
  const record = asRecord(value);
  if (!record) return "";
  return Object.entries(record)
    .filter(([key]) => !key.startsWith("@"))
    .map(([, child]) => textContent(child))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** GLP-1 + peptides curated query, used by the ingestion script. */
export const GLP1_PEPTIDES_QUERY = [
  '("GLP-1 receptor agonists"[MeSH] OR semaglutide OR tirzepatide OR retatrutide OR liraglutide OR "glucagon-like peptide-1")',
  "OR",
  '("peptide therapeutic*" OR "peptide drug conjugate*" OR "peptide modification*" OR lipidation OR PEGylation)',
].join(" ");
