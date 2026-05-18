"use client";

import { useState } from "react";
import { failureOrder, failures } from "@/components/single-turn-evals/content";
import { FailureVisual } from "@/components/single-turn-evals/failure-visuals";
import type { FailureKey } from "@/components/single-turn-evals/types";
import { StopShell } from "@/components/stop-shell";
import { useSlidingTabIndicator } from "@/components/ui/use-sliding-tab-indicator";
import { cn } from "@/lib/utils";

export function Stage03() {
  const [active, setActive] = useState<FailureKey>("cascade");
  const {
    containerRef: tabListRef,
    indicator,
    registerTab,
  } = useSlidingTabIndicator(active);
  const failure = failures[active];

  return (
    <StopShell slug="03-single-turn-evals">
      <div className="flex w-full justify-center">
        <div
          ref={tabListRef}
          role="tablist"
          aria-label="Single-turn eval failure modes"
          className="panel-muted relative flex w-full max-w-full flex-col items-stretch gap-1 overflow-hidden rounded-xl p-1.5 sm:inline-flex sm:w-auto sm:flex-row sm:items-center sm:rounded-full"
        >
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute left-0 top-0 z-0 rounded-lg bg-foreground/[0.07] transition-[height,opacity,transform,width] duration-300 ease-out motion-reduce:transition-none sm:rounded-full",
              indicator.ready ? "opacity-100" : "opacity-0",
            )}
            style={{
              height: indicator.height,
              transform: `translate3d(${indicator.x}px, ${indicator.y}px, 0)`,
              width: indicator.width,
            }}
          />
          {failureOrder.map((key) => {
            const f = failures[key];
            const isActive = key === active;
            const Icon = f.icon;
            return (
              <button
                type="button"
                key={key}
                role="tab"
                id={`single-turn-tab-${key}`}
                aria-controls={`single-turn-panel-${key}`}
                aria-selected={isActive}
                ref={registerTab(key)}
                onClick={() => setActive(key)}
                className={cn(
                  "relative z-10 flex w-full items-center justify-start gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-colors sm:w-auto sm:justify-center sm:rounded-full sm:px-5 sm:py-2",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground sm:hover:text-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0 text-[var(--warning)]" />
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <article
        role="tabpanel"
        id={`single-turn-panel-${active}`}
        aria-labelledby={`single-turn-tab-${active}`}
        className="panel flex min-w-0 flex-col overflow-hidden rounded-2xl p-6 sm:h-[28rem] sm:p-8"
      >
        <div key={active} className="soft-enter flex h-full min-h-0 flex-col">
          <p className="text-lg font-semibold text-foreground sm:text-xl">
            {failure.title}
          </p>
          <p className="mt-3 max-w-2xl text-balance text-sm leading-relaxed text-muted-foreground sm:min-h-[2.75rem]">
            {failure.body}
          </p>
          <div className="mt-5 flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <FailureVisual active={active} />
          </div>
        </div>
      </article>
    </StopShell>
  );
}
