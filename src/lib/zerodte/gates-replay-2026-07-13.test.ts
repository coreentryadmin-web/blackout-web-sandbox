import { test } from "node:test";
import assert from "node:assert/strict";

// ── 2026-07-13 replay — the gate stack's regression fixture ────────────────────────
// The REAL session ledger that motivated the whole gate stack (1W/7L, all seven
// losers at/near the −50% stop), replayed play-by-play through evaluateZeroDteGates
// with the market context of that day. Assertion target: the projected-outcome
// table in docs/audit/NIGHTHAWK-0DTE-DECISION.md §2, adjusted where this
// implementation legitimately differs — each deviation documented inline.
//
// Fixture provenance (nh0dte forensics dataset, derived.json, pulled 2026-07-13):
// - 8 plays with flag times + ledger scores as committed that day.
// - SPY session bias: DOWN all session (SPX −0.43% open→close; the board's own
//   end-of-day fresh find was SPY short, score 93).
// - Day-open VIX (Polygon I:VIX daily bar): 16.32. NOTE: the decision doc's §2
//   G-4 row says "7/13 VIX open 17.2" — that contradicts the dataset it cites
//   (derived.json: vix_day_open 16.32, band 15-17, for every 7/13 row). The
//   DATASET wins here; at 16.32 the G-4 calibration verdict is tier "normal" for
//   every play. G-4 is calibration-only either way, so nothing blocks on it.
// - Night Hawk context: the 7/10 edition carried META LONG (conviction A) — the
//   canonical G-6 conflict. No Slayer play was open on 7/13 (its ledger's last
//   play closed 7/10; Monday's edition had 0 plays).
//
// G-2 ATTRIBUTION (user-directed 2026-07-13): the opening window is 9:30–9:45 ET
// only — the user chose 9:45 KNOWINGLY over the decision doc's original 10:30,
// with the calibration loop (gate_calibration_json.committed_at_et) as the
// arbiter for the 9:45–10:30 band. Every 7/13 entry was flagged ≥ 9:50, so G-2
// catches NONE of them in this replay — the four opening longs block on G-1
// (tape alignment), which is exactly the doc's F-3 finding: counter-tape entries,
// not clock position, are what killed the day.

import { evaluateZeroDteGates, type ZeroDteGateVerdict } from "./gates";
import type { GovernorOpenPlan } from "./governor";

/** 2026-07-13 is EDT: ET minutes + 4h = UTC. */
const dayMs = (etMinutes: number) => Date.parse("2026-07-13T04:00:00Z") + etMinutes * 60_000;

type FixturePlay = {
  ticker: string;
  direction: "long" | "short";
  flag_et: string;
  et_minutes: number;
  /** Ledger score as committed that day (derived.json). */
  score: number;
  /** Provisional session P&L, % premium (context only — not a gate input). */
  pnl: number;
};

// The real ledger, in flag order.
const LEDGER_2026_07_13: FixturePlay[] = [
  { ticker: "AMD", direction: "long", flag_et: "09:50", et_minutes: 9 * 60 + 50, score: 58, pnl: -47.93 },
  { ticker: "SPY", direction: "long", flag_et: "09:55", et_minutes: 9 * 60 + 55, score: 93, pnl: -52.74 },
  { ticker: "MU", direction: "long", flag_et: "09:55", et_minutes: 9 * 60 + 55, score: 73, pnl: -46.0 },
  { ticker: "SPXW", direction: "long", flag_et: "10:00", et_minutes: 10 * 60, score: 78, pnl: -69.39 },
  { ticker: "QQQ", direction: "short", flag_et: "10:20", et_minutes: 10 * 60 + 20, score: 65, pnl: 76.57 },
  { ticker: "META", direction: "short", flag_et: "10:40", et_minutes: 10 * 60 + 40, score: 67, pnl: -50.11 },
  { ticker: "NVDA", direction: "long", flag_et: "12:40", et_minutes: 12 * 60 + 40, score: 40, pnl: -57.25 },
  { ticker: "INTC", direction: "short", flag_et: "12:51", et_minutes: 12 * 60 + 51, score: 61, pnl: -50.0 },
];

const VIX_DAY_OPEN = 16.32;

/** Replay the session chronologically: each play evaluated at its flag time with
 *  the plays the gated desk would actually have open at that moment. */
function replaySession(): Map<string, ZeroDteGateVerdict> {
  const verdicts = new Map<string, ZeroDteGateVerdict>();
  const openPlans: GovernorOpenPlan[] = [];
  for (const p of LEDGER_2026_07_13) {
    const nowMs = dayMs(p.et_minutes);
    const v = evaluateZeroDteGates({
      ticker: p.ticker,
      direction: p.direction,
      score: p.score,
      nowEtMinutes: p.et_minutes,
      nowMs,
      bias: "down", // SPY sold off all session — bias was DOWN at every flag time
      biasAsOfMs: nowMs - 60_000, // fresh SPY bar at each evaluation
      governor: { open_plans: [...openPlans], stops: [] },
      vixDayOpen: VIX_DAY_OPEN,
      slayerLive: null, // no open Slayer play on 7/13
      nighthawkTake:
        p.ticker === "META" ? { direction: "long", edition_for: "2026-07-10" } : null,
    });
    verdicts.set(p.ticker, v);
    if (v.verdict === "COMMIT") openPlans.push({ ticker: p.ticker, direction: p.direction });
  }
  return verdicts;
}

