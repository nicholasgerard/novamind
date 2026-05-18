import type { DataVizStreamEvent } from "@novamind/shared/data-viz-events";

export type DemoMode = "idle" | "running" | "complete" | "error";

export type DataVizChartEvent = Extract<
  DataVizStreamEvent,
  { type: "data_viz_chart" }
>;

export type DataVizAgentEvent = Extract<
  DataVizStreamEvent,
  { type: "data_viz_agent_event" }
>;

export type DataVizToolCallEvent = Extract<
  DataVizStreamEvent,
  { type: "data_viz_tool_call" }
>;

export type DataVizToolResultEvent = Extract<
  DataVizStreamEvent,
  { type: "data_viz_tool_result" }
>;

export type DataVizStepEvent = Extract<
  DataVizStreamEvent,
  { type: "data_viz_step" }
>;

export type DataVizStartedEvent = Extract<
  DataVizStreamEvent,
  { type: "data_viz_started" }
>;

export type DataVizCompleteEvent = Extract<
  DataVizStreamEvent,
  { type: "data_viz_complete" }
>;

export type StatusTone =
  | "active"
  | "queued"
  | "ready"
  | "complete"
  | "idle"
  | "blocked"
  | "error";
