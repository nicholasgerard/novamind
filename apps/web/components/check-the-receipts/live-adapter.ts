import type { LiteratureStageId, StreamEvent } from "@novamind/shared";
import type { DataVizStreamEvent } from "@novamind/shared/data-viz-events";
import type { CachedDataVizRun, CachedResearchRun } from "@/lib/demo-run-cache";
import type {
  ModelTier,
  ReceiptAgent,
  ReceiptData,
  ReceiptStage,
} from "./types";

interface LitStageTemplate {
  label: string;
  caption: string;
  rationale: string;
  isLlm: boolean;
  modelTier: ModelTier;
  fallbackModel: string;
}

const LIT_STAGE_ORDER: LiteratureStageId[] = [
  "orchestrator",
  "search",
  "claim_extractor",
  "citation_verifier",
  "hypothesis",
];

const LIT_STAGE_TEMPLATES: Record<LiteratureStageId, LitStageTemplate> = {
  search: {
    label: "Search",
    caption: "Hybrid vector + BM25 retrieval",
    rationale:
      "Retrieval does not need a model. Hybrid search returns ranked passages quickly and keeps evidence lookup deterministic.",
    isLlm: false,
    modelTier: "none",
    fallbackModel: "Hybrid RAG",
  },
  orchestrator: {
    label: "Orchestrator",
    caption: "Coordinates the research trajectory",
    rationale:
      "Sonnet owns tool routing and recovery, while each typed tool keeps the expensive work narrow and measurable.",
    isLlm: true,
    modelTier: "medium",
    fallbackModel: "Sonnet 4.6",
  },
  claim_extractor: {
    label: "Claims",
    caption: "Extract abstract-level claims",
    rationale:
      "Structured extraction is a bounded transformation, so Haiku keeps the step fast and inexpensive.",
    isLlm: true,
    modelTier: "small",
    fallbackModel: "Haiku 4.5",
  },
  citation_verifier: {
    label: "Verifier",
    caption: "Check each claim against its abstract",
    rationale:
      "Binary grounded checks against known passages are narrow enough for Haiku, with prompt caching reducing repeated context cost.",
    isLlm: true,
    modelTier: "small",
    fallbackModel: "Haiku 4.5",
  },
  hypothesis: {
    label: "Hypothesis",
    caption: "Synthesize verified evidence",
    rationale:
      "Synthesis is the highest-value reasoning step, so Opus is reserved for turning verified evidence into the final hypothesis.",
    isLlm: true,
    modelTier: "large",
    fallbackModel: "Opus 4.7",
  },
};

const VIZ_DATA_LOAD_TEMPLATE = {
  label: "Trial data",
  caption: "Load ClinicalTrials.gov snapshot",
  rationale: "The trial registry is local data, so no model needs to touch it.",
  modelLabel: "Agent handoff",
};

const VIZ_ORCHESTRATOR_TEMPLATE = {
  label: "Chart agent",
  caption: "Plan & build four charts via deterministic tools",
  rationale:
    "Choosing chart slices and reading aggregates is reasoning, not generation, so Sonnet handles it without burning Opus budget.",
  modelTier: "medium" as ModelTier,
  fallbackModel: "Sonnet 4.6",
};

/**
 * Projects cached demo telemetry into the stable view model used by Stage 7.
 * The receipt stays read-only: costs, tokens, and timings all come from the
 * completed research/data-viz stream events already persisted by the demos.
 */
export function buildLiveReceiptData(
  litRun: CachedResearchRun | undefined,
  vizRun: CachedDataVizRun | undefined,
): ReceiptData {
  const literature = buildLiteratureAgent(litRun);
  const viz = buildVizAgent(vizRun);

  const totalCostUsd = sumOptional(literature.totalCostUsd, viz.totalCostUsd);
  const cacheSavingsUsd = sumOptional(
    literature.cacheSavingsUsd,
    viz.cacheSavingsUsd,
  );
  // Agents run sequentially: lit completes, hands off to viz.
  const endToEndMs = sumOptional(literature.endToEndMs, viz.endToEndMs);

  let totalCachedTokens = 0;
  for (const stage of [...literature.stages, ...viz.stages]) {
    if (!stage.isLlm) continue;
    const cached = stage.cacheReadTokens ?? 0;
    if (cached <= 0) continue;
    totalCachedTokens += cached;
  }

  const completedAtMs = vizRun?.completedAt ?? litRun?.completedAt;
  const completedAt = completedAtMs ? new Date(completedAtMs) : undefined;

  return {
    query: litRun?.question ?? vizRun?.researchHandoff.question,
    completedAt,
    totalCostUsd,
    uncachedTotalCostUsd:
      totalCostUsd !== undefined &&
      cacheSavingsUsd !== undefined &&
      cacheSavingsUsd > 0
        ? totalCostUsd + cacheSavingsUsd
        : undefined,
    cacheSavingsUsd:
      cacheSavingsUsd !== undefined && cacheSavingsUsd > 0
        ? cacheSavingsUsd
        : undefined,
    endToEndMs,
    totalCachedTokens: totalCachedTokens > 0 ? totalCachedTokens : undefined,
    runId: completedAt ? `NM-${formatRunIdFromDate(completedAt)}` : undefined,
    literature,
    viz,
  };
}

