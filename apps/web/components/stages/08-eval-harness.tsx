import { EvalHarness } from "@/components/eval-harness/eval-harness";
import { StopShell } from "@/components/stop-shell";

export function Stage08() {
  return (
    <StopShell slug="08-eval-harness" wide compact>
      <EvalHarness />
    </StopShell>
  );
}
