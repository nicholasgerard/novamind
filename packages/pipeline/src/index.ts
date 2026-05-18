/**
 * @novamind/pipeline — research-agent, eval, data, and provider core.
 *
 * Same primitives consumed by the apps/agent SSE wrapper and by the
 * packages/eval Braintrust harness. No HTTP, no React — just the
 * orchestrated agent loop, RAG, eval helpers, and provider plumbing.
 */
export {
  collectLiteratureAgentRun,
  runLiteratureAgent,
  ORCHESTRATOR_MODEL,
} from "./literature/orchestrator";
export type {
  LiteratureAgentRun,
  LiteratureTimingEvent,
  RunLiteratureAgentArgs,
} from "./literature/types";
export {
  agentSdkRuntimeStatus,
  ensureDemoAgentSdkWarmProfiles,
} from "./agent-sdk/demo-runtime";
export type {
  AgentSdkRuntimeProfileStatus,
  AgentSdkRuntimeTimingEvent,
} from "./agent-sdk/runtime";
export {
  assembleVerifiedEvidence,
  attachEvidenceIds,
  maybeBuildVerifierCheckClaim,
} from "./literature/evidence";
export {
  corpusSize,
  corpusSourceName,
  ensureRagReady,
  getCorpus,
  preloadRagResources,
  retrieve,
} from "./rag";
export type {
  EmbeddingProvider,
  RagWarmupOptions,
  RagWarmupResult,
  RagWarmupTimingEvent,
  RetrievalMethod,
  RetrieveOptions,
} from "./rag";
export { tokenize } from "./rag/bm25";
export { isClaudeAvailable } from "./providers/claude";
export { getOpenAI, isOpenAIAvailable } from "./providers/openai";
export {
  assertKnownDirectApiPricing,
  DIRECT_API_PRICING,
  estimateAnthropicMessagesUsage,
  estimateOpenAIChatUsage,
  type AnthropicMessagesUsage,
  type DirectApiPricingProvider,
  type OpenAIChatUsage,
} from "./providers/pricing";
export {
  claudeStructuredOutputSchema,
  callStructured,
  type ClaudeEffort,
  type StructuredCallArgs,
  type StructuredCallResult,
  type StructuredCallMetadata,
  type StructuredOutputMode,
  type StructuredProvider,
} from "./structured";
export {
  HYPOTHESIS_MODEL,
  HYPOTHESIS_MODEL_EFFORT,
  runHypothesisModelTool,
  type CandidateClaim,
  type CitationVerdict,
} from "./literature/model-tools";
export { HYPOTHESIS_SYSTEM_PROMPT } from "@novamind/shared";
export {
  IMPROVE_DEFAULT_EFFORT,
  IMPROVE_MODEL,
  IMPROVE_SCHEMA_NAME,
  improvePrompt,
  type ImprovementOutput,
  type RunSummary,
} from "./prompt-improver";
export {
  DATA_VIZ_AGENT_MODEL,
  loadClinicalTrialsDataset,
  preloadDataVizResources,
  runDataVizAnalysis,
  type DataVizTimingEvent,
  type RunDataVizAnalysisArgs,
} from "./data-viz";
