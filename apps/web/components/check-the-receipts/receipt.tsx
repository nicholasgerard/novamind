"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  formatLatency,
  formatNumber,
  formatTokens,
  formatUsd,
} from "@/lib/format";
import type {
  ModelTier,
  ReceiptAgent,
  ReceiptData,
  ReceiptStage,
} from "./types";

export function Receipt({ data }: { data: ReceiptData }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const fallbackId = useFallbackRunId();
  const runId = data.runId ?? fallbackId;

  const dateLabel = data.completedAt
    ? new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        timeZone: "UTC",
      }).format(data.completedAt)
    : null;
  const timeLabel = data.completedAt
    ? new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
      }).format(data.completedAt)
    : null;

  return (
    <div className="mx-auto max-w-2xl">
      <article className="panel relative p-8 sm:p-12">
        <PerforatedEdge />

        <header className="border-b border-dashed border-border pb-6 text-center">
          <h2 className="mono-data text-sm uppercase tracking-[0.18em] text-foreground">
            Claude&apos;s research shop
          </h2>
          <p className="mono-data mt-2 text-[11px] text-muted-foreground">
            {dateLabel && timeLabel
              ? `${dateLabel} / ${timeLabel} UTC`
              : "Awaiting demo run"}
          </p>
          <p className="mono-data mt-1 text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">
            No. {runId}
          </p>
        </header>

        <section className="border-b border-dashed border-border py-5">
          <QueryCard query={data.query} />
        </section>

        <section className="border-b border-dashed border-border py-5">
          <div className="mono-data mb-3 grid grid-cols-[1fr_3.25rem_4.75rem] gap-3 px-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <span>Item</span>
            <span className="text-right">Time</span>
            <span className="text-right">Cost</span>
          </div>
          <div className="mb-4 h-px w-full bg-border/35" />

          <AgentSection
            agent={data.literature}
            activeKey={activeKey}
            setActiveKey={setActiveKey}
          />
          <div className="my-5 h-px w-full bg-border/35" />
          <AgentSection
            agent={data.viz}
            activeKey={activeKey}
            setActiveKey={setActiveKey}
          />
        </section>

        <ReceiptSummary data={data} />

        <footer className="border-t border-dashed border-border pt-5 text-center">
          <p className="mono-data text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Thank you for using your models responsibly.
          </p>
        </footer>

        <PerforatedEdge bottom />
      </article>
    </div>
  );
}

function QueryCard({ query }: { query: string | undefined }) {
  const hasQuery = Boolean(query);
  return (
    <figure
      className="relative mx-auto max-w-[34rem] px-4 py-7 text-center"
      aria-label="User query"
    >
      <div
        aria-hidden
        className="mono-data pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 select-none text-[5.5rem] leading-none text-primary/15"
      >
        &ldquo;
      </div>
      <blockquote
        className={cn(
          "relative pt-9 text-xl font-light leading-relaxed text-balance",
          hasQuery ? "text-foreground/90" : "text-muted-foreground/85",
        )}
      >
        {query ?? "Run the demos to print the question here."}
      </blockquote>
    </figure>
  );
}

function AgentSection({
  agent,
  activeKey,
  setActiveKey,
}: {
  agent: ReceiptAgent;
  activeKey: string | null;
  setActiveKey: (key: string | null) => void;
}) {
  return (
    <div>
      <div className="mono-data mb-2 px-3 text-[10px] uppercase tracking-[0.2em]">
        <span className="text-foreground/85">{agent.label}</span>
      </div>
      <ul className="space-y-1">
        {agent.stages.map((stage) => (
          <StageRow
            key={stage.key}
            stage={stage}
            active={activeKey === stage.key}
            onActivate={() => setActiveKey(stage.key)}
            onDeactivate={() => setActiveKey(null)}
          />
        ))}
      </ul>
      <div className="mono-data mt-3 flex items-baseline justify-between px-3 pt-2 text-[11px] text-muted-foreground">
        <span>{agent.label} subtotal</span>
        <span className="text-foreground/85">
          {agent.totalCostUsd !== undefined
            ? formatUsd(agent.totalCostUsd, { precise: true })
            : placeholder(`${agent.label} subtotal pending`)}
        </span>
      </div>
    </div>
  );
}

