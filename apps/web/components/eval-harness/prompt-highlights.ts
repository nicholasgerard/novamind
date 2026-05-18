import type { PromptChangeHighlight } from "./prompt-editor";
import type { ImprovementResult } from "./use-prompt-improver";

export function buildPromptHighlights({
  after,
  before,
  improvement,
}: {
  after: string;
  before: string;
  improvement: ImprovementResult;
}): PromptChangeHighlight[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }

  let endBefore = beforeLines.length - 1;
  let endAfter = afterLines.length - 1;
  while (
    endBefore >= start &&
    endAfter >= start &&
    beforeLines[endBefore] === afterLines[endAfter]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  if (start > endAfter) return [];
  const message = `Claude targeted ${improvement.targetedMetric || "prompt quality"}. ${improvement.rationale}`;
  return afterLines.slice(start, endAfter + 1).map((_, index) => {
    const lineNumber = start + index + 1;
    return {
      lineNumber,
      message,
      previous: beforeLines[start + index],
    };
  });
}
