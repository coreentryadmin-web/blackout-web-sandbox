import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPremarketBriefFresh,
  priorDayFromDailyBars,
  widenSessionExtremesWithSpot,
} from "./spx-session";

describe("widenSessionExtremesWithSpot", () => {
  it("widens HOD/LOD to include live spot during RTH", () => {
    const { hod, lod } = widenSessionExtremesWithSpot(7440.43, 7392.95, 7294.18, true);
    assert.equal(hod, 7440.43);
    assert.equal(lod, 7294.18);
  });

  it("does not fabricate extremes from spot when HOD/LOD are null", () => {
    const { hod, lod } = widenSessionExtremesWithSpot(7440.43, null, null, true);
    assert.equal(hod, null);
    assert.equal(lod, null);
  });

  it("leaves extremes unchanged when market is closed", () => {
    const { hod, lod } = widenSessionExtremesWithSpot(7440.43, 7392.95, 7294.18, false);
    assert.equal(hod, 7392.95);
    assert.equal(lod, 7294.18);
  });
});

describe("priorDayFromDailyBars", () => {
  // noon ET keeps the bar unambiguously on its calendar date regardless of conversion
  const bar = (ymd: string, h: number, l: number, c: number) => ({
    t: Date.parse(`${ymd}T12:00:00-04:00`),
    o: 0,
    h,
    l,
    c,
  });

  it("off-hours: returns the last COMPLETED session, not the one before it", () => {
    // Pre-market 2026-07-01 with no partial bar yet: 06-30 is the prior session.
    // (Regression: the old bars[length-2] logic returned the stale 06-29 values here.)
    const bars = [
      bar("2026-06-29", 7444.32, 7348.88, 7440.43),
      bar("2026-06-30", 7508.29, 7438.04, 7499.36),
    ];
    assert.deepEqual(priorDayFromDailyBars(bars, "2026-07-01"), {
      pdh: 7508.29,
      pdl: 7438.04,
      pdc: 7499.36,
    });
  });

  it("RTH: skips today's in-progress partial bar", () => {
    const bars = [
      bar("2026-06-29", 7444.32, 7348.88, 7440.43),
      bar("2026-06-30", 7508.29, 7438.04, 7499.36),
      bar("2026-07-01", 7510, 7490, 7505), // today's partial
    ];
    assert.deepEqual(priorDayFromDailyBars(bars, "2026-07-01"), {
      pdh: 7508.29,
      pdl: 7438.04,
      pdc: 7499.36,
    });
  });

  it("handles weekend gaps (Monday 06-29 -> prior Friday 06-26)", () => {
    const bars = [
      bar("2026-06-25", 7419.08, 7323.5, 7357.49),
      bar("2026-06-26", 7392.95, 7294.18, 7354.02),
    ];
    assert.deepEqual(priorDayFromDailyBars(bars, "2026-06-29"), {
      pdh: 7392.95,
      pdl: 7294.18,
      pdc: 7354.02,
    });
  });

  it("returns nulls when only today's partial bar exists", () => {
    assert.deepEqual(
      priorDayFromDailyBars([bar("2026-07-01", 7510, 7490, 7505)], "2026-07-01"),
      { pdh: null, pdl: null, pdc: null }
    );
  });

  it("returns nulls for empty input", () => {
    assert.deepEqual(priorDayFromDailyBars([], "2026-07-01"), {
      pdh: null,
      pdl: null,
      pdc: null,
    });
  });

  it("falls back to bars[length-2] when timestamps are absent", () => {
    const bars = [
      { o: 0, h: 10, l: 5, c: 8 },
      { o: 0, h: 12, l: 6, c: 9 },
    ];
    assert.deepEqual(priorDayFromDailyBars(bars, "2026-07-01"), {
      pdh: 10,
      pdl: 5,
      pdc: 8,
    });
  });
});

describe("isPremarketBriefFresh", () => {
  it("is fresh when the brief date is today", () => {
    assert.equal(isPremarketBriefFresh("2026-07-01", "2026-07-01"), true);
  });

  it("is fresh when the brief is exactly 1 calendar day old (premarket brief published using yesterday's close)", () => {
    assert.equal(isPremarketBriefFresh("2026-06-30", "2026-07-01"), true);
  });

  it("is stale when the brief is 2+ days old", () => {
    assert.equal(isPremarketBriefFresh("2026-06-28", "2026-07-01"), false);
  });

  it("reports the exact reported bug case as stale (2026-06-29 brief served during 2026-07-01 RTH)", () => {
    assert.equal(isPremarketBriefFresh("2026-06-29", "2026-07-01"), false);
  });

  it("is stale for a brief dated in the future relative to today (clock skew / bad row)", () => {
    assert.equal(isPremarketBriefFresh("2026-07-02", "2026-07-01"), false);
  });
});
