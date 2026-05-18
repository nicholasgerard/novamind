import type { CitationVerdict } from "@novamind/pipeline";
import type { Paper } from "@novamind/shared";
import type { ResearchQuestion } from "./glp1-questions";

export interface ConfidenceExpectation {
  min: number;
  max: number;
  target: number;
}

export interface SignalRequirement {
  /** Human-readable audit concept shown to the judge and prompt improver. */
  label?: string;
  anyOf: readonly string[];
  weight?: number;
}

export interface PlanStabilityExpectations {
  /** Evidence IDs the answer should select when it gives a supported hypothesis. */
  expectedEvidenceIds: readonly string[];
  /** Evidence IDs that are acceptable to cite; defaults to expectedEvidenceIds. */
  allowedEvidenceIds?: readonly string[];
  confidence: ConfidenceExpectation;
  gapSignals: readonly SignalRequirement[];
  gapHandling: string;
  rejectedMisuseSignals?: readonly string[];
  rejectedClaimDiscipline: string;
}

export interface PlanStabilityCase extends ResearchQuestion {
  papers: readonly Paper[];
  verdicts: readonly CitationVerdict[];
  expectations: PlanStabilityExpectations;
}

/**
 * Fixed handoff fixtures for the hypothesis-only plan-stability eval. Each
 * case simulates the exact contract the hypothesis synthesis tool receives after
 * retrieval, claim extraction, and citation verification have already run.
 */
