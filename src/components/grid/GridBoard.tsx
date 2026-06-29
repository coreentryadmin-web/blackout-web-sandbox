"use client";

import { PulseStrip } from "./PulseStrip";
import { GridNewsPanel } from "./GridNewsPanel";
import { GridFlowPanel } from "./GridFlowPanel";
import { AnalystActions } from "./AnalystActions";
import { GridMoversPanel } from "./GridMoversPanel";
import { GridEarningsPanel } from "./GridEarningsPanel";
import { GridDarkPoolPanel } from "./GridDarkPoolPanel";
import { GridCongressPanel } from "./GridCongressPanel";
import { GridEconomyPanel } from "./GridEconomyPanel";
import { GridCatalystsPanel } from "./GridCatalystsPanel";
import { GridGexPanel } from "./GridGexPanel";
import { GridSectorHeatmapPanel } from "./GridSectorHeatmapPanel";
import { useGridTicker } from "@/lib/grid/grid-ticker-context";

/**
 * GridBanner — full-width active-ticker banner. Reads from the nearest GridTickerProvider
 * (provided by the page). Shown when a ticker filter is active.
 */
function GridBanner() {
  const { ticker, isFiltered, setTicker } = useGridTicker();
  if (!isFiltered || !ticker) return null;
  return (
    <div className="flex items-center gap-3 px-3 py-2 mb-3 rounded border border-cyan-400/25 bg-cyan-400/5">
      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" aria-hidden />
      <span className="font-mono text-[11px] text-cyan-400 tracking-wide">
        Showing all data for{" "}
        <span className="font-bold text-white">{ticker}</span>
        {" · "}
        <span className="text-sky-300/70">Updated live</span>
      </span>
      <button
        type="button"
        onClick={() => setTicker(null)}
        className="ml-auto font-mono text-[10px] text-sky-400/60 hover:text-white transition-colors"
        aria-label="Clear ticker filter"
      >
        ×&nbsp;Clear
      </button>
    </div>
  );
}

/**
 * GridBoard — the BlackOut Grid masonry (Phases 0-4). Client board that owns layout: a full-width
 * Market Pulse hero strip, then the panel tiles flowing in a CSS-grid masonry (desktop 4-col /
 * tablet 2-col / mobile 1-col, driven by .grid-board in globals.css).
 *
 * Does NOT own the GridTickerProvider — that lives in page.tsx so the search bar in PageHeader
 * and the board share one context instance.
 *
 * Panel map (span / accent / source):
 *   1. Market Pulse     — SPX desk merged payload (PulseStrip)           [hero, full width]
 *   2. Unified News     — multi-channel Benzinga news (BenzingaNewsRail) [2, sky]
 *   3. Notable Flow     — HELIX flow tape (GridFlowPanel)                [1, violet]
 *   4. Analyst Actions  — Benzinga analyst channel                       [1, emerald]
 *   5. Sector Heat      — 11 SPDR sector ETFs (Polygon)                  [2, gold]
 *   6. Top Movers       — Polygon gainers + losers                       [1, gold]
 *   7. Earnings Radar   — UW pre-market + after-hours reporters          [2, sky]
 *   8. Dark Pool Prints — UW market-wide off-lit prints                  [1, violet]
 *   9. Congress Trades  — UW congressional stock disclosures             [1, bear]
 *  10. Economic Calendar — UW macro indicators (CPI / GDP / Fed / etc.)  [2, emerald]
 */
export function GridBoard() {
  return (
    <>
      {/* Active-ticker banner */}
      <GridBanner />

      {/* Masonry panel grid */}
      <div className="grid-board">
        {/* Row 0 — hero */}
        <PulseStrip />

        {/* Row 1 — news + flow + analysts + GEX regime (top-right) */}
        <GridNewsPanel />
        <GridFlowPanel />
        <AnalystActions />
        <GridGexPanel />

        {/* Row 2 — movers */}
        <GridMoversPanel />

        {/* Row 3 — earnings + dark pool */}
        <GridEarningsPanel />
        <GridDarkPoolPanel />

        {/* Row 4 — congress + economy */}
        <GridCongressPanel />
        <GridEconomyPanel />

        {/* Row 5 — corporate catalysts */}
        <GridCatalystsPanel />

        {/* Row 6 — sector heatmap from /api/market/heatmap (sector ETFs) */}
        <GridSectorHeatmapPanel />
      </div>
    </>
  );
}