function StageRow({
  stage,
  active,
  onActivate,
  onDeactivate,
}: {
  stage: ReceiptStage;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const colors = tierColors(stage.modelTier);
  const costUsd = stage.costUsd;
  const costHasValue = costUsd !== undefined && Number.isFinite(costUsd);
  return (
    <li className="relative">
      <button
        type="button"
        onMouseEnter={onActivate}
        onMouseLeave={onDeactivate}
        onFocus={onActivate}
        onBlur={onDeactivate}
        aria-expanded={active}
        className={cn(
          "mono-data relative grid w-full grid-cols-[1fr_3.25rem_4.75rem] items-baseline gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150",
          "hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] focus-visible:outline-none",
          active && "bg-foreground/[0.06]",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-1.5 left-0 w-[2px] rounded-full transition-opacity duration-150",
            colors.bar,
            active ? "opacity-100" : "opacity-0",
          )}
        />
        <div className="min-w-0">
          <p className="text-foreground">{stage.label}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {stage.model}
          </p>
        </div>
        <span
          className={cn(
            "text-right",
            stage.latencyMs !== undefined
              ? "text-foreground/80"
              : "text-muted-foreground",
          )}
        >
          {stage.latencyMs !== undefined
            ? formatLatency(stage.latencyMs)
            : placeholder(`${stage.label} time pending`)}
        </span>
        <span
          className={cn(
            "text-right",
            costHasValue && stage.costUsd! > 0
              ? "text-foreground"
              : "text-muted-foreground",
          )}
        >
          {costHasValue
            ? formatUsd(costUsd, { precise: true })
            : placeholder(`${stage.label} cost pending`)}
        </span>
      </button>
      {active ? <StagePopover stage={stage} /> : null}
    </li>
  );
}

function StagePopover({ stage }: { stage: ReceiptStage }) {
  const colors = tierColors(stage.modelTier);
  const inputTokens = stage.inputTokens ?? 0;
  const outputTokens = stage.outputTokens ?? 0;
  const tokensKnown =
    stage.isLlm &&
    stage.inputTokens !== undefined &&
    stage.outputTokens !== undefined;
  const cached = stage.cacheReadTokens ?? 0;
  const totalTokens = tokensKnown ? inputTokens + outputTokens + cached : 0;

  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-30",
        "left-1/2 top-full mt-2 w-[min(22rem,calc(100vw-3rem))] -translate-x-1/2",
        "lg:left-full lg:top-1/2 lg:mt-0 lg:ml-4 lg:w-80 lg:translate-x-0 lg:-translate-y-1/2",
        "soft-enter",
      )}
    >
      <div className="panel rounded-lg p-4 shadow-[0_18px_44px_-24px_rgb(0_0_0_/0.7)] backdrop-blur-md">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium leading-tight text-foreground">
            {stage.label}
          </p>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {stage.caption}
        </p>

        <div className="mt-3 flex items-center gap-2">
          {stage.isLlm ? (
            <span
              className={cn(
                "mono-data inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em]",
                colors.pillBorder,
                colors.pillBg,
                colors.pillText,
              )}
            >
              <span className={cn("size-1.5 rounded-full", colors.bar)} />
              {stage.model}
            </span>
          ) : (
            <span className="mono-data inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background/60 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground/60" />
              {stage.model}
            </span>
          )}
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-foreground/95">
          {stage.rationale}
        </p>

        {stage.isLlm && tokensKnown ? (
          <div className="mono-data mt-4 space-y-1.5 border-t border-dashed border-border/70 pt-3 text-[11px] text-muted-foreground">
            <TokenRow label="Input" value={inputTokens} />
            <TokenRow label="Output" value={outputTokens} />
            <TokenRow
              label="Cached"
              value={cached}
              tone="positive"
              suffix={
                totalTokens > 0
                  ? `${Math.round((cached / totalTokens) * 100)}% of total`
                  : undefined
              }
            />
          </div>
        ) : !stage.isLlm ? (
          <p className="mono-data mt-4 border-t border-dashed border-border/70 pt-3 text-[11px] text-muted-foreground">
            No tokens billed - this step never touches a model.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TokenRow({
  label,
  value,
  tone = "default",
  suffix,
}: {
  label: string;
  value: number;
  tone?: "default" | "positive";
  suffix?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span
        className={cn(
          "text-right",
          tone === "positive" ? "text-[var(--positive)]" : "text-foreground/85",
        )}
      >
        {formatNumber(value)}
        {suffix ? (
          <span className="ml-2 text-muted-foreground">{suffix}</span>
        ) : null}
      </span>
    </div>
  );
}

function ReceiptSummary({ data }: { data: ReceiptData }) {
  const hasSavings =
    data.uncachedTotalCostUsd !== undefined &&
    data.cacheSavingsUsd !== undefined &&
    data.cacheSavingsUsd > 0;
  const discountLabel = hasSavings
    ? `${formatDiscountPercent(data.cacheSavingsUsd!, data.uncachedTotalCostUsd!)} discount applied!`
    : undefined;

  return (
    <section className="py-6">
      <div className="mono-data px-3">
        <div className="space-y-2.5 text-sm">
          {hasSavings ? (
            <>
              <SummaryLine
                label="Subtotal"
                value={
                  <span className="text-muted-foreground line-through decoration-border decoration-2">
                    {formatUsd(data.uncachedTotalCostUsd!, { precise: true })}
                  </span>
                }
              />
              <SummaryLine
                label="Discount"
                detail={
                  data.totalCachedTokens !== undefined
                    ? `${formatTokens(data.totalCachedTokens)} cached tokens`
                    : undefined
                }
                value={
                  <span className="font-semibold text-[var(--positive)]">
                    -{formatUsd(data.cacheSavingsUsd!, { precise: true })}
                  </span>
                }
              />
            </>
          ) : data.totalCachedTokens !== undefined ? (
            <SummaryLine
              label="Prompt caching"
              value={`${formatTokens(data.totalCachedTokens)} cached tokens`}
            />
          ) : null}

          <div className="mt-4 border-t border-dashed border-border pt-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Total
                </p>
                {hasSavings ? (
                  <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[var(--positive)]">
                    {discountLabel}
                  </p>
                ) : null}
              </div>
              <p className="text-right text-3xl font-semibold leading-none text-primary sm:text-[34px]">
                {data.totalCostUsd !== undefined
                  ? formatUsd(data.totalCostUsd, { precise: true })
                  : placeholder("Total cost pending")}
              </p>
            </div>
          </div>

          <div className="mt-4 border-t border-dashed border-border/70 pt-4">
            <WallClockStopwatch data={data} />
          </div>
        </div>
      </div>
    </section>
  );
}

function formatDiscountPercent(
  savingsUsd: number,
  uncachedTotalCostUsd: number,
): string {
  if (!Number.isFinite(savingsUsd) || !Number.isFinite(uncachedTotalCostUsd)) {
    return "0%";
  }
  if (uncachedTotalCostUsd <= 0) return "0%";
  const percent = (savingsUsd / uncachedTotalCostUsd) * 100;
  return `${percent >= 10 ? Math.round(percent) : percent.toFixed(1)}%`;
}

function SummaryLine({
  label,
  detail,
  value,
}: {
  label: string;
  detail?: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="min-w-0 text-muted-foreground">
        {label}
        {detail ? (
          <span className="ml-2 text-[11px] text-muted-foreground/70">
            {detail}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-right text-foreground">{value}</span>
    </div>
  );
}

function placeholder(label: string) {
  return <MetricPlaceholder label={label} />;
}

function MetricPlaceholder({ label }: { label: string }) {
  return (
    <span
      aria-label={label}
      className="inline-flex h-[0.78em] min-w-[0.72em] items-center justify-start align-baseline text-left"
    >
      <span
        aria-hidden="true"
        className="block h-[0.08em] w-[0.58em] rounded-full bg-current opacity-55"
      />
    </span>
  );
}

function PerforatedEdge({ bottom = false }: { bottom?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-0 right-0 h-4",
        bottom ? "-bottom-2" : "-top-2",
      )}
      style={{
        backgroundImage:
          "radial-gradient(circle at 11px 8px, var(--background) 6.5px, transparent 7px)",
        backgroundSize: "24px 16px",
        backgroundRepeat: "repeat-x",
      }}
    />
  );
}

function useFallbackRunId(): string {
  const reactId = useId();
  const digits = reactId.replace(/\D/g, "");
  const padded = (digits + "000000").slice(0, 6);
  return `NM-${padded}`;
}

interface TierColors {
  bar: string;
  pillBorder: string;
  pillBg: string;
  pillText: string;
}

function WallClockStopwatch({ data }: { data: ReceiptData }) {
  if (data.endToEndMs === undefined) {
    return (
      <div className="flex flex-col items-center gap-2 py-1">
        {placeholder("Wall clock pending")}
        <p className="mono-data text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Wall clock
        </p>
      </div>
    );
  }
  const seconds = data.endToEndMs / 1000;
  // Map elapsed seconds onto a single sweep of the stopwatch hand; one
  // revolution per minute so the position is intuitive for typical demo runs.
  const sweepFraction = (seconds % 60) / 60;
  const angle = sweepFraction * 360 - 90;
  const handX = 32 + Math.cos((angle * Math.PI) / 180) * 18;
  const handY = 34 + Math.sin((angle * Math.PI) / 180) * 18;
  return (
    <div className="flex flex-col items-center gap-2 py-1 text-muted-foreground">
      <svg
        viewBox="0 0 64 64"
        className="size-16"
        role="img"
        aria-label={`Stopwatch showing ${formatLatency(data.endToEndMs)}`}
      >
        <rect x="28" y="2" width="8" height="4" rx="1" fill="currentColor" />
        <line
          x1="32"
          y1="6"
          x2="32"
          y2="9"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="32"
          cy="34"
          r="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {[0, 90, 180, 270].map((deg) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          const x1 = 32 + Math.cos(rad) * 21;
          const y1 = 34 + Math.sin(rad) * 21;
          const x2 = 32 + Math.cos(rad) * 23;
          const y2 = 34 + Math.sin(rad) * 23;
          return (
            <line
              key={deg}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="currentColor"
              strokeWidth="1.25"
              opacity={0.55}
            />
          );
        })}
        <line
          x1="32"
          y1="34"
          x2={handX}
          y2={handY}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          className="text-foreground"
        />
        <circle
          cx="32"
          cy="34"
          r="1.75"
          fill="currentColor"
          className="text-foreground"
        />
      </svg>
      <span className="font-mono text-base tabular-nums text-foreground">
        {formatLatency(data.endToEndMs)}
      </span>
      <p className="mono-data text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Wall clock
      </p>
    </div>
  );
}

function tierColors(tier: ModelTier): TierColors {
  switch (tier) {
    case "large":
      return {
        bar: "bg-primary",
        pillBorder: "border-primary/45",
        pillBg: "bg-primary/10",
        pillText: "text-primary",
      };
    case "medium":
      return {
        bar: "bg-[#7c9e7e]",
        pillBorder: "border-[#7c9e7e]/45",
        pillBg: "bg-[#7c9e7e]/10",
        pillText: "text-[#a8c3a8]",
      };
    case "small":
      return {
        bar: "bg-foreground/70",
        pillBorder: "border-foreground/30",
        pillBg: "bg-foreground/[0.06]",
        pillText: "text-foreground",
      };
    case "none":
      return {
        bar: "bg-muted-foreground/60",
        pillBorder: "border-border",
        pillBg: "bg-background/60",
        pillText: "text-muted-foreground",
      };
  }
}
