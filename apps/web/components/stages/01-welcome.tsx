import { Layers, Shuffle, TrendingUp } from "lucide-react";

const valueProps = [
  {
    icon: Shuffle,
    title: "Multi-provider, multi-model",
    body: "Mix providers and models to optimize cost, efficiency, and reliability.",
  },
  {
    icon: TrendingUp,
    title: "Continuous improvement",
    body: "Hill climb capability evals to automatically improve reliability.",
  },
  {
    icon: Layers,
    title: "Works with your stack",
    body: "OpenAI, Braintrust, LangSmith, and PubMed RAG stay in place.",
  },
];

export function Stage01() {
  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center gap-14 soft-enter">
      {/* Stage 1 intentionally uses bespoke hero copy; the chapter menu labels it "Welcome". */}
      {/* subtle radial glow behind the title */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-12 -z-10 mx-auto h-[28rem] w-[40rem] max-w-full rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse at center, rgb(204 120 92 / 0.18), transparent 70%)",
        }}
      />

      <div className="text-center">
        <p className="mono-data text-[11px] uppercase tracking-[0.36em] text-[var(--fg-dim)]">
          Anthropic <span className="px-2 text-primary">×</span> NovaMind
        </p>

        <h1
          className="mt-9 bg-clip-text pb-2 text-balance text-[4rem] font-semibold leading-[1.05] tracking-normal text-transparent sm:text-[5.5rem]"
          style={{
            backgroundImage:
              "linear-gradient(180deg, #f0ede3 0%, #f0ede3 40%, #cc785c 110%)",
          }}
        >
          NovaMind <span className="font-light">Agent</span>
        </h1>

        <div className="mx-auto mt-7 flex items-center justify-center gap-3">
          <span aria-hidden className="h-px w-10 bg-primary/45" />
          <p className="mono-data text-[11px] uppercase tracking-[0.32em] text-primary">
            built on Agent SDK
          </p>
          <span aria-hidden className="h-px w-10 bg-primary/45" />
        </div>

        <p className="mx-auto mt-7 max-w-2xl text-balance text-lg leading-relaxed text-muted-foreground sm:text-xl">
          Ship a multi-agent research workflow to new pharma customers in under
          30 days.
        </p>
      </div>

      <div className="grid w-full max-w-4xl grid-cols-1 divide-y divide-border/70 md:grid-cols-3 md:divide-y-0 md:gap-8 lg:gap-10">
        {valueProps.map((prop) => (
          <ValueProp key={prop.title} {...prop} />
        ))}
      </div>
    </div>
  );
}

function ValueProp({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-4 py-5 text-left first:pt-0 last:pb-0 md:flex-col md:items-center md:gap-0 md:py-0 md:text-center">
      <span className="grid size-12 shrink-0 place-items-center rounded-full border border-primary/35 bg-primary/[0.06]">
        <Icon className="size-5 text-primary" />
      </span>
      <div className="min-w-0 md:mt-5">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mx-auto mt-2 max-w-[26rem] break-words text-xs leading-relaxed text-muted-foreground md:max-w-[14.5rem]">
          {body}
        </p>
      </div>
    </div>
  );
}
