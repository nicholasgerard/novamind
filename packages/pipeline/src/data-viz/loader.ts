import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClinicalTrialsDatasetSchema,
  type ClinicalTrialsDataset,
} from "@novamind/shared";
import {
  DataSourceUnavailableError,
  fetchJsonWithTimeout,
  productionDataSourcesRequired,
} from "../rag/loader";
import fixture from "./trials-fixture.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));
const LOCAL_TRIALS_DIRS: readonly string[] = process.env.NOVAMIND_TRIALS_DIR
  ? [process.env.NOVAMIND_TRIALS_DIR]
  : Array.from(
      new Set([
        resolve(here, "../../../../internal/clinical-trials/data"),
        resolve(here, "../../../internal/clinical-trials/data"),
        resolve(process.cwd(), "../../internal/clinical-trials/data"),
        resolve(process.cwd(), "internal/clinical-trials/data"),
      ]),
    );

export type ClinicalTrialsSourceMode = "r2" | "local" | "fixture";

export interface ClinicalTrialsDatasetSource {
  dataset: ClinicalTrialsDataset;
  mode: ClinicalTrialsSourceMode;
  name: string;
  isFixture: boolean;
}

let cached: ClinicalTrialsDatasetSource | null = null;
let pending: Promise<ClinicalTrialsDatasetSource> | null = null;

export function fixtureModeEnabled(): boolean {
  return process.env.DEMO_FIXTURE_MODE === "true";
}

export async function loadClinicalTrialsDataset(): Promise<ClinicalTrialsDataset> {
  return (await loadClinicalTrialsDatasetSource()).dataset;
}

export function loadClinicalTrialsDatasetSource(): Promise<ClinicalTrialsDatasetSource> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = (async () => {
      if (fixtureModeEnabled()) {
        cached = fixtureSource();
        return cached;
      }
      const fromR2 = await tryLoadFromR2();
      if (fromR2) {
        cached = fromR2;
        return fromR2;
      }
      const fromFs = tryLoadFromFs();
      if (fromFs) {
        cached = fromFs;
        return fromFs;
      }
      if (productionDataSourcesRequired()) {
        throw new DataSourceUnavailableError(
          "ClinicalTrials.gov dataset",
          "set NOVAMIND_TRIALS_URL to an R2 clinical-trials.json object, provide NOVAMIND_TRIALS_DIR with clinical-trials.json, or set DEMO_FIXTURE_MODE=true for an explicit fixture-backed demo",
        );
      }
      cached = fixtureSource();
      return cached;
    })();
  }
  return pending;
}

async function tryLoadFromR2(): Promise<ClinicalTrialsDatasetSource | null> {
  const url = process.env.NOVAMIND_TRIALS_URL;
  if (!url) return null;
  try {
    const raw = await fetchJsonWithTimeout(url, 30_000);
    const parsed = ClinicalTrialsDatasetSchema.parse(raw);
    console.log(
      `[data-viz] loaded R2 ClinicalTrials.gov dataset: ${parsed.studies.length} studies`,
    );
    return {
      dataset: parsed,
      mode: "r2",
      name: "ClinicalTrials.gov R2 snapshot",
      isFixture: false,
    };
  } catch (err) {
    console.warn("[data-viz] R2 ClinicalTrials.gov fetch failed:", err);
    return null;
  }
}

function tryLoadFromFs(): ClinicalTrialsDatasetSource | null {
  for (const dir of LOCAL_TRIALS_DIRS) {
    const path = resolve(dir, "clinical-trials.json");
    if (!existsSync(path)) continue;
    try {
      const parsed = ClinicalTrialsDatasetSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      console.log(
        `[data-viz] loaded local ClinicalTrials.gov dataset: ${parsed.studies.length} studies from ${path}`,
      );
      return {
        dataset: parsed,
        mode: "local",
        name: path,
        isFixture: false,
      };
    } catch (err) {
      console.warn(`[data-viz] local clinical-trials.json parse failed:`, err);
      return null;
    }
  }
  return null;
}

function fixtureSource(): ClinicalTrialsDatasetSource {
  return {
    dataset: ClinicalTrialsDatasetSchema.parse(fixture),
    mode: "fixture",
    name: "offline fixture",
    isFixture: true,
  };
}
