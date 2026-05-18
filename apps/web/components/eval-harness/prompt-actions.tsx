import { Loader2, Play, Sparkles, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CurrentRun } from "./types";

export function PromptEditorFallback() {
  return (
    <div className="panel flex h-full min-h-0 flex-col overflow-hidden rounded-lg">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="truncate font-semibold uppercase tracking-wider text-muted-foreground">
            Hypothesis system prompt
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="shrink-0 text-muted-foreground">Loading editor</span>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center px-4 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" />
          Loading prompt editor
        </span>
      </div>
    </div>
  );
}

export function ImproveErrorMessage({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <p>{error}</p>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

export function PromptActions({
  current,
  totalCases,
  running,
  improving,
  canImprove,
  onRun,
  onCancel,
  onImprove,
}: {
  current: CurrentRun | null;
  totalCases: number;
  running: boolean;
  improving: boolean;
  canImprove: boolean;
  onRun: () => void;
  onCancel: () => void;
  onImprove: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const completed =
    current?.cases.filter((c) => c.status === "complete").length ?? 0;
  const elapsed = current
    ? ((current.completedAt ?? now) - current.startedAt) / 1000
    : 0;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);

  if (running) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          <Loader2 className="mr-1 inline size-3 animate-spin text-primary" />
          <span className="font-semibold text-primary">{completed}</span> /{" "}
          {totalCases} · {elapsed.toFixed(1)}s
        </span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <Square className="size-3" />
          <span className="hidden sm:inline">Cancel</span>
        </Button>
      </div>
    );
  }

  return (
    <>
      {canImprove && (
        <Button
          variant="outline"
          size="sm"
          onClick={onImprove}
          disabled={improving}
        >
          {improving ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
          <span className="hidden sm:inline">Improve</span>
        </Button>
      )}
      <Button size="sm" onClick={onRun} disabled={improving}>
        <Play className="size-3" />
        {current?.phase === "complete" ? "Rerun" : "Run eval"}
      </Button>
    </>
  );
}
