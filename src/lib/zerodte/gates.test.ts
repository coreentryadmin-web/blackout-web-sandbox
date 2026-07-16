import { test } from "node:test";
import assert from "node:assert/strict";

// gates.ts is a pure leaf (type-only imports from ./board, ./intraday) — no
// mock.module scaffolding needed, unlike scan.test.ts's provider graph.
import {
  evaluateZeroDteGates,
  gateRejectionFor,
  MARKET_BIAS_MAX_AGE_MS,
  type ZeroDteGateInput,
} from "./gates";

const NOW_MS = Date.parse("2026-07-13T15:00:00Z"); // 11:00 ET on the fixture date

/** A mid-session, fully-aligned, fresh-bias input that clears every gate — each
 *  test flips exactly the dimension it exercises. */
function input(overrides: Partial<ZeroDteGateInput> = {}): ZeroDteGateInput {
  return {
    ticker: "QQQ",
    direction: "short",
    score: 70,
    nowEtMinutes: 11 * 60, // 11:00 ET
    nowMs: NOW_MS,
    bias: "down",
    biasAsOfMs: NOW_MS - 60_000, // 1-minute-old SPY bar — fresh
    governor: { open_plans: [], stops: [] },
    ...overrides,
  };
}

// ── G-1 · tape alignment ───────────────────────────────────────────────────────────

test("G-1: aligned with the tape (short on a down day) commits", () => {
  const v = evaluateZeroDteGates(input());
  assert.equal(v.verdict, "COMMIT");
  assert.deepEqual(v.blocks, []);
});

test("G-1: long against a down tape is BLOCKED (was only a -6 score dent)", () => {
  const v = evaluateZeroDteGates(input({ direction: "long", score: 93 }));
  assert.equal(v.verdict, "BLOCKED", "a 93-score counter-tape long must still block (7/13 SPY long)");
  assert.equal(v.blocks[0]!.code, "tape_alignment");
  assert.match(v.blocks[0]!.reason, /fights the DOWN market tape/);
});

