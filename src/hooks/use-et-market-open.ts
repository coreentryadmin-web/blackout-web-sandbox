"use client";

import { useEffect, useState } from "react";
import { isEtMarketHours } from "@/lib/et-market-hours";

/** Hydration-safe RTH flag — updates every 60s after mount. */
export function useEtMarketOpen(): boolean {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const tick = () => setOpen(isEtMarketHours());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return open;
}

/** Fast interval during RTH, slow off-hours (audit R-49). */
export function usePollIntervalMs(fastMs: number, slowMs: number): number {
  const open = useEtMarketOpen();
  return open ? fastMs : slowMs;
}
