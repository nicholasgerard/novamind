"use client";

import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { useSlidingTabIndicator } from "@/components/ui/use-sliding-tab-indicator";
import { cn } from "@/lib/utils";
import { CaseDetailCard } from "./case-detail";
import type { BaselineCase, MetricMeta, RunSnapshot } from "./types";

interface Props {
  runs: ReadonlyArray<RunSnapshot>;
  baselineCases: ReadonlyArray<BaselineCase>;
  selectedRunId: string | null;
  selectedCaseId: string | null;
  metrics: ReadonlyArray<MetricMeta>;
  onSelectRun: (runId: string) => void;
  onSelectCase: (caseId: string) => void;
}

export function CaseInspector({
  runs,
  baselineCases,
  selectedRunId,
  selectedCaseId,
  metrics,
  onSelectRun,
  onSelectCase,
}: Props) {
  const selectedRun =
    runs.find((run) => run.id === selectedRunId) ?? runs.at(-1) ?? null;
  const activeCaseId = selectedCaseId ?? baselineCases[0]?.caseId ?? null;
  const selectedCase =
    baselineCases.find((caseItem) => caseItem.caseId === activeCaseId) ??
    baselineCases[0] ??
    null;
  const selectedRunCase = selectedRun?.cases.find(
    (caseItem) => caseItem.caseId === selectedCase?.caseId,
  );
  const {
    containerRef: tabListRef,
    indicator,
    registerTab,
  } = useSlidingTabIndicator(activeCaseId);

  return (
    <div className="panel flex flex-col overflow-hidden rounded-lg">
      <div className="border-b border-border/35 bg-background/20">
        <div className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Case review
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick a run snapshot, then inspect how one case was graded.
              </p>
            </div>
            {selectedRun && (
              <div className="rounded-md border border-border/70 bg-background/55 px-2.5 py-1.5 text-right font-mono text-[11px] leading-5 tabular-nums text-muted-foreground">
                <span className="block text-foreground">
                  {(selectedRun.score * 100).toFixed(0)}%
                </span>
                <span>${selectedRun.totalUsage.costUsd.toFixed(4)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border/25 px-3 pb-3 sm:px-4">
          <div className="mb-2 flex items-center justify-between gap-3 pt-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-dim)]">
              Run snapshot
            </p>
            {selectedRun && (
              <p className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                {selectedRun.label}
                {selectedRun.elapsedMs
                  ? ` · ${(selectedRun.elapsedMs / 1000).toFixed(1)}s`
                  : ""}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border/70 bg-background/45 p-1">
            {runs.length === 0 ? (
              <span className="block rounded-md border border-dashed border-border/80 px-3 py-2 text-xs text-muted-foreground">
                Run the baseline eval to create the first snapshot.
              </span>
            ) : (
              <div className="flex gap-1 overflow-x-auto">
                {runs.map((run) => {
                  const selected = selectedRun?.id === run.id;
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => onSelectRun(run.id)}
                      className={cn(
                        "flex min-w-[6.75rem] shrink-0 flex-col items-start rounded-md border px-2.5 py-2 text-left transition",
                        selected
                          ? "border-primary/50 bg-primary/[0.12] text-foreground shadow-[0_0_18px_rgb(204_120_92_/_0.08)]"
                          : "border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      <span className="text-xs font-semibold">{run.label}</span>
                      <span className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                        {(run.score * 100).toFixed(0)}% · $
                        {run.totalUsage.costUsd.toFixed(4)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-background/45">
        <div className="flex items-start justify-between gap-3 px-4 pt-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-dim)]">
              Case
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Hypothesis, evidence handoff, and grader notes.
            </p>
          </div>
          <p className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {baselineCases.length} cases
          </p>
        </div>
        <div
          ref={tabListRef}
          role="tablist"
          aria-label="Eval cases"
          className="relative mt-3 grid w-full grid-cols-3 items-stretch gap-1 overflow-hidden px-3 pt-3 sm:px-4"
        >
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute left-0 top-0 z-0 rounded-md border border-border/70 bg-background/55 transition-[height,opacity,transform,width] duration-300 ease-out motion-reduce:transition-none",
              indicator.ready ? "opacity-100" : "opacity-0",
            )}
            style={{
              height: indicator.height,
              transform: `translate3d(${indicator.x}px, ${indicator.y}px, 0)`,
              width: indicator.width,
            }}
          />
          {baselineCases.map((caseItem) => {
            const runCase = selectedRun?.cases.find(
              (c) => c.caseId === caseItem.caseId,
            );
            const selected = activeCaseId === caseItem.caseId;
            return (
              <button
                key={caseItem.caseId}
                type="button"
                role="tab"
                id={`eval-case-tab-${caseItem.caseId}`}
                aria-controls={`eval-case-panel-${caseItem.caseId}`}
                aria-selected={selected}
                ref={registerTab(caseItem.caseId)}
                onClick={() => onSelectCase(caseItem.caseId)}
                className={cn(
                  "relative z-10 flex min-h-16 w-full min-w-0 items-start justify-between gap-2 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors sm:gap-3 sm:px-3",
                  selected
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="line-clamp-3 min-w-0 text-xs font-medium">
                  {caseItem.label}
                </span>
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  <CaseStatusIcon status={runCase?.status ?? "pending"} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-4 pt-3">
          {selectedCase && (
            <div
              key={`${selectedRun?.id ?? "empty"}-${selectedCase.caseId}`}
              role="tabpanel"
              id={`eval-case-panel-${selectedCase.caseId}`}
              aria-labelledby={`eval-case-tab-${selectedCase.caseId}`}
              className="soft-enter"
            >
              <CaseDetailCard
                caseItem={selectedCase}
                runCase={selectedRunCase}
                metrics={metrics}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CaseStatusIcon({
  status,
}: {
  status: "pending" | "running" | "complete" | "error";
}) {
  if (status === "running") {
    return <Loader2 className="size-3 animate-spin text-primary" />;
  }
  if (status === "complete") {
    return <CheckCircle2 className="size-3 text-[var(--positive)]" />;
  }
  if (status === "error") {
    return <XCircle className="size-3 text-destructive" />;
  }
  return <Clock className="size-3 text-muted-foreground/70" />;
}
