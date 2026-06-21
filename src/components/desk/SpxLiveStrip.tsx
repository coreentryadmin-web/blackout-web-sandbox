"use client";

import { useMergedDesk } from "@/hooks/useMergedDesk";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";
import { clsx } from "clsx";

/**
 * Live SPX strip — same merged desk feed as SPX Sniper dashboard.
 *
 * NOTE: This component calls useMergedDesk() directly, which opens its own
 * SSE pulse connection. If rendered on the same page as SpxDashboard (which
 * also calls useMergedDesk), two independent SSE connections will be opened.
 * To avoid this, either share the desk/live values via props or context,
 * or ensure SpxLiveStrip is only rendered on pages without SpxDashboard.
 */
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
        GEX {live && desk?.gex_net != null ? fmtPremium(desk.gex_net) : "—"}
      </span>
      <span className="largo-spx-live-meta capitalize">
        {sessionActive ? (marketLabel ?? desk?.market_label ?? "LIVE") : "CLOSED"}
      </span>
    </div>
  );
}
