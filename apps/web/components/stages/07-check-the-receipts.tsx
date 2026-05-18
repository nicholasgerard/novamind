"use client";

import { useEffect, useMemo, useState } from "react";
import { StopShell } from "@/components/stop-shell";
import { Receipt } from "@/components/check-the-receipts/receipt";
import { buildLiveReceiptData } from "@/components/check-the-receipts/live-adapter";
import {
  readCachedDataVizRun,
  readCachedResearchRun,
  type CachedDataVizRun,
  type CachedResearchRun,
} from "@/lib/demo-run-cache";

export function Stage07() {
  const [litRun, setLitRun] = useState<CachedResearchRun | undefined>();
  const [vizRun, setVizRun] = useState<CachedDataVizRun | undefined>();
  const [hasLoadedCache, setHasLoadedCache] = useState(false);

  useEffect(() => {
    setLitRun(readCachedResearchRun());
    setVizRun(readCachedDataVizRun());
    setHasLoadedCache(true);
  }, []);

  const data = useMemo(
    () =>
      buildLiveReceiptData(
        hasLoadedCache ? litRun : undefined,
        hasLoadedCache ? vizRun : undefined,
      ),
    [hasLoadedCache, litRun, vizRun],
  );

  return (
    <StopShell slug="07-check-the-receipts">
      <Receipt data={data} />
    </StopShell>
  );
}
