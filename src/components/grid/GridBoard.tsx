"use client";

import { PulseStrip } from "./PulseStrip";
import { GridNewsPanel } from "./GridNewsPanel";
import { GridFlowPanel } from "./GridFlowPanel";
import { AnalystActions } from "./AnalystActions";

/**
 * GridBoard — the BlackOut Grid masonry (Phase 0/1). Client board that owns layout: a full-width
 * Market Pulse hero strip, then the panel tiles flowing in a CSS-grid masonry (desktop 4-col /
 * tablet 2-col / mobile 1-col, driven by .grid-board in globals.css).
 *
 * Phase 0/1 panels, each grounded in REAL data (no fabrication):
 *   1. Market Pulse  — SPX desk merged payload (fetchSpxState)            [hero, full width]
 *   2. Unified News  — multi-channel Benzinga news (BenzingaNewsRail)     [reused scroll]
 *   3. Notable Flow  — HELIX flow tape (fetchFlows + flow SSE)            [no new ingest]
 *   4. Analyst Actions — Benzinga analyst channel via /api/grid/analysts  [grid-warm cache-reader]
 *
 * Later phases (movers / dark pool / earnings / econ / sectors / positioning / smart money /
 * catalysts) slot into this same masonry behind the same `grid` launch gate.
 */
export function GridBoard() {
  return (
    <div className="grid-board">
      <PulseStrip />
      <GridNewsPanel />
      <GridFlowPanel />
      <AnalystActions />
    </div>
  );
}
