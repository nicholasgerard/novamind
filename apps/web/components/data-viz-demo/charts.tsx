import type { DataVizChart } from "@novamind/shared/data-viz-events";
import {
  Activity,
  BarChart3,
  LineChart as LineChartIcon,
  PieChart,
  type LucideIcon,
} from "lucide-react";
import { Modal, ModalSection, ModalTitle } from "@/components/ui/modal";
import { TileHoverArrow, TileHoverOverlay } from "@/components/ui/tile-hover";
import { cn } from "@/lib/utils";
import { formatValue, truncate } from "./format";

const EMPTY_SLOT_ICONS: LucideIcon[] = [
  LineChartIcon,
  BarChart3,
  Activity,
  PieChart,
];

export function ChartFrame({
  chart,
  onOpen,
  slotIndex = 0,
}: {
  chart: DataVizChart | undefined;
  onOpen?: () => void;
  slotIndex?: number;
}) {
  const canOpen = Boolean(chart && onOpen);
  const className = cn(
    "group relative flex min-h-[16rem] min-w-0 flex-col overflow-hidden rounded-lg border border-foreground/12 bg-background/35 p-4 text-left transition duration-200 lg:h-full lg:min-h-[8.5rem]",
    canOpen &&
      "cursor-pointer hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-lg hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-4 focus-visible:ring-offset-background",
  );
  const content = (
    <>
      {canOpen && <TileHoverOverlay className="bg-primary/[0.045]" />}
      <ChartHeader chart={chart} canOpen={canOpen} />
      <ChartBody chart={chart} slotIndex={slotIndex} />
    </>
  );

  if (canOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={className}
        aria-label={`Open ${chart!.title} chart details`}
      >
        {content}
      </button>
    );
  }

  return <section className={className}>{content}</section>;
}

export function ChartDetailModal({
  chart,
  open,
  rationale,
  onClose,
}: {
  chart: DataVizChart | undefined;
  open: boolean;
  rationale?: string;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <ModalTitle
          icon={BarChart3}
          title={chart?.title ?? "Chart"}
          description={chart?.subtitle}
        />
      }
      className="max-w-5xl"
    >
      {chart && (
        <div className="space-y-4">
          <div className="h-[min(52vh,30rem)] rounded-lg border border-border bg-background/35 p-4">
            <DataVizChartGraphic chart={chart} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ModalSection eyebrow="Summary">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {chart.summary}
              </p>
            </ModalSection>
            <ModalSection eyebrow="Agent rationale">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {rationale ?? chart.summary}
              </p>
            </ModalSection>
          </div>
          {chart.sourceNote && (
            <ModalSection eyebrow="Source note">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {chart.sourceNote}
              </p>
            </ModalSection>
          )}
          <p className="mono-data border-t border-border/50 pt-4 text-[10px] uppercase tracking-[0.16em] text-[var(--fg-dim)]">
            {chart.xLabel} · {chart.yLabel}
          </p>
        </div>
      )}
    </Modal>
  );
}

function ChartHeader({
  chart,
  canOpen,
}: {
  chart: DataVizChart | undefined;
  canOpen: boolean;
}) {
  return (
    <div className="relative flex shrink-0 items-start justify-between gap-3">
      <div className={cn("min-w-0 flex-1", canOpen && "pr-6")}>
        <p className="mono-data truncate text-[11px] uppercase text-[var(--fg-dim)]">
          {chart?.title ?? "Waiting for agent"}
        </p>
      </div>
      {canOpen && (
        <TileHoverArrow className="pointer-events-none absolute right-0 top-0 size-3.5" />
      )}
    </div>
  );
}

function ChartBody({
  chart,
  slotIndex = 0,
}: {
  chart: DataVizChart | undefined;
  slotIndex?: number;
}) {
  const Icon =
    EMPTY_SLOT_ICONS[slotIndex % EMPTY_SLOT_ICONS.length] ?? BarChart3;
  return (
    <div className="relative mt-3 min-h-0 min-w-0 flex-1 overflow-hidden">
      {chart ? (
        <div className="h-full soft-enter">
          <DataVizChartGraphic chart={chart} />
        </div>
      ) : (
        <div className="grid h-full place-items-center rounded-md border border-dashed border-border/70">
          <Icon
            aria-hidden
            className="size-10 text-foreground/15"
            strokeWidth={1.25}
          />
        </div>
      )}
    </div>
  );
}

export function DataVizChartGraphic({ chart }: { chart: DataVizChart }) {
  if (chart.kind === "horizontal_bar")
    return <HorizontalBarChart chart={chart} />;
  if (chart.kind === "line") return <LineChart chart={chart} />;
  if (chart.kind === "heatmap") return <HeatmapChart chart={chart} />;
  return <BarChart chart={chart} />;
}

function chartAriaLabel(chart: DataVizChart): string {
  return `${chart.title}: ${chart.subtitle}`;
}

