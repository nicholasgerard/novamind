type ClaudeEffortLike = "low" | "medium" | "high" | "xhigh" | "max";

const CLAUDE_EFFORT_MODEL_FAMILIES = {
  standard: [
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-sonnet-4-6",
  ],
  xhigh: ["claude-opus-4-7"],
  max: ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6"],
} as const;

export function claudeModelSupportsEffort(
  model: string,
  effort: ClaudeEffortLike,
): boolean {
  if (effort === "xhigh") {
    return matchesAnyClaudeFamily(model, CLAUDE_EFFORT_MODEL_FAMILIES.xhigh);
  }
  if (effort === "max") {
    return matchesAnyClaudeFamily(model, CLAUDE_EFFORT_MODEL_FAMILIES.max);
  }
  return matchesAnyClaudeFamily(model, CLAUDE_EFFORT_MODEL_FAMILIES.standard);
}

function matchesAnyClaudeFamily(
  model: string,
  families: readonly string[],
): boolean {
  return families.some((family) => matchesClaudeFamily(model, family));
}

function matchesClaudeFamily(model: string, family: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === family || normalized.startsWith(`${family}-20`);
}
