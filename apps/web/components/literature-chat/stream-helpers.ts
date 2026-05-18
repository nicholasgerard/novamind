import type { StreamEvent } from "@novamind/shared/events";
import { stageMeta } from "./stage-meta";
import type {
  CandidateClaimRow,
  LiteratureStageKey,
  LiteratureStageSection,
  PipelineResultEvent,
  RetrievalHit,
  VerificationRow,
} from "./types";

export function getPipelineResult(
  events: readonly StreamEvent[],
): PipelineResultEvent | undefined {
  return events.find(
    (event): event is PipelineResultEvent => event.type === "pipeline_result",
  );
}

export function groupByLiteratureStage(
  events: readonly StreamEvent[],
): LiteratureStageSection[] {
  const sections: LiteratureStageSection[] = [];
  let current: LiteratureStageSection | null = null;

  for (const event of events) {
    if (event.type === "literature_stage_started") {
      if (current) sections.push(current);
      current = {
        id: `${event.stage}-${event.ts}`,
        stage: event.stage as LiteratureStageKey,
        model: event.model,
        events: [],
      };
      continue;
    }
    if (event.type === "literature_stage_finished") {
      if (current && current.stage === event.stage) {
        current.finished = event;
        sections.push(current);
        current = null;
      }
      continue;
    }
    if (
      event.type === "pipeline_result" ||
      event.type === "error" ||
      event.type === "agent_loop_event"
    ) {
      continue;
    }
    if (current) current.events.push(event);
  }
  if (current) sections.push(current);
  return sections;
}

export type LiveStatusIcon =
  | "brain"
  | "check"
  | "file"
  | "files"
  | "refresh"
  | "search"
  | "shield"
  | "sparkles"
  | "spinner"
  | "tool";

export interface LiveStatus {
  icon: LiveStatusIcon;
  key: string;
  label: string;
  meta?: string;
  tone: "active" | "settled" | "recovery" | "error";
}

export function getLiveStatus(events: readonly StreamEvent[]): LiveStatus {
  const latest = latestActivityEvent(events);
  if (!latest) {
    return activeStatus("start", "Starting research agent...", "spinner");
  }

  if (latest.type === "agent_loop_event") {
    if (latest.phase === "recovery") {
      return {
        icon: "refresh",
        key: `recovery-${latest.ts}`,
        label: recoveryLabel(latest.detail ?? latest.label),
        tone: "recovery",
      };
    }
    if (latest.phase === "model" && latest.status === "running") {
      return activeStatus(`model-${latest.ts}`, latest.label, "brain");
    }
    if (latest.phase === "tool" && latest.status === "running") {
      return activeStatus(`tool-${latest.ts}`, latest.label, "tool");
    }
    if (latest.phase === "tool" && latest.status === "complete") {
      return (
        concreteStatusBefore(events, latest.ts) ??
        settledStatus(`tool-complete-${latest.ts}`, latest.label, "check")
      );
    }
    if (latest.phase === "session") {
      return latest.status === "running"
        ? activeStatus(`session-${latest.ts}`, latest.label, "tool")
        : settledStatus(`session-${latest.ts}`, latest.label, "check");
    }
    if (latest.phase === "complete") {
      return latest.status === "error"
        ? errorStatus(`complete-${latest.ts}`, latest.label, "tool")
        : settledStatus(`complete-${latest.ts}`, latest.label, "check");
    }
  }

  if (latest.type === "tool_call") {
    return activeStatus(
      `tool-call-${latest.tool}-${latest.ts}`,
      toolRunningLabel(latest.tool, latest.stage),
      toolIcon(latest.tool, latest.stage),
    );
  }

  if (latest.type === "tool_result") {
    return toolResultStatus(latest, events);
  }

  if (latest.type === "literature_stage_finished") {
    return activeStatus(
      `stage-finished-${latest.stage}-${latest.ts}`,
      afterFinishedLabel(latest.stage),
      stageIcon(latest.stage),
    );
  }

  if (latest.type === "literature_stage_started") {
    return activeStatus(
      `stage-started-${latest.stage}-${latest.ts}`,
      stageRunningLabel(latest.stage),
      stageIcon(latest.stage),
    );
  }

  if (latest.type === "literature_stage_message") {
    return activeStatus(
      `stage-message-${latest.stage}-${latest.ts}`,
      stageRunningLabel(latest.stage),
      stageIcon(latest.stage),
    );
  }

  return activeStatus(`working-${latest.ts}`, "Working...", "spinner");
}

