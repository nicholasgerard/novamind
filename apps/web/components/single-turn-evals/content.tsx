import { AlertTriangle, Eye, GitBranch } from "lucide-react";
import type { ComponentType } from "react";
import type { FailureKey } from "./types";

export const failureOrder: readonly FailureKey[] = [
  "cascade",
  "drift",
  "spillage",
];

export const failures: Record<
  FailureKey,
  {
    body: string;
    icon: ComponentType<{ className?: string }>;
    label: string;
    title: string;
  }
> = {
  cascade: {
    icon: AlertTriangle,
    label: "Tool cascades",
    title: "Compounding tool errors",
    body: "A single bad tool result propagates without being revisited. Each step is locally valid, but reasoning over bad input.",
  },
  drift: {
    icon: GitBranch,
    label: "Plan drift",
    title: "Constraints fade across the trajectory",
    body: "Long trajectories quietly forget early instructions. The answer looks fine — just slightly off the original question.",
  },
  spillage: {
    icon: Eye,
    label: "Ungrounded citation",
    title: "Cited from memory, not retrieval",
    body: "The citation looks rigorous, but the underlying fact came from training data, not the retrieved corpus.",
  },
};
