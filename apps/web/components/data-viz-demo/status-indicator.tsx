import { cn } from "@/lib/utils";
import type { DemoMode, StatusTone } from "./types";

export function StatusPill({
  blocked,
  mode,
}: {
  blocked?: boolean;
  mode: DemoMode;
}) {
  const status = blocked
    ? ({
        label: "Not ready",
        tone: "blocked",
        tooltip:
          "Run the research agent first before generating visualizations.",
      } as const)
    : mode === "running"
      ? ({ label: "Running", tone: "active" } as const)
      : mode === "complete"
        ? ({ label: "Complete", tone: "complete" } as const)
        : mode === "error"
          ? ({ label: "Error", tone: "error" } as const)
          : ({ label: "Ready", tone: "ready" } as const);

  return <StatusIndicator {...status} />;
}

export function StatusIndicator({
  label,
  tone,
  className,
  tooltip,
}: {
  label: string;
  tone: StatusTone;
  className?: string;
  tooltip?: string;
}) {
  const pill = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium tabular-nums transition-[background-color,border-color,box-shadow,color]",
        tone === "active" &&
          "border-primary/65 bg-primary/[0.18] text-primary shadow-[0_0_24px_rgba(204,120,92,0.18)]",
        tone === "queued" && "border-primary/35 bg-primary/[0.07] text-primary",
        tone === "ready" &&
          "border-[var(--positive)]/35 bg-background/55 text-muted-foreground",
        tone === "complete" &&
          "border-[var(--positive)]/45 bg-[var(--positive)]/10 text-[var(--positive)]",
        tone === "idle" &&
          "border-border bg-background/55 text-muted-foreground",
        tone === "blocked" &&
          "border-border bg-background/45 text-muted-foreground",
        tone === "error" &&
          "border-destructive/40 bg-destructive/10 text-destructive",
        className,
      )}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          tone === "active" && "animate-pulse bg-primary",
          tone === "queued" && "bg-primary",
          tone === "ready" && "bg-[var(--positive)]",
          tone === "complete" && "bg-[var(--positive)]",
          tone === "idle" && "bg-muted-foreground/70",
          tone === "blocked" && "bg-muted-foreground/45",
          tone === "error" && "bg-destructive",
        )}
      />
      <span>{label}</span>
    </span>
  );

  if (!tooltip) return pill;

  return (
    <span
      className="group relative inline-flex shrink-0"
      tabIndex={0}
      aria-label={`${label}: ${tooltip}`}
    >
      {pill}
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-[calc(100%+0.5rem)] z-30 w-56 rounded-md border border-border bg-card/95 px-3 py-2 text-left text-xs leading-relaxed text-muted-foreground opacity-0 shadow-2xl shadow-black/30 backdrop-blur-xl transition duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {tooltip}
      </span>
    </span>
  );
}
