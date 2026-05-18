import { z } from "zod";
import {
  query,
  startup,
  type McpServerConfig,
  type Options,
  type Query,
  type SDKResultMessage,
  type SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";
import { ZERO_USAGE, sumUsage, type StreamEvent } from "@novamind/shared";
import {
  ensureClaudeAgentRuntime,
  orchestratorEffort,
  orchestratorThinking,
  sdkColdFirstMessageTimeoutMs,
  sdkIdleTimeoutMs,
  sdkLiveStartupWaitMs,
  sdkStartupInitializeTimeoutMs,
  sdkWarmFirstMessageTimeoutMs,
} from "../agent-sdk/config";
import { describeSdkMessage } from "../agent-sdk/messages";
import { parseAgentSdkStructuredOutput } from "../agent-sdk/structured-output";
import {
  getAgentSdkRuntimeManager,
  withAgentSdkMessageTimeouts,
  type AgentSdkRuntimeTimingSink,
  type AgentSdkWarmProfileDefinition,
} from "../agent-sdk/runtime";
import { ORCHESTRATOR_MAX_TURNS, ORCHESTRATOR_MODEL } from "../model-config";
import {
  claudeAgentEnv,
  claudeAgentRuntimePaths,
  claudeStructuredOutputSchema,
  resolveClaudeExecutablePath,
  usageFromAgentResult,
} from "../structured";
import { AsyncEventQueue, emitOrchestratorNote } from "./events";
import {
  createAgentLoopEmitter,
  createAgentLoopMessageMapper,
} from "./agent-sdk-observability";
import { emitLiteratureTiming, startLiteratureTiming } from "./timing";
import {
  createDeferredLiteratureToolServer,
  createLiteratureToolServer,
} from "./tools";
import type {
  LiteratureAgentRun,
  LiteratureRunState,
  RunLiteratureAgentArgs,
} from "./types";

export { ORCHESTRATOR_MODEL } from "../model-config";
const OrchestratorResultSchema = z
  .object({
    status: z
      .enum(["complete", "failed"])
      .describe(
        "Use complete after synthesize_hypothesis succeeds, or after search_literature reports completeWithoutEvidence. Use failed only when a fatal tool error prevents completion.",
      ),
    reason: z
      .string()
      .max(240)
      .optional()
      .describe(
        "Short plain-text failure reason. Include only when status is failed.",
      ),
  })
  .strict();
type OrchestratorResult = z.infer<typeof OrchestratorResultSchema>;
type OrchestratorResultParse =
  | {
      data: OrchestratorResult;
      success: true;
    }
  | {
      error: string;
      success: false;
    };

export const allowedLiteratureOrchestratorTools = [
  "mcp__novamind_literature_orchestrator__search_literature",
  "mcp__novamind_literature_orchestrator__extract_candidate_claims",
  "mcp__novamind_literature_orchestrator__verify_citations",
  "mcp__novamind_literature_orchestrator__synthesize_hypothesis",
] as const;

/**
 * Top-level literature research agent. The orchestrator owns control flow and
 * calls scoped typed tools in a bounded order. The tools do one narrow model
 * or retrieval operation, validate their handoffs, and return recoverable
 * errors to the orchestrator so it can repair the trajectory.
 */
export async function* runLiteratureAgent(
  args: RunLiteratureAgentArgs,
): AsyncIterable<StreamEvent> {
  const queue = new AsyncEventQueue<StreamEvent>({
    label: "literature stream",
    maxBuffer: 512,
  });
  const state = createInitialState(args);

  const producer = runOrchestrator(state, (event) => queue.push(event))
    .catch((err) => {
      if (isAbortError(err)) {
        console.info("[literature] orchestrator aborted");
        return;
      }
      console.error("[literature] orchestrator failed", err);
      queue.push({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
      });
    })
    .finally(() => queue.finish());

  for await (const event of queue) {
    yield event;
  }

  await producer;
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

function abortError(message: string): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

export async function collectLiteratureAgentRun(
  args: RunLiteratureAgentArgs,
): Promise<LiteratureAgentRun> {
  const t0 = Date.now();
  const events: StreamEvent[] = [];
  for await (const event of runLiteratureAgent(args)) {
    events.push(event);
  }
  const finalEvent = events.find((event) => event.type === "pipeline_result");
  return {
    result:
      finalEvent?.type === "pipeline_result" ? finalEvent.result : undefined,
    totalUsage:
      finalEvent?.type === "pipeline_result"
        ? finalEvent.totalUsage
        : ZERO_USAGE,
    events,
    elapsedMs: Date.now() - t0,
  };
}

export const literatureAgentSdkWarmProfile = {
  name: "literature",
  async startWarmQuery({ abortController, onTiming }) {
    const target = createDeferredLiteratureToolServer();
    const startedAt = Date.now();
    const warmQuery = await startup({
      initializeTimeoutMs: sdkStartupInitializeTimeoutMs(),
      options: await buildLiteratureSdkOptions({
        abortController,
        mcpServer: target.server,
        runId: "warm-literature-profile",
        telemetryAction: "literature-warm-profile",
      }),
    });
    onTiming?.({
      elapsedMs: Date.now() - startedAt,
      phase: "finish",
      profile: "literature",
      sdkEvent: "warm_query_initialized",
      stage: "agent_sdk_runtime",
    });
    return {
      warmQuery,
      bind: target.bind,
      clear: target.clear,
    };
  },
} satisfies AgentSdkWarmProfileDefinition<{
  emit: (event: StreamEvent) => void;
  state: LiteratureRunState;
}>;

async function runOrchestrator(
  state: LiteratureRunState,
  emit: (event: StreamEvent) => void,
): Promise<void> {
  const startedAt = Date.now();
  const finishTiming = startLiteratureTiming(state, "orchestrator", {
    model: ORCHESTRATOR_MODEL,
  });
  emitOrchestratorNote(
    emit,
    "Planning a bounded research-agent trajectory: search, extract claims, verify citations, then synthesize from verified evidence only.",
  );

  try {
    const result = await callOrchestratorAgent(state, emit);
    const orchestratorUsage = usageFromAgentResult(result, {
      fallbackModel: ORCHESTRATOR_MODEL,
    });
    state.usageParts.push(orchestratorUsage);

    if (result.subtype !== "success") {
      throw new Error(
        result.errors?.join("; ") ??
          `Claude Agent SDK failed with ${result.subtype}`,
      );
    }
    const parsed = parseOrchestratorResult(result);
    if (!parsed.success) {
      throw new Error(parsed.error);
    }

    if (parsed.data.status === "failed") {
      throw new Error(
        parsed.data.reason ??
          "Literature orchestrator reported failure without a reason.",
      );
    }
    if (!state.finalResult) {
      throw new Error(
        "Orchestrator completed without synthesizing a final result.",
      );
    }

    const supportedClaimCount = state.verdicts.filter(
      (verdict) => verdict.supported,
    ).length;
    emitOrchestratorNote(
      emit,
      literatureCompletionNote({
        candidateClaimCount: state.candidateClaims.length,
        paperCount: state.hits.length,
        rejectedClaimCount: state.verdicts.length - supportedClaimCount,
        supportedClaimCount,
      }),
      orchestratorUsage,
    );

    emit({
      type: "pipeline_result",
      result: state.finalResult,
      totalUsage: sumUsage(state.usageParts),
      ts: Date.now(),
    });

    finishTiming("finish", {
      candidateClaimCount: state.candidateClaims.length,
      hitCount: state.hits.length,
      usageCostUsd: orchestratorUsage.costUsd,
      verdictCount: state.verdicts.length,
    });
    console.log(
      `[literature] orchestrated agent complete in ${Date.now() - startedAt}ms (hits=${state.hits.length}, claims=${state.candidateClaims.length}, verdicts=${state.verdicts.length})`,
    );
  } catch (err) {
    finishTiming("error", {
      error: err instanceof Error ? err.message : String(err),
      hitCount: state.hits.length,
      candidateClaimCount: state.candidateClaims.length,
      verdictCount: state.verdicts.length,
    });
    throw err;
  }
}

async function callOrchestratorAgent(
  state: LiteratureRunState,
  emit: (event: StreamEvent) => void,
): Promise<SDKResultMessage> {
  const sdkStartedAt = Date.now();
  const effort = orchestratorEffort(ORCHESTRATOR_MODEL);
  const thinking = orchestratorThinking();
  const emitLoop = createAgentLoopEmitter(emit, sdkStartedAt);
  const loopEventFromSdkMessage = createAgentLoopMessageMapper();

  let result: SDKResultMessage | undefined;
  emitLoop({
    phase: "session",
    status: "running",
    label: "Starting orchestrator",
    detail: "Launching the bounded orchestrator with the literature tools.",
  });
  emitOrchestratorSdkEvent(state, sdkStartedAt, "query_created", {
    effort,
    maxTurns: ORCHESTRATOR_MAX_TURNS,
    model: ORCHESTRATOR_MODEL,
    sdkStartupMode: "pending",
    thinking: thinking.type,
    toolCount: allowedLiteratureOrchestratorTools.length,
  });

  const manager = getAgentSdkRuntimeManager();
  const runtimeTiming: AgentSdkRuntimeTimingSink = (event) => {
    emitLiteratureTiming(state, event);
  };
  const claim = await manager.claimWarmProfile(
    literatureAgentSdkWarmProfile,
    { state, emit },
    {
      liveAbortController: state.args.abortController,
      maxStartupWaitMs: sdkLiveStartupWaitMs(),
      onTiming: runtimeTiming,
    },
  );
  let messages: Query | undefined;
  const sdkStartupMode = claim ? "warm_query" : "cold_query";
  let coldRunStreamFinished = false;
  try {
    if (claim) {
      messages = claim.query(literatureOrchestratorRunPrompt(state.question));
    } else {
      const mcpServer = createLiteratureToolServer(state, emit);
      messages = query({
        prompt: literatureOrchestratorRunPrompt(state.question),
        options: await buildLiteratureSdkOptions({
          abortController: state.args.abortController,
          mcpServer,
          runId: state.args.runId,
          telemetryAction: "literature",
        }),
      });
    }

    emitOrchestratorSdkEvent(state, sdkStartedAt, "query_started", {
      sdkStartupMode,
    });

    let messageCount = 0;
    for await (const message of withAgentSdkMessageTimeouts(messages, {
      firstMessageTimeoutMs: claim
        ? sdkWarmFirstMessageTimeoutMs()
        : sdkColdFirstMessageTimeoutMs(),
      idleTimeoutMs: sdkIdleTimeoutMs(),
      profile: "literature",
      onTimeout: (err) => {
        emitOrchestratorSdkEvent(state, sdkStartedAt, err.timeoutKind, {
          error: err.message,
          sdkStartupMode,
        });
        claim?.abort();
        messages?.close();
      },
    })) {
      messageCount += 1;
      emitOrchestratorSdkEvent(
        state,
        sdkStartedAt,
        "message",
        describeSdkMessage(message, messageCount),
      );
      const loopEvent = loopEventFromSdkMessage(message);
      if (loopEvent) emitLoop(loopEvent);
      if (message.type === "result") result = message;
    }
    emitOrchestratorSdkEvent(state, sdkStartedAt, "stream_finished", {
      messageCount,
      sdkStartupMode,
      subtype: result?.subtype,
    });
    coldRunStreamFinished = !claim;
  } finally {
    if (claim) {
      claim.finish({ replenish: true });
    } else if (coldRunStreamFinished) {
      void manager.ensureWarmProfile(literatureAgentSdkWarmProfile, {
        onTiming: runtimeTiming,
        reason: "replenish_after_cold_live_run",
      });
    }
  }
  if (!result) {
    if (state.args.abortController?.signal.aborted) {
      throw abortError("Claude Agent SDK stream was aborted.");
    }
    throw new Error("Claude Agent SDK returned no result message");
  }
  emitLoop({
    phase: "complete",
    status: result.subtype === "success" ? "complete" : "error",
    label:
      result.subtype === "success"
        ? "Agent loop complete"
        : "Agent loop ended with an SDK error",
    detail:
      result.subtype === "success"
        ? "Claude returned the structured trajectory result."
        : result.errors?.join("; "),
  });
  return result;
}

async function buildLiteratureSdkOptions({
  abortController,
  mcpServer,
  runId,
  telemetryAction,
}: {
  abortController?: AbortController;
  mcpServer: McpServerConfig;
  runId?: string;
  telemetryAction: string;
}): Promise<Options> {
  const pathToClaudeCodeExecutable = resolveClaudeExecutablePath();
  const runtimePaths = claudeAgentRuntimePaths("literature");
  await ensureClaudeAgentRuntime(runtimePaths);
  const effort = orchestratorEffort(ORCHESTRATOR_MODEL);
  const thinking = orchestratorThinking();

  return {
    model: ORCHESTRATOR_MODEL,
    systemPrompt: literatureOrchestratorPrompt(),
    tools: [],
    cwd: runtimePaths.cwd,
    mcpServers: { novamind_literature_orchestrator: mcpServer },
    allowedTools: [...allowedLiteratureOrchestratorTools],
    strictMcpConfig: true,
    permissionMode: "dontAsk",
    persistSession: false,
    maxTurns: ORCHESTRATOR_MAX_TURNS,
    maxBudgetUsd: 0.5,
    effort,
    thinking,
    settingSources: [],
    skills: [],
    includePartialMessages: true,
    outputFormat: {
      type: "json_schema",
      schema: claudeStructuredOutputSchema(OrchestratorResultSchema),
    },
    abortController,
    env: claudeAgentEnv(
      {
        "novamind.action": telemetryAction,
        "novamind.agent_profile": "literature",
        "novamind.component": "literature-orchestrator",
        "novamind.run_id": runId,
      },
      runtimePaths,
    ),
    debug: process.env.NOVAMIND_AGENT_SDK_DEBUG === "true",
    debugFile: process.env.NOVAMIND_AGENT_SDK_DEBUG_FILE || undefined,
    stderr: (data) => {
      if (process.env.NOVAMIND_AGENT_SDK_DEBUG === "true") {
        process.stderr.write(data);
      }
    },
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
  };
}

function emitOrchestratorSdkEvent(
  state: LiteratureRunState,
  startedAt: number,
  sdkEvent: string,
  fields: Record<string, unknown> = {},
): void {
  emitLiteratureTiming(state, {
    ...fields,
    elapsedMs: Date.now() - startedAt,
    phase: "event",
    sdkEvent,
    stage: "orchestrator_sdk",
  });
}

function literatureOrchestratorRunPrompt(question: string): string {
  return (
    `<question>${question}</question>\n\n` +
    "Run the literature trajectory now. After the final required tool succeeds or search_literature reports completeWithoutEvidence, finish immediately with status=complete. If a fatal error prevents completion, finish with status=failed and a short reason. Do not write a prose report, markdown, bullets, tables, or emoji in the final response."
  );
}

export function literatureOrchestratorPrompt(): string {
  return [
    "You are the NovaMind literature orchestrator.",
    "Coordinate one biomedical research trajectory by calling the scoped tools below. Tools return typed results plus recoverable or fatal errors.",
    "",
    "Happy path:",
    "1. search_literature with one compact query.",
    "2. If it reports completeWithoutEvidence, return complete.",
    "3. extract_candidate_claims.",
    "4. verify_citations.",
    "5. synthesize_hypothesis.",
    "6. After synthesize_hypothesis succeeds, finish immediately with status complete. The synthesis tool result is the user-facing report.",
    "",
    "Rules:",
    "- Never skip a required tool unless search found no papers; never synthesize before verification succeeds.",
    "- Search query: preserve molecule, endpoint, population, and comparator when present; prefer compact PubMed-style terms over full prose.",
    '- For the default HbA1c GLP-1 demo question, use the seeded query "GLP-1 receptor agonists HbA1c reduction randomized controlled trials type 2 diabetes" unless the user changed the topic.',
    "- On recoverable_error, retry the same tool once. For search, broaden/change the query using retryHint; for other tools, pass retryHint as retryReason.",
    "- Final Agent SDK output is a machine-readable completion signal only: no prose report, markdown, bullets, tables, or emoji.",
    "- On fatal_error, finish with status failed and a short plain-text reason.",
  ].join("\n");
}

export interface LiteratureCompletionStats {
  candidateClaimCount: number;
  paperCount: number;
  rejectedClaimCount: number;
  supportedClaimCount: number;
}

export function literatureCompletionNote(
  stats: LiteratureCompletionStats,
): string {
  if (stats.paperCount === 0) {
    return "Literature trajectory complete: no matching papers retrieved; no-evidence handoff emitted.";
  }

  return [
    "Literature trajectory complete:",
    `${stats.paperCount} ${plural("paper", stats.paperCount)} retrieved,`,
    `${stats.candidateClaimCount} candidate ${plural("claim", stats.candidateClaimCount)} extracted,`,
    `${stats.supportedClaimCount} verified`,
    `(${stats.rejectedClaimCount} rejected),`,
    "hypothesis synthesized.",
  ].join(" ");
}

function plural(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

function createInitialState(args: RunLiteratureAgentArgs): LiteratureRunState {
  return {
    question: args.question,
    args: {
      ...args,
      injectUnverifiedClaim:
        args.injectUnverifiedClaim ?? injectUnverifiedClaimEnabled(),
      allowEvidenceFallback: args.allowEvidenceFallback ?? true,
    },
    demoClaimEvidenceIds: new Set<string>(),
    hits: [],
    candidateClaims: [],
    verdicts: [],
    finalResult: undefined,
    lastExtractionError: undefined,
    toolAttempts: {},
    usageParts: [],
  };
}

function injectUnverifiedClaimEnabled(): boolean {
  const raw = process.env.INJECT_UNVERIFIED_CLAIM?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function parseOrchestratorResult(
  result: SDKResultSuccess | SDKResultMessage,
): OrchestratorResultParse {
  if (result.subtype !== "success") {
    return {
      error: `Claude Agent SDK failed with ${result.subtype}`,
      success: false,
    };
  }
  const parsed = parseAgentSdkStructuredOutput(
    result,
    OrchestratorResultSchema,
    "Literature orchestrator",
  );
  if (parsed.success) return { data: parsed.data, success: true };
  return { error: parsed.error, success: false };
}
