import type { FailureKey } from "./types";

const FG = "#f0ede3";
const MUTED = "#a6a199";
const DIM = "#6b665e";
const BORDER = "#2a2723";
const ELEVATED = "#1c1a17";
const WARNING = "#d4a574";
const DESTRUCTIVE = "#b8584c";
const CORAL = "#cc785c";

export function FailureVisual({ active }: { active: FailureKey }) {
  if (active === "cascade") return <CascadeViz />;
  if (active === "drift") return <DriftViz />;
  return <SpillageViz />;
}

function CascadeViz() {
  type CascadeState = "ok" | "corrupt" | "tainted" | "wrong";
  const steps: { n: number; state: CascadeState; label: string }[] = [
    { n: 1, state: "ok", label: "retrieve" },
    { n: 2, state: "ok", label: "filter" },
    { n: 3, state: "corrupt", label: "rerank" },
    { n: 4, state: "tainted", label: "synthesize" },
    { n: 5, state: "wrong", label: "output" },
  ];
  const stepW = 120;
  const gap = 25;

  function colorsFor(state: CascadeState) {
    if (state === "wrong") {
      return {
        fill: "rgb(184 88 76 / 0.18)",
        stroke: DESTRUCTIVE,
        text: DESTRUCTIVE,
        dashed: false,
      };
    }
    if (state === "corrupt") {
      return {
        fill: "rgb(212 165 116 / 0.18)",
        stroke: WARNING,
        text: WARNING,
        dashed: false,
      };
    }
    if (state === "tainted") {
      return {
        fill: "rgb(212 165 116 / 0.08)",
        stroke: WARNING,
        text: WARNING,
        dashed: true,
      };
    }
    return { fill: ELEVATED, stroke: BORDER, text: FG, dashed: false };
  }

  return (
    <svg
      viewBox="0 29 745 200"
      className="block h-full max-h-full w-full max-w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Tool cascade: a corrupt retrieval at step 3 propagates through downstream steps and produces an incorrect final output."
    >
      {steps.map((s, i) => {
        const x = 20 + i * (stepW + gap);
        const c = colorsFor(s.state);
        const next = steps[i + 1];
        const arrowColor = (() => {
          if (next?.state === "wrong") return DESTRUCTIVE;
          if (
            s.state === "corrupt" ||
            s.state === "tainted" ||
            next?.state === "tainted" ||
            next?.state === "corrupt"
          ) {
            return WARNING;
          }
          return DIM;
        })();
        return (
          <g key={s.n}>
            <rect
              x={x}
              y={70}
              width={stepW}
              height={56}
              rx={10}
              fill={c.fill}
              stroke={c.stroke}
              strokeWidth={1.5}
              strokeDasharray={c.dashed ? "4 3" : "none"}
            />
            <text
              x={x + stepW / 2}
              y={94}
              textAnchor="middle"
              fontSize={11}
              fill={DIM}
              fontFamily="ui-monospace, monospace"
            >
              step {s.n}
            </text>
            <text
              x={x + stepW / 2}
              y={114}
              textAnchor="middle"
              fontSize={13}
              fill={c.text}
              fontFamily="ui-sans-serif, system-ui"
            >
              {s.label}
            </text>
            {s.state === "corrupt" && (
              <g>
                <circle cx={x + stepW - 12} cy={58} r={9} fill={WARNING} />
                <text
                  x={x + stepW - 12}
                  y={62}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={700}
                  fill="#0a0908"
                  fontFamily="ui-sans-serif, system-ui"
                >
                  !
                </text>
              </g>
            )}
            {s.state === "wrong" && (
              <g>
                <circle cx={x + stepW - 12} cy={58} r={9} fill={DESTRUCTIVE} />
                <text
                  x={x + stepW - 12}
                  y={62}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={700}
                  fill="#f0ede3"
                  fontFamily="ui-sans-serif, system-ui"
                >
                  ✕
                </text>
                <text
                  x={x + stepW / 2}
                  y={146}
                  textAnchor="middle"
                  fontSize={10}
                  fill={DESTRUCTIVE}
                  fontFamily="ui-monospace, monospace"
                  letterSpacing={1.5}
                >
                  INCORRECT
                </text>
              </g>
            )}
            {next && (
              <g>
                <line
                  x1={x + stepW}
                  y1={98}
                  x2={x + stepW + gap - 6}
                  y2={98}
                  stroke={arrowColor}
                  strokeWidth={1.5}
                />
                <polygon
                  points={`${x + stepW + gap},98 ${x + stepW + gap - 8},94 ${x + stepW + gap - 8},102`}
                  fill={arrowColor}
                />
              </g>
            )}
          </g>
        );
      })}
      <text
        x={372}
        y={188}
        textAnchor="middle"
        fontSize={12}
        fill={DIM}
        fontFamily="ui-monospace, monospace"
      >
        corruption at step 3 → flows downstream → final answer is wrong
      </text>
    </svg>
  );
}

