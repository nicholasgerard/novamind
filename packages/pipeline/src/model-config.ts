import type { ClaudeEffort } from "./structured";

export const ORCHESTRATOR_MODEL = "claude-sonnet-4-6";
export const ORCHESTRATOR_MAX_TURNS = 12;

export const CLAIM_EXTRACTOR_MODEL = "claude-haiku-4-5";
export const VERIFIER_MODEL = "claude-haiku-4-5";
export const HYPOTHESIS_MODEL = "claude-opus-4-7";
export const HYPOTHESIS_MODEL_EFFORT = "high" satisfies ClaudeEffort;

export const DATA_VIZ_AGENT_MODEL = "claude-sonnet-4-6";
export const DATA_VIZ_MAX_TURNS = 14;
export const REQUIRED_CHART_COUNT = 4;

export const IMPROVE_MODEL = "claude-sonnet-4-6";
export const IMPROVE_DEFAULT_EFFORT = "low" satisfies ClaudeEffort;
