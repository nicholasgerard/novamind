import { Loader2, Play, RotateCcw, Sparkles } from "lucide-react";
import type { ResearchHandoff } from "@novamind/shared";
import type { DataVizStreamEvent } from "@novamind/shared/data-viz-events";
import { Button } from "@/components/ui/button";
import { Modal, ModalSection, ModalTitle } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { activityItems } from "./activity-items";
import { ActivityLog } from "./activity-panel";
import { DataVizChartGraphic } from "./charts";
import { StatusPill } from "./status-indicator";
import type {
  DataVizChartEvent,
  DataVizCompleteEvent,
  DemoMode,
} from "./types";

export function DataVizControlPanel({
  mode,
  events,
  result,
  error,
  researchHandoff,
  running,
  onRun,
  onReset,
  onOpenResult,
  className,
}: {
  mode: DemoMode;
  events: DataVizStreamEvent[];
  result: DataVizCompleteEvent | undefined;
  error: string | null;
  researchHandoff: ResearchHandoff | undefined;
  running: boolean;
  onRun: () => void;
  onReset: () => void;
  onOpenResult: () => void;
  className?: string;
}) {
  const activity = activityItems(events);
  const complete = mode === "complete" && Boolean(result);
  return (
    <aside
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-foreground/15 bg-card/80 p-4 lg:h-full lg:min-h-0",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-3">
        <p className="text-base font-medium text-foreground">Activity</p>
        <StatusPill blocked={!researchHandoff} mode={mode} />
      </div>

      <ActivityLog
        items={activity}
        result={result}
        error={error}
        researchHandoff={researchHandoff}
        onOpenResult={onOpenResult}
      />

      <div className="mt-3 shrink-0">
        <ReportRunControl
          complete={complete}
          disabled={!researchHandoff}
          running={running}
          onRun={onRun}
          onReset={onReset}
        />
      </div>
    </aside>
  );
}

export function RecommendationModal({
  chartEvents,
  open,
  result,
  onClose,
}: {
  chartEvents: DataVizChartEvent[];
  open: boolean;
  result: DataVizCompleteEvent | undefined;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <ModalTitle
          icon={Sparkles}
          title="Final report"
          description="Assembled visual report based on our hypothesis"
        />
      }
      className="max-w-6xl"
    >
      {result && (
        <div className="space-y-5">
          {chartEvents.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {chartEvents.slice(0, 4).map((event, index) => (
                <ReportChartCard
                  key={event.chart.id}
                  chartEvent={event}
                  index={index}
                />
              ))}
            </div>
          )}
          <ModalSection eyebrow="Recommendation">
            <p className="text-base leading-relaxed text-foreground">
              {result.recommendation}
            </p>
          </ModalSection>
          <ModalSection eyebrow="Rationale">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {result.rationale}
            </p>
          </ModalSection>
          {result.caveats.length > 0 && (
            <ModalSection eyebrow="Caveats">
              <ul className="mt-2 space-y-2">
                {result.caveats.map((caveat, index) => (
                  <li
                    key={`${caveat}-${index}`}
                    className="rounded-md border border-border bg-background/35 px-3 py-2 text-sm leading-relaxed text-muted-foreground"
                  >
                    {caveat}
                  </li>
                ))}
              </ul>
            </ModalSection>
          )}
          <div className="mono-data space-y-1.5 border-t border-border/50 pt-4 text-[10px] uppercase tracking-[0.16em] text-[var(--fg-dim)]">
            <p>
              Typed chart specs over computed data · no arbitrary code execution
            </p>
            <p>
              ${result.totalUsage.costUsd.toFixed(4)} ·{" "}
              {result.totalUsage.outputTokens.toLocaleString()} output tokens
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ReportChartCard({
  chartEvent,
  index,
}: {
  chartEvent: DataVizChartEvent;
  index: number;
}) {
  const { chart, rationale } = chartEvent;
  return (
    <article className="grid min-h-full overflow-hidden rounded-lg border border-border bg-background/35">
      <div className="border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mono-data mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.14em] text-primary">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium leading-snug text-foreground">
              {chart.title}
            </h3>
            <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground">
              {chart.subtitle}
            </p>
          </div>
        </div>
      </div>
      <div className="h-44 min-w-0 border-b border-border/50 bg-card/30 p-3">
        <DataVizChartGraphic chart={chart} />
      </div>
      <div className="space-y-2 px-3 py-3">
        <p className="text-xs leading-relaxed text-foreground/85">
          {rationale ?? chart.summary}
        </p>
        {rationale && rationale !== chart.summary && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {chart.summary}
          </p>
        )}
        <p className="mono-data border-t border-border/40 pt-2 text-[9px] uppercase tracking-[0.14em] text-[var(--fg-dim)]">
          {chart.xLabel} · {chart.yLabel}
        </p>
      </div>
    </article>
  );
}

function ReportRunControl({
  complete,
  disabled,
  running,
  onRun,
  onReset,
}: {
  complete: boolean;
  disabled: boolean;
  running: boolean;
  onRun: () => void;
  onReset: () => void;
}) {
  if (complete) {
    return (
      <Button
        onClick={onReset}
        variant="secondary"
        className="h-10 w-full px-4"
      >
        <RotateCcw />
        Reset
      </Button>
    );
  }

  return (
    <Button
      onClick={onRun}
      disabled={running || disabled}
      className="h-10 w-full px-4 shadow-lg shadow-primary/10"
    >
      {running ? (
        <>
          <Loader2 className="animate-spin" />
          Building report
        </>
      ) : (
        <>
          <Play />
          Generate report
        </>
      )}
    </Button>
  );
}