function concreteStatusBefore(
  events: readonly StreamEvent[],
  beforeTs: number,
): LiveStatus | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.ts > beforeTs) continue;
    if (event.type === "tool_result") {
      return toolResultStatus(event, events);
    }
    if (event.type === "literature_stage_finished") {
      return activeStatus(
        `stage-finished-${event.stage}-${event.ts}`,
        afterFinishedLabel(event.stage),
        stageIcon(event.stage),
      );
    }
  }
  return undefined;
}

function latestActivityEvent(
  events: readonly StreamEvent[],
):
  | Exclude<
      StreamEvent,
      PipelineResultEvent | Extract<StreamEvent, { type: "error" }>
    >
  | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || event.type === "pipeline_result" || event.type === "error") {
      continue;
    }
    return event;
  }
  return undefined;
}

function stageRunningLabel(stage: string): string {
  return stageMeta[stage as LiteratureStageKey]?.runningLabel ?? "Working...";
}

function toolRunningLabel(tool: string, stage: string): string {
  switch (tool) {
    case "pubmed_corpus_search":
      return "Searching corpus...";
    case "retrieval_override":
      return "Loading retrieved papers...";
    case "citation_verdict":
      return "Scoring citation support...";
    case "verifier_context":
      return "Preparing verifier context...";
    default:
      return stageRunningLabel(stage);
  }
}

function toolResultStatus(
  event: Extract<StreamEvent, { type: "tool_result" }>,
  events: readonly StreamEvent[],
): LiveStatus {
  if (event.tool === "pubmed_corpus_search") {
    const hits = getHits(event.output);
    return settledStatus(
      `tool-result-${event.tool}-${event.ts}`,
      `${hits.length} ${hits.length === 1 ? "abstract" : "abstracts"} retrieved`,
      "files",
    );
  }

  if (event.tool === "candidate_claims") {
    const claims = getCandidateClaims(event.output);
    return settledStatus(
      `tool-result-${event.tool}-${event.ts}`,
      `${claims.length} ${claims.length === 1 ? "claim" : "claims"} extracted`,
      "file",
    );
  }

  if (event.tool === "verifier_context") {
    const output = asRecord(event.output);
    const claimCount = numberValue(output?.claim_count);
    return activeStatus(
      `tool-result-${event.tool}-${event.ts}`,
      claimCount
        ? `Checking ${claimCount} ${claimCount === 1 ? "claim" : "claims"}...`
        : "Checking citation support...",
      "shield",
    );
  }

  if (event.tool === "citation_verdict") {
    return verifierVerdictStatus(event, events);
  }

  return activeStatus(
    `tool-result-${event.tool}-${event.ts}`,
    afterToolLabel(event.tool, event.stage),
    toolIcon(event.tool, event.stage),
  );
}

function afterToolLabel(tool: string, stage: string): string {
  switch (tool) {
    case "pubmed_corpus_search":
    case "retrieval_override":
      return "Preparing retrieved abstracts...";
    case "verifier_context":
      return "Verifying citations in one call...";
    case "citation_verdict":
      return "Reviewing citation verdicts...";
    case "candidate_claims":
      return "Preparing verifier inputs...";
    default:
      return stageRunningLabel(stage);
  }
}

function verifierVerdictStatus(
  event: Extract<StreamEvent, { type: "tool_result" }>,
  events: readonly StreamEvent[],
): LiveStatus {
  const context = findLatestVerifierContext(events, event.ts);
  const expected = numberValue(asRecord(context?.output)?.claim_count);
  const contextTs = context?.ts ?? Number.NEGATIVE_INFINITY;
  const received = events.filter(
    (item) =>
      item.type === "tool_result" &&
      item.tool === "citation_verdict" &&
      item.ts >= contextTs &&
      item.ts <= event.ts,
  ).length;
  if (expected && received < expected) {
    return {
      icon: "shield",
      key: `verifier-progress-${event.ts}`,
      label: "Verifier returning verdicts...",
      meta: `${received}/${expected}`,
      tone: "active",
    };
  }
  const checked = expected ?? received;
  return settledStatus(
    `verifier-complete-${event.ts}`,
    `${checked} ${checked === 1 ? "claim" : "claims"} checked`,
    "shield",
  );
}

