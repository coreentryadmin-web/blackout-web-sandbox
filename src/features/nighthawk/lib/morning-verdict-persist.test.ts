import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMorningVerdictRecord,
  persistNighthawkMorningVerdicts,
  isDegradedSevere,
  MORNING_VERDICT_VERSION,
  DEGRADED_SEVERE_REASON_COUNT,
  type MorningVerdictMarketContext,
} from "./morning-verdict-persist";
import type { PlayStatus } from "./morning-confirm-verdict";
import type { PlaybookPlay } from "./types";
import type { recordNighthawkMorningVerdict } from "@/lib/db";

// PR-N4 (decision doc N-7): morning-confirm verdicts persist durably and INVALIDATED
// becomes binding. The harness below mirrors the DB function's two pinning rules
// (COALESCE first-write-wins verdict; one-way pulled latch) exactly the way
// regrade-stuck.test.ts's harness mirrors the WHERE outcome='pending' guard — so
// idempotence is exercised against the real semantics, hermetically.

function play(overrides: Partial<PlaybookPlay> = {}): PlaybookPlay {
  return {
    rank: 1,
    ticker: "AMD",
    direction: "LONG",
    conviction: "A+",
    play_type: "stock",
    thesis: "t",
    key_signal: "k",
    entry_range: "$137.00-$138.50",
    target: "$140.00",
    stop: "$134.00",
    options_play: "AMD 140C",
    score: 78,
    ...overrides,
  };
}

function status(overrides: Partial<PlayStatus> = {}): PlayStatus {
  return {
    rank: 1,
    ticker: "AMD",
    direction: "LONG",
    status: "INVALIDATED",
    reason: "AMD pre-market 128.20 has gapped through the stop (134)",
    ...overrides,
  };
}

// The AMD 2026-07-07 shape (the decision doc's headline failure): stop 134, pre-market
// 128.20 — gapped clean through, INVALIDATED-knowable at 9:15.
function market(overrides: Partial<MorningVerdictMarketContext> = {}): MorningVerdictMarketContext {
  return {
    gapPts: -25.3,
    spxPremarket: 6218.4,
    spxPriorClose: 6243.7,
    regime: "BEARISH",
    stockPremarketByTicker: { AMD: 128.2 },
    ...overrides,
  };
}

/** In-memory rows honoring the DB function's semantics: verdict COALESCE, pulled OR. */
function harness(existing: Record<string, { morning_verdict: Record<string, unknown> | null; pulled: boolean; pulled_reason: string | null }> = {}) {
  const rows = existing;
  const calls: string[] = [];
  const record: typeof recordNighthawkMorningVerdict = async (row) => {
    calls.push(row.ticker.toUpperCase());
    const r = rows[row.ticker.toUpperCase()];
    if (!r) return { matched: false, verdict_written: false, pulled: false };
    const wasEmpty = r.morning_verdict == null;
    if (wasEmpty) r.morning_verdict = row.verdict;
    r.pulled = r.pulled || row.pull;
    if (row.pull && r.pulled_reason == null) r.pulled_reason = row.pull_reason;
    return { matched: true, verdict_written: wasEmpty, pulled: r.pulled };
  };
  return { rows, calls, record };
}

function freshRow() {
  return { morning_verdict: null as Record<string, unknown> | null, pulled: false, pulled_reason: null as string | null };
}

