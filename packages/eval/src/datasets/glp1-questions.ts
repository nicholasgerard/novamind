/**
 * Curated research questions for the GLP-1 + peptide therapeutics corpus.
 * Used across multiple eval axes; each axis derives its own EvalCase[] from
 * this list to keep the test surface comparable.
 */
export interface ResearchQuestion {
  id: string;
  question: string;
}

export const glp1Questions: ReadonlyArray<ResearchQuestion> = [
  {
    id: "tirzepatide-vs-semaglutide-weight",
    question:
      "How does tirzepatide compare to semaglutide for weight loss in adults with obesity?",
  },
  {
    id: "glp1-cardiovascular-outcomes",
    question:
      "What cardiovascular outcomes have been reported for GLP-1 receptor agonists in patients with type 2 diabetes?",
  },
  {
    id: "retatrutide-phase2",
    question:
      "What HbA1c reductions and weight changes have been observed with retatrutide in phase 2 trials?",
  },
  {
    id: "lipidation-half-life",
    question:
      "How does fatty-acid lipidation affect the in-vivo half-life of GLP-1 receptor agonists?",
  },
  {
    id: "tirzepatide-safety",
    question:
      "What are the most common adverse events reported in tirzepatide trials, and how do they vary by dose?",
  },
  {
    id: "oral-glp1-snac",
    question:
      "How effective is oral semaglutide using SNAC permeation enhancement compared to subcutaneous formulations?",
  },
  {
    id: "glucagon-receptor-retatrutide",
    question:
      "What is the role of glucagon receptor agonism in retatrutide's metabolic effects?",
  },
  {
    id: "tirzepatide-cv-trials",
    question:
      "Have cardiovascular outcome trials for tirzepatide in T2D patients reported results?",
  },
  {
    id: "liraglutide-vs-semaglutide-safety",
    question:
      "How does the safety profile of liraglutide compare to semaglutide in obesity treatment?",
  },
  {
    id: "pegylation-peptides",
    question:
      "What are the trade-offs of PEGylation versus lipidation for extending peptide therapeutic half-life?",
  },
];
