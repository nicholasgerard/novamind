import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const MISSING_DIR = "/private/tmp/novamind-test-missing-data";

function restoreOriginalEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

function setMissingDataEnv() {
  delete process.env.DEMO_FIXTURE_MODE;
  delete process.env.NOVAMIND_PAPERS_URL;
  delete process.env.NOVAMIND_TRIALS_URL;
  process.env.NOVAMIND_CORPUS_DIR = MISSING_DIR;
  process.env.NOVAMIND_TRIALS_DIR = MISSING_DIR;
}

describe("production data source policy", () => {
  beforeEach(() => {
    vi.resetModules();
    restoreOriginalEnv();
    setMissingDataEnv();
  });

  afterEach(() => {
    vi.resetModules();
    restoreOriginalEnv();
  });

  it("allows explicit PubMed fixture mode", async () => {
    process.env.DEMO_FIXTURE_MODE = "true";
    const { loadCorpusSource } = await import("./rag/sources");

    const source = await loadCorpusSource();

    expect(source.name).toBe("fixture");
    expect(source.mode).toBe("fixture");
    expect(source.papers.length).toBeGreaterThan(0);
  });

  it("fails closed for PubMed corpus fallback in production", async () => {
    process.env.NODE_ENV = "production";
    const { loadCorpusSource } = await import("./rag/sources");

    await expect(loadCorpusSource()).rejects.toThrow(
      /PubMed corpus data source unavailable/,
    );
  });

  it("allows explicit ClinicalTrials.gov fixture mode", async () => {
    process.env.DEMO_FIXTURE_MODE = "true";
    const { loadClinicalTrialsDatasetSource } =
      await import("./data-viz/loader");

    const source = await loadClinicalTrialsDatasetSource();

    expect(source.mode).toBe("fixture");
    expect(source.isFixture).toBe(true);
    expect(source.dataset.studies.length).toBeGreaterThan(0);
  });

  it("fails closed for ClinicalTrials.gov fallback in production", async () => {
    process.env.NODE_ENV = "production";
    const { loadClinicalTrialsDatasetSource } =
      await import("./data-viz/loader");

    await expect(loadClinicalTrialsDatasetSource()).rejects.toThrow(
      /ClinicalTrials\.gov dataset data source unavailable/,
    );
  });
});
