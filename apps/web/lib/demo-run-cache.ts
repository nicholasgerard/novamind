"use client";

import type { DataVizStreamEvent } from "@novamind/shared/data-viz-events";
import type {
  HypothesisResult,
  ResearchHandoff,
  StreamEvent,
  TokenUsage,
} from "@novamind/shared";
import type {
  CaseState,
  CaseStatus,
  RunSnapshot,
  ScoreMap,
} from "../components/eval-harness/types";
import type { HillClimbPoint } from "../components/eval-harness/hill-climb-chart-model";
import {
  parseDataVizStreamEvent,
  parseLiteratureStreamEvent,
} from "./client-stream-events";

const CACHE_KEY = "novamind.demoRuns.v2";
const CACHE_VERSION = 2;
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_FUTURE_SKEW_MS = 60 * 1000;

export interface CachedResearchRun {
  completedAt: number;
  events: StreamEvent[];
  question: string;
  result: HypothesisResult;
  totalUsage: TokenUsage;
}

export interface CachedDataVizRun {
  completedAt: number;
  events: DataVizStreamEvent[];
  researchHandoff: ResearchHandoff;
}

export interface CachedHillClimbState {
  completedRuns: RunSnapshot[];
  diffBasePrompt: string | null;
  history: HillClimbPoint[];
  prompt: string;
  selectedCaseId: string | null;
  selectedRunId: string | null;
  updatedAt: number;
}

interface DemoRunCache {
  dataViz?: CachedDataVizRun;
  hillClimb?: CachedHillClimbState;
  research?: CachedResearchRun;
  updatedAt: number;
  version: number;
}

export function readCachedResearchRun(): CachedResearchRun | undefined {
  return readCache().research;
}

export function writeCachedResearchRun(run: CachedResearchRun): void {
  writeCache({ ...readCache(), research: run, updatedAt: Date.now() });
}

export function clearCachedResearchRun(): void {
  const cache = readCache();
  writeCache({
    ...cache,
    research: undefined,
    dataViz: undefined,
    updatedAt: Date.now(),
  });
}

export function researchHandoffFromCachedRun(
  run: CachedResearchRun | undefined,
): ResearchHandoff | undefined {
  if (!run) return undefined;
  if (!Array.isArray(run.result?.evidence)) return undefined;
  const evidence = run.result.evidence
    .filter(
      (item) =>
        item.verified &&
        typeof item.citation === "string" &&
        item.citation.length > 0 &&
        typeof item.claim === "string" &&
        item.claim.length > 0,
    )
    .slice(0, 8)
    .map((item) => ({
      citation: item.citation,
      claim: item.claim,
    }));
  if (evidence.length === 0) return undefined;
  return {
    question: run.question,
    hypothesis: run.result.hypothesis,
    confidence: run.result.confidence,
    evidence,
    completedAt: run.completedAt,
  };
}

export function readCachedDataVizRun(): CachedDataVizRun | undefined {
  return readCache().dataViz;
}

export function writeCachedDataVizRun(run: CachedDataVizRun): void {
  writeCache({ ...readCache(), dataViz: run, updatedAt: Date.now() });
}

export function clearCachedDataVizRun(): void {
  const cache = readCache();
  writeCache({ ...cache, dataViz: undefined, updatedAt: Date.now() });
}

export function readCachedHillClimbState(): CachedHillClimbState | undefined {
  return readCache().hillClimb;
}

export function writeCachedHillClimbState(state: CachedHillClimbState): void {
  writeCache({
    ...readCache(),
    hillClimb: { ...state, updatedAt: Date.now() },
    updatedAt: Date.now(),
  });
}

export function clearCachedHillClimbState(): void {
  const cache = readCache();
  writeCache({ ...cache, hillClimb: undefined, updatedAt: Date.now() });
}

function readCache(): DemoRunCache {
  if (typeof window === "undefined") return emptyCache();
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return emptyCache();
    const parsed = JSON.parse(raw) as Partial<DemoRunCache>;
    const now = Date.now();
    if (parsed.version !== CACHE_VERSION) return emptyCache();
    if (
      !isPositiveNumber(parsed.updatedAt) ||
      now - parsed.updatedAt > MAX_CACHE_AGE_MS ||
      parsed.updatedAt - now > MAX_CACHE_FUTURE_SKEW_MS
    ) {
      window.localStorage.removeItem(CACHE_KEY);
      return emptyCache();
    }
    return {
      version: CACHE_VERSION,
      updatedAt: parsed.updatedAt,
      research: cachedResearchRun(parsed.research),
      dataViz: cachedDataVizRun(parsed.dataViz),
      hillClimb: cachedHillClimbState(parsed.hillClimb),
    };
  } catch {
    try {
      window.localStorage.removeItem(CACHE_KEY);
    } catch {
      // Browser storage is an enhancement; failed cleanup should not break demos.
    }
    return emptyCache();
  }
}