function DriftViz() {
  return (
    <svg
      viewBox="0 47 745 200"
      className="block h-full max-h-full w-full max-w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Plan drift: the agent's actual trajectory diverges from the original goal."
    >
      <circle cx={50} cy={100} r={16} fill={CORAL} />
      <text
        x={50}
        y={106}
        textAnchor="middle"
        fontSize={13}
        fontWeight={700}
        fill="#0a0908"
        fontFamily="ui-sans-serif, system-ui"
      >
        G
      </text>
      <text
        x={50}
        y={138}
        textAnchor="middle"
        fontSize={11}
        fill={MUTED}
        fontFamily="ui-sans-serif, system-ui"
      >
        goal · step 1
      </text>

      <line
        x1={70}
        y1={100}
        x2={665}
        y2={100}
        stroke={DIM}
        strokeWidth={1.5}
        strokeDasharray="3 4"
      />
      <text
        x={370}
        y={92}
        textAnchor="middle"
        fontSize={11}
        fill={DIM}
        fontFamily="ui-monospace, monospace"
      >
        planned trajectory
      </text>
      <circle
        cx={680}
        cy={100}
        r={10}
        fill={ELEVATED}
        stroke={DIM}
        strokeWidth={1.5}
      />
      <text
        x={680}
        y={138}
        textAnchor="middle"
        fontSize={11}
        fill={DIM}
        fontFamily="ui-sans-serif, system-ui"
      >
        target
      </text>

      <path
        d="M 70 100 Q 320 108 470 145 T 665 188"
        stroke={WARNING}
        strokeWidth={2}
        fill="none"
      />
      <text
        x={460}
        y={158}
        textAnchor="middle"
        fontSize={11}
        fill={WARNING}
        fontFamily="ui-monospace, monospace"
      >
        actual trajectory
      </text>
      <circle
        cx={680}
        cy={188}
        r={10}
        fill="rgb(212 165 116 / 0.2)"
        stroke={WARNING}
        strokeWidth={1.5}
      />
      <text
        x={680}
        y={210}
        textAnchor="end"
        fontSize={11}
        fill={WARNING}
        fontFamily="ui-sans-serif, system-ui"
      >
        off-goal answer
      </text>
    </svg>
  );
}

function SpillageViz() {
  return (
    <svg
      viewBox="0 20 745 200"
      className="block h-full max-h-full w-full max-w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Ungrounded citation: agent cites a fact sourced from training data instead of the retrieved corpus."
    >
      <defs>
        <marker
          id="training-source-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={WARNING} />
        </marker>
      </defs>
      <ellipse
        cx={155}
        cy={60}
        rx={120}
        ry={38}
        fill={ELEVATED}
        stroke={BORDER}
        strokeWidth={1.5}
      />
      <text
        x={155}
        y={56}
        textAnchor="middle"
        fontSize={13}
        fontWeight={500}
        fill={FG}
        fontFamily="ui-sans-serif, system-ui"
      >
        Retrieved corpus
      </text>
      <text
        x={155}
        y={76}
        textAnchor="middle"
        fontSize={11}
        fill={DIM}
        fontFamily="ui-monospace, monospace"
      >
        PubMed · 500 abstracts
      </text>

      <ellipse
        cx={590}
        cy={60}
        rx={120}
        ry={38}
        fill="rgb(212 165 116 / 0.08)"
        stroke={WARNING}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <text
        x={590}
        y={56}
        textAnchor="middle"
        fontSize={13}
        fontWeight={500}
        fill={WARNING}
        fontFamily="ui-sans-serif, system-ui"
      >
        Training data
      </text>
      <text
        x={590}
        y={76}
        textAnchor="middle"
        fontSize={11}
        fill={DIM}
        fontFamily="ui-monospace, monospace"
      >
        model parameters
      </text>

      <rect
        x={300}
        y={170}
        width={150}
        height={48}
        rx={10}
        fill={ELEVATED}
        stroke={BORDER}
        strokeWidth={1.5}
      />
      <text
        x={375}
        y={194}
        textAnchor="middle"
        fontSize={13}
        fontWeight={500}
        fill={FG}
        fontFamily="ui-sans-serif, system-ui"
      >
        Cited claim
      </text>
      <text
        x={375}
        y={210}
        textAnchor="middle"
        fontSize={11}
        fill={DIM}
        fontFamily="ui-monospace, monospace"
      >
        &quot;per Smith et al.&quot;
      </text>

      <line
        x1={530}
        y1={97}
        x2={420}
        y2={166}
        stroke={WARNING}
        strokeWidth={2}
        strokeDasharray="5 4"
        markerEnd="url(#training-source-arrow)"
      />
      <text
        x={510}
        y={138}
        fontSize={11}
        fill={WARNING}
        fontWeight={500}
        fontFamily="ui-monospace, monospace"
      >
        actual source
      </text>

      <line
        x1={215}
        y1={92}
        x2={335}
        y2={166}
        stroke={DIM}
        strokeWidth={1.5}
        strokeDasharray="2 4"
        strokeOpacity={0.55}
      />
      <text
        x={235}
        y={138}
        fontSize={11}
        fill={DIM}
        fontStyle="italic"
        fontFamily="ui-monospace, monospace"
      >
        expected source
      </text>
    </svg>
  );
}
