import type { TokenUsage } from "@novamind/shared/events";

export type ScoreMap = Record<string, number>;

export interface BaselineCase {
  caseId: string;
  index: number;
  label: string;
  scores: ScoreMap;
}

export interface BaselineSnapshot {
  axis: string;
  hypothesisSystemPrompt: string;
  averageScores: ScoreMap;
  cases: BaselineCase[];
  totalUsage: TokenUsage;
  capturedAt: string;
}

export type CaseStatus = "pending" | "running" | "complete" | "error";

export interface CaseState {
  caseId: string;
  index: number;
  label: string;
  status: CaseStatus;
  scores?: ScoreMap;
  output?: unknown;
  usage?: TokenUsage;
  elapsedMs?: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export type RunPhase = "idle" | "starting" | "running" | "complete" | "error";

export interface CurrentRun {
  phase: RunPhase;
  cases: CaseState[];
  startedAt: number;
  completedAt?: number;
  averageScores?: ScoreMap;
  totalUsage: TokenUsage;
  error?: string;
}

export interface RunSnapshot {
  id: string;
  label: string;
  note: string;
  prompt: string;
  score: number;
  scores: ScoreMap;
  cases: CaseState[];
  startedAt: number;
  completedAt?: number;
  elapsedMs?: number;
  totalUsage: TokenUsage;
}

export interface MetricMeta {
  key: string;
  label: string;
  goodIsHigh: boolean;
  /** Short blurb shown next to the score for context. */
  description: string;
}
