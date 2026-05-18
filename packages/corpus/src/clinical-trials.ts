import {
  ClinicalTrialsDatasetSchema,
  type ClinicalTrialAdverseEvent,
  type ClinicalTrialOutcomeMeasurement,
  type ClinicalTrialStudy,
  type ClinicalTrialsDataset,
} from "@novamind/shared";

const CTG_BASE = "https://clinicaltrials.gov/api/v2";
const DEFAULT_QUERY =
  "(semaglutide OR tirzepatide OR retatrutide OR liraglutide OR dulaglutide OR exenatide OR GLP-1)";

export interface FetchClinicalTrialsOptions {
  query?: string;
  retmax?: number;
  pageSize?: number;
}

export async function fetchClinicalTrialsDataset(
  opts: FetchClinicalTrialsOptions = {},
): Promise<ClinicalTrialsDataset> {
  const query = opts.query ?? DEFAULT_QUERY;
  const retmax = opts.retmax ?? 250;
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 100);
  const version = await fetchVersion().catch(() => ({}));

  const rawStudies: unknown[] = [];
  let pageToken: string | undefined;
  while (rawStudies.length < retmax) {
    const page = await fetchStudiesPage({
      query,
      pageSize: Math.min(pageSize, retmax - rawStudies.length),
      pageToken,
    });
    rawStudies.push(...page.studies);
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  const studies: ClinicalTrialStudy[] = [];
  const outcomes: ClinicalTrialOutcomeMeasurement[] = [];
  const adverseEvents: ClinicalTrialAdverseEvent[] = [];

  for (const raw of rawStudies) {
    const normalized = normalizeStudy(raw);
    if (!normalized) continue;
    studies.push(normalized.study);
    outcomes.push(...normalized.outcomes);
    adverseEvents.push(...normalized.adverseEvents);
  }

  return ClinicalTrialsDatasetSchema.parse({
    _generated: new Date().toISOString(),
    _source: "clinicaltrials.gov",
    _sourceApiVersion: stringValue(record(version).apiVersion),
    _sourceDataTimestamp: stringValue(record(version).dataTimestamp),
    _query: query,
    _count: studies.length,
    studies,
    outcomes,
    adverseEvents,
  });
}

async function fetchVersion(): Promise<unknown> {
  const res = await fetch(`${CTG_BASE}/version`);
  if (!res.ok)
    throw new Error(`ClinicalTrials.gov version failed: ${res.status}`);
  return res.json();
}

async function fetchStudiesPage(args: {
  query: string;
  pageSize: number;
  pageToken?: string;
}): Promise<{ studies: unknown[]; nextPageToken?: string }> {
  const url = new URL(`${CTG_BASE}/studies`);
  url.searchParams.set("query.term", args.query);
  url.searchParams.set("filter.advanced", "AREA[HasResults]true");
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", String(args.pageSize));
  url.searchParams.set("countTotal", "true");
  if (args.pageToken) url.searchParams.set("pageToken", args.pageToken);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `ClinicalTrials.gov studies failed: ${res.status} ${res.statusText}`,
    );
  }
  const json = record(await res.json());
  const studies = arrayValue(json.studies);
  return {
    studies,
    nextPageToken: stringValue(json.nextPageToken),
  };
}

function normalizeStudy(raw: unknown): {
  study: ClinicalTrialStudy;
  outcomes: ClinicalTrialOutcomeMeasurement[];
  adverseEvents: ClinicalTrialAdverseEvent[];
} | null {
  const root = record(raw);
  const protocol = record(root.protocolSection);
  const results = record(root.resultsSection);
  const identification = record(protocol.identificationModule);
  const status = record(protocol.statusModule);
  const design = record(protocol.designModule);
  const conditions = record(protocol.conditionsModule);
  const arms = record(protocol.armsInterventionsModule);
  const nctId = stringValue(identification.nctId);
  const title = stringValue(identification.briefTitle);
  if (!nctId || !title) return null;

  const study: ClinicalTrialStudy = {
    nctId,
    title,
    briefSummary: stringValue(record(protocol.descriptionModule).briefSummary),
    overallStatus: stringValue(status.overallStatus) ?? "UNKNOWN",
    phases: stringArray(design.phases),
    conditions: stringArray(conditions.conditions),
    interventions: arrayValue(arms.interventions)
      .map((item) => {
        const intervention = record(item);
        const name = stringValue(intervention.name);
        if (!name) return null;
        const type = stringValue(intervention.type);
        return {
          name,
          ...(type ? { type } : {}),
        };
      })
      .filter((item): item is { name: string; type?: string } => item !== null),
    enrollmentCount: numberValue(record(design.enrollmentInfo).count),
    enrollmentType: stringValue(record(design.enrollmentInfo).type),
    startDate: stringValue(record(status.startDateStruct).date),
    completionDate: stringValue(record(status.completionDateStruct).date),
    hasResults: root.hasResults === true,
  };

  return {
    study,
    outcomes: normalizeOutcomeMeasurements(nctId, title, results),
    adverseEvents: normalizeAdverseEvents(nctId, title, results),
  };
}

