import { localAuthEnabled } from "@/lib/runtime-mode";

export function agentBaseUrl(): string {
  const configured = process.env.AGENT_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (localAuthEnabled()) return "http://localhost:8787";
  throw new Error("AGENT_SERVICE binding is required outside local auth mode");
}
