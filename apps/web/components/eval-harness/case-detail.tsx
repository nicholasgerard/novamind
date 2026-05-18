import type { BaselineCase, CaseState, MetricMeta, ScoreMap } from "./types";

interface PlanCaseOutput {
  hypothesis: string;
  confidence: number | null;
  selectedEvidenceIds: string[];
  handoffPmids: string[];
  evidence: Array<{ citation: string; claim: string }>;
  gradingNotes: Record<string, string>;
}

export function CaseDetailCard({
  caseItem,
  runCase,
  metrics,
}: {
  caseItem: BaselineCase;
  runCase: CaseState | undefined;
  metrics: ReadonlyArray<MetricMeta>;
}) {
  const parsed = parsePlanCaseOutput(runCase?.output);

  return (
    <section className="min-w-0">
      <div className="space-y-3">
        <div className="rounded-md border border-border/70 bg-background/35 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Hypothesis
            </p>
            {parsed?.confidence !== null &&
              parsed?.confidence !== undefined && (
                <span className="rounded-md border border-border/70 bg-background/55 px-2 py-1 font-mono text-xs">
                  confidence {(parsed.confidence * 100).toFixed(0)}%
                </span>
              )}
          </div>
          <p className="mt-3 text-lg font-light leading-8 text-foreground/90">
            {parsed?.hypothesis ??
              (runCase?.error
                ? "This case errored before producing a hypothesis."
                : `Run output for ${caseItem.label} will appear here after the selected case completes.`)}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <EvidenceBox
            title="Selected evidence IDs"
            items={parsed?.selectedEvidenceIds ?? []}
            empty="No selected evidence IDs"
          />
          <EvidenceBox
            title="Handoff PMIDs"
            items={parsed?.handoffPmids ?? []}
            empty="No handoff PMIDs"
          />
        </div>

        {parsed?.evidence && parsed.evidence.length > 0 && (
          <div className="border-t border-border/60 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Evidence surfaced
            </p>
            <div className="mt-2 space-y-2">
              {parsed.evidence.map((item) => (
                <div
                  key={`${item.citation}-${item.claim}`}
                  className="border-l border-primary/30 py-1 pl-3"
                >
                  <p className="font-mono text-[10px] text-primary">
                    {item.citation}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {item.claim}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2 rounded-md border border-border/70 bg-background/35 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Grader response
          </p>
          <div className="space-y-2">
            {metrics.map((metric) => (
              <MetricGradeCard
                key={metric.key}
                metric={metric}
                scores={runCase?.scores}
                note={parsed?.gradingNotes[metric.key]}
              />
            ))}
            {runCase?.error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {runCase.error}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricGradeCard({
  metric,
  scores,
  note,
}: {
  metric: MetricMeta;
  scores: ScoreMap | undefined;
  note: string | undefined;
}) {
  const value = scores?.[metric.key];
  return (
    <div className="border-t border-border/50 py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-medium">{metric.label}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {note ?? metric.description}
          </p>
        </div>
        <span className="grid size-14 shrink-0 place-items-center rounded-full border border-foreground/75 bg-foreground/[0.035] font-mono text-sm font-semibold tabular-nums text-foreground shadow-[0_0_18px_rgb(240_237_227_/_0.08)]">
          {value === undefined ? "--" : `${(value * 100).toFixed(0)}`}
        </span>
      </div>
    </div>
  );
}

function EvidenceBox({
  title,
  items,
  empty,
}: {
  title: string;
  items: readonly string[];
  empty: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background/35 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.length > 0 ? (
          items.map((item) => (
            <code
              key={item}
              className="rounded bg-secondary px-1.5 py-1 font-mono text-[10px] text-secondary-foreground"
            >
              {item}
            </code>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{empty}</span>
        )}
      </div>
    </div>
  );
}

function parsePlanCaseOutput(output: unknown): PlanCaseOutput | null {
  const record = asRecord(output);
  if (!record) return null;
  const result = asRecord(record.result);
  const hypothesis =
    typeof result?.hypothesis === "string" ? result.hypothesis : "";
  const confidence =
    typeof result?.confidence === "number" ? result.confidence : null;
  const selectedEvidenceIds = stringArray(record.selectedEvidenceIds);
  const handoffPmids = stringArray(record.handoffPmids);
  const gradingNotes = stringRecord(record.gradingNotes);
  const evidence = Array.isArray(result?.evidence)
    ? result.evidence.flatMap((item) => {
        const evidenceItem = asRecord(item);
        if (!evidenceItem) return [];
        const citation =
          typeof evidenceItem.citation === "string"
            ? evidenceItem.citation
            : "";
        const claim =
          typeof evidenceItem.claim === "string" ? evidenceItem.claim : "";
        return citation || claim ? [{ citation, claim }] : [];
      })
    : [];

  return {
    hypothesis,
    confidence,
    selectedEvidenceIds,
    handoffPmids,
    evidence,
    gradingNotes,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