test("7/13 replay: full verdict table matches the decision doc's §2 projection (G-2 attribution updated per user direction)", () => {
  const verdicts = replaySession();

  // The doc's projection (§2, adjusted): 6 of 8 blocked, QQQ + META print.
  //   AMD  long  09:50 → BLOCKED  G-1 + G-3  (score 58 also under the floor)
  //   SPY  long  09:55 → BLOCKED  G-1        (93-score counter-tape long — the
  //                                           exact play the score dent waved in)
  //   MU   long  09:55 → BLOCKED  G-1        (ledger score 73 clears the floor — tape alone)
  //   SPXW long  10:00 → BLOCKED  G-1
  //   QQQ  short 10:20 → COMMIT              (aligned, ≥ 9:45, score 65 = floor)
  //   META short 10:40 → COMMIT + G-6 CONFLICT (calibration mode — logged, not blocked)
  //   NVDA long  12:40 → BLOCKED  G-1 + G-3  (doc's table names G-1; score 40 also
  //                                           fails the floor — both are recorded,
  //                                           blocks[] carries every failing gate)
  //   INTC short 12:51 → BLOCKED  G-3        (doc left INTC open — "passes or blocks
  //                                           per implemented rules"; its ledger
  //                                           score 61 sits in the 55-64 band that
  //                                           runs 18.8% WR, so the floor blocks it.
  //                                           It stopped out at −50% — correctly.)
  const expected: Record<string, string[] | "COMMIT"> = {
    AMD: ["tape_alignment", "score_floor"],
    SPY: ["tape_alignment"],
    MU: ["tape_alignment"],
    SPXW: ["tape_alignment"],
    QQQ: "COMMIT",
    META: "COMMIT",
    NVDA: ["tape_alignment", "score_floor"],
    INTC: ["score_floor"],
  };

  for (const [ticker, want] of Object.entries(expected)) {
    const v = verdicts.get(ticker)!;
    if (want === "COMMIT") {
      assert.equal(v.verdict, "COMMIT", `${ticker} must commit`);
      assert.deepEqual(v.blocks, [], `${ticker} must have no blocks`);
    } else {
      assert.equal(v.verdict, "BLOCKED", `${ticker} must be blocked`);
      assert.deepEqual(
        v.blocks.map((b) => b.code),
        want,
        `${ticker} block attribution`
      );
    }
  }
});

test("7/13 replay: G-2 catches none of the entries (all flagged ≥ 9:50 > 9:45) — G-1 is the killer gate", () => {
  const verdicts = replaySession();
  for (const [ticker, v] of verdicts) {
    assert.ok(
      !v.blocks.some((b) => b.code === "opening_window"),
      `${ticker}: user-directed 9:45 boundary leaves the 9:45-10:30 band open — the calibration loop is the arbiter`
    );
  }
});

test("7/13 replay: META short prints but carries the G-6 CONFLICT flag (calibration, not a block)", () => {
  const meta = replaySession().get("META")!;
  assert.equal(meta.verdict, "COMMIT");
  assert.equal(meta.calibration.g6_conflict.conflict, true);
  assert.deepEqual(meta.calibration.g6_conflict.against, ["nighthawk_edition"]);
  // Hardened G-6 would have blocked it (score 67 < 80) — that's the would_block
  // data point the 30-session calibration run exists to accumulate.
  assert.equal(meta.calibration.g6_conflict.would_block, true);
  assert.match(meta.calibration.g6_conflict.note, /2026-07-10/);
});

test("7/13 replay: G-4 verdict is tier=normal at the dataset's 16.32 day-open VIX (doc's 17.2 figure is contradicted by derived.json — dataset wins)", () => {
  for (const [, v] of replaySession()) {
    assert.equal(v.calibration.g4_vix.tier, "normal");
    assert.equal(v.calibration.g4_vix.would_block, false);
    assert.equal(v.calibration.g4_vix.day_open_vix, VIX_DAY_OPEN);
  }
});

test("7/13 replay: session economics — the gated desk prints 1W/1L instead of 1W/7L", () => {
  const verdicts = replaySession();
  const printed = LEDGER_2026_07_13.filter((p) => verdicts.get(p.ticker)!.verdict === "COMMIT");
  const blocked = LEDGER_2026_07_13.filter((p) => verdicts.get(p.ticker)!.verdict === "BLOCKED");

  assert.deepEqual(printed.map((p) => p.ticker), ["QQQ", "META"]);
  // The winner survives; six of the seven losers are removed before entry.
  assert.equal(printed.filter((p) => p.pnl > 0).length, 1);
  assert.equal(printed.filter((p) => p.pnl < 0).length, 1);
  assert.equal(blocked.length, 6);
  assert.ok(blocked.every((p) => p.pnl < 0), "every blocked play was a real loser — no winner was gated away");

  // Calibration context rides every verdict, committed or not (C-2 columns).
  const qqq = verdicts.get("QQQ")!;
  assert.equal(qqq.calibration.committed_at_et, "10:20");
  assert.equal(qqq.calibration.market_bias, "down");
  assert.equal(qqq.calibration.score_at_commit, 65);
});