function writeCache(cache: DemoRunCache): void {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify({
    ...cache,
    version: CACHE_VERSION,
    updatedAt: Date.now(),
  });
  try {
    window.localStorage.setItem(CACHE_KEY, serialized);
  } catch (err) {
    if (!isQuotaExceededError(err)) return;
    try {
      window.localStorage.removeItem(CACHE_KEY);
      window.localStorage.setItem(CACHE_KEY, serialized);
    } catch {
      // Browser storage is an enhancement; failed writes should not break demos.
    }
  }
}

function isQuotaExceededError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

function emptyCache(): DemoRunCache {
  return { version: CACHE_VERSION, updatedAt: Date.now() };
}

function cachedResearchRun(value: unknown): CachedResearchRun | undefined {
  const record = asRecord(value);
  const events = parsedArray(record?.events, parseLiteratureStreamEvent);
  const finalEvent = events?.find(
    (event): event is Extract<StreamEvent, { type: "pipeline_result" }> =>
      event.type === "pipeline_result",
  );
  if (!record) return undefined;
  if (
    !isPositiveNumber(record.completedAt) ||
    typeof record.question !== "string" ||
    !events ||
    !finalEvent
  ) {
    return undefined;
  }
  return {
    completedAt: record.completedAt,
    events,
    question: record.question,
    result: finalEvent.result,
    totalUsage: finalEvent.totalUsage,
  };
}

function cachedDataVizRun(value: unknown): CachedDataVizRun | undefined {
  const record = asRecord(value);
  const events = parsedArray(record?.events, parseDataVizStreamEvent);
  const handoff = researchHandoff(record?.researchHandoff);
  if (
    !record ||
    !isPositiveNumber(record.completedAt) ||
    !events ||
    !events.some((event) => event.type === "data_viz_complete") ||
    !handoff
  ) {
    return undefined;
  }
  return {
    completedAt: record.completedAt,
    events,
    researchHandoff: handoff,
  };
}

function cachedHillClimbState(
  value: unknown,
): CachedHillClimbState | undefined {
  const record = asRecord(value);
  const completedRuns = parsedArray(record?.completedRuns, runSnapshot);
  const history = parsedArray(record?.history, hillClimbPoint);
  const diffBasePrompt = nullableString(record?.diffBasePrompt);
  const selectedCaseId = nullableString(record?.selectedCaseId);
  const selectedRunId = nullableString(record?.selectedRunId);
  if (
    !record ||
    !completedRuns ||
    !history ||
    typeof record.prompt !== "string" ||
    diffBasePrompt === undefined ||
    selectedCaseId === undefined ||
    selectedRunId === undefined ||
    !isPositiveNumber(record.updatedAt)
  ) {
    return undefined;
  }
  return {
    completedRuns,
    diffBasePrompt,
    history,
    prompt: record.prompt,
    selectedCaseId,
    selectedRunId,
    updatedAt: record.updatedAt,
  };
}

function researchHandoff(value: unknown): ResearchHandoff | undefined {
  const record = asRecord(value);
  const evidence = parsedArray(record?.evidence, researchHandoffEvidence);
  if (
    !record ||
    typeof record.question !== "string" ||
    typeof record.hypothesis !== "string" ||
    (record.confidence !== undefined && !isUnitNumber(record.confidence)) ||
    !evidence ||
    evidence.length === 0 ||
    (record.completedAt !== undefined && !isPositiveNumber(record.completedAt))
  ) {
    return undefined;
  }
  return {
    question: record.question,
    hypothesis: record.hypothesis,
    evidence,
    ...(record.confidence === undefined
      ? {}
      : { confidence: record.confidence }),
    ...(record.completedAt === undefined
      ? {}
      : { completedAt: record.completedAt }),
  };
}

function researchHandoffEvidence(
  value: unknown,
): ResearchHandoff["evidence"][number] | undefined {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.citation !== "string" ||
    record.citation.length === 0 ||
    typeof record.claim !== "string" ||
    record.claim.length === 0
  ) {
    return undefined;
  }
  return { citation: record.citation, claim: record.claim };
}

