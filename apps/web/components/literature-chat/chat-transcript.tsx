"use client";

import {
  BrainCircuit,
  CheckCircle2,
  FileText,
  Files,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Syringe,
  Wrench,
} from "lucide-react";
import { memo, useMemo, type ComponentType, type ReactNode } from "react";
import type { StreamEvent, TokenUsage } from "@novamind/shared/events";
import { Badge } from "@/components/ui/badge";
import { MarkdownText } from "@/components/ui/markdown-text";
import { cn } from "@/lib/utils";
import { stageMeta } from "./stage-meta";
import {
  asRecord,
  getCandidateClaims,
  getHits,
  stringValue,
  type LiveStatus,
} from "./stream-helpers";
import type {
  LiteratureStageSection,
  PipelineResultEvent,
  VerificationRow,
} from "./types";

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="chat-fade-in flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-border bg-card/60 px-5 py-3 text-base text-foreground">
        {text}
      </div>
    </div>
  );
}

export const LiteratureStageSectionCard = memo(
  function LiteratureStageSectionCard({
    section,
  }: {
    section: LiteratureStageSection;
  }) {
    const meta = stageMeta[section.stage] ?? stageMeta.orchestrator;
    const Icon = meta.icon;
    const activityItems = useMemo(
      () => groupActivityEvents(section.events),
      [section.events],
    );
    return (
      <section className="chat-fade-in" aria-label={meta.label}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 place-items-center rounded-full border border-border bg-card/60">
            <Icon className="size-3.5 text-foreground/85" />
          </span>
          <p className="shrink-0 text-sm font-medium text-foreground">
            {meta.label}
          </p>
          {section.model && (
            <Badge variant="muted" className="min-w-0 truncate font-mono">
              {section.model}
            </Badge>
          )}
        </div>
        <div className="ml-9 mt-3 space-y-3">
          {activityItems.map((item) => (
            <div key={item.key} className="chat-fade-in">
              <ActivityGroupItem item={item} />
            </div>
          ))}
          {section.finished && hasBillableUsage(section.finished.usage) && (
            <p className="mono-data text-[10px] uppercase tracking-[0.16em] text-[var(--fg-dim)]">
              {section.finished.usage.inputTokens.toLocaleString()} in ·{" "}
              {section.finished.usage.outputTokens.toLocaleString()} out · $
              {section.finished.usage.costUsd.toFixed(5)}
            </p>
          )}
        </div>
      </section>
    );
  },
);

type ToolResultStreamEvent = Extract<StreamEvent, { type: "tool_result" }>;

type ActivityGroup =
  | {
      event: StreamEvent;
      key: string;
      kind: "event";
    }
  | {
      context?: ToolResultStreamEvent;
      key: string;
      kind: "verifier_batch";
      verdicts: ToolResultStreamEvent[];
    };

function groupActivityEvents(events: readonly StreamEvent[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;

    if (isVerifierContextEvent(event) || isCitationVerdictEvent(event)) {
      const context = isVerifierContextEvent(event) ? event : undefined;
      const verdicts: ToolResultStreamEvent[] = [];
      let cursor = context ? index + 1 : index;

      while (cursor < events.length) {
        const candidate = events[cursor];
        if (!candidate || !isCitationVerdictEvent(candidate)) break;
        verdicts.push(candidate);
        cursor += 1;
      }

      groups.push({
        context,
        key: `verifier-batch-${event.ts}-${index}`,
        kind: "verifier_batch",
        verdicts,
      });
      index = cursor - 1;
      continue;
    }

    groups.push({ event, key: `${event.ts}-${index}`, kind: "event" });
  }
  return groups;
}

function isVerifierContextEvent(
  event: StreamEvent,
): event is ToolResultStreamEvent {
  return event.type === "tool_result" && event.tool === "verifier_context";
}

function isCitationVerdictEvent(
  event: StreamEvent,
): event is ToolResultStreamEvent {
  return event.type === "tool_result" && event.tool === "citation_verdict";
}

function ActivityGroupItem({ item }: { item: ActivityGroup }) {
  if (item.kind === "verifier_batch") {
    return (
      <VerifierBatchCard context={item.context} verdicts={item.verdicts} />
    );
  }
  return <ActivityItem event={item.event} />;
}

function hasBillableUsage(usage: TokenUsage): boolean {
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cacheCreationTokens > 0 ||
    usage.cacheReadTokens > 0 ||
    usage.costUsd > 0
  );
}

