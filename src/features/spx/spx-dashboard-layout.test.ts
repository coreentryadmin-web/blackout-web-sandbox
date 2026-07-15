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
  // Declutter contract (user-directed 2026-07-14): the matrix column carries NO spot module
  // (spot lives in the header strip via StripSpot) and the session time bar is unrendered —
  // the Dealer Gamma Map owns the full column height.
  assert.equal(src.includes("spx-matrix-column-spot"), false, "matrix column must not mount the spot module");
  assert.equal(src.includes("<SpxSessionTimeBar"), false, "session time bar must not be rendered");
  // Focus toggle lives in the Vector toolbar, left of Replay, via the replay lead slot.
  assert.match(src, /toolbarReplayLeadSlot/);
  assert.match(src, /spx-desk-focus-btn/);
  // Embedded Vector chart column — same shell as /vector, chart-only, pinned defaults 0DTE + 3min.
  assert.match(src, /VectorPageShell/);
  assert.match(src, /spx-sniper-vector-col/);
  assert.match(src, /embed="chart-only"/);
  assert.match(src, /defaultDteHorizon="0dte"/);
  assert.match(src, /defaultTimeframe=\{3\}/);
  assert.match(src, /spx-sniper-triple--desk-v3/);
});
