"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  AlertTriangle,
  ChartColumnIncreasing,
  CheckCircle2,
  Database,
  FileBarChart2,
  FileCheck2,
  FileText,
  Sparkles,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { ResearchHandoff } from "@novamind/shared";
import { cn } from "@/lib/utils";
import type { ActivityIconName, ActivityItem } from "./activity-items";
import { truncate } from "./format";
import type { DataVizCompleteEvent } from "./types";

export function ActivityLog({
  items,
  result,
  error,
  researchHandoff,
  onOpenResult,
}: {
  items: ActivityItem[];
  result: DataVizCompleteEvent | undefined;
  error: string | null;
  researchHandoff: ResearchHandoff | undefined;
  onOpenResult: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const latestItemKey = items.at(-1)?.key;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const frame = window.requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error, latestItemKey, researchHandoff?.completedAt, result?.ts]);

  return (
    <div className="relative mt-4 min-h-[10rem] flex-1 lg:min-h-0">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-card to-transparent" />
      <div
        ref={scrollerRef}
        className="max-h-[15rem] overflow-y-auto pr-1 lg:h-full lg:max-h-none"
        aria-live="polite"
      >
        <div className="py-3">
          <ResearchHandoffActivity handoff={researchHandoff} />
          {(items.length > 0 || result || error) && (
            <div className="mt-3">
              {items.map((item, index) => (
                <ActivityRow
                  key={item.key}
                  item={item}
                  isLast={!result && !error && index === items.length - 1}
                />
              ))}
              {result && (
                <RecommendationSummary result={result} onOpen={onOpenResult} />
              )}
              {error && <ActivityError message={error} />}
            </div>
          )}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-card to-transparent" />
    </div>
  );
}

function ActivityRow({
  item,
  isLast,
}: {
  item: ActivityItem;
  isLast: boolean;
}) {
  const Icon = activityIconMap[item.icon];
  return (
    <TimelineItem
      icon={Icon}
      isLast={isLast}
      tone={item.tone === "error" ? "error" : "neutral"}
      className="pb-4"
    >
      <div className="min-w-0">
        <p className="text-xs font-medium leading-relaxed text-foreground">
          {item.label}
        </p>
        {item.detail && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {item.detail}
          </p>
        )}
      </div>
    </TimelineItem>
  );
}

const activityIconMap: Record<ActivityIconName, LucideIcon> = {
  chartBuilt: FileCheck2,
  chartRendered: ChartColumnIncreasing,
  complete: CheckCircle2,
  data: Database,
  orchestrator: Waypoints,
  profile: FileBarChart2,
};

function ResearchHandoffActivity({
  handoff,
}: {
  handoff: ResearchHandoff | undefined;
}) {
  const ready = Boolean(handoff);
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-3 soft-enter",
        ready
          ? "border-primary/35 bg-primary/[0.055]"
          : "border-border/70 bg-background/35",
      )}
    >
      <div className="grid grid-cols-[2rem_1fr] gap-3">
        <div
          className={cn(
            "mt-0.5 grid size-7 place-items-center rounded-full border",
            ready
              ? "border-primary/40 bg-primary/15 text-primary"
              : "border-border bg-secondary text-muted-foreground",
          )}
        >
          <FileText className="size-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium leading-relaxed text-foreground">
            {handoff?.question ??
              "Run the research agent first to generate a report handoff."}
          </p>
          <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {handoff?.hypothesis ??
              "First generate a verified hypothesis with evidence, then come back to generate a visual report from it."}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/50 pt-2">
            <HandoffActivityStat
              label="confidence"
              value={
                handoff?.confidence === undefined
                  ? "--"
                  : `${Math.round(handoff.confidence * 100)}%`
              }
            />
            <HandoffActivityStat
              label="verified"
              value={handoff?.evidence.length ?? "--"}
            />
            <HandoffActivityStat
              label="status"
              value={ready ? "ready" : "blocked"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function HandoffActivityStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <span className="mono-data inline-flex min-w-0 items-baseline gap-1 text-[9px] uppercase tracking-[0.08em]">
      <span className="text-[var(--fg-dim)]">{label}</span>
      <span className="truncate text-foreground">{value}</span>
    </span>
  );
}

function RecommendationSummary({
  result,
  onOpen,
}: {
  result: DataVizCompleteEvent;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group mt-1 w-full rounded-md border border-primary/35 bg-primary/[0.055] px-3 py-3 text-left soft-enter",
        "transition duration-200 hover:border-primary/55 hover:bg-primary/[0.075]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-4 focus-visible:ring-offset-background",
      )}
    >
      <div className="grid grid-cols-[2rem_1fr] gap-3">
        <div className="mt-0.5 grid size-7 place-items-center rounded-full border border-primary/40 bg-primary/15 text-primary transition group-hover:border-primary/60">
          <Sparkles className="size-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium leading-relaxed text-foreground">
            Final report assembled
          </p>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {truncate(result.recommendation, 190)}
          </p>
          <p className="mono-data mt-2 border-t border-border/50 pt-2 text-[9px] uppercase tracking-[0.14em] text-[var(--fg-dim)]">
            ${result.totalUsage.costUsd.toFixed(4)} ·{" "}
            {result.totalUsage.outputTokens.toLocaleString()} output tokens
          </p>
        </div>
      </div>
    </button>
  );
}

function ActivityError({ message }: { message: string }) {
  return (
    <TimelineItem icon={AlertTriangle} tone="error" className="pb-1">
      <div className="min-w-0">
        <p className="text-xs font-medium leading-relaxed text-destructive">
          Report builder stopped
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {message}
        </p>
      </div>
    </TimelineItem>
  );
}

function TimelineItem({
  children,
  className,
  icon: Icon,
  isLast = true,
  onClick,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  icon: LucideIcon;
  isLast?: boolean;
  onClick?: () => void;
  tone?: "error" | "interactive" | "neutral";
}) {
  const content = (
    <>
      {!isLast && (
        <span className="absolute bottom-1.5 left-[0.875rem] top-9 w-px bg-border/45" />
      )}
      <div
        className={cn(
          "relative z-10 mt-0.5 grid size-7 place-items-center rounded-full border bg-card",
          tone === "error"
            ? "border-destructive/45 text-destructive"
            : "border-border/80 text-muted-foreground",
          tone === "interactive" &&
            "transition group-hover:border-foreground/35 group-hover:text-foreground",
        )}
      >
        <Icon className="size-3.5" />
      </div>
      {children}
    </>
  );
  const itemClassName = cn(
    "relative grid min-w-0 grid-cols-[2rem_1fr] gap-3 soft-enter",
    onClick &&
      "group w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-4 focus-visible:ring-offset-background",
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={itemClassName}>
        {content}
      </button>
    );
  }

  return <div className={itemClassName}>{content}</div>;
}