test("G-1: short against an up tape is BLOCKED (mirror)", () => {
  const v = evaluateZeroDteGates(input({ bias: "up", direction: "short" }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "tape_alignment");
});

test("G-1: a flat tape has no directional conflict — commits either way", () => {
  assert.equal(evaluateZeroDteGates(input({ bias: "flat", direction: "long" })).verdict, "COMMIT");
  assert.equal(evaluateZeroDteGates(input({ bias: "flat", direction: "short" })).verdict, "COMMIT");
});

test("G-1 fail-closed: missing bias blocks a NEW commit, with its own distinct code", () => {
  const v = evaluateZeroDteGates(input({ bias: null }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "no_market_bias");
  assert.match(v.blocks[0]!.reason, /fail closed/);
});

test("G-1 fail-closed: a stale bias (SPY bars stopped arriving) blocks like a missing one", () => {
  const staleMs = NOW_MS - MARKET_BIAS_MAX_AGE_MS - 1;
  const v = evaluateZeroDteGates(input({ biasAsOfMs: staleMs }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "no_market_bias");

  // Exactly at the age limit is still fresh — the boundary is exclusive.
  const edge = evaluateZeroDteGates(input({ biasAsOfMs: NOW_MS - MARKET_BIAS_MAX_AGE_MS }));
  assert.equal(edge.verdict, "COMMIT");
});

test("G-1 fail-closed: bias present but its freshness unknown (no bar timestamp) blocks", () => {
  const v = evaluateZeroDteGates(input({ biasAsOfMs: null }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks[0]!.code, "no_market_bias");
});

// ── G-2 · opening window (first 15 minutes — user-directed 2026-07-13) ─────────────

test("G-2: an aligned setup in the first 15 minutes is BLOCKED, with the unlock time on the card", () => {
  const v = evaluateZeroDteGates(input({ nowEtMinutes: 9 * 60 + 40 }));
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.length, 1, "only the window blocks — alignment is clean");
  assert.equal(v.blocks[0]!.code, "opening_window");
  assert.equal(v.blocks[0]!.unlock_et, "9:45 ET");
});

test("G-2: exactly 9:45 ET unlocks (boundary inclusive)", () => {
  const v = evaluateZeroDteGates(input({ nowEtMinutes: 9 * 60 + 45 }));
  assert.equal(v.verdict, "COMMIT");
});

test("G-2: 9:55/10:20 entries are OUTSIDE the window — the user chose 9:45 knowingly; the 9:45-10:30 band is the calibration loop's to judge", () => {
  // 7/13's opening losers were flagged 9:50-10:20, i.e. AFTER 9:45 — under this
  // boundary G-2 does not catch them (G-1 tape alignment is the gate that does).
  assert.equal(evaluateZeroDteGates(input({ nowEtMinutes: 9 * 60 + 55 })).verdict, "COMMIT");
  assert.equal(evaluateZeroDteGates(input({ nowEtMinutes: 10 * 60 + 20 })).verdict, "COMMIT");
});

test("G-1 + G-2: a counter-tape long at 09:40 collects BOTH blocks (all reasons visible)", () => {
  const v = evaluateZeroDteGates(input({ direction: "long", nowEtMinutes: 9 * 60 + 40 }));
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(
    v.blocks.map((b) => b.code),
    ["tape_alignment", "opening_window"]
  );
});

// ── G-3 · score floor ──────────────────────────────────────────────────────────────

test("G-3: score 64 blocks, 65 commits (the 55-64 band is below breakeven)", () => {
  const blocked = evaluateZeroDteGates(input({ score: 64 }));
  assert.equal(blocked.verdict, "BLOCKED");
  assert.equal(blocked.blocks[0]!.code, "score_floor");
  assert.equal(blocked.blocks[0]!.threshold, 65);
  assert.match(blocked.blocks[0]!.reason, /18\.8% WR/);

  assert.equal(evaluateZeroDteGates(input({ score: 65 })).verdict, "COMMIT");
});

test("G-3: judged on the POST-edge-layer score — 7/13's INTC short (61) blocks even though aligned and mid-day", () => {
  const v = evaluateZeroDteGates(input({ ticker: "INTC", score: 61, nowEtMinutes: 12 * 60 + 51 }));
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(v.blocks.map((b) => b.code), ["score_floor"]);
});

// ── G-5 · session governor (wiring — the rules themselves live in governor.test.ts) ─

test("G-5: unreadable governor state fails closed with gate_context_unavailable", () => {
  const v = evaluateZeroDteGates(input({ governor: null }));
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(v.blocks.map((b) => b.code), ["gate_context_unavailable"]);
});

test("G-5: three stopped plays halt every further commit for the session", () => {
  const stops = [
    { ticker: "SPY", direction: "long" as const, at_ms: null },
    { ticker: "MU", direction: "long" as const, at_ms: null },
    { ticker: "AMD", direction: "long" as const, at_ms: null },
  ];
  const v = evaluateZeroDteGates(input({ governor: { open_plans: [], stops } }));
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(v.blocks.map((b) => b.code), ["governor_session_stops"]);
});

test("G-5: committedThisCycle counts toward the concurrency cap within one scan pass", () => {
  const governor = { open_plans: [{ ticker: "TSLA", direction: "short" as const }], stops: [] };
  assert.equal(
    evaluateZeroDteGates(
      input({ governor, committedThisCycle: [{ ticker: "AMZN", direction: "short" }] })
    ).verdict,
    "COMMIT"
  );
  const v = evaluateZeroDteGates(
    input({
      governor,
      committedThisCycle: [
        { ticker: "AMZN", direction: "short" },
        { ticker: "GOOGL", direction: "short" },
      ],
    })
  );
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(v.blocks.map((b) => b.code), ["governor_max_concurrent"]);
});

test("G-5/B-3: a commit accepted earlier in the SAME cycle also anchors the correlated-conflict check", () => {
  // Cycle accepts SPY long first; a QQQ short later in the same pass must block
  // even though the ledger snapshot predates both.
  const v = evaluateZeroDteGates(
    input({
      ticker: "QQQ",
      direction: "short",
      governor: { open_plans: [], stops: [] },
      committedThisCycle: [{ ticker: "SPY", direction: "long" }],
    })
  );
  assert.equal(v.verdict, "BLOCKED");
  assert.deepEqual(v.blocks.map((b) => b.code), ["correlated_conflict"]);
});

// ── G-4 · VIX regime throttle (HARD GATE — promoted from calibration 2026-07-16) ────

test("G-4: normal VIX (<17) commits freely, calibration tier logged", () => {
  const normal = evaluateZeroDteGates(input({ vixDayOpen: 16.32 }));
  assert.equal(normal.verdict, "COMMIT");
  assert.equal(normal.calibration.g4_vix.tier, "normal");
  assert.equal(normal.calibration.g4_vix.would_block, false);
});

test("G-4: elevated VIX (>=17) with score < 75 BLOCKS (the 44pp WR gap is too strong to ignore)", () => {
  const weak = evaluateZeroDteGates(input({ vixDayOpen: 18, score: 70 }));
  assert.equal(weak.verdict, "BLOCKED");
  assert.equal(weak.blocks.some((b) => b.code === "vix_elevated"), true);
  assert.match(weak.blocks.find((b) => b.code === "vix_elevated")!.reason, /25% WR/);
  assert.equal(weak.calibration.g4_vix.tier, "elevated");
  assert.equal(weak.calibration.g4_vix.would_block, true);
});

test("G-4: elevated VIX (>=17) with score >= 75 clears", () => {
  const strong = evaluateZeroDteGates(input({ vixDayOpen: 18, score: 80 }));
  assert.equal(strong.verdict, "COMMIT");
  assert.equal(strong.calibration.g4_vix.would_block, false, "aligned + score >= 75 clears");
});

test("G-4: extreme VIX (>=20) blocks single names outright", () => {
  const nvda = evaluateZeroDteGates(input({ ticker: "NVDA", direction: "short", vixDayOpen: 22, score: 90 }));
  assert.equal(nvda.verdict, "BLOCKED");
  assert.equal(nvda.blocks.some((b) => b.code === "vix_extreme"), true);
  assert.match(nvda.blocks.find((b) => b.code === "vix_extreme")!.reason, /single-name/);
  assert.equal(nvda.calibration.g4_vix.would_block, true);
});

test("G-4: extreme VIX (>=20) lets index/ETF products through (half-size in calibration)", () => {
  const qqq = evaluateZeroDteGates(input({ vixDayOpen: 22, score: 90 }));
  assert.equal(qqq.verdict, "COMMIT");
  assert.equal(qqq.calibration.g4_vix.tier, "extreme");
  assert.equal(qqq.calibration.g4_vix.would_halve_size, true);
});

test("G-4: unknown VIX does not block — fail-open on missing data (tier engine handles the penalty)", () => {
  const v = evaluateZeroDteGates(input({ vixDayOpen: null }));
  assert.equal(v.calibration.g4_vix.tier, "unknown");
  assert.equal(v.calibration.g4_vix.would_block, false);
  assert.equal(v.verdict, "COMMIT");
});

// ── G-6 · cross-system conflict (HARD GATE — promoted from calibration 2026-07-16) ──

test("G-6: opposing Night Hawk's take with score < 80 BLOCKS (was calibration-only)", () => {
  const v = evaluateZeroDteGates(
    input({
      ticker: "META",
      direction: "short",
      score: 67,
      nighthawkTake: { direction: "long", edition_for: "2026-07-10" },
    })
  );
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.blocks.some((b) => b.code === "cross_system_conflict"), true);
  assert.match(
    v.blocks.find((b) => b.code === "cross_system_conflict")!.reason,
    /Night Hawk/
  );
  assert.equal(v.calibration.g6_conflict.conflict, true);
  assert.deepEqual(v.calibration.g6_conflict.against, ["nighthawk_edition"]);
  assert.equal(v.calibration.g6_conflict.would_block, true);
});

test("G-6: opposing the live Slayer play on an SPX-correlated ticker BLOCKS at score < 80", () => {
  const slayerLive = { direction: "long" as const };
  const spy = evaluateZeroDteGates(input({ ticker: "SPY", direction: "short", slayerLive }));
  assert.equal(spy.verdict, "BLOCKED");
  assert.equal(spy.blocks.some((b) => b.code === "cross_system_conflict"), true);
  assert.equal(spy.calibration.g6_conflict.conflict, true);
  assert.deepEqual(spy.calibration.g6_conflict.against, ["spx_slayer"]);
});

test("G-6: single-name short is NOT correlated exposure to Slayer's SPX book — no conflict", () => {
  const slayerLive = { direction: "long" as const };
  const intc = evaluateZeroDteGates(input({ ticker: "INTC", direction: "short", slayerLive }));
  assert.equal(intc.calibration.g6_conflict.conflict, false);
  assert.equal(intc.verdict, "COMMIT");
});

test("G-6: same direction as Slayer — no conflict, commits freely", () => {
  const slayerLive = { direction: "long" as const };
  const qqqLong = evaluateZeroDteGates(input({ ticker: "QQQ", direction: "long", bias: "up", slayerLive }));
  assert.equal(qqqLong.calibration.g6_conflict.conflict, false);
  assert.equal(qqqLong.verdict, "COMMIT");
});

test("G-6: score >= 80 overrides the conflict — CONFLICT still flagged but commits", () => {
  const v = evaluateZeroDteGates(
    input({
      ticker: "META",
      direction: "short",
      score: 85,
      nighthawkTake: { direction: "long", edition_for: "2026-07-10" },
    })
  );
  assert.equal(v.verdict, "COMMIT");
  assert.equal(v.calibration.g6_conflict.conflict, true);
  assert.equal(v.calibration.g6_conflict.would_block, false);
});

import { recentNighthawkTake } from "./gates";

test("recentNighthawkTake: recency-bounded (<=5 days) and strictly directional", () => {
  const take = { direction: "long", edition_for: "2026-07-10" };
  assert.deepEqual(recentNighthawkTake(take, "2026-07-13"), {
    direction: "long",
    edition_for: "2026-07-10",
  });
  assert.equal(recentNighthawkTake(take, "2026-07-20"), null, "a week-old take is history, not context");
  assert.equal(recentNighthawkTake({ direction: "mixed", edition_for: "2026-07-13" }, "2026-07-13"), null);
  assert.equal(recentNighthawkTake(null, "2026-07-13"), null);
});

test("calibration record carries the C-2 context columns (score, bias, ET time bucket)", () => {
  const v = evaluateZeroDteGates(input({ score: 71.4, nowEtMinutes: 12 * 60 + 40, vixDayOpen: 16.32 }));
  assert.equal(v.calibration.score_at_commit, 71);
  assert.equal(v.calibration.market_bias, "down");
  assert.equal(v.calibration.committed_at_et, "12:40");
});

// ── rejection-row bridge ───────────────────────────────────────────────────────────

const rejectionSource = {
  ticker: "SPY",
  direction: "long" as const,
  gross_premium: 2_400_000,
  aggression: 0.62,
  side_dominance: 0.81,
  otm_pct: 0.4,
  prints: 12,
  first_seen: "2026-07-13T13:55:00Z",
  last_seen: "2026-07-13T13:58:00Z",
};

test("gateRejectionFor: one row per blocked setup — primary code, ALL reasons concatenated", () => {
  // 09:40 counter-tape long → two blocks (G-1 + G-2), one durable row.
  const v = evaluateZeroDteGates(
    input({ ticker: "SPY", direction: "long", bias: "down", nowEtMinutes: 9 * 60 + 40 })
  );
  const row = gateRejectionFor(rejectionSource, v);
  assert.equal(row.ticker, "SPY");
  assert.equal(row.gate_failed, "tape_alignment", "primary = first-evaluated failing gate");
  assert.match(String(row.reason), /fights the DOWN market tape/);
  assert.match(String(row.reason), /9:45 ET/, "second block's sentence rides the same row");
  // Evidence-gate columns carry through so both gate families are comparable rows.
  assert.equal(row.gross_premium, 2_400_000);
  assert.equal(row.direction, "long");
  assert.equal(row.prints, 12);
});

test("gateRejectionFor: a null verdict (gate context unreadable) is itself a fail-closed row", () => {
  const row = gateRejectionFor(rejectionSource, null);
  assert.equal(row.gate_failed, "gate_context_unavailable");
  assert.match(String(row.reason), /fail closed/);
});
