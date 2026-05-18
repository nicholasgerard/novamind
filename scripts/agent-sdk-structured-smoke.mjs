import { createRequire } from "node:module";
import { loadRepoEnv } from "./lib/env.mjs";

loadRepoEnv();

const packageRequire = createRequire(
  new URL("../packages/pipeline/package.json", import.meta.url),
);
const { createSdkMcpServer, query, startup, tool } = await import(
  packageRequire.resolve("@anthropic-ai/claude-agent-sdk")
);
const { z } = await import(packageRequire.resolve("zod"));

const model = process.env.NOVAMIND_SMOKE_MODEL ?? "claude-sonnet-4-6";
const initializeTimeoutMs = Number(
  process.env.NOVAMIND_SMOKE_STARTUP_TIMEOUT_MS ?? 90_000,
);
const schema = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description: "The concise answer requested by the prompt.",
    },
  },
  required: ["answer"],
  additionalProperties: false,
};

const baseOptions = {
  model,
  tools: [],
  permissionMode: "dontAsk",
  settingSources: [],
  skills: [],
  persistSession: false,
  maxTurns: 4,
  maxBudgetUsd: Number(process.env.NOVAMIND_SMOKE_MAX_BUDGET_USD ?? 0.5),
  outputFormat: {
    type: "json_schema",
    schema,
  },
  env: {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: "novamind-structured-smoke/0.0.0",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ENABLE_TOOL_SEARCH: "false",
  },
};

const smokeToolServer = createSdkMcpServer({
  name: "structured_smoke",
  version: "0.0.0",
  alwaysLoad: true,
  tools: [
    tool(
      "echo_value",
      "Echoes the provided value so the structured-output smoke test can verify MCP tool use before the final response.",
      {
        value: z.string().describe("Value to echo."),
      },
      async ({ value }) => ({
        structuredContent: { value },
        content: [{ type: "text", text: `value=${value}` }],
      }),
    ),
  ],
});

const scenarios = [
  {
    name: "cold-system-prompt",
    mode: "cold",
    prompt: "Answer with the word alpha.",
    options: {
      ...baseOptions,
      systemPrompt: "You return the requested final answer.",
    },
  },
  {
    name: "warm-system-prompt",
    mode: "warm",
    prompt: "Answer with the word beta.",
    options: {
      ...baseOptions,
      systemPrompt: "You return the requested final answer.",
    },
  },
  {
    name: "cold-system-prompt-mcp",
    mode: "cold",
    prompt:
      'Call echo_value with value "eta", then answer with the exact echoed value.',
    options: {
      ...baseOptions,
      systemPrompt:
        "Use the smoke MCP tool when the user asks for it, then return the requested final answer.",
      mcpServers: { structured_smoke: smokeToolServer },
      allowedTools: ["mcp__structured_smoke__echo_value"],
      strictMcpConfig: true,
    },
  },
  {
    name: "warm-system-prompt-mcp",
    mode: "warm",
    prompt:
      'Call echo_value with value "theta", then answer with the exact echoed value.',
    options: {
      ...baseOptions,
      systemPrompt:
        "Use the smoke MCP tool when the user asks for it, then return the requested final answer.",
      mcpServers: { structured_smoke: smokeToolServer },
      allowedTools: ["mcp__structured_smoke__echo_value"],
      strictMcpConfig: true,
    },
  },
];

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  throw new Error("ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is required.");
}

const scenarioFilter = new Set(
  (process.env.NOVAMIND_SMOKE_SCENARIOS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const selectedScenarios =
  scenarioFilter.size === 0
    ? scenarios
    : scenarios.filter((scenario) => scenarioFilter.has(scenario.name));
if (selectedScenarios.length === 0) {
  throw new Error(
    `No smoke scenarios selected. Available scenarios: ${scenarios
      .map((scenario) => scenario.name)
      .join(", ")}`,
  );
}

const results = [];
for (const scenario of selectedScenarios) {
  const startedAt = Date.now();
  try {
    const result =
      scenario.mode === "warm"
        ? await runWarmScenario(scenario)
        : await collect(
            query({
              prompt: scenario.prompt,
              options: scenario.options,
            }),
          );
    results.push(summarize(scenario.name, result, Date.now() - startedAt));
  } catch (err) {
    results.push({
      name: scenario.name,
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - startedAt,
    });
  }
}

console.log(JSON.stringify(results, null, 2));
const failures = results.filter(
  (result) =>
    result.error ||
    result.subtype !== "success" ||
    result.hasStructuredOutput !== true,
);
if (failures.length > 0) {
  console.error(
    `Agent SDK structured-output smoke failed: ${failures
      .map((result) => result.name)
      .join(", ")}`,
  );
  process.exitCode = 1;
}

async function runWarmScenario(scenario) {
  const warm = await startup({
    initializeTimeoutMs,
    options: scenario.options,
  });
  try {
    return await collect(warm.query(scenario.prompt));
  } finally {
    warm.close();
  }
}

async function collect(messages) {
  let result;
  for await (const message of messages) {
    if (message.type === "result") result = message;
  }
  if (!result) throw new Error("No result message returned.");
  return result;
}

function summarize(name, result, elapsedMs) {
  return {
    name,
    elapsedMs,
    subtype: result.subtype,
    hasStructuredOutput:
      result.subtype === "success" && result.structured_output !== undefined,
    structuredOutput:
      result.subtype === "success" ? result.structured_output : undefined,
    errors: Array.isArray(result.errors) ? result.errors : undefined,
    numTurns: result.num_turns,
  };
}
