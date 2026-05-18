import type { MetricMeta, ScoreMap } from "./types";

export interface HillClimbPoint {
  id: string;
  label: string;
  score: number;
  scores?: ScoreMap;
  pending?: boolean;
}

export interface SegmentTooltip {
  color: string;
  contribution: number;
  description: string;
  label: string;
  runLabel: string;
  score: number;
  x: number;
  y: number;
}

export interface MetricSegment {
  bottom: number;
  color: string;
  contribution: number;
  metric: MetricMeta;
  roundTop: boolean;
  score: number;
  top: number;
}

type ChartStatusTone = "active" | "queued" | "complete" | "idle";

export interface ChartStatus {
  label: string;
  tone: ChartStatusTone;
}

export const VIEWBOX = { width: 720, height: 328 };
export const CHART = { left: 44, right: 26, top: 18, bottom: 42 };
export const BAR_WIDTH = 54;
export const METRIC_COLORS = [
  "rgb(103 194 168)",
  "rgb(226 177 92)",
  "rgb(139 163 225)",
  "rgb(178 202 117)",
];
export const AGGREGATE_COLOR = "rgb(204 120 92)";

export function chartStatus({
  hasQueuedImprovement,
  latest,
  running,
}: {
  hasQueuedImprovement: boolean;
  latest: HillClimbPoint | undefined;
  running: boolean;
}): ChartStatus {
  if (running) {
    return {
      label: "Scoring",
      tone: "active",
    };
  }

  if (hasQueuedImprovement) {
    return {
      label: "Ready to rerun",
      tone: "queued",
    };
  }

  if (latest?.pending) {
    return {
      label: "Ready",
      tone: "idle",
    };
  }

  return {
    label: latest ? `${(latest.score * 100).toFixed(0)}% scored` : "Ready",
    tone: latest ? "complete" : "idle",
  };
}

export function pointPosition(score: number, index: number, count: number) {
  const width = VIEWBOX.width - CHART.left - CHART.right;
  const x =
    count === 1
      ? CHART.left + width / 2
      : CHART.left + (width * index) / (count - 1);
  return { x, y: yFor(score) };
}

/**
 * Convert per-metric scores into stacked bar slices. The aggregate is an
 * unweighted average, so each slice contributes `metricScore / metricCount`
 * points to the total height.
 */
export function metricSegments(
  point: HillClimbPoint,
  metrics: ReadonlyArray<MetricMeta>,
): MetricSegment[] {
  if (!point.scores || point.pending || metrics.length === 0) return [];

  let cumulative = 0;
  const segments = metrics.flatMap((metric, index) => {
    const score = point.scores?.[metric.key];
    if (score === undefined) return [];
    const contribution = clamp01(score) / metrics.length;
    const bottom = cumulative;
    const top = cumulative + contribution;
    cumulative = top;
    return [
      {
        bottom,
        color: METRIC_COLORS[index % METRIC_COLORS.length] ?? AGGREGATE_COLOR,
        contribution,
        metric,
        roundTop: false,
        score,
        top,
      },
    ];
  });
  let visibleTop = -1;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index]?.contribution) {
      visibleTop = index;
      break;
    }
  }
  return segments.map((segment, index) => ({
    ...segment,
    roundTop: index === visibleTop,
  }));
}

export function yFor(score: number): number {
  const height = VIEWBOX.height - CHART.top - CHART.bottom;
  return CHART.top + (1 - clamp01(score)) * height;
}

export function linePath(
  points: ReadonlyArray<{ x: number; y: number }>,
): string {
  if (points.length < 2) return "";
  return points
    .map((point, index) =>
      index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`,
    )
    .join(" ");
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
