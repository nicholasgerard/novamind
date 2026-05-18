import { z } from "zod";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const OPENAI_URL = "https://api.openai.com/v1/embeddings";

/** Default fetch timeout for embedding APIs. Surfaces stalled connections fast. */
const DEFAULT_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const VoyageRespSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()) })),
});

const OpenAIRespSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()) })),
});

export interface VoyageOptions {
  model?: "voyage-3" | "voyage-3-lite" | "voyage-3-large";
  inputType?: "document" | "query";
  apiKey?: string;
  timeoutMs?: number;
}

export async function embedVoyage(
  inputs: string[],
  opts: VoyageOptions = {},
): Promise<number[][]> {
  const apiKey = opts.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY not set");
  const res = await fetchWithTimeout(
    VOYAGE_URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: inputs,
        model: opts.model ?? "voyage-3",
        input_type: opts.inputType ?? "document",
      }),
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(
      `Voyage embeddings failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = VoyageRespSchema.parse(await res.json());
  return data.data.map((d) => d.embedding);
}

export interface OpenAIEmbedOptions {
  model?: "text-embedding-3-large" | "text-embedding-3-small";
  dimensions?: number;
  apiKey?: string;
  timeoutMs?: number;
}

export async function embedOpenAI(
  inputs: string[],
  opts: OpenAIEmbedOptions = {},
): Promise<number[][]> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const res = await fetchWithTimeout(
    OPENAI_URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: inputs,
        model: opts.model ?? "text-embedding-3-large",
        ...(opts.dimensions ? { dimensions: opts.dimensions } : {}),
      }),
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(
      `OpenAI embeddings failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = OpenAIRespSchema.parse(await res.json());
  return data.data.map((d) => d.embedding);
}
