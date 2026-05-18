"use client";

import { useEffect, useMemo, useState } from "react";
import type { DataVizStreamEvent } from "@novamind/shared/data-viz-events";
import type { ResearchHandoff } from "@novamind/shared";
import { useAccessGate } from "@/components/access-gate";
import {
  ChartDetailModal,
  ChartFrame,
} from "@/components/data-viz-demo/charts";
import {
  DataVizControlPanel,
  RecommendationModal,
} from "@/components/data-viz-demo/control-panel";
import type {
  DataVizChartEvent,
  DataVizCompleteEvent,
  DemoMode,
} from "@/components/data-viz-demo/types";
import { StopShell } from "@/components/stop-shell";
import {
  isDataVizTerminalEventPayload,
  parseDataVizStreamEvent,
} from "@/lib/client-stream-events";
import { fetchDemoApi, responseNeedsAccess } from "@/lib/demo-api-fetch";
import {
  clearCachedDataVizRun,
  readCachedDataVizRun,
  readCachedResearchRun,
  researchHandoffFromCachedRun,
  writeCachedDataVizRun,
} from "@/lib/demo-run-cache";
import { readJsonSseStream } from "@/lib/sse-client";
import { useAbortableRequest } from "@/lib/use-abortable-request";

export function Stage06() {
  return (
    <StopShell slug="06-data-visualization-demo" wide>
      <DataVizLiveDemo />
    </StopShell>
  );
}

function DataVizLiveDemo() {
  const { requireAccess, showLogin } = useAccessGate();
  const { abortCurrent, clearCurrent, startRequest } = useAbortableRequest();
  const [mode, setMode] = useState<DemoMode>("idle");
  const [events, setEvents] = useState<DataVizStreamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [chartModalOpen, setChartModalOpen] = useState(false);
  const [selectedChart, setSelectedChart] = useState<
    DataVizChartEvent | undefined
  >(undefined);
  const [researchHandoff, setResearchHandoff] = useState<
    ResearchHandoff | undefined
  >(undefined);

  const chartEvents = useMemo(
    () =>
      events.filter(
        (event): event is DataVizChartEvent => event.type === "data_viz_chart",
      ),
    [events],
  );
  const result = events.find(
    (event): event is DataVizCompleteEvent =>
      event.type === "data_viz_complete",
  );

  useEffect(() => {
    const handoff = researchHandoffFromCachedRun(readCachedResearchRun());
    setResearchHandoff(handoff);
    const cached = readCachedDataVizRun();
    if (
      cached &&
      handoff &&
      cached.researchHandoff.completedAt === handoff.completedAt
    ) {
      setEvents(cached.events);
      setMode("complete");
    }
  }, []);

  async function run() {
    if (mode === "running") return;
    if (!requireAccess()) return;
    if (!researchHandoff) {
      setError(
        "Run the research agent first before generating visualizations.",
      );
      setMode("idle");
      return;
    }

    const controller = startRequest();

    setMode("running");
    setEvents([]);
    setError(null);
    setResultModalOpen(false);
    setChartModalOpen(false);
    setSelectedChart(undefined);

    let streamError: string | null = null;
    try {
      const runEvents: DataVizStreamEvent[] = [];
      const res = await fetchDemoApi("/api/data-viz/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: researchHandoff.question,
          researchHandoff,
        }),
        signal: controller.signal,
      });

      if (responseNeedsAccess(res)) {
        setMode("idle");
        showLogin({ resetAccessHint: true });
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
      }
      if (!res.body) throw new Error("No response body");

      let sawComplete = false;

      await readJsonSseStream({
        body: res.body,
        isTerminalEventPayload: isDataVizTerminalEventPayload,
        parseEvent: parseDataVizStreamEvent,
        streamName: "data-viz-stream",
        onEvent: (event) => {
          if (event.type === "data_viz_error") {
            streamError = event.message;
            controller.abort();
            return;
          }
          if (event.type === "data_viz_complete") {
            sawComplete = true;
            setResultModalOpen(true);
          }
          runEvents.push(event);
          setEvents([...runEvents]);
        },
      });

      if (streamError) throw new Error(streamError);
      if (!sawComplete)
        throw new Error("Data-viz stream ended before completion.");
      writeCachedDataVizRun({
        completedAt: Date.now(),
        events: runEvents,
        researchHandoff,
      });
      setMode("complete");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        if (streamError) {
          setError(streamError);
          setMode("error");
        }
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setMode("error");
    } finally {
      clearCurrent(controller);
    }
  }

  function reset() {
    abortCurrent();
    clearCachedDataVizRun();
    setEvents([]);
    setError(null);
    setMode("idle");
    setResultModalOpen(false);
    setChartModalOpen(false);
    setSelectedChart(undefined);
  }

  const running = mode === "running";

  return (
    <div className="min-w-0">
      <div className="grid min-w-0 gap-4 lg:h-[clamp(20.5rem,calc(100dvh-24.5rem),40rem)] lg:grid-cols-[minmax(0,1fr)_23rem]">
        <DataVizControlPanel
          className="lg:order-2"
          mode={mode}
          events={events}
          result={result}
          error={error}
          researchHandoff={researchHandoff}
          running={running}
          onRun={run}
          onReset={reset}
          onOpenResult={() => setResultModalOpen(true)}
        />

        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:order-1 lg:min-h-0 lg:grid-rows-2">
          {[0, 1, 2, 3].map((index) => (
            <ChartFrame
              key={index}
              chart={chartEvents[index]?.chart}
              slotIndex={index}
              onOpen={
                chartEvents[index]
                  ? () => {
                      setSelectedChart(chartEvents[index]);
                      setChartModalOpen(true);
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      <RecommendationModal
        chartEvents={chartEvents}
        open={resultModalOpen && Boolean(result)}
        result={result}
        onClose={() => setResultModalOpen(false)}
      />
      <ChartDetailModal
        open={chartModalOpen}
        chart={selectedChart?.chart}
        rationale={selectedChart?.rationale}
        onClose={() => setChartModalOpen(false)}
      />
    </div>
  );
}
