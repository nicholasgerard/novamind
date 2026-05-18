import OpenAI from "openai";

let client: OpenAI | null = null;

/** Lazy OpenAI client. Throws if `OPENAI_API_KEY` is unset. */
export function getOpenAI(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");
    client = new OpenAI({ apiKey });
  }
  return client;
}

export function isOpenAIAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
