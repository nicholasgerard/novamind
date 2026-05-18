import { afterEach, describe, expect, it, vi } from "vitest";
import { orchestratorEffort } from "./config";

describe("orchestratorEffort", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to low effort for latency-sensitive demo orchestrators", () => {
    expect(orchestratorEffort("claude-sonnet-4-6")).toBe("low");
  });

  it("accepts supported Sonnet 4.6 effort overrides", () => {
    vi.stubEnv("NOVAMIND_ORCHESTRATOR_EFFORT", "medium");
    expect(orchestratorEffort("claude-sonnet-4-6")).toBe("medium");
  });

  it("falls back when the configured effort is unsupported by the model", () => {
    vi.stubEnv("NOVAMIND_ORCHESTRATOR_EFFORT", "xhigh");
    expect(orchestratorEffort("claude-sonnet-4-6")).toBe("low");
  });

  it("accepts xhigh on Claude models that support it", () => {
    vi.stubEnv("NOVAMIND_ORCHESTRATOR_EFFORT", "xhigh");
    expect(orchestratorEffort("claude-opus-4-7")).toBe("xhigh");
  });
});
