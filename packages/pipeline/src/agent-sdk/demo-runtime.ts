import {
  getAgentSdkRuntimeManager,
  type AgentSdkRuntimeProfileStatus,
  type AgentSdkRuntimeTimingSink,
  type AgentSdkWarmProfileDefinition,
} from "./runtime";
import { dataVizAgentSdkWarmProfile } from "../data-viz/analysis";
import { literatureAgentSdkWarmProfile } from "../literature/orchestrator";

const DEMO_AGENT_SDK_PROFILES = [
  literatureAgentSdkWarmProfile,
  dataVizAgentSdkWarmProfile,
] satisfies readonly AgentSdkWarmProfileDefinition<unknown>[];

export function agentSdkRuntimeStatus(): AgentSdkRuntimeProfileStatus[] {
  return getAgentSdkRuntimeManager().status();
}

export async function ensureDemoAgentSdkWarmProfiles({
  onTiming,
  waitForReady = false,
}: {
  onTiming?: AgentSdkRuntimeTimingSink;
  waitForReady?: boolean;
} = {}): Promise<AgentSdkRuntimeProfileStatus[]> {
  return getAgentSdkRuntimeManager().ensureWarmProfiles(
    DEMO_AGENT_SDK_PROFILES,
    {
      onTiming,
      reason: "authenticated_demo_startup",
      waitForReady,
    },
  );
}
