import { mkdir } from "node:fs/promises";
import type {
  EffortLevel,
  ThinkingConfig,
} from "@anthropic-ai/claude-agent-sdk";
import { claudeModelSupportsEffort } from "../claude-model-capabilities";
import { ORCHESTRATOR_MODEL } from "../model-config";

const DEFAULT_ORCHESTRATOR_EFFORT = "low" satisfies EffortLevel;
const DEFAULT_SDK_STARTUP_INITIALIZE_TIMEOUT_MS = 90_000;
const DEFAULT_COLD_FIRST_MESSAGE_TIMEOUT_MS = 90_000;
const DEFAULT_WARM_FIRST_MESSAGE_TIMEOUT_MS = 15_000;
const DEFAULT_SDK_IDLE_TIMEOUT_MS = 180_000;
const DEFAULT_LIVE_STARTUP_WAIT_MS = 2_000;

export interface ClaudeAgentRuntimePaths {
  configDir: string;
  cwd: string;
}

/**
 * Create the isolated Agent SDK working directories used by each profile.
 * Literature and data-viz keep separate paths so warm sessions do not share
 * writable Claude runtime state.
 */
export async function ensureClaudeAgentRuntime(
  runtimePaths: ClaudeAgentRuntimePaths,
): Promise<void> {
  await Promise.all([
    mkdir(runtimePaths.cwd, { recursive: true }),
    mkdir(runtimePaths.configDir, { recursive: true }),
  ]);
}

/** Resolve the configured effort to a value supported by the selected model. */
export function orchestratorEffort(model = ORCHESTRATOR_MODEL): EffortLevel {
  const configured = configuredEffort();
  if (!configured) return DEFAULT_ORCHESTRATOR_EFFORT;
  return supportsEffort(model, configured)
    ? configured
    : DEFAULT_ORCHESTRATOR_EFFORT;
}

/** Keep extended thinking opt-in for latency-sensitive demo orchestrators. */
export function orchestratorThinking(): ThinkingConfig {
  return process.env.NOVAMIND_ORCHESTRATOR_THINKING === "adaptive"
    ? { type: "adaptive" }
    : { type: "disabled" };
}

export function sdkStartupInitializeTimeoutMs(): number {
  return numberFromEnv(
    "NOVAMIND_AGENT_SDK_STARTUP_TIMEOUT_MS",
    DEFAULT_SDK_STARTUP_INITIALIZE_TIMEOUT_MS,
  );
}

export function sdkColdFirstMessageTimeoutMs(): number {
  return numberFromEnv(
    "NOVAMIND_AGENT_SDK_COLD_FIRST_MESSAGE_TIMEOUT_MS",
    DEFAULT_COLD_FIRST_MESSAGE_TIMEOUT_MS,
  );
}

export function sdkWarmFirstMessageTimeoutMs(): number {
  return numberFromEnv(
    "NOVAMIND_AGENT_SDK_WARM_FIRST_MESSAGE_TIMEOUT_MS",
    DEFAULT_WARM_FIRST_MESSAGE_TIMEOUT_MS,
  );
}

export function sdkIdleTimeoutMs(): number {
  return numberFromEnv(
    "NOVAMIND_AGENT_SDK_IDLE_TIMEOUT_MS",
    DEFAULT_SDK_IDLE_TIMEOUT_MS,
  );
}

export function sdkLiveStartupWaitMs(): number {
  return numberFromEnv(
    "NOVAMIND_AGENT_SDK_LIVE_STARTUP_WAIT_MS",
    DEFAULT_LIVE_STARTUP_WAIT_MS,
  );
}

function configuredEffort(): EffortLevel | undefined {
  const configured = process.env.NOVAMIND_ORCHESTRATOR_EFFORT;
  return configured === "low" ||
    configured === "medium" ||
    configured === "high" ||
    configured === "xhigh" ||
    configured === "max"
    ? configured
    : undefined;
}

function supportsEffort(model: string, effort: EffortLevel): boolean {
  return claudeModelSupportsEffort(model, effort);
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
