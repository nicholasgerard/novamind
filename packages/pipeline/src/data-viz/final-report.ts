export const DATA_VIZ_FINAL_REPORT_WORD_BUDGET = 90;

export const DATA_VIZ_FINAL_REPORT_GUIDANCE = [
  "The final Agent SDK structured output is the only report artifact.",
  "After chart 4 succeeds, return the structured output immediately; do not re-plan, call more tools, or write a markdown report.",
  "recommendation: one sentence.",
  "rationale: one sentence, using the chart summaries already returned by tools.",
  "caveats: zero to two short strings; prefer an empty array when there is no material caveat.",
  `Keep the entire structured output under ${DATA_VIZ_FINAL_REPORT_WORD_BUDGET} words.`,
].join("\n");

export const DATA_VIZ_FINAL_REPORT_TOOL_HINT =
  "next=return_final_structured_output recommendation=one_sentence rationale=one_sentence caveats=0_to_2_short_strings markdown=false";
