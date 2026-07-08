import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** SPX Slayer left rail is matrix-only — no Benzinga scroll, live tape, or interval-flow panels. */
test("SpxDashboard keeps matrix-only left rail (no Benzinga / tape / order-flow panels)", () => {
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
  ];

  for (const token of banned) {
    assert.equal(
      src.includes(token),
      false,
      `SpxDashboard must not mount ${token} — left rail is SpxGexMatrixHeatmap only`
    );
  }

  assert.match(src, /SpxGexMatrixHeatmap/);
  assert.match(src, /spx-left-matrix/);
});
