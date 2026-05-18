import { StopShell } from "@/components/stop-shell";

const FG = "#f0ede3";
const MUTED = "#a6a199";
const DIM = "#6b665e";
const BORDER = "#2a2723";
const PANEL = "#141210";
const ELEVATED = "#1c1a17";
const CORAL = "#cc785c";

const contrasts: { workflow: string; agent: string }[] = [
  {
    workflow: "Built on fixed steps and schemas",
    agent: "Built on tool use and sub-agents",
  },
  {
    workflow: "Evals measure step accuracy",
    agent: "Evals measure trajectory",
  },
  {
    workflow: "Brittle when off the happy path",
    agent: "Automatically recovers and adapts",
  },
];

export function Stage02() {
  return (
    <StopShell slug="02-workflows-to-agents">
      <div className="grid min-w-0 gap-y-5 md:grid-cols-2 md:gap-x-8 md:gap-y-0 md:[grid-template-rows:auto_auto_auto_auto_auto]">
        <article className="panel grid min-w-0 rounded-2xl p-6 sm:p-8 md:row-span-5 md:[grid-template-rows:subgrid]">
          <ColumnTitle>Workflow</ColumnTitle>
          <SVGCell>
            <WorkflowSVG />
          </SVGCell>
          {contrasts.map((row, i) => (
            <ContrastCell key={i}>{row.workflow}</ContrastCell>
          ))}
        </article>

        <article className="grid min-w-0 rounded-2xl border border-primary/35 bg-primary/[0.05] p-6 shadow-xl shadow-primary/10 ring-1 ring-primary/10 sm:p-8 md:row-span-5 md:[grid-template-rows:subgrid]">
          <ColumnTitle accent>Agent</ColumnTitle>
          <SVGCell>
            <AgentSVG />
          </SVGCell>
          {contrasts.map((row, i) => (
            <ContrastCell key={i} accent>
              {row.agent}
            </ContrastCell>
          ))}
        </article>
      </div>
    </StopShell>
  );
}

function ColumnTitle({
  accent,
  children,
}: {
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <p
      className={
        accent
          ? "mono-data pb-6 text-center text-[12px] uppercase tracking-[0.32em] text-primary sm:pb-8"
          : "mono-data pb-6 text-center text-[12px] uppercase tracking-[0.32em] text-foreground/85 sm:pb-8"
      }
    >
      {children}
    </p>
  );
}

function SVGCell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center overflow-hidden pb-6 sm:pb-8">
      <div className="w-full min-w-0">{children}</div>
    </div>
  );
}

function ContrastCell({
  accent,
  children,
}: {
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-center border-t border-border/40 px-2 py-5">
      <p
        className={
          accent
            ? "text-balance text-center text-base leading-snug text-foreground"
            : "text-balance text-center text-base leading-snug text-muted-foreground"
        }
      >
        {children}
      </p>
    </div>
  );
}

function WorkflowSVG() {
  return (
    <svg
      viewBox="0 0 600 290"
      className="block w-full max-w-full"
      role="img"
      aria-label="Workflow diagram: linear sequence of four steps — extract, search, score, output."
    >
      <WorkflowStep x={20} label="Extract" />
      <WorkflowArrow x1={145} x2={170} />
      <WorkflowStep x={170} label="Search" />
      <WorkflowArrow x1={295} x2={320} />
      <WorkflowStep x={320} label="Score" />
      <WorkflowArrow x1={445} x2={470} />
      <WorkflowStep x={470} label="Output" />
    </svg>
  );
}

function WorkflowStep({ x, label }: { x: number; label: string }) {
  return (
    <g>
      <rect
        x={x}
        y={110}
        width={120}
        height={70}
        rx={10}
        fill={ELEVATED}
        stroke={BORDER}
        strokeWidth={1.5}
      />
      <text
        x={x + 60}
        y={151}
        textAnchor="middle"
        fontSize={17}
        fill={FG}
        fontFamily="ui-sans-serif, system-ui"
      >
        {label}
      </text>
    </g>
  );
}

function WorkflowArrow({ x1, x2 }: { x1: number; x2: number }) {
  return (
    <g>
      <line
        x1={x1}
        y1={145}
        x2={x2 - 6}
        y2={145}
        stroke={DIM}
        strokeWidth={1.5}
      />
      <polygon points={`${x2} 145, ${x2 - 8} 141, ${x2 - 8} 149`} fill={DIM} />
    </g>
  );
}

function AgentSVG() {
  return (
    <svg
      viewBox="0 -10 600 290"
      className="block w-full max-w-full"
      role="img"
      aria-label="Agent diagram: central orchestrator with branching tools and a feedback loop arrow returning to the orchestrator."
    >
      <path
        d="M 335 114 Q 350 64 300 64 Q 250 64 265 114"
        stroke={CORAL}
        strokeWidth={1.5}
        fill="none"
        strokeOpacity={0.7}
        markerEnd="url(#arrowhead-agent-coral-v4)"
      />
      <defs>
        <marker
          id="arrowhead-agent-coral-v4"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill={CORAL} />
        </marker>
      </defs>

      <line
        x1={240}
        y1={144}
        x2={160}
        y2={43}
        stroke={CORAL}
        strokeOpacity={0.55}
        strokeWidth={1.5}
        strokeDasharray="3 4"
      />
      <line
        x1={240}
        y1={144}
        x2={160}
        y2={223}
        stroke={CORAL}
        strokeOpacity={0.55}
        strokeWidth={1.5}
        strokeDasharray="3 4"
      />
      <line
        x1={360}
        y1={144}
        x2={440}
        y2={43}
        stroke={CORAL}
        strokeOpacity={0.55}
        strokeWidth={1.5}
        strokeDasharray="3 4"
      />
      <line
        x1={360}
        y1={144}
        x2={440}
        y2={223}
        stroke={CORAL}
        strokeOpacity={0.55}
        strokeWidth={1.5}
        strokeDasharray="3 4"
      />

      <AgentTool x={30} y={24} label="Search" />
      <AgentTool x={30} y={204} label="Verify" />
      <AgentTool x={440} y={24} label="Extract" />
      <AgentTool x={440} y={204} label="Synthesize" />

      <rect x={240} y={114} width={120} height={70} rx={35} fill={CORAL} />
      <text
        x={300}
        y={156}
        textAnchor="middle"
        fontSize={16}
        fontWeight={600}
        fill="#0a0908"
        fontFamily="ui-sans-serif, system-ui"
      >
        Orchestrator
      </text>
    </svg>
  );
}

function AgentTool({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={130}
        height={42}
        rx={8}
        fill={PANEL}
        stroke={CORAL}
        strokeOpacity={0.45}
        strokeWidth={1.5}
      />
      <text
        x={x + 65}
        y={y + 27}
        textAnchor="middle"
        fontSize={14}
        fill={MUTED}
        fontFamily="ui-sans-serif, system-ui"
      >
        {label}
      </text>
    </g>
  );
}
