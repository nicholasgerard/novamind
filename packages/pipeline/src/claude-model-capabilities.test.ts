import { describe, expect, it } from "vitest";
import { claudeModelSupportsEffort } from "./claude-model-capabilities";

describe("Claude model capabilities", () => {
  it("matches explicit model families and dated variants", () => {
    expect(claudeModelSupportsEffort("claude-sonnet-4-6", "low")).toBe(true);
    expect(claudeModelSupportsEffort("claude-sonnet-4-6-20260217", "low")).toBe(
      true,
    );
    expect(claudeModelSupportsEffort("claude-sonnet-4-5", "low")).toBe(false);
  });

  it("keeps xhigh and max constrained to the families that support them", () => {
    expect(claudeModelSupportsEffort("claude-opus-4-7", "xhigh")).toBe(true);
    expect(claudeModelSupportsEffort("claude-opus-4-6", "xhigh")).toBe(false);
    expect(claudeModelSupportsEffort("claude-sonnet-4-6", "max")).toBe(true);
    expect(claudeModelSupportsEffort("claude-opus-4-5", "max")).toBe(false);
  });
});