function runSnapshot(value: unknown): RunSnapshot | undefined {
  const record = asRecord(value);
  const scores = scoreMap(record?.scores);
  const cases = parsedArray(record?.cases, caseState);
  const totalUsage = tokenUsage(record?.totalUsage);
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.label !== "string" ||
    typeof record.note !== "string" ||
    typeof record.prompt !== "string" ||
    !isUnitNumber(record.score) ||
    !scores ||
    !cases ||
    !isPositiveNumber(record.startedAt) ||
    (record.completedAt !== undefined &&
      !isPositiveNumber(record.completedAt)) ||
    (record.elapsedMs !== undefined &&
      !isNonNegativeNumber(record.elapsedMs)) ||
    !totalUsage
  ) {
    return undefined;
  }
  return {
    id: record.id,
    label: record.label,
    note: record.note,
    prompt: record.prompt,
    score: record.score,
    scores,
    cases,
    startedAt: record.startedAt,
    ...(record.completedAt === undefined
      ? {}
      : { completedAt: record.completedAt }),
    ...(record.elapsedMs === undefined ? {} : { elapsedMs: record.elapsedMs }),
    totalUsage,
  };
}

function caseState(value: unknown): CaseState | undefined {
  const record = asRecord(value);
  const scores = scoreMap(record?.scores);
  const usage = tokenUsage(record?.usage);
  if (
    !record ||
    typeof record.caseId !== "string" ||
    !isNonNegativeInteger(record.index) ||
    typeof record.label !== "string" ||
    !isCaseStatus(record.status) ||
    (record.scores !== undefined && !scores) ||
    (record.usage !== undefined && !usage) ||
    (record.elapsedMs !== undefined &&
      !isNonNegativeNumber(record.elapsedMs)) ||
    (record.error !== undefined && typeof record.error !== "string") ||
    (record.startedAt !== undefined && !isPositiveNumber(record.startedAt)) ||
    (record.completedAt !== undefined && !isPositiveNumber(record.completedAt))
  ) {
    return undefined;
  }
  return {
    caseId: record.caseId,
    index: record.index,
    label: record.label,
    status: record.status,
    ...(scores ? { scores } : {}),
    ...(record.output === undefined ? {} : { output: record.output }),
    ...(usage ? { usage } : {}),
    ...(record.elapsedMs === undefined ? {} : { elapsedMs: record.elapsedMs }),
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    ...(record.completedAt === undefined
      ? {}
      : { completedAt: record.completedAt }),
  };
}

function hillClimbPoint(value: unknown): HillClimbPoint | undefined {
  const record = asRecord(value);
  const scores = scoreMap(record?.scores);
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.label !== "string" ||
    !isUnitNumber(record.score) ||
    (record.scores !== undefined && !scores) ||
    (record.pending !== undefined && typeof record.pending !== "boolean")
  ) {
    return undefined;
  }
  return {
    id: record.id,
    label: record.label,
    score: record.score,
    ...(scores ? { scores } : {}),
    ...(typeof record.pending === "boolean" ? { pending: record.pending } : {}),
  };
}

function tokenUsage(value: unknown): TokenUsage | undefined {
  const record = asRecord(value);
  if (
    !record ||
    !isNonNegativeInteger(record.inputTokens) ||
    !isNonNegativeInteger(record.outputTokens) ||
    !isNonNegativeInteger(record.cacheReadTokens) ||
    !isNonNegativeInteger(record.cacheCreationTokens) ||
    !isNonNegativeNumber(record.costUsd)
  ) {
    return undefined;
  }
  return {
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheCreationTokens: record.cacheCreationTokens,
    costUsd: record.costUsd,
    ...(isNonNegativeNumber(record.uncachedCostUsd)
      ? { uncachedCostUsd: record.uncachedCostUsd }
      : {}),
    ...(isNonNegativeNumber(record.cacheSavingsUsd)
      ? { cacheSavingsUsd: record.cacheSavingsUsd }
      : {}),
  };
}

function scoreMap(value: unknown): ScoreMap | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const entries = Object.entries(record);
  if (entries.some((entry) => !isUnitNumber(entry[1]))) return undefined;
  return Object.fromEntries(entries) as ScoreMap;
}

function parsedArray<T>(
  value: unknown,
  parse: (item: unknown) => T | null | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.flatMap((item) => {
    const next = parse(item);
    return next === null || next === undefined ? [] : [next];
  });
  return parsed.length === value.length ? parsed : undefined;
}

function isCaseStatus(value: unknown): value is CaseStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "complete" ||
    value === "error"
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isUnitNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}
