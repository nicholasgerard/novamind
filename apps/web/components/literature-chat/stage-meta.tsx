import {
  FileText,
  Search,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import type { LiteratureStageKey } from "./types";

export const stageMeta: Record<
  LiteratureStageKey,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    runningLabel: string;
  }
> = {
  search: { label: "Search", icon: Search, runningLabel: "Searching..." },
  claim_extractor: {
    label: "Claim extractor",
    icon: FileText,
    runningLabel: "Extracting claims...",
  },
  citation_verifier: {
    label: "Citation verifier",
    icon: ShieldCheck,
    runningLabel: "Verifying citations...",
  },
  hypothesis: {
    label: "Hypothesis",
    icon: Sparkles,
    runningLabel: "Synthesizing hypothesis...",
  },
  orchestrator: {
    label: "Orchestrator",
    icon: Waypoints,
    runningLabel: "Coordinating tools...",
  },
};
