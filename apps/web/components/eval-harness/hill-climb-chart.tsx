"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { MetricMeta } from "./types";
import {
  AGGREGATE_COLOR,
  BAR_WIDTH,
  CHART,
  METRIC_COLORS,
  VIEWBOX,
  chartStatus,
  linePath,
  metricSegments,
  pointPosition,
  yFor,
  type HillClimbPoint,
  type SegmentTooltip,
} from "./hill-climb-chart-model";

export type { HillClimbPoint } from "./hill-climb-chart-model";

interface Props {
  points: ReadonlyArray<HillClimbPoint>;
  metrics: ReadonlyArray<MetricMeta>;
  running: boolean;
  hasQueuedImprovement: boolean;
}

export function HillClimbChart({
  points,
  metrics,
  running,
  hasQueuedImprovement,
}: Props) {
  const [tooltip, setTooltip] = useState<SegmentTooltip | null>(null);
  const firstPoint = points[0];
  if (!firstPoint) return null;

  const plotted = points.map((point, index) => ({
    ...point,
    ...pointPosition(point.score, index, points.length),
  }));
  const solidPoints = plotted.filter((point) => !point.pending);
  const aggregatePath = linePath(solidPoints);
  const latest = points.at(-1);
  const status = chartStatus({ hasQueuedImprovement, latest, running });

  return (
    <div
      className={cn(
        "panel relative overflow-hidden rounded-lg p-4 transition-all duration-500",
        running &&
          "border-primary/55 shadow-[0_0_0_1px_rgb(204_120_92_/_0.28),0_0_38px_rgb(204_120_92_/_0.16)]",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 bg-primary/[0.045] opacity-0 transition-opacity duration-500",
          running && "opacity-100",
        )}
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Hill climb
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Run eval, improve the prompt, then rerun to climb.
            </p>
          </div>
          <div
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
              running
                ? "border-primary/50 bg-primary/[0.12] text-primary"
                : "border-border bg-background/55 text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                status.tone === "active" && "animate-pulse bg-primary",
                status.tone === "queued" && "bg-primary",
                status.tone === "complete" && "bg-[var(--positive)]",
                status.tone === "idle" && "bg-muted-foreground/70",
              )}
            />
            <span>{status.label}</span>
          </div>
        </div>

        <div className="relative mt-3 rounded-md border border-border/75 bg-background/35">
          <svg
            viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
            className="h-64 w-full sm:h-80"
            role="img"
            aria-label="Hill climb score chart with stacked metric contributions and aggregate score"
            onMouseLeave={() => setTooltip(null)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setTooltip(null);
              }
            }}
          >
            {[0.25, 0.5, 0.75, 1].map((tick) => {
              const y = yFor(tick);
              return (
                <g key={tick}>
                  <line
                    x1={CHART.left}
                    x2={VIEWBOX.width - CHART.right}
                    y1={y}
                    y2={y}
                    stroke="rgb(240 237 227 / 0.08)"
                  />
                  <text
                    x={CHART.left - 9}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-muted-foreground font-mono text-[9px]"
                  >
                    {Math.round(tick * 100)}
                  </text>
                </g>
              );
            })}

            {plotted.map((point) => (
              <g key={`${point.id}-column`}>
                <line
                  x1={point.x}
                  x2={point.x}
                  y1={CHART.top}
                  y2={VIEWBOX.height - CHART.bottom}
                  stroke="rgb(240 237 227 / 0.1)"
                  strokeDasharray={point.pending ? "4 5" : undefined}
                />
                {metricSegments(point, metrics).map((segment) => {
                  const y = yFor(segment.top);
                  const height =
                    segment.contribution > 0
                      ? Math.max(1.5, yFor(segment.bottom) - y)
                      : 0;
                  const tooltipData: SegmentTooltip = {
                    color: segment.color,
                    contribution: segment.contribution,
                    description: segment.metric.description,
                    label: segment.metric.label,
                    runLabel: point.label,
                    score: segment.score,
                    x: point.x,
                    y: y + height / 2,
                  };

                  return (
                    <rect
                      key={segment.metric.key}
                      tabIndex={0}
                      aria-label={`${point.label} ${segment.metric.label} ${(segment.score * 100).toFixed(1)} percent`}
                      x={point.x - BAR_WIDTH / 2}
                      y={y}
                      width={BAR_WIDTH}
                      height={height}
                      rx={segment.roundTop ? 5 : 0}
                      fill={segment.color}
                      opacity="0.86"
                      className="cursor-help outline-none transition-opacity hover:opacity-100 focus:opacity-100"
                      onFocus={() => setTooltip(tooltipData)}
                      onMouseEnter={() => setTooltip(tooltipData)}
                      onMouseMove={() => setTooltip(tooltipData)}
                    />
                  );
                })}
                <text
                  x={point.x}
                  y={VIEWBOX.height - 14}
                  textAnchor="middle"
                  className={cn(
                    "fill-muted-foreground font-mono text-[10px]",
                    point.pending && "opacity-70",
                  )}
                >
                  {point.label}
                </text>
              </g>
            ))}

            {aggregatePath && (
              <>
                <path
                  d={aggregatePath}
                  fill="none"
                  stroke="rgb(204 120 92 / 0.22)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={aggregatePath}
                  fill="none"
                  stroke={AGGREGATE_COLOR}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            )}

            {solidPoints.map((point) => (
              <g key={`${point.id}-aggregate`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="7"
                  fill={AGGREGATE_COLOR}
                  stroke="rgb(13 12 10)"
                  strokeWidth="2.5"
                >
                  <title>Aggregate: {(point.score * 100).toFixed(1)}%</title>
                </circle>
                <text
                  x={point.x}
                  y={point.y - 12}
                  textAnchor="middle"
                  className="fill-foreground font-mono text-[10px] font-semibold"
                >
                  {(point.score * 100).toFixed(0)}%
                </text>
              </g>
            ))}
          </svg>
          {tooltip && <SegmentTooltipCard tooltip={tooltip} />}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <LegendDot color={AGGREGATE_COLOR} label="Aggregate" emphasis />
          {metrics.map((metric, index) => (
            <LegendDot
              key={metric.key}
              color={
                METRIC_COLORS[index % METRIC_COLORS.length] ?? AGGREGATE_COLOR
              }
              label={metric.label}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SegmentTooltipCard({ tooltip }: { tooltip: SegmentTooltip }) {
  return (
    <div
      className="pointer-events-none absolute z-20 w-56 rounded-lg border border-border bg-card/95 p-3 text-xs shadow-2xl shadow-black/35 backdrop-blur-xl"
      style={{
        left: `${(tooltip.x / VIEWBOX.width) * 100}%`,
        top: `${(tooltip.y / VIEWBOX.height) * 100}%`,
        transform:
          tooltip.x > VIEWBOX.width * 0.72
            ? "translate(-105%, -50%)"
            : "translate(10px, -50%)",
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="size-2.5 rounded-full"
          style={{ backgroundColor: tooltip.color }}
        />
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {tooltip.runLabel}
        </p>
      </div>
      <p className="font-medium text-foreground">{tooltip.label}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 font-mono tabular-nums">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Score
          </p>
          <p>{(tooltip.score * 100).toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Contribution
          </p>
          <p>{(tooltip.contribution * 100).toFixed(1)} pts</p>
        </div>
      </div>
      <p className="mt-2 leading-5 text-muted-foreground">
        {tooltip.description}
      </p>
    </div>
  );
}

function LegendDot({
  color,
  label,
  emphasis,
}: {
  color: string;
  label: string;
  emphasis?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span
        className={cn("rounded-full", emphasis ? "size-2.5" : "size-2")}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
