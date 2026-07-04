import { test } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import {
  nightHawkAccuracyFromRows,
  blendedAccuracy,
  MIN_SAMPLE_FOR_RECOMMENDATION,
  type SignalAccuracyBySource,
} from "./signal-accuracy";

// Regression: /api/platform/intel and the Night Hawk platform-intel snapshot used to
// compute signalAccuracy/regimeAccuracy from a JOIN against signal_events/signal_outcomes
// (004_god_tier_features.sql) — a table that has never received a single write in
// production (nothing calls POST /api/signals/record outside its own route file), so the
// join always returned zero rows and both consumers permanently fell back to
// "INSUFFICIENT DATA". These tests prove the real replacement — sourced from
// nighthawk_play_outcomes (via nightHawkAccuracyFromRows) and spx_play_outcomes (via
// blendedAccuracy combining both real ledgers) — actually produces non-null numbers.

const nhRow = (overrides: Partial<NighthawkPlayOutcomeRow>): NighthawkPlayOutcomeRow => ({
  id: 1,
  edition_for: "2026-06-30",
  ticker: "AAPL",
  direction: "LONG",
  conviction: "A",
  entry_range_low: 448,
  entry_range_high: 452,
  target: 460,
  stop: 440,
  score: 70,
  sector: "Tech",
  next_day_open: 450,
  next_day_close: 455,
  session_high: 456,
  session_low: 449,
  hit_target: false,
  hit_stop: false,
  outcome: "target",
  created_at: "2026-06-30T09:00:00Z",
  ...overrides,
});

test("nightHawkAccuracyFromRows computes real wins/total/winRate from nighthawk_play_outcomes rows", () => {
  const rows = [
    nhRow({ outcome: "target" }),
    nhRow({ outcome: "target" }),
    nhRow({ outcome: "stop" }),
    nhRow({ outcome: "pending" }), // excluded — not yet resolved
  ];
  const acc = nightHawkAccuracyFromRows(rows);
  assert.equal(acc.total, 3); // pending excluded, matches isNighthawkOutcomeScoreable
  assert.equal(acc.wins, 2);
  assert.equal(acc.winRate, 66.7);
});

test("nightHawkAccuracyFromRows excludes unfilled and stop-data-unavailable rows like the public track record", () => {
  const rows = [
    nhRow({ outcome: "unfilled" }),
    nhRow({ outcome: "stop", session_high: null, session_low: null }), // stop w/ no intraday data
    nhRow({ outcome: "target" }),
  ];
  const acc = nightHawkAccuracyFromRows(rows);
  assert.equal(acc.total, 1);
  assert.equal(acc.wins, 1);
  assert.equal(acc.winRate, 100);
});

test("nightHawkAccuracyFromRows returns winRate null (not 0 or NaN) when there's no closed sample", () => {
  const acc = nightHawkAccuracyFromRows([nhRow({ outcome: "pending" })]);
  assert.equal(acc.total, 0);
  assert.equal(acc.wins, 0);
  assert.equal(acc.winRate, null);
});

test("blendedAccuracy combines SPX Slayer + Night Hawk into one real win rate", () => {
  const bySource: SignalAccuracyBySource = {
    SPX_SLAYER: { total: 8, wins: 5, winRate: 62.5 },
    NIGHT_HAWK: { total: 4, wins: 1, winRate: 25 },
  };
  const blended = blendedAccuracy(bySource);
  assert.equal(blended.total, 12);
  assert.equal(blended.wins, 6);
  assert.equal(blended.winRate, 50);
  // The combined sample clears the minimum bar even though neither source alone
  // would be enough on its own (8 and 4 are both < MIN_SAMPLE_FOR_RECOMMENDATION).
  assert.ok(blended.total >= MIN_SAMPLE_FOR_RECOMMENDATION);
});

test("blendedAccuracy returns winRate null when both real ledgers are empty (never fabricates 0%)", () => {
  const bySource: SignalAccuracyBySource = {
    SPX_SLAYER: { total: 0, wins: 0, winRate: null },
    NIGHT_HAWK: { total: 0, wins: 0, winRate: null },
  };
  const blended = blendedAccuracy(bySource);
  assert.equal(blended.total, 0);
  assert.equal(blended.winRate, null);
});
