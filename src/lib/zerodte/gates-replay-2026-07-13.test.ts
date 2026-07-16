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

import { evaluateZeroDteGates, gateRejectionFor, type ZeroDteGateVerdict } from "./gates";
import type { GovernorOpenPlan } from "./governor";
// ── Cortex layer (PR-B wire-in) — the same 7/13 session replayed through the FULL
// stack: hard gates first, then composeCortexEvidence over the design doc's own
// 7/13 fixtures on the gate survivors (NIGHTHAWK-CORTEX-DESIGN.md §2 wiring).
import { composeCortexEvidence, type CortexInputs } from "@/lib/nighthawk/cortex";
import { QQQ_SHORT_2026_07_13 } from "@/lib/nighthawk/cortex/fixtures-2026-07-13";
import { baseInputs } from "@/lib/nighthawk/cortex/test-helpers";
import { assessCortexVerdict, cortexEntryContextFor, cortexGateBlocks } from "./cortex-gate";

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

  // The doc's projection (§2, adjusted for hardened G-6): 7 of 8 blocked, QQQ only prints.
  //   AMD  long  09:50 → BLOCKED  G-1 + G-3  (score 58 also under the floor)
  //   SPY  long  09:55 → BLOCKED  G-1        (93-score counter-tape long — the
  //                                           exact play the score dent waved in)
  //   MU   long  09:55 → BLOCKED  G-1        (ledger score 73 clears the floor — tape alone)
  //   SPXW long  10:00 → BLOCKED  G-1
  //   QQQ  short 10:20 → COMMIT              (aligned, ≥ 9:45, score 65 = floor)
  //   META short 10:40 → BLOCKED  G-6        (score 67 < 80, opposes Night Hawk
  //                                           7/10 edition LONG A — the canonical
  //                                           cross-system conflict. Was calibration-
  //                                           only; promoted to hard gate 2026-07-16.
  //                                           META stopped out at −50.11% — correctly blocked.)
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
    META: ["cross_system_conflict"],
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

