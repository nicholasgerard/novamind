import { CheckCircle2, FileText, ShieldX, XCircle } from "lucide-react";
import { Modal, ModalSection, ModalTitle } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import type { PipelineResultEvent, VerificationRow } from "./types";

export function EvidenceModal({
  open,
  onClose,
  result,
}: {
  open: boolean;
  onClose: () => void;
  result: PipelineResultEvent | undefined;
}) {
  if (!result) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <ModalTitle
          icon={FileText}
          title="Evidence cited"
          description="Verified claims selected for the final hypothesis"
        />
      }
    >
      <ul className="space-y-3">
        {result.result.evidence.map((item, index) => (
          <li
            key={`${item.citation}-${index}`}
            className={cn(
              "rounded-lg border p-4",
              item.verified
                ? "border-border bg-card/40"
                : "border-primary/45 bg-primary/[0.08]",
            )}
          >
            <div className="flex items-center gap-2">
              {item.verified ? (
                <CheckCircle2 className="size-4 text-[var(--positive)]" />
              ) : (
                <XCircle className="size-4 text-primary" />
              )}
              <span className="mono-data text-xs text-muted-foreground">
                {item.citation}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-foreground/90">
              {item.claim}
            </p>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function VerifierModal({
  open,
  onClose,
  rows,
}: {
  open: boolean;
  onClose: () => void;
  rows: VerificationRow[];
}) {
  const unsupported = rows.filter((row) => !row.verified);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <ModalTitle
          icon={ShieldX}
          title="Verifier catch"
          description="Rejected claims excluded from synthesis"
        />
      }
    >
      <ModalSection>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Each claim emitted by the agent is checked by a verifier model against
          the matching retrieved abstract text. The claims below were rejected -
          they never made it into the final hypothesis.
        </p>
      </ModalSection>
      <ul className="mt-5 space-y-3">
        {unsupported.map((row) => (
          <li
            key={row.pmid}
            className="rounded-lg border border-primary/45 bg-primary/[0.08] p-4"
          >
            <div className="flex items-center gap-2">
              <ShieldX className="size-4 text-primary" />
              <span className="text-sm font-medium text-primary">
                Rejected · PMID:{row.pmid}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-foreground/90">
              {row.claim}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              The retrieved abstract did not support this claim. The verifier
              flagged it before it could enter the synthesis.
            </p>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
