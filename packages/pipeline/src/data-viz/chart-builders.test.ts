import { describe, expect, it } from "vitest";
import { ClinicalTrialsDatasetSchema } from "@novamind/shared";
import fixture from "./trials-fixture.json" with { type: "json" };
import { buildTrialChart, profileTrialDataset } from "./chart-builders";

const dataset = ClinicalTrialsDatasetSchema.parse(fixture);

describe("ClinicalTrials.gov chart builders", () => {
  it("profiles compact trial coverage for the report-builder agent", () => {
    const profile = profileTrialDataset(dataset);

    expect(profile.source.studies).toBeGreaterThan(0);
    expect(profile.interventionCounts.length).toBeGreaterThan(0);
    expect(
      profile.endpointFamilies.some((item) => item.label === "hba1c"),
    ).toBe(true);
  });

  it("builds a chart from raw outcome rows instead of a preselected chart id", () => {
    const built = buildTrialChart(
      dataset,
      {
        analysis: "outcome_signal",
        endpoint: "hba1c",
        focusTerms: ["hba1c", "tirzepatide"],
        rationale: "HbA1c is the endpoint named in the handoff.",
      },
      1,
    );

    expect(built.chart.id).toBe("report-chart-1-outcome_signal");
    expect(built.chart.points.length).toBeGreaterThan(0);
    expect(built.rationale).toContain("HbA1c");
  });
});