function HorizontalBarChart({ chart }: { chart: DataVizChart }) {
  const points = chart.points.slice(0, 8);
  const values = points.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const x = (value: number) => 94 + ((value - min) / range) * 214;
  const zero = x(0);
  return (
    <svg
      viewBox="0 0 360 190"
      className="h-full w-full"
      role="img"
      aria-label={chartAriaLabel(chart)}
    >
      <line
        x1={zero}
        x2={zero}
        y1="16"
        y2="156"
        stroke="#6b665e"
        strokeDasharray="4 4"
      />
      {points.map((point, index) => {
        const y = 24 + index * 18;
        const vx = x(point.value);
        return (
          <g key={`${point.label}-${index}`}>
            <text x="8" y={y + 4} fill="#a6a199" fontSize="9">
              {truncate(point.label, 16)}
            </text>
            <rect
              x={Math.min(zero, vx)}
              y={y - 7}
              width={Math.max(2, Math.abs(vx - zero))}
              height="10"
              rx="2"
              fill={point.value < 0 ? "#cc785c" : "#f0ede3"}
              opacity="0.86"
            />
            <text x="318" y={y + 4} fill="#a6a199" fontSize="9">
              {formatValue(point.value)}
            </text>
          </g>
        );
      })}
      <text x="94" y="178" fill="#6b665e" fontSize="10">
        {chart.xLabel}
      </text>
    </svg>
  );
}

function BarChart({ chart }: { chart: DataVizChart }) {
  const points = chart.points.slice(0, 8);
  const max = Math.max(1, ...points.map((point) => point.value));
  const barW = 260 / Math.max(1, points.length);
  return (
    <svg
      viewBox="0 0 360 190"
      className="h-full w-full"
      role="img"
      aria-label={chartAriaLabel(chart)}
    >
      <line x1="44" x2="326" y1="154" y2="154" stroke="#2a2723" />
      <line x1="44" x2="44" y1="18" y2="154" stroke="#2a2723" />
      {points.map((point, index) => {
        const h = (point.value / max) * 118;
        const x = 56 + index * barW;
        return (
          <g key={`${point.label}-${index}`}>
            <rect
              x={x}
              y={154 - h}
              width={Math.max(12, barW - 12)}
              height={h}
              rx="3"
              fill="#f0ede3"
              opacity="0.82"
            />
            <text x={x} y="174" fill="#6b665e" fontSize="9">
              {truncate(point.label, 8)}
            </text>
          </g>
        );
      })}
      <text x="222" y="30" fill="#a6a199" fontSize="10">
        {chart.yLabel}
      </text>
    </svg>
  );
}

function LineChart({ chart }: { chart: DataVizChart }) {
  const points = chart.points.slice(0, 12);
  const max = Math.max(1, ...points.map((point) => point.value));
  const x = (index: number) =>
    42 + (index / Math.max(1, points.length - 1)) * 282;
  const y = (value: number) => 154 - (value / max) * 120;
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.value)}`,
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 360 190"
      className="h-full w-full"
      role="img"
      aria-label={chartAriaLabel(chart)}
    >
      <line x1="38" x2="330" y1="154" y2="154" stroke="#2a2723" />
      <line x1="38" x2="38" y1="20" y2="154" stroke="#2a2723" />
      <path d={path} fill="none" stroke="#cc785c" strokeWidth="2.5" />
      {points.map((point, index) => (
        <circle
          key={`${point.label}-${index}`}
          cx={x(index)}
          cy={y(point.value)}
          r="3.5"
          fill="#f0ede3"
        />
      ))}
      <text x="38" y="176" fill="#6b665e" fontSize="10">
        {points[0]?.label}
      </text>
      <text x="286" y="176" fill="#6b665e" fontSize="10">
        {points[points.length - 1]?.label}
      </text>
    </svg>
  );
}

function HeatmapChart({ chart }: { chart: DataVizChart }) {
  const rows = [...new Set(chart.points.map((point) => point.label))].slice(
    0,
    6,
  );
  const cols = [
    ...new Set(chart.points.map((point) => point.group ?? "")),
  ].slice(0, 5);
  const max = Math.max(1, ...chart.points.map((point) => point.value));
  return (
    <svg
      viewBox="0 0 360 190"
      className="h-full w-full"
      role="img"
      aria-label={chartAriaLabel(chart)}
    >
      {rows.map((row, rowIndex) => (
        <g key={row}>
          <text x="8" y={36 + rowIndex * 22} fill="#a6a199" fontSize="9">
            {truncate(row, 12)}
          </text>
          {cols.map((col, colIndex) => {
            const value =
              chart.points.find(
                (point) => point.label === row && point.group === col,
              )?.value ?? 0;
            return (
              <rect
                key={col}
                x={86 + colIndex * 44}
                y={24 + rowIndex * 22}
                width="36"
                height="16"
                rx="3"
                fill="#f0ede3"
                opacity={0.08 + (value / max) * 0.72}
              />
            );
          })}
        </g>
      ))}
    </svg>
  );
}