function ActivityItem({ event }: { event: StreamEvent }) {
  if (event.type === "tool_call") {
    return <ToolCallItem event={event} />;
  }
  if (event.type === "tool_result") {
    return <ToolResultItem event={event} />;
  }
  if (event.type === "literature_stage_message") {
    if (event.text.startsWith("Injected demo claim:")) {
      return <InjectedDemoClaimCallout text={event.text} />;
    }
    return (
      <MarkdownText
        text={event.text}
        className="text-sm leading-relaxed text-muted-foreground"
      />
    );
  }
  return null;
}

function InjectedDemoClaimCallout({ text }: { text: string }) {
  const detail = text.replace(/^Injected demo claim:\s*/, "");
  return (
    <ToolActivityBox icon={Syringe} title="Injected demo claim" tone="lit">
      <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </ToolActivityBox>
  );
}

function ToolCallItem({
  event,
}: {
  event: Extract<StreamEvent, { type: "tool_call" }>;
}) {
  const input = asRecord(event.input);
  const query = stringValue(input?.query);
  const claim = stringValue(input?.claim);
  const pmid = stringValue(input?.pmid);
  const label = toolCallLabel(event.tool);

  if (event.tool === "pubmed_corpus_search") {
    return (
      <ToolEventLine icon={Search} label={label} layout="inline">
        <span>{query ? `"${query}"` : "PubMed corpus"}</span>
      </ToolEventLine>
    );
  }

  return (
    <ToolEventLine icon={Wrench} label={label}>
      {query && <span>{`"${query}"`}</span>}
      {claim && <span>{truncateText(claim, 120)}</span>}
      {pmid && !claim && <span>PMID {pmid}</span>}
    </ToolEventLine>
  );
}

function toolCallLabel(tool: string): string {
  switch (tool) {
    case "pubmed_corpus_search":
      return "Searched";
    default:
      return tool;
  }
}

function ToolResultItem({
  event,
}: {
  event: Extract<StreamEvent, { type: "tool_result" }>;
}) {
  if (event.tool === "pubmed_corpus_search") {
    const hits = getHits(event.output);
    return (
      <ToolSummaryCard
        icon={Files}
        title={`${hits.length} ${hits.length === 1 ? "abstract" : "abstracts"} retrieved`}
      >
        <div className="space-y-2">
          {hits.map((hit) => (
            <div key={hit.pmid} className="rounded-md bg-background/35 p-2.5">
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {hit.year ? `${hit.year} · ` : ""}
                {hit.title}
              </p>
              <p className="mono-data mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--fg-dim)]">
                PMID {hit.pmid}
              </p>
            </div>
          ))}
        </div>
      </ToolSummaryCard>
    );
  }
  if (event.tool === "candidate_claims") {
    const claims = getCandidateClaims(event.output);
    return (
      <ToolSummaryCard
        icon={FileText}
        title={`${claims.length} ${claims.length === 1 ? "claim" : "claims"} extracted`}
      >
        <div className="space-y-2">
          {claims.map((claim, index) => (
            <div
              key={`${claim.pmid}-${index}`}
              className="rounded-md bg-background/35 p-2.5"
            >
              <p className="text-xs leading-relaxed text-muted-foreground">
                {claim.claim}
              </p>
              <p className="mono-data mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--fg-dim)]">
                PMID {claim.pmid}
              </p>
            </div>
          ))}
        </div>
      </ToolSummaryCard>
    );
  }
  return (
    <ToolEventLine icon={Wrench} label="Tool result">
      <span>{event.tool}</span>
    </ToolEventLine>
  );
}

