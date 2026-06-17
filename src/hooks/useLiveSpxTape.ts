"use client";

import { useEffect, useState } from "react";
import { createFlowEventSource, type FlowAlert } from "@/lib/api";
import type { SpxTapeItem } from "@/lib/providers/spx-desk";
import { flowAlertToTapeItem, mergeTapeItems } from "@/lib/spx-desk-merge";

const SPX_TICKERS = new Set(["SPX", "SPXW"]);

/** Rolling live tape — polls from desk + SSE pushes between polls. */
export function useLiveSpxTape(seed: SpxTapeItem[] | undefined): SpxTapeItem[] {
  const [tape, setTape] = useState<SpxTapeItem[]>([]);

  useEffect(() => {
    if (!seed?.length) return;
    setTape((prev) => mergeTapeItems(seed, prev));
  }, [seed]);

  useEffect(() => {
    const es = createFlowEventSource((alert: FlowAlert) => {
      const ticker = alert.ticker?.toUpperCase() ?? "";
      if (!SPX_TICKERS.has(ticker)) return;
      const item = flowAlertToTapeItem(alert);
      setTape((prev) => mergeTapeItems([item], prev));
    });
    return () => es?.close();
  }, []);

  return tape.length > 0 ? tape : seed ?? [];
}