// --- Literature ---------------------------------------------------------

function buildLiteratureAgent(
  run: CachedResearchRun | undefined,
): ReceiptAgent {
  const stages: ReceiptStage[] = LIT_STAGE_ORDER.map((stageId) => {
    const template = LIT_STAGE_TEMPLATES[stageId];
    const aggregated = run ? aggregateLitStage(run.events, stageId) : undefined;
    return {
      key: `lit-${stageId}`,
      label: template.label,
      caption: template.caption,
      rationale: template.rationale,
      model: template.isLlm
        ? aggregated?.model
          ? formatModel(aggregated.model, template.fallbackModel)
          : template.fallbackModel
        : template.fallbackModel,
      modelTier: template.modelTier,
      isLlm: template.isLlm,
      latencyMs: aggregated?.latencyMs,
      inputTokens: aggregated?.inputTokens,
      outputTokens: aggregated?.outputTokens,
      cacheReadTokens: aggregated?.cacheReadTokens,
      costUsd: aggregated?.costUsd,
    };
  });

  let endToEndMs: number | undefined;
  let totalCostUsd: number | undefined;
  let cacheSavingsUsd: number | undefined;
  if (run && run.events.length > 0) {
    const firstTs = run.events[0]?.ts;
    const pipelineResult = [...run.events]
      .reverse()
      .find(
        (event): event is Extract<StreamEvent, { type: "pipeline_result" }> =>
          event.type === "pipeline_result",
      );
    const lastTs =
      pipelineResult?.ts ?? run.events[run.events.length - 1]?.ts ?? firstTs;
    if (firstTs !== undefined && lastTs !== undefined) {
      endToEndMs = Math.max(0, lastTs - firstTs);
    }
    totalCostUsd = run.totalUsage.costUsd;
    cacheSavingsUsd = run.totalUsage.cacheSavingsUsd;
  }

  return {
    id: "literature",
    label: "Research agent",
    endToEndMs,
    totalCostUsd,
    cacheSavingsUsd,
    stages,
  };
}