export const planStabilityCases: ReadonlyArray<PlanStabilityCase> = [
  {
    id: "tirzepatide-vs-semaglutide-weight",
    question:
      "How does tirzepatide compare to semaglutide for weight loss in adults with obesity?",
    papers: [
      {
        pmid: "EVAL-OB-001",
        title: "Tirzepatide once weekly for chronic weight management",
        abstract:
          "Tirzepatide was evaluated in adults with obesity over 72 weeks and produced substantial body-weight reduction versus placebo across dose arms, with gastrointestinal events as the most common adverse events.",
        year: 2022,
        journal: "Obesity Medicine",
        authors: ["Jastreboff A", "Aronne L"],
        meshTerms: ["Obesity", "Tirzepatide", "Body Weight"],
      },
      {
        pmid: "EVAL-OB-002",
        title: "Semaglutide 2.4 mg once weekly in adults with obesity",
        abstract:
          "Semaglutide 2.4 mg once weekly was evaluated in adults with overweight or obesity and produced substantially greater mean body-weight reduction than placebo, with gastrointestinal events commonly reported.",
        year: 2021,
        journal: "Obesity Trials",
        authors: ["Wilding J", "Batterham R"],
        meshTerms: ["Obesity", "Semaglutide", "Body Weight"],
      },
      {
        pmid: "EVAL-T2D-003",
        title: "Tirzepatide versus semaglutide in type 2 diabetes",
        abstract:
          "In patients with type 2 diabetes inadequately controlled on metformin, tirzepatide produced greater HbA1c and body-weight reductions than semaglutide 1 mg, with broadly similar gastrointestinal tolerability.",
        year: 2021,
        journal: "Diabetes Therapeutics",
        authors: ["Frias J", "Davies M"],
        meshTerms: ["Diabetes Mellitus, Type 2", "Tirzepatide", "Semaglutide"],
      },
      {
        pmid: "EVAL-OB-004",
        title: "Network comparisons of incretin therapies for obesity",
        abstract:
          "Network comparisons can rank incretin therapies when direct head-to-head obesity trials are absent, but estimates remain indirect and depend on trial comparability.",
        year: 2024,
        journal: "Clinical Obesity Review",
        authors: ["Lee C", "Morgan P"],
        meshTerms: ["Obesity", "Comparative Effectiveness Research"],
      },
    ],
    verdicts: [
      {
        evidenceId: "weight-tirzepatide-obesity",
        pmid: "EVAL-OB-001",
        claim:
          "Tirzepatide produced substantial body-weight reduction versus placebo in adults with obesity over 72 weeks.",
        supported: true,
        rationale:
          "The claim is directly stated in the tirzepatide obesity abstract.",
      },
      {
        evidenceId: "weight-semaglutide-obesity",
        pmid: "EVAL-OB-002",
        claim:
          "Semaglutide 2.4 mg produced substantially greater mean body-weight reduction than placebo in adults with overweight or obesity.",
        supported: true,
        rationale:
          "The claim is directly stated in the semaglutide obesity abstract.",
      },
      {
        evidenceId: "weight-tirzepatide-semaglutide-t2d",
        pmid: "EVAL-T2D-003",
        claim:
          "Tirzepatide produced greater HbA1c and body-weight reductions than semaglutide 1 mg in patients with type 2 diabetes.",
        supported: true,
        rationale:
          "The claim is directly stated in the diabetes head-to-head abstract.",
      },
      {
        evidenceId: "rejected-direct-obesity-head-to-head",
        pmid: "EVAL-OB-004",
        claim:
          "A direct obesity head-to-head trial showed tirzepatide caused more weight loss than semaglutide 2.4 mg.",
        supported: false,
        rationale:
          "The abstract says direct head-to-head obesity trials are absent; it does not support this claim.",
      },
    ],
    expectations: {
      expectedEvidenceIds: [
        "weight-tirzepatide-obesity",
        "weight-semaglutide-obesity",
      ],
      allowedEvidenceIds: [
        "weight-tirzepatide-obesity",
        "weight-semaglutide-obesity",
        "weight-tirzepatide-semaglutide-t2d",
      ],
      confidence: { min: 0.45, max: 0.7, target: 0.6 },
      gapSignals: [
        {
          label: "obesity comparison is indirect",
          anyOf: ["indirect", "no direct", "direct head-to-head"],
        },
        {
          label: "direct comparison evidence is from type 2 diabetes",
          anyOf: ["type 2 diabetes", "T2D", "not adults with obesity"],
        },
        {
          label: "direct obesity head-to-head conclusion cannot be made",
          anyOf: ["uncertain", "cautious", "cannot", "not available"],
        },
      ],
      gapHandling:
        "The answer should compare cautiously and make the evidence boundary auditable: obesity evidence is placebo-controlled for each drug, the only direct tirzepatide-versus-semaglutide evidence is in type 2 diabetes, and the diabetes trial used semaglutide 1 mg rather than the 2.4 mg obesity dose. Full credit requires explicitly saying the obesity comparison is indirect and cannot establish a direct obesity head-to-head result.",
      rejectedMisuseSignals: [
        "direct obesity head-to-head trial showed",
        "direct head-to-head obesity trial showed",
      ],
      rejectedClaimDiscipline:
        "The rejected direct obesity head-to-head claim must not be used as evidence or stated as true. Full credit requires making the rejected claim visible as unsupported or blocked: direct obesity head-to-head evidence is missing, not merely uncited.",
    },
  },
  {
    id: "glp1-cardiovascular-outcomes",
    question:
      "What cardiovascular outcomes have been reported for GLP-1 receptor agonists in patients with type 2 diabetes?",
    papers: [
      {
        pmid: "EVAL-PDC-001",
        title: "Peptide-drug conjugates for targeted oncology delivery",
        abstract:
          "Peptide-drug conjugates use receptor-targeting peptides to deliver cytotoxic payloads in oncology settings. The design challenge is balancing tumor selectivity, linker stability, payload potency, and systemic tolerability.",
        year: 2024,
        journal: "Journal of Peptide Therapeutics",
        authors: ["Chen L", "Morris R"],
        meshTerms: ["Peptides", "Drug Delivery Systems", "Neoplasms"],
      },
      {
        pmid: "EVAL-CYC-002",
        title:
          "Macrocyclization strategies for protease-resistant peptide scaffolds",
        abstract:
          "Macrocyclization can increase conformational rigidity and protease resistance in peptide scaffolds, improving binding selectivity and metabolic stability outside incretin biology.",
        year: 2023,
        journal: "Peptide Science",
        authors: ["Rivera N", "Khan O"],
        meshTerms: ["Peptides", "Molecular Structure", "Proteolysis"],
      },
      {
        pmid: "EVAL-VAX-003",
        title: "Adjuvant selection for peptide vaccine formulations",
        abstract:
          "Peptide vaccine formulations often require adjuvants to improve antigen presentation and immune durability. Formulation choices affect T-cell priming and reactogenicity.",
        year: 2021,
        journal: "Vaccine Formulation Review",
        authors: ["Bennett H", "Okafor M"],
        meshTerms: ["Vaccines", "Adjuvants, Immunologic", "Peptides"],
      },
    ],
    verdicts: [
      {
        evidenceId: "offtopic-peptide-drug-conjugates",
        pmid: "EVAL-PDC-001",
        claim:
          "Peptide-drug conjugates use receptor-targeting peptides to deliver cytotoxic payloads in oncology settings.",
        supported: true,
        rationale:
          "The claim is directly stated in the oncology peptide-drug conjugate abstract.",
      },
      {
        evidenceId: "offtopic-macrocyclization",
        pmid: "EVAL-CYC-002",
        claim:
          "Macrocyclization can increase conformational rigidity and protease resistance in peptide scaffolds.",
        supported: true,
        rationale:
          "The claim is directly stated in the macrocyclization abstract.",
      },
      {
        evidenceId: "offtopic-peptide-vaccines",
        pmid: "EVAL-VAX-003",
        claim:
          "Peptide vaccine formulations often require adjuvants to improve antigen presentation and immune durability.",
        supported: true,
        rationale:
          "The claim is directly stated in the peptide vaccine formulation abstract.",
      },
    ],
    expectations: {
      expectedEvidenceIds: [],
      confidence: { min: 0, max: 0.15, target: 0.05 },
      gapSignals: [
        {
          label: "verified claims are off-question",
          anyOf: ["do not address", "does not address", "no evidence"],
        },
        {
          label: "missing cardiovascular GLP-1 T2D evidence",
          anyOf: ["cardiovascular", "GLP-1", "type 2 diabetes"],
        },
        {
          label: "refuse to synthesize a cardiovascular conclusion",
          anyOf: ["cannot", "no evidence-grounded", "no hypothesis"],
        },
      ],
      gapHandling:
        "The answer should say the verified claims do not address cardiovascular outcomes, GLP-1 receptor agonists, or type 2 diabetes. Full credit requires refusing to synthesize a cardiovascular conclusion and naming the verified claims as off-question evidence rather than weak cardiovascular evidence.",
      rejectedClaimDiscipline:
        "There are no rejected claims in this case; the answer should simply avoid using off-question verified claims as support.",
    },
  },
  {
    id: "retatrutide-phase2",
    question:
      "What HbA1c reductions and weight changes have been observed with retatrutide in phase 2 trials?",
    papers: [
      {
        pmid: "EVAL-RET-001",
        title: "Retatrutide phase 2 trial in adults with obesity",
        abstract:
          "Retatrutide, a triple agonist of GIP, GLP-1, and glucagon receptors, was assessed in a phase 2 trial in adults with obesity. Higher dose arms produced mean body-weight reduction exceeding twenty-four percent at 48 weeks.",
        year: 2023,
        journal: "Metabolic Trials",
        authors: ["Kaplan L", "Frias J"],
        meshTerms: ["Retatrutide", "Obesity", "Body Weight"],
      },
      {
        pmid: "EVAL-RET-002",
        title: "Dose response and tolerability of retatrutide",
        abstract:
          "Retatrutide showed dose-related body-weight reductions with gastrointestinal adverse events consistent with incretin therapies. The abstract did not report HbA1c change values.",
        year: 2023,
        journal: "Incretin Research",
        authors: ["Nguyen T", "Price D"],
        meshTerms: [
          "Retatrutide",
          "Dose-Response Relationship",
          "Adverse Events",
        ],
      },
    ],
    verdicts: [
      {
        evidenceId: "retatrutide-weight-phase2",
        pmid: "EVAL-RET-001",
        claim:
          "In a phase 2 trial in adults with obesity, higher retatrutide dose arms produced mean body-weight reduction exceeding twenty-four percent at 48 weeks.",
        supported: true,
        rationale:
          "The claim is directly stated in the retatrutide phase 2 abstract.",
      },
      {
        evidenceId: "retatrutide-dose-weight",
        pmid: "EVAL-RET-002",
        claim:
          "Retatrutide showed dose-related body-weight reductions with gastrointestinal adverse events consistent with incretin therapies.",
        supported: true,
        rationale:
          "The claim is directly stated in the dose-response abstract.",
      },
      {
        evidenceId: "rejected-retatrutide-hba1c",
        pmid: "EVAL-RET-002",
        claim:
          "Retatrutide reduced HbA1c by 2.0 percentage points in the phase 2 trial.",
        supported: false,
        rationale:
          "The abstract explicitly does not report HbA1c change values.",
      },
    ],
    expectations: {
      expectedEvidenceIds: ["retatrutide-weight-phase2"],
      allowedEvidenceIds: [
        "retatrutide-weight-phase2",
        "retatrutide-dose-weight",
      ],
      confidence: { min: 0.35, max: 0.6, target: 0.52 },
      gapSignals: [
        {
          label: "requested HbA1c facet",
          anyOf: ["HbA1c"],
        },
        {
          label: "HbA1c value is missing from verified claims",
          anyOf: [
            "did not report HbA1c",
            "not report HbA1c",
            "no HbA1c reduction",
            "HbA1c change values",
            "HbA1c value is unavailable",
            "HbA1c value is not available",
          ],
        },
        {
          label: "supported weight-loss result",
          anyOf: [
            "body-weight reduction",
            "weight reduction",
            "24%",
            "twenty-four percent",
          ],
        },
      ],
      gapHandling:
        "The answer should separately cover both requested facets: supported weight-loss results, including the >24% phase 2 result and dose-related weight-loss claim, and the missing HbA1c result. Full credit requires explicitly saying no HbA1c reduction value is available in the verified claims.",
      rejectedMisuseSignals: ["2.0 percentage points", "reduced HbA1c by 2"],
      rejectedClaimDiscipline:
        "The rejected HbA1c value must not be reported as fact or used as evidence. Full credit requires visibly blocking the rejected 2.0 percentage point HbA1c claim as unsupported, not just omitting the number.",
    },
  },
  {
    id: "tirzepatide-safety",
    question:
      "What are the most common adverse events reported in tirzepatide trials, and how do they vary by dose?",
    papers: [
      {
        pmid: "EVAL-SAFE-001",
        title: "Adverse events in once-weekly tirzepatide obesity trials",
        abstract:
          "Across tirzepatide dose arms, gastrointestinal adverse events including nausea, diarrhea, and vomiting were the most common events. Most events were mild to moderate and occurred during dose escalation.",
        year: 2022,
        journal: "Obesity Safety",
        authors: ["Martin K", "Shah R"],
        meshTerms: ["Tirzepatide", "Adverse Events", "Obesity"],
      },
      {
        pmid: "EVAL-SAFE-002",
        title: "Treatment discontinuation in tirzepatide studies",
        abstract:
          "Tirzepatide studies reported low rates of treatment discontinuation due to adverse events, with gastrointestinal tolerability remaining the dominant safety consideration.",
        year: 2023,
        journal: "Clinical Diabetes Safety",
        authors: ["Park S", "Diaz M"],
        meshTerms: ["Tirzepatide", "Treatment Discontinuation"],
      },
    ],
    verdicts: [
      {
        evidenceId: "tirzepatide-gi-events-common",
        pmid: "EVAL-SAFE-001",
        claim:
          "Gastrointestinal adverse events including nausea, diarrhea, and vomiting were the most common events across tirzepatide dose arms.",
        supported: true,
        rationale:
          "The claim is directly stated in the tirzepatide safety abstract.",
      },
      {
        evidenceId: "tirzepatide-discontinuation-low",
        pmid: "EVAL-SAFE-002",
        claim:
          "Tirzepatide studies reported low rates of treatment discontinuation due to adverse events.",
        supported: true,
        rationale:
          "The claim is directly stated in the discontinuation abstract.",
      },
      {
        evidenceId: "rejected-tirzepatide-dose-gradient",
        pmid: "EVAL-SAFE-001",
        claim:
          "Nausea increased monotonically from 5 mg to 10 mg to 15 mg with exact dose-specific percentages.",
        supported: false,
        rationale:
          "The abstract identifies common gastrointestinal events across dose arms but does not provide exact dose-specific percentages or a monotonic gradient.",
      },
    ],
    expectations: {
      expectedEvidenceIds: ["tirzepatide-gi-events-common"],
      allowedEvidenceIds: [
        "tirzepatide-gi-events-common",
        "tirzepatide-discontinuation-low",
      ],
      confidence: { min: 0.45, max: 0.7, target: 0.58 },
      gapSignals: [
        {
          label: "common GI adverse events",
          anyOf: ["nausea", "diarrhea", "vomiting", "gastrointestinal"],
        },
        {
          label: "events occurred during dose escalation",
          anyOf: ["dose escalation", "escalation"],
        },
        {
          label: "dose-specific variation was requested",
          anyOf: [
            "dose-specific",
            "by dose",
            "dose variation",
            "dose response",
            "dose-response",
          ],
        },
        {
          label: "exact dose-specific percentages are unsupported",
          anyOf: [
            "no exact dose-specific",
            "not provide exact",
            "not support exact",
            "dose-specific percentages",
            "monotonic",
            "monotonically",
            "cannot quantify",
          ],
        },
      ],
      gapHandling:
        "The answer should identify common gastrointestinal adverse events, mention that events occurred during dose escalation, and separately state that the verified claims do not support exact dose-specific variation. Full credit requires not collapsing low discontinuation into the answer to dose variation.",
      rejectedMisuseSignals: [
        "monotonically",
        "exact dose-specific percentages",
      ],
      rejectedClaimDiscipline:
        "The rejected exact dose-gradient claim must not be stated as true. Full credit requires explicitly blocking the monotonic 5 mg to 10 mg to 15 mg percentage-gradient claim as unsupported when discussing dose variation.",
    },
  },
  {
    id: "lipidation-half-life",
    question:
      "How does fatty-acid lipidation affect the in-vivo half-life of GLP-1 receptor agonists?",
    papers: [
      {
        pmid: "EVAL-LIP-001",
        title: "Fatty-acid lipidation for half-life extension of GLP-1 analogs",
        abstract:
          "Fatty-acid lipidation enables reversible albumin binding, reducing renal clearance and proteolytic degradation. This mechanism prolongs in-vivo half-life for GLP-1 analogs and other peptide therapeutics.",
        year: 2020,
        journal: "Peptide Pharmacokinetics",
        authors: ["Holm P", "Rasmussen J"],
        meshTerms: ["Lipidation", "Albumins", "GLP-1 Receptor Agonists"],
      },
      {
        pmid: "EVAL-LIP-002",
        title: "PEGylation in peptide therapeutics",
        abstract:
          "PEGylation extends circulating half-life of peptide drugs by increasing hydrodynamic size and reducing renal clearance, but it can alter receptor binding and manufacturability.",
        year: 2019,
        journal: "Drug Delivery Reviews",
        authors: ["Baker H", "Stone M"],
        meshTerms: ["PEGylation", "Peptides", "Half-Life"],
      },
      {
        pmid: "EVAL-SNAC-003",
        title: "SNAC permeation enhancement for oral peptide delivery",
        abstract:
          "SNAC and related permeation enhancers can improve oral bioavailability of peptide drugs by promoting gastric absorption, but the mechanism is distinct from half-life extension.",
        year: 2021,
        journal: "Oral Peptide Delivery",
        authors: ["Mehta P", "Santos A"],
        meshTerms: ["SNAC", "Bioavailability", "Peptides"],
      },
    ],
    verdicts: [
      {
        evidenceId: "lipidation-albumin-half-life",
        pmid: "EVAL-LIP-001",
        claim:
          "Fatty-acid lipidation enables reversible albumin binding, reduces renal clearance and proteolytic degradation, and prolongs in-vivo half-life for GLP-1 analogs.",
        supported: true,
        rationale: "The claim is directly stated in the lipidation abstract.",
      },
      {
        evidenceId: "pegylation-half-life-contrast",
        pmid: "EVAL-LIP-002",
        claim:
          "PEGylation extends circulating half-life of peptide drugs by increasing hydrodynamic size and reducing renal clearance.",
        supported: true,
        rationale: "The claim is directly stated in the PEGylation abstract.",
      },
      {
        evidenceId: "snac-oral-bioavailability",
        pmid: "EVAL-SNAC-003",
        claim:
          "SNAC can improve oral bioavailability of peptide drugs by promoting gastric absorption.",
        supported: true,
        rationale: "The claim is directly stated in the SNAC abstract.",
      },
      {
        evidenceId: "rejected-lipidation-always-best",
        pmid: "EVAL-LIP-002",
        claim:
          "Fatty-acid lipidation always outperforms PEGylation and SNAC for half-life extension.",
        supported: false,
        rationale:
          "The abstracts describe different mechanisms but do not support an always-outperforms comparison.",
      },
    ],
    expectations: {
      expectedEvidenceIds: ["lipidation-albumin-half-life"],
      allowedEvidenceIds: [
        "lipidation-albumin-half-life",
        "pegylation-half-life-contrast",
      ],
      confidence: { min: 0.65, max: 0.85, target: 0.72 },
      gapSignals: [
        {
          label: "albumin-binding mechanism",
          anyOf: ["albumin"],
        },
        {
          label: "renal-clearance or proteolysis mechanism",
          anyOf: ["renal clearance", "proteolytic"],
        },
        {
          label:
            "SNAC is absorption/bioavailability context, not half-life evidence",
          anyOf: [
            "SNAC is distinct",
            "SNAC is not half-life",
            "SNAC does not",
            "SNAC oral bioavailability",
            "SNAC absorption",
            "bioavailability rather than half-life",
            "absorption, not half-life",
          ],
        },
      ],
      gapHandling:
        "The answer should center the lipidation-to-albumin-binding mechanism, connect it to reduced renal clearance and proteolytic degradation, and avoid treating SNAC oral bioavailability as half-life evidence. PEGylation can be used only as a mechanistic contrast. Full credit requires explicitly separating SNAC absorption/bioavailability from half-life extension.",
      rejectedMisuseSignals: ["always outperforms"],
      rejectedClaimDiscipline:
        "The rejected broad superiority claim must not be stated. Full credit requires explicitly saying the evidence does not support lipidation always outperforming PEGylation or SNAC, not just avoiding a ranking.",
    },
  },
];
