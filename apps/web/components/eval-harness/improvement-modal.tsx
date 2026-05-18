"use client";

import { Sparkles } from "lucide-react";
import { Modal, ModalSection, ModalTitle } from "@/components/ui/modal";
import type { PromptChangeHighlight } from "./prompt-editor";
import type { ImprovementResult } from "./use-prompt-improver";

interface Props {
  improvement: ImprovementResult | null;
  open: boolean;
  onClose: () => void;
  highlights?: ReadonlyArray<PromptChangeHighlight>;
  currentPrompt?: string;
}

const MODAL_DIFF_PREVIEW_LIMIT = 2;

export function ImprovementModal({
  improvement,
  open,
  onClose,
  highlights,
  currentPrompt,
}: Props) {
  if (!improvement) return null;

  const previews = highlights
    ? highlights.slice(0, MODAL_DIFF_PREVIEW_LIMIT)
    : [];
  const overflow = (highlights?.length ?? 0) - previews.length;
  const afterLines = currentPrompt?.split("\n") ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <ModalTitle
          icon={Sparkles}
          title="Claude improved the synthesis prompt"
          description="The new prompt is already loaded in the editor. Changed lines are highlighted in place."
        />
      }
    >
      <div className="space-y-3">
        <ModalSection eyebrow="Target" title="Primary improvement area">
          <code className="rounded bg-primary/10 px-1.5 py-1 font-mono text-xs text-primary">
            {improvement.targetedMetric || "prompt quality"}
          </code>
        </ModalSection>
        <ModalSection eyebrow="Recommendation" title="What changed and why">
          <p className="text-sm leading-6 text-muted-foreground">
            {improvement.rationale || "Claude proposed a revised prompt."}
          </p>
        </ModalSection>
        {previews.length > 0 && (
          <ModalSection eyebrow="Diff" title="Changed lines">
            <div className="space-y-2 font-mono text-[11px] leading-5">
              {previews.map((highlight) => {
                const afterLine = afterLines[highlight.lineNumber - 1] ?? "";
                return (
                  <div
                    key={highlight.lineNumber}
                    className="overflow-hidden rounded-md border border-border/70 bg-background/40"
                  >
                    <p className="border-b border-border/50 bg-background/50 px-2.5 py-1 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                      Line {highlight.lineNumber}
                    </p>
                    {highlight.previous !== undefined && (
                      <p className="break-words bg-destructive/[0.07] px-2.5 py-1.5 text-muted-foreground line-through decoration-destructive/45">
                        {highlight.previous || " "}
                      </p>
                    )}
                    <p className="break-words bg-[var(--positive)]/[0.07] px-2.5 py-1.5 text-foreground">
                      {afterLine || " "}
                    </p>
                  </div>
                );
              })}
              {overflow > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  +{overflow} more changed line{overflow === 1 ? "" : "s"} in
                  the editor.
                </p>
              )}
            </div>
          </ModalSection>
        )}
        {improvement.costUsd !== undefined && (
          <p className="font-mono text-[10px] text-muted-foreground">
            ${improvement.costUsd.toFixed(4)} · sonnet 4.6
          </p>
        )}
      </div>
    </Modal>
  );
}
