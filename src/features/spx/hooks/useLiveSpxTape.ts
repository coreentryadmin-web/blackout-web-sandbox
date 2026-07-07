"use client";

import { useEffect, useState } from "react";
import { createFlowEventSource, type FlowAlert } from "@/lib/api";
import type { SpxTapeItem } from "@/features/spx/lib/spx-desk";
import { flowAlertToTapeItem, mergeTapeItems } from "@/features/spx/lib/spx-desk-merge";

const SPX_TICKERS = new Set(["SPX", "SPXW"]);

/** Rolling live tape — polls from desk + SSE pushes between polls. */
export function useLiveSpxTape(seed: SpxTapeItem[] | undefined): SpxTapeItem[] {
  const [tape, setTape] = useState<SpxTapeItem[]>([]);

  useEffect(() => {
    if (!seed?.length) return;
    setTape((prev) => mergeTapeItems(seed, prev));
  }, [seed]);

  useEffect(() => {
    const conn = createFlowEventSource((alert: FlowAlert) => {
      const ticker = alert.ticker?.toUpperCase() ?? "";
      if (!SPX_TICKERS.has(ticker)) return;
      // Gap #6 residual: parseUwFlowAlert emits option_type='UNKNOWN' for typeless UW alerts; the tape
      // is a directional read, so flowAlertToTapeItem would render an UNKNOWN as a confident CALL. Drop
      // the untyped row rather than fabricate a direction (mirrors the SPX-ticker filter above and the
      // server-side buildUnifiedTape skip).
      const type = (alert.option_type ?? "").toUpperCase();
      if (!type.startsWith("C") && !type.startsWith("P")) return;
      const item = flowAlertToTapeItem(alert);
      setTape((prev) => mergeTapeItems([item], prev));
    });
    return () => conn?.close();
  }, []);

  return tape.length > 0 ? tape : seed ?? [];
}