test("7/13 replay: META short BLOCKED by G-6 (score 67 < 80, opposes Night Hawk long)", () => {
  const meta = replaySession().get("META")!;
  assert.equal(meta.verdict, "BLOCKED");
  assert.equal(meta.blocks.some((b) => b.code === "cross_system_conflict"), true);
  assert.equal(meta.calibration.g6_conflict.conflict, true);
  assert.deepEqual(meta.calibration.g6_conflict.against, ["nighthawk_edition"]);
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

test("7/13 replay: session economics — the gated desk prints 1W/0L instead of 1W/7L (G-6 catches META)", () => {
  const verdicts = replaySession();
  const printed = LEDGER_2026_07_13.filter((p) => verdicts.get(p.ticker)!.verdict === "COMMIT");
  const blocked = LEDGER_2026_07_13.filter((p) => verdicts.get(p.ticker)!.verdict === "BLOCKED");

  assert.deepEqual(printed.map((p) => p.ticker), ["QQQ"]);
  // The winner survives; ALL seven losers are removed before entry — perfect session.
  assert.equal(printed.filter((p) => p.pnl > 0).length, 1);
  assert.equal(printed.filter((p) => p.pnl < 0).length, 0);
  assert.equal(blocked.length, 7);
  assert.ok(blocked.every((p) => p.pnl < 0), "every blocked play was a real loser — no winner was gated away");

  // Calibration context rides every verdict, committed or not (C-2 columns).
  const qqq = verdicts.get("QQQ")!;
  assert.equal(qqq.calibration.committed_at_et, "10:20");
  assert.equal(qqq.calibration.market_bias, "down");
  assert.equal(qqq.calibration.score_at_commit, 65);
});

// ── Full-stack replay: hard gates + the Cortex layer (PR-B wire-in) ────────────────
// Mirrors attachGateVerdicts' exact sequencing (scan.ts): evaluateZeroDteGates first;
// on COMMIT, compose the Cortex verdict and fold it via cortexGateBlocks — a
// non-empty block list flips the verdict to BLOCKED with the gate blocks REPLACED by
// the Cortex blocks (gate blocks were necessarily empty on a COMMIT).
function applyCortex(gate: ZeroDteGateVerdict, inputs: CortexInputs) {
  assert.equal(gate.verdict, "COMMIT", "the Cortex only ever runs on gate survivors");
  const assessment = assessCortexVerdict(composeCortexEvidence(inputs));
  const blocks = cortexGateBlocks(assessment);
  const verdict: ZeroDteGateVerdict = blocks.length > 0 ? { ...gate, verdict: "BLOCKED", blocks } : gate;
  return { assessment, verdict };
}

/** The rejection-source fields of the 7/13 QQQ short, for gateRejectionFor. */
const QQQ_REJECTION_SOURCE = {
  ticker: "QQQ",
  direction: "short" as const,
  gross_premium: 1_250_000,
  aggression: 0.72,
  side_dominance: 0.7,
  otm_pct: 0.4,
  prints: 5,
  first_seen: "2026-07-13T14:08:00.000Z",
  last_seen: "2026-07-13T14:18:00.000Z",
};

test("7/13 full stack: QQQ short survives BOTH layers — gates COMMIT and the net-supportive fixture PASSES, evidence pinned for the ledger", () => {
  const gate = replaySession().get("QQQ")!;
  const { assessment, verdict } = applyCortex(gate, QQQ_SHORT_2026_07_13);

  assert.equal(verdict.verdict, "COMMIT", "the session's one real winner must still print");
  assert.deepEqual(verdict.blocks, []);
  assert.equal(assessment.decision, "PASS");

  // The entry_context.cortex blob the committed row would pin: the FULL vector.
  const blob = cortexEntryContextFor(assessment);
  assert.ok(blob && !blob.abstained);
  if (blob && !blob.abstained) {
    assert.ok(blob.score > 0);
    assert.equal(blob.conviction, "A");
    assert.ok(blob.supports.length >= 5);
    assert.deepEqual(blob.vetoes, []);
    assert.ok(blob.narrative.length > 0);
  }
});

test("7/13 full stack: a gate-passing find dies on a Cortex VETO — blocked exactly like a gate block, rejection row carries cortex_veto:<source> + the evidence sentence", () => {
  const gate = replaySession().get("QQQ")!;
  // Same winner, alternate tape: an opposing bullish sweep cluster ($1.3M / 2
  // prints inside 15 min) crosses flow-quality's veto floor. Everything else
  // still argues FOR the short — one loud opposing fact kills it anyway (§0).
  const { assessment, verdict } = applyCortex(gate, {
    ...QQQ_SHORT_2026_07_13,
    flow: {
      asOf: "2026-07-13T14:19:00.000Z",
      prints: [
        { premium: 700_000, direction: "bullish", kind: "sweep", at: "2026-07-13T14:10:00.000Z" },
        { premium: 600_000, direction: "bullish", kind: "sweep", at: "2026-07-13T14:16:00.000Z" },
      ],
    },
  });

  assert.equal(assessment.decision, "VETO");
  assert.equal(verdict.verdict, "BLOCKED");
  assert.deepEqual(verdict.blocks.map((b) => b.code), ["cortex_veto:flow-quality"]);

  // The BLOCKED verdict rides the SAME rejection plumbing as a hard-gate block:
  // persistZeroDteScan routes any non-COMMIT fresh find to zerodte_scan_rejections
  // (never to the ledger, never an entry_context — the blocked-find invariant).
  const rejection = gateRejectionFor(QQQ_REJECTION_SOURCE, verdict);
  assert.equal(rejection.gate_failed, "cortex_veto:flow-quality");
  assert.match(rejection.reason!, /Cortex veto \[flow-quality\]: opposing bullish sweep\/block cluster \$1\.3M/);
});

test("7/13 full stack: a gate-passing find dies on NET-NEGATIVE evidence (no veto) — cortex_net_negative", () => {
  const gate = replaySession().get("QQQ")!;
  // Only readable evidence opposes the short (positive breadth + positive net VEX,
  // asOf = now so the raw −0.9 sum survives undecayed); nothing veto-grade.
  const { assessment, verdict } = applyCortex(gate, baseInputs({
    ticker: "QQQ",
    direction: "short",
    now: QQQ_SHORT_2026_07_13.now,
    sector: {
      asOf: QQQ_SHORT_2026_07_13.now,
      sectorName: null,
      sectorChangePct: null,
      breadthTone: "strongly_positive",
      tickerChangePct: 0.8,
    },
    vex: { asOf: QQQ_SHORT_2026_07_13.now, netVex: 900_000_000, kingStrike: null },
  }));

  assert.equal(assessment.decision, "NET_NEGATIVE");
  assert.equal(verdict.verdict, "BLOCKED");
  assert.equal(verdict.blocks.length, 1);
  assert.equal(verdict.blocks[0]!.code, "cortex_net_negative");
  assert.equal(verdict.blocks[0]!.threshold, 0);
  assert.match(verdict.blocks[0]!.reason, /nets -0\.9 against this short/);

  const rejection = gateRejectionFor(QQQ_REJECTION_SOURCE, verdict);
  assert.equal(rejection.gate_failed, "cortex_net_negative");
  assert.equal(rejection.threshold, 0);
});

test("7/13 full stack: a total Cortex outage ABSTAINS — the commit proceeds on gates alone and the abstain is recorded, not hidden", () => {
  const gate = replaySession().get("QQQ")!;
  // Every reader down/timed out → every slice null → every source absent.
  const { assessment, verdict } = applyCortex(
    gate,
    baseInputs({ ticker: "QQQ", direction: "short", now: QQQ_SHORT_2026_07_13.now })
  );

  assert.equal(assessment.decision, "ABSTAIN");
  assert.equal(verdict.verdict, "COMMIT", "a Cortex outage must never halt the engine — the hard gates are the safety floor");
  assert.deepEqual(verdict.blocks, []);

  // ...but the row records the blindness honestly (entry_context.cortex).
  assert.deepEqual(cortexEntryContextFor(assessment), {
    abstained: true,
    reason: "no Cortex source produced evidence (8 absent) — commit proceeds on the hard gates alone.",
  });
});