interface AggregatedLitStage {
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

function aggregateLitStage(
  events: readonly StreamEvent[],
  stageId: LiteratureStageId,
): AggregatedLitStage | undefined {
  let model = "";
  let earliestStart = Infinity;
  let latestFinish = -Infinity;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let costUsd = 0;
  let saw = false;

  for (const event of events) {
    if (event.type === "literature_stage_started" && event.stage === stageId) {
      saw = true;
      if (event.model) model = event.model;
      if (event.ts < earliestStart) earliestStart = event.ts;
    } else if (
      event.type === "literature_stage_finished" &&
      event.stage === stageId
    ) {
      saw = true;
      if (event.ts > latestFinish) latestFinish = event.ts;
      inputTokens += event.usage.inputTokens;
      outputTokens += event.usage.outputTokens;
      cacheReadTokens += event.usage.cacheReadTokens;
      costUsd += event.usage.costUsd;
    }
  }

  if (!saw) return undefined;

  const latencyMs =
    Number.isFinite(earliestStart) && Number.isFinite(latestFinish)
      ? Math.max(0, latestFinish - earliestStart)
      : 0;

  return {
    model,
    latencyMs,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    costUsd,
  };
}

// --- Visualization ------------------------------------------------------

function buildVizAgent(run: CachedDataVizRun | undefined): ReceiptAgent {
  let dataLoadLatencyMs: number | undefined;
  let orchestratorLatencyMs: number | undefined;
  let orchestratorCost: number | undefined;
  let orchestratorInput: number | undefined;
  let orchestratorOutput: number | undefined;
  let orchestratorCacheRead: number | undefined;
  let orchestratorModel = VIZ_ORCHESTRATOR_TEMPLATE.fallbackModel;
  let endToEndMs: number | undefined;
  let totalCostUsd: number | undefined;
  let cacheSavingsUsd: number | undefined;

  if (run) {
    const startEvent = findVizEvent(run.events, "data_viz_started");
    const completeEvent = findVizEvent(run.events, "data_viz_complete");
    const dataLoadEnd = run.events.find(
      (
        event,
      ): event is Extract<
        DataVizStreamEvent,
        { type: "data_viz_agent_event" }
      > =>
        event.type === "data_viz_agent_event" &&
        event.phase === "data" &&
        event.status === "complete",
    );

    if (startEvent && completeEvent) {
      endToEndMs = Math.max(0, completeEvent.ts - startEvent.ts);
      totalCostUsd = completeEvent.totalUsage.costUsd;
      orchestratorCost = completeEvent.totalUsage.costUsd;
      orchestratorInput = completeEvent.totalUsage.inputTokens;
      orchestratorOutput = completeEvent.totalUsage.outputTokens;
      orchestratorCacheRead = completeEvent.totalUsage.cacheReadTokens;
      cacheSavingsUsd = completeEvent.totalUsage.cacheSavingsUsd;
      if (startEvent.model) {
        orchestratorModel = formatModel(
          startEvent.model,
          VIZ_ORCHESTRATOR_TEMPLATE.fallbackModel,
        );
      }
      const orchestratorStartTs = dataLoadEnd?.ts ?? startEvent.ts;
      orchestratorLatencyMs = Math.max(
        0,
        completeEvent.ts - orchestratorStartTs,
      );
      if (dataLoadEnd) {
        dataLoadLatencyMs = Math.max(0, dataLoadEnd.ts - startEvent.ts);
      }
    }
  }

  const stages: ReceiptStage[] = [
    {
      key: "viz-data",
      label: VIZ_DATA_LOAD_TEMPLATE.label,
      caption: VIZ_DATA_LOAD_TEMPLATE.caption,
      rationale: VIZ_DATA_LOAD_TEMPLATE.rationale,
      model: VIZ_DATA_LOAD_TEMPLATE.modelLabel,
      modelTier: "none",
      isLlm: false,
      latencyMs: dataLoadLatencyMs,
      costUsd: run ? 0 : undefined,
    },
    {
      key: "viz-orchestrator",
      label: VIZ_ORCHESTRATOR_TEMPLATE.label,
      caption: VIZ_ORCHESTRATOR_TEMPLATE.caption,
      rationale: VIZ_ORCHESTRATOR_TEMPLATE.rationale,
      model: orchestratorModel,
      modelTier: VIZ_ORCHESTRATOR_TEMPLATE.modelTier,
      isLlm: true,
      latencyMs: orchestratorLatencyMs,
      inputTokens: orchestratorInput,
      outputTokens: orchestratorOutput,
      cacheReadTokens: orchestratorCacheRead,
      costUsd: orchestratorCost,
    },
  ];

  return {
    id: "viz",
    label: "Visualization agent",
    endToEndMs,
    totalCostUsd,
    cacheSavingsUsd,
    stages,
  };
}

function findVizEvent<T extends DataVizStreamEvent["type"]>(
  events: readonly DataVizStreamEvent[],
  type: T,
): Extract<DataVizStreamEvent, { type: T }> | undefined {
  return events.find(
    (event): event is Extract<DataVizStreamEvent, { type: T }> =>
      event.type === type,
  );
}

// --- Helpers ------------------------------------------------------------

function sumOptional(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

function formatModel(model: string, fallback: string): string {
  if (!model || model === "eval-retrieval-override") return fallback;
  if (!model.startsWith("claude-")) return model;
  const parts = model.replace(/^claude-/, "").split("-");
  const family = parts[0] ? titleCase(parts[0]) : "";
  const version = parts.slice(1).join(".");
  return [family, version].filter(Boolean).join(" ") || fallback;
}

function titleCase(value: string): string {
  return value ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}

function formatRunIdFromDate(date: Date): string {
  const epoch = date.getTime();
  const digits = `${epoch}`.slice(-6);
  return digits.padStart(6, "0");
}
