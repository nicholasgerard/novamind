import { z } from "zod";

export const PaperSchema = z.object({
  pmid: z.string(),
  title: z.string(),
  abstract: z.string(),
  year: z.number().int(),
  journal: z.string(),
  authors: z.array(z.string()),
  meshTerms: z.array(z.string()),
});
export type Paper = z.infer<typeof PaperSchema>;

export const RetrievalHitSchema = z.object({
  paper: PaperSchema,
  score: z.number(),
  source: z.enum(["bm25", "vector", "hybrid"]),
});
export type RetrievalHit = z.infer<typeof RetrievalHitSchema>;
