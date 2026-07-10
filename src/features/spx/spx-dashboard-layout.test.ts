import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** SPX desk is four panels: Largo commentary | matrix | trades | terminal. */
test("SpxDashboard mounts quad desk without legacy side panels", () => {
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
  assert.match(src, /SpxTradeAlerts/);
  assert.match(src, /spx-sniper-triple--desk-v2/);
});