function normalizeOutcomeMeasurements(
  nctId: string,
  studyTitle: string,
  results: Record<string, unknown>,
): ClinicalTrialOutcomeMeasurement[] {
  const out: ClinicalTrialOutcomeMeasurement[] = [];
  const module = record(results.outcomeMeasuresModule);
  for (const rawMeasure of arrayValue(module.outcomeMeasures)) {
    const measure = record(rawMeasure);
    const groups = new Map<string, string>();
    for (const rawGroup of arrayValue(measure.groups)) {
      const group = record(rawGroup);
      const id = stringValue(group.id);
      const title = stringValue(group.title);
      if (id && title) groups.set(id, title);
    }

    for (const rawClass of arrayValue(measure.classes)) {
      const outcomeClass = record(rawClass);
      for (const rawCategory of arrayValue(outcomeClass.categories)) {
        const category = record(rawCategory);
        for (const rawMeasurement of arrayValue(category.measurements)) {
          const measurement = record(rawMeasurement);
          const groupId = stringValue(measurement.groupId);
          const value = numberValue(measurement.value);
          if (!groupId || value === undefined) continue;
          out.push({
            nctId,
            studyTitle,
            outcomeTitle: stringValue(measure.title) ?? "Outcome",
            outcomeType: stringValue(measure.type),
            timeFrame: stringValue(measure.timeFrame),
            groupId,
            groupTitle: groups.get(groupId) ?? groupId,
            value,
            spread: numberValue(measurement.spread),
            unit: stringValue(measure.unitOfMeasure),
          });
        }
      }
    }
  }
  return out;
}

function normalizeAdverseEvents(
  nctId: string,
  studyTitle: string,
  results: Record<string, unknown>,
): ClinicalTrialAdverseEvent[] {
  const out: ClinicalTrialAdverseEvent[] = [];
  const module = record(results.adverseEventsModule);
  const groups = new Map<string, string>();
  for (const rawGroup of arrayValue(module.eventGroups)) {
    const group = record(rawGroup);
    const id = stringValue(group.id);
    const title = stringValue(group.title);
    if (id && title) groups.set(id, title);
  }

  for (const [serious, events] of [
    [true, arrayValue(module.seriousEvents)],
    [false, arrayValue(module.otherEvents)],
  ] as const) {
    for (const rawEvent of events) {
      const event = record(rawEvent);
      const term = stringValue(event.term);
      if (!term) continue;
      for (const rawStat of arrayValue(event.stats)) {
        const stat = record(rawStat);
        const groupId = stringValue(stat.groupId);
        const numAffected = numberValue(stat.numAffected);
        const numAtRisk = numberValue(stat.numAtRisk);
        if (
          !groupId ||
          numAffected === undefined ||
          numAtRisk === undefined ||
          numAtRisk <= 0
        ) {
          continue;
        }
        out.push({
          nctId,
          studyTitle,
          term,
          organSystem: stringValue(event.organSystem),
          groupId,
          groupTitle: groups.get(groupId) ?? groupId,
          serious,
          numAffected: Math.max(0, Math.trunc(numAffected)),
          numAtRisk: Math.max(1, Math.trunc(numAtRisk)),
        });
      }
    }
  }
  return out;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return arrayValue(value).filter(
    (item): item is string => typeof item === "string",
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
