export interface Stop {
  /** URL path segment for the presentation route. */
  slug: string;
  /** One-based display order in the chapter navigation. */
  number: number;
  /** Chapter-menu label and default slide header title. */
  title: string;
  /** Chapter-menu blurb and default slide header subtitle. */
  description: string;
  isDemo?: boolean;
}

export const stops: readonly Stop[] = [
  {
    number: 1,
    slug: "01-welcome",
    title: "Welcome",
    description:
      "Ship a multi-agent research workflow to 5 new pharma customers in under 30 days.",
  },
  {
    number: 2,
    slug: "02-workflows-to-agents",
    title: "From workflows to agents",
    description:
      "Workflows can become brittle as they get more complex. Agents offer flexibility at scale.",
  },
  {
    number: 3,
    slug: "03-single-turn-evals",
    title: "What single-turn evals miss",
    description:
      "Long trajectories have distinct failure modes that don't show up in step-level measurement.",
  },
  {
    number: 4,
    slug: "04-anthropic-agents",
    title: "How Anthropic builds agents",
    description:
      "The Agent SDK lets you build agents with the same tools that power Claude Code.",
  },
  {
    number: 5,
    slug: "05-research-agent-demo",
    title: "Research agent demo",
    description:
      "Build a research agent with RAG search, verified citations, and claim-level grounding.",
    isDemo: true,
  },
  {
    number: 6,
    slug: "06-data-visualization-demo",
    title: "Data visualization demo",
    description:
      "Hand off the validated hypothesis to a report-builder agent that turns trial data into charts.",
    isDemo: true,
  },
  {
    number: 7,
    slug: "07-check-the-receipts",
    title: "Check the receipts",
    description:
      "Pick the smallest model that does the job and use caching to optimize cost and latency.",
  },
  {
    number: 8,
    slug: "08-eval-harness",
    title: "Hill climbing in practice",
    description:
      "A good harness turns evals into an engine for continuous improvement.",
    isDemo: true,
  },
  {
    number: 9,
    slug: "09-next-steps",
    title: "Next steps",
    description:
      "Start with evals. Build a baseline, roll out to customers, then test automated improvements.",
  },
  {
    number: 10,
    slug: "10-resources",
    title: "Resources",
    description:
      "Cloneable demos, evals, and deployment docs for the Agent SDK.",
  },
] as const;

export function findStop(slug: string): Stop | undefined {
  return stops.find((s) => s.slug === slug);
}

export function requireStop(slug: string): Stop {
  const stop = findStop(slug);
  if (!stop) throw new Error(`Missing stop metadata for ${slug}`);
  return stop;
}

export function adjacentStops(slug: string): {
  prev: Stop | undefined;
  next: Stop | undefined;
} {
  const i = stops.findIndex((s) => s.slug === slug);
  if (i === -1) return { prev: undefined, next: undefined };
  return {
    prev: i > 0 ? stops[i - 1] : undefined,
    next: i < stops.length - 1 ? stops[i + 1] : undefined,
  };
}
