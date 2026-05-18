import type {
  ClinicalTrialsDataset,
  DataVizChart,
  DataVizSourceSummary,
  ResearchHandoff,
  TokenUsage,
} from "@novamind/shared";
import type {
  BuildTrialChartInput,
  TrialDatasetProfile,
} from "./chart-builders";

export {
  DATA_VIZ_AGENT_MODEL,
  DATA_VIZ_MAX_TURNS,
  REQUIRED_CHART_COUNT,
} from "../model-config";

export const allowedDataVizTools = [
  "mcp__novamind_data_viz_report_builder__inspect_research_handoff",
  "mcp__novamind_data_viz_report_builder__profile_trial_dataset",
  "mcp__novamind_data_viz_report_builder__build_trial_chart",
] as const;

export interface RunDataVizAnalysisArgs {
  abortController?: AbortController;
  onTiming?: DataVizTimingSink;
  question?: string;
  researchHandoff?: ResearchHandoff;
  runId?: string;
}

export type DataVizTimingPhase =
  | "start"
  | "event"
  | "finish"
  | "error"
  | "skip";

export interface DataVizTimingEvent {
  elapsedMs?: number;
  phase: DataVizTimingPhase;
  stage: string;
  [key: string]: unknown;
}

export type DataVizTimingSink = (event: DataVizTimingEvent) => void;

export interface DataVizRunState {
  args: RunDataVizAnalysisArgs;
  builtChartKeys: Set<string>;
  charts: Array<{ chart: DataVizChart; rationale: string }>;
  dataset: ClinicalTrialsDataset;
  finalReportReadyAt?: number;
  onFinalChartsReady?: () => void;
  profile: TrialDatasetProfile | undefined;
  question: string;
  researchHandoff: ResearchHandoff;
  source: DataVizSourceSummary;
  usageParts: TokenUsage[];
}

export type DataVizToolName =
  | "inspect_research_handoff"
  | "profile_trial_dataset"
  | "build_trial_chart";

export type DataVizToolEnvelope<T> =
  | { status: "ok"; data: T }
  | {
      status: "recoverable_error";
      code: string;
      message: string;
      retryHint: string;
    }
  | { status: "fatal_error"; code: string; message: string };

export interface InspectHandoffData {
  confidence: number | undefined;
  evidenceCount: number;
  focusTerms: string[];
  hypothesis: string;
  question: string;
  verifiedEvidence: Array<{ citation: string; claim: string }>;
}

export interface DatasetProfileData {
  focusTerms: string[];
  profile: TrialDatasetProfile;
}

export interface BuiltChartData {
  analysis: BuildTrialChartInput["analysis"];
  chartId: string;
  chartNumber: number;
  pointCount: number;
  rationale: string;
  summary: string;
}