test("verdict record pins the numbers the check actually saw (gap, premarket vs stop/band)", () => {
  const rec = buildMorningVerdictRecord({
    status: status(),
    play: play(),
    checkedAt: "2026-07-07T13:15:30.000Z",
    market: market(),
  });

  assert.equal(rec.verdict_version, MORNING_VERDICT_VERSION);
  assert.equal(rec.status, "INVALIDATED");
  assert.equal(rec.checked_at, "2026-07-07T13:15:30.000Z");
  const m = rec.metrics as Record<string, unknown>;
  assert.equal(m.stock_premarket, 128.2);
  assert.equal(m.overnight_gap_pts, -25.3);
  // (6218.4-6243.7)/6243.7 = −0.4052%
  assert.equal(m.overnight_gap_pct, -0.4052);
  assert.equal(m.regime, "BEARISH");
  assert.equal(m.stop, 134);
  // Pre-market 128.20 vs stop 134 = −4.3284% — the "gapped through the stop" number.
  assert.equal(m.premarket_vs_stop_pct, -4.3284);
  // Vs the LONG fill edge (band top 138.50) = −7.4368%.
  assert.equal(m.premarket_vs_band_pct, -7.4368);
});

test("unavailable inputs persist as null — never fabricated", () => {
  const rec = buildMorningVerdictRecord({
    status: status({ ticker: "WFC", status: "UNVERIFIED", reason: "No pre-market data reachable" }),
    play: undefined,
    checkedAt: "2026-07-07T13:15:30.000Z",
    market: market({ gapPts: null, spxPremarket: null, spxPriorClose: null, regime: null, stockPremarketByTicker: {} }),
  });
  const m = rec.metrics as Record<string, unknown>;
  assert.equal(m.stock_premarket, null);
  assert.equal(m.overnight_gap_pts, null);
  assert.equal(m.overnight_gap_pct, null);
  assert.equal(m.stop, null);
  assert.equal(m.premarket_vs_stop_pct, null);
});

test("INVALIDATED pulls; single-reason DEGRADED stays advisory; CONFIRMED is label-only", async () => {
  const h = harness({ AMD: freshRow(), TSLA: freshRow(), WFC: freshRow() });
  const result = await persistNighthawkMorningVerdicts(
    {
      editionFor: "2026-07-07",
      checkedAt: "2026-07-07T13:15:30.000Z",
      playStatuses: [
        status(),
        status({ rank: 2, ticker: "TSLA", status: "DEGRADED", reason: "Contrary flow anomaly detected — reduce size" }),
        status({ rank: 3, ticker: "WFC", status: "CONFIRMED", reason: "All checks passed" }),
      ],
      plays: [play(), play({ rank: 2, ticker: "TSLA" }), play({ rank: 3, ticker: "WFC" })],
      market: market({ stockPremarketByTicker: { AMD: 128.2, TSLA: 250.1, WFC: 60.4 } }),
    },
    { record: h.record }
  );

  assert.equal(result.ok, true);
  assert.equal(result.persisted, 3, "every play's verdict persists, not just the bad ones");
  assert.equal(result.pulled, 1);
  assert.equal(h.rows.AMD.pulled, true);
  assert.match(h.rows.AMD.pulled_reason ?? "", /^Pulled pre-open: /);
  assert.match(h.rows.AMD.pulled_reason ?? "", /gapped through the stop/);
  assert.equal(h.rows.TSLA.pulled, false, "single-reason DEGRADED stays advisory");
  assert.equal(h.rows.WFC.pulled, false);
  assert.equal((h.rows.TSLA.morning_verdict as Record<string, unknown>).status, "DEGRADED");
});

test("severe DEGRADED (≥2 reasons) engages the pull latch (PR-N6)", async () => {
  const h = harness({ AMD: freshRow() });
  const severeReason = "Put wall drifted 15 pts; Contrary flow anomaly detected";
  const result = await persistNighthawkMorningVerdicts(
    {
      editionFor: "2026-07-07",
      checkedAt: "2026-07-07T13:15:30.000Z",
      playStatuses: [
        status({ ticker: "AMD", status: "DEGRADED", reason: severeReason }),
      ],
      plays: [play()],
      market: market(),
    },
    { record: h.record }
  );

  assert.equal(result.ok, true);
  assert.equal(result.persisted, 1);
  assert.equal(result.pulled, 1);
  assert.equal(h.rows.AMD.pulled, true);
  assert.match(h.rows.AMD.pulled_reason ?? "", /severe degradation/);
  assert.match(h.rows.AMD.pulled_reason ?? "", /Put wall drifted/);
  assert.equal((h.rows.AMD.morning_verdict as Record<string, unknown>).status, "DEGRADED");
});