function findLatestVerifierContext(
  events: readonly StreamEvent[],
  beforeTs: number,
): Extract<StreamEvent, { type: "tool_result" }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.type === "tool_result" &&
      event.tool === "verifier_context" &&
      event.ts <= beforeTs
    ) {
      return event;
    }
  }
  return undefined;
}

function afterFinishedLabel(stage: string): string {
  switch (stage) {
    case "search":
      return "Extracting claims...";
    case "claim_extractor":
      return "Verifying citations...";
    case "citation_verifier":
      return "Synthesizing hypothesis...";
    case "hypothesis":
      return "Finalizing result...";
    default:
      return "Coordinating tools...";
  }
}

function recoveryLabel(detail: string): string {
  if (/verif/i.test(detail)) return "Recovering verifier output...";
  if (/claim/i.test(detail)) return "Recovering claim extraction...";
  if (/search/i.test(detail)) return "Recovering search...";
  return "Recovering from tool error...";
}

function activeStatus(
  key: string,
  label: string,
  icon: LiveStatusIcon,
): LiveStatus {
  return { icon, key, label, tone: "active" };
}

function settledStatus(
  key: string,
  label: string,
  icon: LiveStatusIcon,
): LiveStatus {
  return { icon, key, label, tone: "settled" };
}

function errorStatus(
  key: string,
  label: string,
  icon: LiveStatusIcon,
): LiveStatus {
  return { icon, key, label, tone: "error" };
}

function toolIcon(tool: string, stage: string): LiveStatusIcon {
  switch (tool) {
    case "pubmed_corpus_search":
      return "search";
    case "candidate_claims":
      return "file";
    case "verifier_context":
    case "citation_verdict":
      return "shield";
    default:
      return stageIcon(stage);
  }
}

function stageIcon(stage: string): LiveStatusIcon {
  switch (stage) {
    case "search":
      return "search";
    case "claim_extractor":
      return "file";
    case "citation_verifier":
      return "shield";
    case "hypothesis":
      return "sparkles";
    default:
      return "tool";
  }
}

export function extractVerificationRows(
  events: readonly StreamEvent[],
): VerificationRow[] {
  const pendingClaims = new Map<string, string>();
  const rows: VerificationRow[] = [];

  for (const event of events) {
    if (event.type === "tool_call" && event.tool === "citation_verdict") {
      const input = asRecord(event.input);
      const pmid = stringValue(input?.pmid);
      const claim = stringValue(input?.claim);
      if (pmid && claim) pendingClaims.set(pmid, claim);
    }
    if (event.type === "tool_result" && event.tool === "citation_verdict") {
      const output = asRecord(event.output);
      const pmid = stringValue(output?.pmid);
      const claim = stringValue(output?.claim);
      if (!pmid) continue;
      rows.push({
        pmid,
        claim: claim ?? pendingClaims.get(pmid) ?? "Claim text unavailable.",
        verified: output?.verified === true,
      });
    }
  }
  return rows;
}

export function getHits(output: unknown): RetrievalHit[] {
  const record = asRecord(output);
  const hits = Array.isArray(record?.hits) ? record.hits : [];
  const normalized: RetrievalHit[] = [];
  for (const item of hits) {
    const hit = asRecord(item);
    const pmid = stringValue(hit?.pmid);
    const title = stringValue(hit?.title);
    if (!pmid || !title) continue;
    normalized.push({
      pmid,
      title,
      year: numberValue(hit?.year),
    });
  }
  return normalized;
}

export function getCandidateClaims(output: unknown): CandidateClaimRow[] {
  const record = asRecord(output);
  const claims = Array.isArray(record?.claims) ? record.claims : [];
  const normalized: CandidateClaimRow[] = [];
  for (const item of claims) {
    const claim = asRecord(item);
    const pmid = stringValue(claim?.pmid);
    const text = stringValue(claim?.claim);
    if (!pmid || !text) continue;
    normalized.push({ pmid, claim: text });
  }
  return normalized;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
