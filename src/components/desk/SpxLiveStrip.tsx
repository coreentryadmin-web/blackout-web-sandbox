"use client";

import { useMergedDesk } from "@/hooks/useMergedDesk";
import { fmtPct, fmtPrice } from "@/lib/api";
import { clsx } from "clsx";

/** Live SPX strip — same merged desk feed as SPX Sniper dashboard. */
export function SpxLiveStrip({ className }: { className?: string }) {
  const { desk, live, sessionActive, marketLabel } = useMergedDesk();

  return (
    <div className={clsx("largo-spx-live-strip", className)} aria-live="polite">
      <span className="largo-spx-live-label">SPX SNIPER</span>
      <span className="largo-spx-live-price tabular-nums">
        {live ? fmtPrice(desk?.price ?? null, 2) : "—"}
      </span>
      <span
        className={clsx(
          "largo-spx-live-chg tabular-nums",
          (desk?.spx_change_pct ?? 0) >= 0 ? "num-bull" : "num-bear"
        )}
      >
        {live ? fmtPct(desk?.spx_change_pct ?? null) : "—"}
      </span>
      <span className="largo-spx-live-meta">
        VIX {live && desk?.vix != null ? fmtPrice(desk.vix, 2) : "—"}
      </span>
      <span className="largo-spx-live-meta">
        GEX {live && desk?.gex_net != null ? `${(desk.gex_net / 1e9).toFixed(2)}B` : "—"}
      </span>
      <span className="largo-spx-live-meta capitalize">
        {sessionActive ? (marketLabel ?? desk?.market_label ?? "LIVE") : "CLOSED"}
      </span>
    </div>
  );
}
