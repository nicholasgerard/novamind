import {
  Activity,
  CheckCircle2,
  Cloud,
  Database,
  Flag,
  FlaskConical,
  Gauge,
  PanelsTopLeft,
  Rocket,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { StageHeader } from "@/components/stage-header";
import { requireStop } from "@/lib/stops";
import { cn } from "@/lib/utils";

const articleSpacing = "space-y-8 sm:space-y-10 lg:space-y-10";

const unchangedItems: {
  icon: LucideIcon;
  label: string;
}[] = [
  {
    icon: Workflow,
    label: "OpenAI prompt flows",
  },
  {
    icon: FlaskConical,
    label: "Braintrust evals",
  },
  {
    icon: Activity,
    label: "LangSmith traces",
  },
  {
    icon: Database,
    label: "PubMed RAG ingestion",
  },
  {
    icon: PanelsTopLeft,
    label: "Customer surfaces",
  },
  {
    icon: Cloud,
    label: "OpenAI traffic",
  },
];

const timelineMilestones = [
  {
    week: "Week 1",
    title: "Eval baseline",
    body: "Stand up the multi-axis harness on NovaMind data. Run Claude vs GPT-5.1 across the same representative cases before changing production behavior.",
    outcome: "Provider report card",
  },
  {
    week: "Week 4",
    title: "First customer behind a flag",
    body: "Ship the literature-to-hypothesis workflow for one pharma customer with live eval tracking, cost telemetry, and a reversible rollout path.",
    outcome: "Go / no-go launch",
  },
  {
    week: "Week 12",
    title: "Hill-climbing in production",
    body: "Feed production traces back into the harness, test prompt improvements before keeping them, and expose the loop to the engineering team.",
    outcome: "Repeatable improvement loop",
  },
] as const;

const commitments: {
  label: string;
  icon: LucideIcon;
  launch?: boolean;
}[] = [
  {
    label: "Measure baseline",
    icon: Gauge,
  },
  {
    label: "Launch to customers",
    icon: Rocket,
    launch: true,
  },
  {
    label: "Continuously improve",
    icon: TrendingUp,
  },
];

export function Stage09() {
  const stop = requireStop("09-next-steps");

  return (
    <article
      className={cn(
        "mx-auto w-full min-w-0 max-w-[calc(100vw-3rem)] soft-enter sm:max-w-7xl",
        articleSpacing,
      )}
    >
      <StageHeader title={stop.title} description={stop.description} />

      <div className="min-w-0 space-y-8 sm:space-y-10">
        <ol className="relative grid min-w-0 grid-cols-[minmax(0,1fr)] items-stretch gap-4 lg:grid-cols-3 lg:gap-4">
          {timelineMilestones.map((milestone, index) => (
            <CommitmentStep
              key={milestone.week}
              milestone={milestone}
              commitment={commitments[index]}
            />
          ))}
        </ol>

        <StaysInPlace />
      </div>
    </article>
  );
}

function StaysInPlace() {
  return (
    <section className="mx-auto w-full max-w-5xl min-w-0 pt-4 text-center opacity-75 sm:pt-6">
      <div className="mx-auto max-w-2xl min-w-0">
        <p className="mono-data text-[10px] uppercase tracking-[0.18em] text-[var(--fg-dim)]">
          What stays in place
        </p>
      </div>

      <ul className="mx-auto mt-10 grid max-w-6xl min-w-0 grid-cols-2 gap-x-5 gap-y-5 sm:mt-12 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-8">
        {unchangedItems.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="mx-auto flex min-w-0 max-w-[8.5rem] flex-col items-center gap-2 text-center"
          >
            <Icon className="size-4.5 shrink-0 text-muted-foreground/70" />
            <span className="min-w-0 whitespace-nowrap text-[11px] leading-none text-muted-foreground sm:text-xs">
              {label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CommitmentStep({
  milestone,
  commitment,
}: {
  milestone: (typeof timelineMilestones)[number];
  commitment: (typeof commitments)[number] | undefined;
}) {
  const Icon = commitment?.icon ?? Flag;
  const launch = Boolean(commitment?.launch);

  return (
    <li className="relative flex h-full w-full min-w-0 max-w-full">
      <article
        className={cn(
          "panel flex h-full w-full min-w-0 max-w-full flex-col rounded-lg p-4 sm:p-5",
          launch && "border-primary/50 bg-primary/[0.07]",
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_3rem] items-start gap-4">
            <div className="min-w-0">
              <p className="mono-data text-[10px] uppercase tracking-[0.18em] text-primary">
                {milestone.week}
              </p>
              <h2 className="mt-2 break-words text-2xl font-semibold leading-tight text-foreground lg:text-[1.7rem]">
                {commitment?.label ?? milestone.title}
              </h2>
            </div>
            <span
              className={cn(
                "grid size-12 shrink-0 place-items-center rounded-md border bg-background/35 text-muted-foreground",
                launch
                  ? "border-primary/60 bg-primary/15 text-primary shadow-lg shadow-primary/10"
                  : "border-border",
              )}
            >
              <Icon className="size-5" />
            </span>
          </div>

          <p className="mb-5 mt-4 break-words text-sm leading-6 text-muted-foreground">
            {milestone.body}
          </p>

          <div className="mt-auto flex min-w-0 flex-wrap items-center gap-2 border-t border-border/70 pt-3">
            <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {milestone.outcome}
            </span>
          </div>
        </div>
      </article>
    </li>
  );
}