test("isDegradedSevere: single reason → false, two reasons → true, non-DEGRADED → false", () => {
  assert.equal(isDegradedSevere(status({ status: "DEGRADED", reason: "One reason only" })), false);
  assert.equal(isDegradedSevere(status({ status: "DEGRADED", reason: "Reason A; Reason B" })), true);
  assert.equal(isDegradedSevere(status({ status: "DEGRADED", reason: "A; B; C" })), true);
  assert.equal(isDegradedSevere(status({ status: "CONFIRMED", reason: "A; B" })), false);
  assert.equal(isDegradedSevere(status({ status: "INVALIDATED", reason: "A; B" })), false);
  assert.equal(DEGRADED_SEVERE_REASON_COUNT, 2);
});

test("idempotent re-run: first verdict wins, pull latch is one-way (a softer re-run can never un-pull)", async () => {
  const h = harness({ AMD: freshRow() });
  const base = {
    editionFor: "2026-07-07",
    plays: [play()],
    market: market(),
  };

  const first = await persistNighthawkMorningVerdicts(
    { ...base, checkedAt: "2026-07-07T13:15:30.000Z", playStatuses: [status()] },
    { record: h.record }
  );
  assert.equal(first.persisted, 1);
  assert.equal(first.pulled, 1);

  // Re-run later with a SOFTER verdict (the flap the one-way latch exists to kill).
  const second = await persistNighthawkMorningVerdicts(
    {
      ...base,
      checkedAt: "2026-07-07T13:40:00.000Z",
      playStatuses: [status({ status: "CONFIRMED", reason: "All checks passed" })],
    },
    { record: h.record }
  );
  assert.equal(second.persisted, 0, "first-write-wins — the 9:15 verdict is the calibration datum");
  assert.equal(second.already_recorded, 1);
  assert.equal((h.rows.AMD.morning_verdict as Record<string, unknown>).status, "INVALIDATED");
  assert.equal((h.rows.AMD.morning_verdict as Record<string, unknown>).checked_at, "2026-07-07T13:15:30.000Z");
  assert.equal(h.rows.AMD.pulled, true, "pulled-is-pulled: no flapping back to green at 9:40");
  assert.equal(second.pulled, 1, "still reported pulled (the latch state, not this run's verdict)");
});

test("a play with NO outcome row is counted missing (publish-sync gap), not invented", async () => {
  const h = harness({}); // no rows at all
  const result = await persistNighthawkMorningVerdicts(
    {
      editionFor: "2026-07-07",
      checkedAt: "2026-07-07T13:15:30.000Z",
      playStatuses: [status()],
      plays: [play()],
      market: market(),
    },
    { record: h.record }
  );
  assert.equal(result.persisted, 0);
  assert.equal(result.missing_rows, 1);
  assert.equal(result.ok, true, "a missing row is a reported condition, not a thrown error");
});

test("FAIL-SOFT: a per-play write failure lands in errors, the batch continues, and nothing throws", async () => {
  const h = harness({ AMD: freshRow(), TSLA: freshRow() });
  const failingRecord: typeof recordNighthawkMorningVerdict = async (row) => {
    if (row.ticker === "AMD") throw new Error("pg connection reset");
    return h.record(row);
  };

  const result = await persistNighthawkMorningVerdicts(
    {
      editionFor: "2026-07-07",
      checkedAt: "2026-07-07T13:15:30.000Z",
      playStatuses: [status(), status({ rank: 2, ticker: "TSLA", status: "DEGRADED", reason: "anomaly" })],
      plays: [play(), play({ rank: 2, ticker: "TSLA" })],
      market: market(),
    },
    { record: failingRecord }
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /AMD@2026-07-07/);
  assert.equal(result.persisted, 1, "the healthy play still persisted");
});
