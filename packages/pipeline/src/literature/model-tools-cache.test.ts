import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "@novamind/shared";
import {
  runCitationVerificationModelTool,
  runClaimExtractionModelTool,
} from "./model-tools";

const papers: Paper[] = [
  {
    abstract: "Semaglutide reduced HbA1c versus placebo in adults.",
    authors: [],
    journal: "Demo Journal",
    meshTerms: [],
    pmid: "111",
    title: "Semaglutide trial",
    year: 2025,
  },
];

describe("literature model tool caching", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps the retrieved-paper cache prefix identical for Haiku tools", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        claudeResponse({
          claims: [
            {
              claim: "Semaglutide reduced HbA1c versus placebo in adults.",
              pmid: "111",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        claudeResponse({
          verdicts: [
            {
              claim: "Semaglutide reduced HbA1c versus placebo in adults.",
              evidenceId: "ev-01",
              pmid: "111",
              rationale: "Directly stated by the abstract.",
              supported: true,
              supportingQuote:
                "Semaglutide reduced HbA1c versus placebo in adults.",
            },
          ],
        }),
      );

    const extraction = await runClaimExtractionModelTool({
      papers,
      question: "Compare HbA1c reduction.",
    });
    await runCitationVerificationModelTool({
      claims: extraction.claims.map((claim) => ({
        ...claim,
        evidenceId: "ev-01",
      })),
      papers,
    });

    const extractionBody = requestBody(fetchMock, 0);
    const verifierBody = requestBody(fetchMock, 1);
    expect(extractionBody.system).toEqual(verifierBody.system);
    expect(extractionBody.messages[0]?.content[0]).toEqual(
      verifierBody.messages[0]?.content[0],
    );
    expect(extractionBody.messages[0]?.content[0]).toMatchObject({
      cache_control: { ttl: "1h", type: "ephemeral" },
      type: "text",
    });
    expect(extractionBody.messages[0]?.content[1]).not.toHaveProperty(
      "cache_control",
    );
    expect(verifierBody.messages[0]?.content[1]).not.toHaveProperty(
      "cache_control",
    );
  });
});

function requestBody(
  fetchMock: { mock: { calls: unknown[][] } },
  callIndex: number,
): {
  messages: Array<{ content: Array<Record<string, unknown>> }>;
  system: unknown;
} {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return JSON.parse(init?.body as string);
}

function claudeResponse(output: unknown): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text: JSON.stringify(output) }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 12,
        output_tokens: 4,
      },
    }),
    { status: 200 },
  );
}
