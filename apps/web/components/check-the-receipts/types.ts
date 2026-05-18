export type ModelTier = "none" | "small" | "medium" | "large";

export interface ReceiptStage {
  key: string;
  label: string;
  caption: string;
  rationale: string;
  model: string;
  modelTier: ModelTier;
  isLlm: boolean;
  /** Undefined means the stage is waiting for a completed cached run. */
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
}

export interface ReceiptAgent {
  id: "literature" | "viz";
  label: string;
  endToEndMs?: number;
  totalCostUsd?: number;
  cacheSavingsUsd?: number;
  stages: ReceiptStage[];
}

export interface ReceiptData {
  query?: string;
  completedAt?: Date;
  endToEndMs?: number;
  totalCostUsd?: number;
  uncachedTotalCostUsd?: number;
  cacheSavingsUsd?: number;
  totalCachedTokens?: number;
  runId?: string;
  literature: ReceiptAgent;
  viz: ReceiptAgent;
}
