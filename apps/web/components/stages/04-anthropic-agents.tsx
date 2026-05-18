import {
  Boxes,
  Database,
  Eye,
  Layers,
  Plug,
  Radio,
  TestTubeDiagonal,
  Webhook,
  Wrench,
} from "lucide-react";
import { StopShell } from "@/components/stop-shell";
import { TileHoverArrow, TileHoverOverlay } from "@/components/ui/tile-hover";
import { cn } from "@/lib/utils";

const blocks: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  href: string;
}[] = [
  {
    icon: Boxes,
    title: "Sub-agents",
    body: "Scoped specialists handle search, verification, and synthesis while an orchestrator decides when each runs.",
    href: "https://code.claude.com/docs/en/agent-sdk/subagents",
  },
  {
    icon: Wrench,
    title: "Tool use",
    body: "Reliable structured outputs via typed JSON schemas. Validation failures are recoverable events.",
    href: "https://code.claude.com/docs/en/agent-sdk/custom-tools",
  },
  {
    icon: Plug,
    title: "MCP",
    body: "Connect PubMed, Braintrust, vector DBs, and internal tools through one protocol instead of custom glue.",
    href: "https://modelcontextprotocol.io",
  },
  {
    icon: Database,
    title: "Prompt caching",
    body: "Cache 100K-token retrieval prefixes once. Each trajectory turn pays mostly for the delta.",
    href: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",
  },
  {
    icon: Layers,
    title: "Model mix",
    body: "Use small models for routing, stronger models for orchestration, and the largest only for deep reasoning.",
    href: "https://docs.anthropic.com/en/docs/about-claude/models/overview",
  },
  {
    icon: Radio,
    title: "Streaming",
    body: "Stream tool calls, retrievals, and partial outputs so users and engineers can see the trajectory as it runs.",
    href: "https://code.claude.com/docs/en/agent-sdk/streaming-output",
  },
  {
    icon: TestTubeDiagonal,
    title: "Evals",
    body: "Measure full trajectories: tool choices, recovery, grounding, and task completion under realistic failures.",
    href: "https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents",
  },
  {
    icon: Eye,
    title: "Observability",
    body: "Capture traces, usage, tool calls, and model decisions so failures turn into targeted fixes.",
    href: "https://code.claude.com/docs/en/agent-sdk/observability",
  },
  {
    icon: Webhook,
    title: "Hooks",
    body: "Add deterministic control points to validate inputs, gate risky tools, log state, or enforce policy.",
    href: "https://code.claude.com/docs/en/agent-sdk/hooks",
  },
];

const sections: {
  eyebrow: string;
  title: string;
  items: typeof blocks;
}[] = [
  {
    eyebrow: "Compose",
    title: "Agent architecture",
    items: blocks.filter((block) =>
      ["Sub-agents", "Tool use", "MCP"].includes(block.title),
    ),
  },
  {
    eyebrow: "Observe",
    title: "Runtime visibility",
    items: blocks.filter((block) =>
      ["Streaming", "Observability", "Hooks"].includes(block.title),
    ),
  },
  {
    eyebrow: "Optimize",
    title: "Reliability and cost",
    items: blocks.filter((block) =>
      ["Evals", "Model mix", "Prompt caching"].includes(block.title),
    ),
  },
];

export function Stage04() {
  return (
    <StopShell slug="04-anthropic-agents" wide>
      <div className="grid gap-5 lg:grid-cols-3">
        {sections.map((section) => (
          <section key={section.title} className="min-w-0 space-y-4">
            <div className="border-l border-primary/35 pl-3">
              <p className="eyebrow">{section.eyebrow}</p>
              <h2 className="mt-1 text-sm font-semibold text-foreground">
                {section.title}
              </h2>
            </div>
            <div className="grid auto-rows-fr gap-3">
              {section.items.map((b) => (
                <BlockCard key={b.title} {...b} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </StopShell>
  );
}

function BlockCard({
  icon: Icon,
  title,
  body,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "panel group relative block h-full overflow-hidden rounded-lg p-4 transition duration-200",
        "hover:-translate-y-0.5 hover:border-primary/60 hover:bg-primary/[0.04] hover:shadow-lg hover:shadow-primary/10",
      )}
    >
      <TileHoverOverlay />
      <div className="relative flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground transition duration-200 group-hover:text-primary" />
        <p className="text-sm font-semibold leading-none text-foreground transition duration-200 group-hover:text-primary">
          {title}
        </p>
        <TileHoverArrow className="ml-auto size-3.5" />
      </div>
      <p className="relative mt-2 text-[13px] leading-5 text-muted-foreground">
        {body}
      </p>
    </a>
  );
}
