import {
  FlaskConical,
  FolderGit2,
  Github,
  Mail,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { StageHeader } from "@/components/stage-header";
import { TileHoverArrow } from "@/components/ui/tile-hover";
import { requireStop } from "@/lib/stops";
import { cn } from "@/lib/utils";

interface ResourceStat {
  value: string;
  label: string;
}

interface ResourceCta {
  href: string;
  icon: LucideIcon;
  label: string;
  eyebrow: string;
  body: string;
  accent?: boolean;
  external?: boolean;
}

const manifestRows = [
  {
    path: "apps/web",
    role: "Deck routes, demo UI, Access-gated API proxy",
    signal: "deck",
  },
  {
    path: "apps/agent",
    role: "Container runtime, SSE routes, model calls, tool boundaries",
    signal: "runtime",
  },
  {
    path: "packages/eval",
    role: "Four eval axes, streaming runner, prompt hill-climb",
    signal: "evals",
  },
  {
    path: "packages/pipeline",
    role: "Agent SDK orchestration, RAG, tools, provider adapters",
    signal: "agents",
  },
  {
    path: "packages/corpus",
    role: "PubMed and ClinicalTrials.gov ingest, embeddings, R2 upload",
    signal: "data",
  },
  {
    path: "scripts",
    role: "Cloudflare deploys, smoke tests, observability helpers",
    signal: "ops",
  },
  {
    path: "docs",
    role: "Architecture, Claude, deploy, eval, corpus, security guides",
    signal: "guides",
  },
];

const resourceStats: ResourceStat[] = [
  {
    value: "3",
    label: "live demos",
  },
  {
    value: "2",
    label: "SDK agents",
  },
  {
    value: "4",
    label: "eval axes",
  },
  {
    value: "9",
    label: "guides",
  },
];

const resourceCtas: ResourceCta[] = [
  {
    href: "https://github.com/nicholasgerard/novamind/tree/main/packages/eval",
    icon: FlaskConical,
    label: "Open eval harness",
    eyebrow: "Start here",
    body: "Run four axes, inspect per-case output, and iterate on prompts.",
    accent: true,
  },
  {
    href: "https://github.com/nicholasgerard/novamind",
    icon: Github,
    label: "Clone full source",
    eyebrow: "Source",
    body: "Agent SDK demos, Cloudflare deployment, corpus scripts, evals, and docs.",
  },
  {
    href: "mailto:nick@thebkapp.co",
    icon: Mail,
    label: "Get in touch",
    eyebrow: "Follow up",
    body: "Questions, implementation notes, or next-step discussion.",
    external: false,
  },
];

export function Stage10() {
  const stop = requireStop("10-resources");

  return (
    <article
      className={cn(
        "mx-0 w-full min-w-0 soft-enter sm:mx-auto",
        "max-w-full space-y-8 sm:max-w-6xl sm:space-y-10 lg:space-y-11",
      )}
    >
      <div className="mx-auto flex w-full max-w-full flex-col items-center gap-7 text-center sm:max-w-5xl sm:gap-8">
        <StageHeader title={stop.title} description={stop.description} />

        <StatRow stats={resourceStats} />

        <RepoWindow />
      </div>
    </article>
  );
}

function StatRow({ stats }: { stats: ResourceStat[] }) {
  return (
    <div className="w-full min-w-0 border-y border-border/70 py-3">
      <ul className="mono-data mx-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs uppercase tracking-[0.14em] text-muted-foreground sm:gap-x-4 sm:text-[13px]">
        {stats.map((stat, index) => (
          <li
            key={stat.label}
            className="inline-flex items-center gap-3 whitespace-nowrap"
          >
            <span>
              <span className="font-semibold text-foreground">
                {stat.value}
              </span>{" "}
              {stat.label}
            </span>
            {index < stats.length - 1 ? (
              <span aria-hidden className="text-[var(--fg-dim)]">
                ·
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RepoWindow() {
  return (
    <section className="panel w-full min-w-0 overflow-hidden rounded-lg border-primary/25 bg-card/75 text-left">
      <div className="flex min-w-0 items-center gap-3 border-b border-border/70 px-4 py-3 sm:px-5">
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="size-2 rounded-full bg-destructive/80" />
          <span className="size-2 rounded-full bg-warning/80" />
          <span className="size-2 rounded-full bg-[var(--positive)]/80" />
        </div>
        <div className="mono-data flex min-w-0 flex-1 items-center gap-2 text-[11px] text-muted-foreground">
          <Terminal className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">nicholasgerard/novamind</span>
        </div>
      </div>

      <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 p-4 sm:p-5">
          <div className="mb-4 flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary/10 text-primary">
              <FolderGit2 className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="mono-data text-[10px] uppercase tracking-[0.18em] text-[var(--fg-dim)]">
                Repository manifest
              </p>
              <p className="mono-data mt-1 truncate text-xl font-semibold leading-none text-foreground">
                novamind/
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-border/75 bg-background/35">
            {manifestRows.map((row) => (
              <ManifestRow key={row.path} {...row} />
            ))}
          </div>
        </div>

        <aside className="min-w-0 border-t border-border/70 bg-background/20 p-4 sm:p-5 lg:border-l lg:border-t-0">
          <p className="mono-data text-[10px] uppercase tracking-[0.18em] text-primary">
            Links
          </p>
          <div className="mt-4 grid gap-2.5">
            {resourceCtas.map((cta) => (
              <ActionRow key={cta.label} {...cta} />
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function ManifestRow({
  path,
  role,
  signal,
  accent,
}: {
  path: string;
  role: string;
  signal: string;
  accent?: boolean;
}) {
  const [parent, child] = path.split("/");

  return (
    <div
      className={cn(
        "grid min-w-0 gap-1.5 border-b border-border/60 px-3 py-3 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)_4.5rem] sm:items-center sm:gap-3 sm:px-4",
        accent && "bg-primary/[0.045]",
      )}
    >
      <p className="mono-data min-w-0 text-sm">
        <span className="text-[var(--fg-dim)]">{parent}/</span>
        <span
          className={cn(
            "font-semibold",
            accent ? "text-primary" : "text-foreground",
          )}
        >
          {child}
        </span>
      </p>
      <p className="min-w-0 break-words text-xs leading-5 text-muted-foreground sm:text-sm">
        {role}
      </p>
      <span
        className={cn(
          "mono-data w-fit rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em]",
          accent
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border bg-secondary/70 text-[var(--fg-dim)]",
        )}
      >
        {signal}
      </span>
    </div>
  );
}

function ActionRow({
  href,
  icon: Icon,
  eyebrow,
  label,
  body,
  accent,
  external = true,
}: ResourceCta) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={cn(
        "group grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_1rem] gap-3 rounded-md border p-3 transition duration-200 hover:bg-white/[0.035]",
        accent
          ? "border-primary/45 bg-primary/[0.08]"
          : "border-border bg-card/45 hover:border-primary/35",
      )}
    >
      <span
        className={cn(
          "grid size-9 place-items-center rounded-md border",
          accent
            ? "border-primary/45 bg-background/35 text-primary"
            : "border-border bg-background/35 text-muted-foreground group-hover:text-primary",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "mono-data block text-[10px] uppercase tracking-[0.16em]",
            accent ? "text-primary" : "text-[var(--fg-dim)]",
          )}
        >
          {eyebrow}
        </span>
        <span className="mt-1 block break-words text-sm font-semibold leading-snug text-foreground">
          {label}
        </span>
        <span className="mt-1 block overflow-hidden text-xs leading-relaxed text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
          {body}
        </span>
      </span>
      <TileHoverArrow
        visibility="always"
        className={cn(
          "mt-0.5 size-4",
          accent
            ? "text-primary"
            : "text-muted-foreground group-hover:text-primary",
        )}
      />
    </a>
  );
}
