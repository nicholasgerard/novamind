import type { DataVizStreamEvent } from "@novamind/shared/data-viz-events";

export type ActivityIconName =
  | "chartBuilt"
  | "chartRendered"
  | "complete"
  | "data"
  | "orchestrator"
  | "profile";

export interface ActivityItem {
  detail?: string;
  icon: ActivityIconName;
  key: string;
  label: string;
  tone: "idle" | "active" | "complete" | "error";
}

export function activityItems(
  events: readonly DataVizStreamEvent[],
): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const event of events) {
    if (event.type === "data_viz_agent_event") {
      const item = activityItemFromAgentEvent(event);
      if (!item) continue;
      items.push({
        ...item,
        key: `${event.type}-${event.ts}-${item.label}`,
      });
    }

    if (event.type === "data_viz_chart") {
      items.push({
        key: `${event.type}-${event.ts}-${event.chart.id}`,
        icon: "chartRendered",
        label: `Rendered ${event.chart.title}`,
        detail: event.rationale ?? event.chart.summary,
        tone: "complete",
      });
    }
  }

  return dedupeAdjacent(items);
}

function dedupeAdjacent(items: ActivityItem[]): ActivityItem[] {
  const deduped: ActivityItem[] = [];
  for (const item of items) {
    const previous = deduped.at(-1);
    if (
      previous &&
      previous.label === item.label &&
      previous.detail === item.detail
    ) {
      continue;
    }
    deduped.push(item);
  }
  return deduped;
}

function activityItemFromAgentEvent(
  event: Extract<DataVizStreamEvent, { type: "data_viz_agent_event" }>,
): Omit<ActivityItem, "key"> | undefined {
  if (isHiddenAgentEvent(event)) return undefined;
  if (event.label === "Tool result returned") return undefined;
  if (event.phase === "tool" && event.status === "running") return undefined;
  if (
    event.tool === "StructuredOutput" ||
    event.label.includes("StructuredOutput")
  ) {
    return undefined;
  }
  const label = cleanActivityText(event.label);
  return {
    icon: iconForAgentEvent(event),
    label,
    detail: event.detail
      ? cleanActivityText(event.detail)
      : fallbackActivityDetail(label),
    tone: event.status === "running" ? "active" : event.status,
  };
}

function isHiddenAgentEvent(
  event: Extract<DataVizStreamEvent, { type: "data_viz_agent_event" }>,
): boolean {
  return hiddenAgentEventLabels.has(event.label);
}

const hiddenAgentEventLabels = new Set([
  "Starting report-builder agent",
  "Agent SDK session ready",
  "Trial dataset ready",
]);

function iconForAgentEvent(
  event: Extract<DataVizStreamEvent, { type: "data_viz_agent_event" }>,
): ActivityIconName {
  if (event.tool === "profile_trial_dataset") return "profile";
  if (event.phase === "data") return "data";
  if (event.phase === "chart") return "chartBuilt";
  if (event.phase === "complete") return "complete";
  return "orchestrator";
}

function cleanActivityText(value: string): string {
  return value
    .replaceAll("Claude Code", "Claude")
    .replaceAll("StructuredOutput", "structured output");
}

function fallbackActivityDetail(label: string): string | undefined {
  if (label === "Claude is coordinating the visual report") {
    return "Preparing the next chart decision or final recommendation.";
  }
  return undefined;
}
