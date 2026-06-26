"use client";

import { PulseStrip } from "./PulseStrip";
import { GridNewsPanel } from "./GridNewsPanel";
import { GridFlowPanel } from "./GridFlowPanel";
import { AnalystActions } from "./AnalystActions";
import { GridSectorsPanel } from "./GridSectorsPanel";
import { GridMoversPanel } from "./GridMoversPanel";
import { GridEarningsPanel } from "./GridEarningsPanel";
import { GridDarkPoolPanel } from "./GridDarkPoolPanel";
import { GridCongressPanel } from "./GridCongressPanel";
import { GridEconomyPanel } from "./GridEconomyPanel";

/**
 * GridBoard — the BlackOut Grid masonry (Phases 0-4). Client board that owns layout: a full-width
 * Market Pulse hero strip, then the panel tiles flowing in a CSS-grid masonry (desktop 4-col /
 * tablet 2-col / mobile 1-col, driven by .grid-board in globals.css).
 *
 * Panel map (span / accent / source):
 *   1. Market Pulse     — SPX desk merged payload (PulseStrip)           [hero, full width]
 *   2. Unified News     — multi-channel Benzinga news (BenzingaNewsRail) [1, sky]
 *   3. Notable Flow     — HELIX flow tape (GridFlowPanel)                [2, emerald]
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
    <div className="grid-board">
      {/* Row 0 — hero */}
      <PulseStrip />

      {/* Row 1 — news + flow + analysts */}
      <GridNewsPanel />
      <GridFlowPanel />
      <AnalystActions />

      {/* Row 2 — sectors + movers */}
      <GridSectorsPanel />
      <GridMoversPanel />

      {/* Row 3 — earnings + dark pool */}
      <GridEarningsPanel />
      <GridDarkPoolPanel />

      {/* Row 4 — congress + economy */}
      <GridCongressPanel />
      <GridEconomyPanel />
    </div>
  );
}
