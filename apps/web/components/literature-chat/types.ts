import type { StreamEvent } from "@novamind/shared/events";

export type Phase = "idle" | "running" | "complete";

export type PipelineResultEvent = Extract<
  StreamEvent,
  { type: "pipeline_result" }
>;

export interface RetrievalHit {
  pmid: string;
  title: string;
  year?: number;
}

export interface CandidateClaimRow {
  pmid: string;
  claim: string;
}

export interface VerificationRow {
  pmid: string;
  claim: string;
  verified: boolean;
}

export type LiteratureStageKey =
  | "search"
  | "claim_extractor"
  | "citation_verifier"
  | "hypothesis"
  | "orchestrator";

export interface LiteratureStageSection {
  id: string;
  stage: LiteratureStageKey;
  model?: string;
  events: StreamEvent[];
  finished?: Extract<StreamEvent, { type: "literature_stage_finished" }>;
}
