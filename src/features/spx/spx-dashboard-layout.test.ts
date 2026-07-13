import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SPX desk v3 (2026-07-13, member-directed consolidation): THREE panels —
 * Largo commentary | matrix | embedded SPX Vector chart (chart-only).
 * The Trade Alerts kanban (SpxTradeAlerts) and the Slayer desk terminal are REMOVED from the
 * flagship desk (components stay in the repo unused, one render away). NO terminal on SPX Slayer.
 */
test("SpxDashboard mounts triple desk: Largo | matrix | embedded Vector chart (no trade-alerts / terminal panels)", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/components/SpxDashboard.tsx"), "utf8");

  const banned = [
    "BenzingaNewsTicker",
    "BenzingaNewsRail",
    "SpxUnifiedTape",
    "SpxIntervalFlowPanel",
    "SpxIntelStrip",
    "SpxGexLadder",
    "SpxDarkPoolCard",
    "SpxDayPerformancePanel",
    "SpxTrackRecordPanel",
    "SpxStructureBlocks",
    "spx-left-stack",
    "spx-commentary-below-desk",
    // Desk v3 removals — must not be RENDERED (a comment pointing at the file is fine):
    "<SpxTradeAlerts",
    'import("./SpxTradeAlerts")',
    "SpxDeskTerminal",
    "spx-sniper-terminal-col",
    "spx-sniper-plays-col",
  ];

  for (const token of banned) {
    assert.equal(
      src.includes(token),
      false,
      `SpxDashboard must not mount ${token}`
    );
  }

  assert.match(src, /SpxCommentaryRail/);
  assert.match(src, /spx-left-commentary/);
  assert.match(src, /SpxGexMatrixHeatmap/);
  assert.match(src, /spx-left-matrix/);
  assert.match(src, /spx-matrix-column-spot/);
  assert.match(src, /SpxLiveSpotPrice/);
  // Embedded Vector chart column — same shell as /vector, chart-only, pinned defaults 0DTE + 3min.
  assert.match(src, /VectorPageShell/);
  assert.match(src, /spx-sniper-vector-col/);
  assert.match(src, /embed="chart-only"/);
  assert.match(src, /defaultDteHorizon="0dte"/);
  assert.match(src, /defaultTimeframe=\{3\}/);
  assert.match(src, /spx-sniper-triple--desk-v3/);
});
