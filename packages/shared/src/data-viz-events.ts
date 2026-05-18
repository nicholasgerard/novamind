import { z } from "zod";
import { TokenUsageSchema } from "./events";

export const DataVizChartKindSchema = z.enum([
  "bar",
  "horizontal_bar",
  "line",
  "scatter",
  "heatmap",
]);
export type DataVizChartKind = z.infer<typeof DataVizChartKindSchema>;

export const DataVizChartPointSchema = z.object({
  label: z.string(),
  value: z.number(),
  group: z.string().optional(),
  secondaryValue: z.number().optional(),
  low: z.number().optional(),
  high: z.number().optional(),
});
export type DataVizChartPoint = z.infer<typeof DataVizChartPointSchema>;

export const DataVizChartSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  kind: DataVizChartKindSchema,
  xLabel: z.string(),
  yLabel: z.string(),
  points: z.array(DataVizChartPointSchema),
  summary: z.string(),
  sourceNote: z.string().optional(),
});
export type DataVizChart = z.infer<typeof DataVizChartSchema>;

export const DataVizSourceSummarySchema = z.object({
  source: z.string(),
  sourceMode: z.enum(["r2", "local", "fixture"]),
  sourceName: z.string(),
  isFixture: z.boolean(),
  sourceDataTimestamp: z.string().optional(),
  studyCount: z.number().int().nonnegative(),
  outcomeCount: z.number().int().nonnegative(),
  adverseEventCount: z.number().int().nonnegative(),
});
export type DataVizSourceSummary = z.infer<typeof DataVizSourceSummarySchema>;

export const DataVizAgentEventSchema = z.object({
  type: z.literal("data_viz_agent_event"),
  phase: z.enum([
    "data",
    "session",
    "model",
    "tool",
    "chart",
    "recovery",
    "complete",
  ]),
  status: z.enum(["running", "complete", "error"]),
  label: z.string(),
  detail: z.string().optional(),
  elapsedMs: z.number().nonnegative().optional(),
  tool: z.string().optional(),
  ts: z.number(),
});
export type DataVizAgentEvent = z.infer<typeof DataVizAgentEventSchema>;

export const DataVizStartedEventSchema = z.object({
  type: z.literal("data_viz_started"),
  model: z.string(),
  source: DataVizSourceSummarySchema,
  ts: z.number(),
});

export const DataVizToolCallEventSchema = z.object({
  type: z.literal("data_viz_tool_call"),
  tool: z.string(),
  input: z.unknown(),
  ts: z.number(),
});

export const DataVizToolResultEventSchema = z.object({
  type: z.literal("data_viz_tool_result"),
  tool: z.string(),
  output: z.unknown(),
  ts: z.number(),
});

export const DataVizStepEventSchema = z.object({
  type: z.literal("data_viz_step"),
  message: z.string(),
  ts: z.number(),
});

export const DataVizChartEventSchema = z.object({
  type: z.literal("data_viz_chart"),
  chart: DataVizChartSchema,
  rationale: z.string().optional(),
  ts: z.number(),
});

export const DataVizCompleteEventSchema = z.object({
  type: z.literal("data_viz_complete"),
  recommendation: z.string(),
  rationale: z.string(),
  caveats: z.array(z.string()),
  totalUsage: TokenUsageSchema,
  ts: z.number(),
});

export const DataVizErrorEventSchema = z.object({
  type: z.literal("data_viz_error"),
  message: z.string(),
  ts: z.number(),
});

export const DataVizStreamEventSchema = z.discriminatedUnion("type", [
  DataVizAgentEventSchema,
  DataVizStartedEventSchema,
  DataVizToolCallEventSchema,
  DataVizToolResultEventSchema,
  DataVizStepEventSchema,
  DataVizChartEventSchema,
  DataVizCompleteEventSchema,
  DataVizErrorEventSchema,
]);
export type DataVizStreamEvent = z.infer<typeof DataVizStreamEventSchema>;