function VerifierBatchCard({
  context,
  verdicts,
}: {
  context?: ToolResultStreamEvent;
  verdicts: ToolResultStreamEvent[];
}) {
  const output = asRecord(context?.output);
  const claimCount = numberValue(output?.claim_count) ?? verdicts.length;
  const complete = claimCount > 0 && verdicts.length >= claimCount;
  const title = complete
    ? `${claimCount} ${claimCount === 1 ? "claim" : "claims"} checked`
    : claimCount > 0
      ? `Checking ${verdicts.length}/${claimCount} claims`
      : "Checking claims";

  return (
    <ToolActivityBox icon={ShieldCheck} title={title}>
      <div className="overflow-hidden rounded-lg border border-border/65 bg-background/25">
        {verdicts.length > 0 ? (
          <ul className="divide-y divide-border/55">
            {verdicts.map((verdict, index) => (
              <VerifierVerdictRow
                key={`${verdict.ts}-${index}`}
                verdict={verdict}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-border/55 bg-card/30 px-2.5 py-2 text-xs text-muted-foreground">
            Awaiting verdict rows from the batched verifier response...
          </p>
        )}
      </div>
    </ToolActivityBox>
  );
}

function VerifierVerdictRow({ verdict }: { verdict: ToolResultStreamEvent }) {
  const output = asRecord(verdict.output);
  const verified = output?.verified === true;
  const pmid = cleanText(output?.pmid);
  const claim = cleanText(output?.claim);
  const rationale = cleanText(output?.rationale);
  const supportingQuote = cleanText(output?.supporting_quote);
  const detail =
    rationale ??
    (verified
      ? supportingQuote
        ? `Matched abstract quote: ${supportingQuote}`
        : "Matched the retrieved abstract."
      : "Claim rejected - not supported by retrieved abstract.");
  const Icon = verified ? CheckCircle2 : ShieldX;

  return (
    <li
      className={cn(
        "px-3 py-2.5",
        verified ? "bg-card/20" : "bg-primary/[0.08]",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border",
            verified
              ? "border-[var(--positive)]/30 bg-[var(--positive)]/10 text-[var(--positive)]"
              : "border-primary/35 bg-primary/16 text-primary",
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={cn(
                "mono-data text-[10px] uppercase tracking-[0.14em]",
                verified ? "text-[var(--positive)]" : "text-primary",
              )}
            >
              {verified ? "Citation supported" : "Verifier catch"}
            </p>
            {pmid && (
              <span className="mono-data text-[9px] uppercase tracking-[0.1em] text-[var(--fg-dim)]">
                PMID {pmid}
              </span>
            )}
          </div>
          {claim && (
            <p
              className={cn(
                "line-clamp-2 text-xs leading-relaxed",
                verified ? "text-foreground/75" : "text-foreground/85",
              )}
            >
              {claim}
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {detail}
          </p>
          {verified && supportingQuote && rationale && (
            <p className="truncate border-l border-border/70 pl-2 text-[11px] leading-relaxed text-muted-foreground/75">
              {supportingQuote}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

type ToolActivityLayout = "stacked" | "inline";
type ToolActivityTone = "default" | "accent" | "lit";

const toolActivityToneStyles: Record<
  ToolActivityTone,
  {
    icon: string;
    label: string;
    shell: string;
  }
> = {
  default: {
    icon: "bg-muted/70 text-foreground/75",
    label: "text-[var(--fg-dim)]",
    shell: "border-border bg-card/50",
  },
  accent: {
    icon: "bg-primary/15 text-primary",
    label: "text-primary",
    shell: "border-primary/45 bg-primary/[0.08]",
  },
  lit: {
    icon: "bg-primary/20 text-primary",
    label: "text-primary",
    shell: "border-primary/60 bg-primary/[0.11] ring-1 ring-primary/15",
  },
};

function ToolActivityBox({
  bodyClassName,
  children,
  className,
  icon: Icon,
  layout = "stacked",
  title,
  tone = "default",
}: {
  bodyClassName?: string;
  children: ReactNode;
  className?: string;
  icon: ComponentType<{ className?: string }>;
  layout?: ToolActivityLayout;
  title: string;
  tone?: ToolActivityTone;
}) {
  const styles = toolActivityToneStyles[tone];
  return (
    <div
      className={cn(
        "rounded-xl border shadow-sm shadow-black/5",
        layout === "inline" ? "px-3 py-2.5" : "p-3.5",
        styles.shell,
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full",
            styles.icon,
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <p
          className={cn(
            "mono-data text-[10px] uppercase tracking-[0.14em]",
            layout === "inline" ? "shrink-0" : "min-w-0",
            styles.label,
          )}
        >
          {title}
        </p>
        {layout === "inline" && (
          <div
            className={cn(
              "min-w-0 flex-1 truncate text-xs leading-relaxed text-muted-foreground",
              bodyClassName,
            )}
          >
            {children}
          </div>
        )}
      </div>
      {layout === "stacked" && (
        <div className={cn("mt-3", bodyClassName)}>{children}</div>
      )}
    </div>
  );
}

function ToolSummaryCard({
  children,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  icon: ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <ToolActivityBox icon={Icon} title={title}>
      {children}
    </ToolActivityBox>
  );
}

function ToolEventLine({
  children,
  icon: Icon,
  label,
  layout,
}: {
  children: ReactNode;
  icon: ComponentType<{ className?: string }>;
  label: string;
  layout?: ToolActivityLayout;
}) {
  return (
    <ToolActivityBox
      bodyClassName="break-words text-xs leading-relaxed text-muted-foreground"
      icon={Icon}
      layout={layout}
      title={label}
    >
      {children}
    </ToolActivityBox>
  );
}

const liveStatusIcons: Record<
  Exclude<LiveStatus["icon"], "spinner">,
  ComponentType<{ className?: string }>
> = {
  brain: BrainCircuit,
  check: CheckCircle2,
  file: FileText,
  files: Files,
  refresh: RefreshCw,
  search: Search,
  shield: ShieldCheck,
  sparkles: Sparkles,
  tool: Wrench,
};

export function LiveStatusLine({ status }: { status: LiveStatus }) {
  const isActive = status.tone === "active" || status.tone === "recovery";
  const Icon = isActive
    ? Loader2
    : status.icon === "spinner"
      ? CheckCircle2
      : liveStatusIcons[status.icon];
  return (
    <div
      key={status.key}
      className="chat-fade-in flex min-w-0 items-center gap-2.5"
      aria-live={isActive ? "polite" : "off"}
      role={isActive ? "status" : undefined}
    >
      <span
        className={cn(
          "relative grid size-7 shrink-0 place-items-center rounded-full border",
          status.tone === "error"
            ? "border-destructive/45 bg-destructive/10 text-destructive"
            : status.tone === "settled"
              ? "border-[var(--positive)]/35 bg-[var(--positive)]/10 text-[var(--positive)]"
              : "border-primary/45 bg-primary/10 text-primary",
        )}
      >
        {isActive && (
          <span
            className="absolute inset-0 rounded-full border border-primary/30 opacity-60"
            aria-hidden
          />
        )}
        <Icon
          className={cn(
            "size-3.5",
            isActive && "animate-spin",
            status.tone === "recovery" && "text-primary",
          )}
        />
      </span>
      <p
        className={cn(
          "relative min-w-0 flex-1 truncate text-sm text-muted-foreground transition-colors",
          status.tone === "settled" && "text-foreground/80",
          status.tone === "error" && "text-destructive",
        )}
      >
        <span>{status.label}</span>
        {isActive && (
          <span aria-hidden className="live-status-label-sweep">
            {status.label}
          </span>
        )}
      </p>
      {status.meta && (
        <span className="mono-data shrink-0 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--fg-dim)]">
          {status.meta}
        </span>
      )}
    </div>
  );
}

export function SynthesisCard({
  result,
  verificationRows,
  onOpenEvidence,
  onOpenVerifier,
}: {
  result: PipelineResultEvent;
  verificationRows: VerificationRow[];
  onOpenEvidence: () => void;
  onOpenVerifier: () => void;
}) {
  const evidenceCount = result.result.evidence.length;
  const verifierCatches = verificationRows.filter(
    (row) => !row.verified,
  ).length;
  return (
    <article className="chat-fade-in rounded-2xl border border-primary/35 bg-primary/[0.05] p-6 sm:p-7">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-primary/15">
          <Sparkles className="size-3.5 text-primary" />
        </span>
        <p className="mono-data text-[10px] uppercase tracking-[0.18em] text-primary">
          Hypothesis · synthesized
        </p>
        <span className="mono-data ml-auto rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          confidence {(result.result.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <MarkdownText
        text={result.result.hypothesis}
        className="mt-5 text-balance text-xl leading-relaxed text-foreground sm:text-[1.375rem] sm:leading-[1.45]"
        listClassName="ml-5 text-left"
      />

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border/50 pt-5">
        <Attachment
          icon={FileText}
          label={`${evidenceCount} ${evidenceCount === 1 ? "evidence item" : "evidence items"}`}
          onClick={onOpenEvidence}
        />
        {verifierCatches > 0 && (
          <Attachment
            icon={ShieldX}
            label={`${verifierCatches} verifier catch${verifierCatches === 1 ? "" : "es"}`}
            onClick={onOpenVerifier}
            accent
          />
        )}
        <span className="mono-data w-full text-[10px] uppercase tracking-[0.16em] text-[var(--fg-dim)] sm:ml-auto sm:w-auto">
          ${result.totalUsage.costUsd.toFixed(4)} ·{" "}
          {result.totalUsage.outputTokens.toLocaleString()} output tokens
        </span>
      </div>
    </article>
  );
}

function truncateText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function cleanText(value: unknown): string | undefined {
  return stringValue(value)?.trim() || undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function Attachment({
  icon: Icon,
  label,
  onClick,
  accent,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition",
        accent
          ? "border-primary/45 bg-primary/[0.07] text-primary hover:bg-primary/[0.13]"
          : "border-border bg-card/55 text-foreground/85 hover:border-foreground/35 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
