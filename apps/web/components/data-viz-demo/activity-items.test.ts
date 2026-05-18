import { describe, expect, it } from "vitest";
import type { DataVizStreamEvent } from "@novamind/shared/data-viz-events";
import { activityItems } from "./activity-items";

const source = {
  source: "clinicaltrials.gov",
  sourceMode: "r2",
  sourceName: "ClinicalTrials.gov R2 snapshot",
  isFixture: false,
  studyCount: 250,
  outcomeCount: 20340,
  adverseEventCount: 47918,
} satisfies Extract<DataVizStreamEvent, { type: "data_viz_started" }>["source"];

describe("data-viz activity items", () => {
  it("filters startup chatter and keeps the profiled dataset row", () => {
    const items = activityItems([
      {
        type: "data_viz_agent_event",
        phase: "session",
        status: "running",
        label: "Starting report-builder agent",
        ts: 1,
      },
      {
        type: "data_viz_agent_event",
        phase: "session",
        status: "complete",
        label: "Agent SDK session ready",
        ts: 2,
      },
      {
        type: "data_viz_agent_event",
        phase: "data",
        status: "running",
        label: "Loading ClinicalTrials.gov data",
        ts: 3,
      },
      {
        type: "data_viz_started",
        model: "claude-sonnet-4-6",
        source,
        ts: 4,
      },
      {
        type: "data_viz_agent_event",
        phase: "data",
        status: "complete",
        label: "Trial dataset ready",
        ts: 5,
      },
      {
        type: "data_viz_agent_event",
        phase: "data",
        status: "complete",
        label: "Trial dataset profiled",
        detail: "250 studies · 20,340 outcomes · 47,918 adverse-event rows",
        tool: "profile_trial_dataset",
        ts: 6,
      },
    ] satisfies DataVizStreamEvent[]);

    expect(items.map((item) => item.label)).toEqual([
      "Loading ClinicalTrials.gov data",
      "Trial dataset profiled",
    ]);
    expect(items.map((item) => item.icon)).toEqual(["data", "profile"]);
  });

  it("uses one built-chart icon and a separate rendered-chart icon", () => {
    const items = activityItems([
      {
        type: "data_viz_agent_event",
        phase: "chart",
        status: "complete",
        label: "Chart 1 built",
        ts: 1,
      },
      {
        type: "data_viz_agent_event",
        phase: "chart",
        status: "complete",
        label: "Chart 4 built",
        ts: 2,
      },
      {
        type: "data_viz_chart",
        chart: {
          id: "weight-change",
          title: "Weight change",
          subtitle: "Mean change by arm",
          kind: "bar",
          xLabel: "Arm",
          yLabel: "Kilograms",
          points: [{ label: "Semaglutide", value: -14.2 }],
          summary: "Semaglutide reduced weight versus placebo.",
        },
        ts: 3,
      },
      {
        type: "data_viz_chart",
        chart: {
          id: "ae-heatmap",
          title: "Adverse-event heatmap",
          subtitle: "Events by arm",
          kind: "heatmap",
          xLabel: "Arm",
          yLabel: "Event",
          points: [{ label: "Nausea", value: 18, group: "Semaglutide" }],
          summary: "GI events were more common in active arms.",
        },
        ts: 4,
      },
    ] satisfies DataVizStreamEvent[]);

    expect(items.map((item) => item.icon)).toEqual([
      "chartBuilt",
      "chartBuilt",
      "chartRendered",
      "chartRendered",
    ]);
  });

  it("keeps model coordination on the orchestrator icon", () => {
    const items = activityItems([
      {
        type: "data_viz_agent_event",
        phase: "model",
        status: "running",
        label: "Claude is coordinating the visual report",
        ts: 1,
      },
    ] satisfies DataVizStreamEvent[]);

    expect(items).toMatchObject([
      {
        icon: "orchestrator",
        detail: "Preparing the next chart decision or final recommendation.",
      },
    ]);
  });
});
