import { z } from "zod";

export const ClinicalTrialStudySchema = z.object({
  nctId: z.string(),
  title: z.string(),
  briefSummary: z.string().optional(),
  overallStatus: z.string(),
  phases: z.array(z.string()),
  conditions: z.array(z.string()),
  interventions: z.array(
    z.object({
      name: z.string(),
      type: z.string().optional(),
    }),
  ),
  enrollmentCount: z.number().int().nonnegative().optional(),
  enrollmentType: z.string().optional(),
  startDate: z.string().optional(),
  completionDate: z.string().optional(),
  hasResults: z.boolean(),
});
export type ClinicalTrialStudy = z.infer<typeof ClinicalTrialStudySchema>;

export const ClinicalTrialOutcomeMeasurementSchema = z.object({
  nctId: z.string(),
  studyTitle: z.string(),
  outcomeTitle: z.string(),
  outcomeType: z.string().optional(),
  timeFrame: z.string().optional(),
  groupId: z.string(),
  groupTitle: z.string(),
  value: z.number(),
  spread: z.number().optional(),
  unit: z.string().optional(),
});
export type ClinicalTrialOutcomeMeasurement = z.infer<
  typeof ClinicalTrialOutcomeMeasurementSchema
>;

export const ClinicalTrialAdverseEventSchema = z.object({
  nctId: z.string(),
  studyTitle: z.string(),
  term: z.string(),
  organSystem: z.string().optional(),
  groupId: z.string(),
  groupTitle: z.string(),
  serious: z.boolean(),
  numAffected: z.number().int().nonnegative(),
  numAtRisk: z.number().int().positive(),
});
export type ClinicalTrialAdverseEvent = z.infer<
  typeof ClinicalTrialAdverseEventSchema
>;

export const ClinicalTrialsDatasetSchema = z.object({
  _generated: z.string(),
  _source: z.literal("clinicaltrials.gov"),
  _sourceApiVersion: z.string().optional(),
  _sourceDataTimestamp: z.string().optional(),
  _query: z.string(),
  _count: z.number().int().nonnegative(),
  studies: z.array(ClinicalTrialStudySchema),
  outcomes: z.array(ClinicalTrialOutcomeMeasurementSchema),
  adverseEvents: z.array(ClinicalTrialAdverseEventSchema),
});
export type ClinicalTrialsDataset = z.infer<typeof ClinicalTrialsDatasetSchema>;
