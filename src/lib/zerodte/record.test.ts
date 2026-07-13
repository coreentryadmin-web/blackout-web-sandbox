import { test } from "node:test";
import assert from "node:assert/strict";

// record.ts is a pure-aggregation leaf (its only @/lib/db import is type-only,
// erased at runtime; ./plan's etMinutesOf is dependency-free) — no mocks needed.
import type { ZeroDteSetupLogRow } from "@/lib/db";
import {
  buildZeroDteRecord,
  isGradedZeroDteRow,
  isZeroDteWin,
  LOW_N_THRESHOLD,
  scoreBand,
  scoreForBanding,
  todBucket,
  ZERODTE_RECORD_METHODOLOGY,
} from "./record";

function row(overrides: Partial<ZeroDteSetupLogRow>): ZeroDteSetupLogRow {
  return {
    session_date: "2026-07-13",
    ticker: "TEST",
    direction: "long",
    top_strike: 100,
    expiry: "2026-07-13",
    score: 60,
    score_max: 60,
    dossier_score: null,
    conviction: "C",
    gross_premium: 1_000_000,
    spike: false,
    underlying_at_flag: 100,
    underlying_latest: 100,
    flags_json: null,
    first_flagged_at: "2026-07-13T14:00:00.000Z", // 10:00 ET (EDT)
    last_seen_at: "2026-07-13T14:00:00.000Z",
    close_price: null,
    move_pct: null,
    direction_hit: null,
    graded_at: "2026-07-14T00:00:00.000Z",
    entry_premium: 1,
    flow_avg_fill: 1,
    plan_json: null,
    plan_outcome: "stopped",
    plan_pnl_pct: -50,
    status: "CLOSED",
    last_mark: null,
    peak_premium: null,
    trough_premium: null,
    entry_context: null,
    ...overrides,
  };
}

// The REAL 2026-07-13 session ledger (docs/audit/NIGHTHAWK-VS-SLAYER-0DTE.md §2.2):
// 8 committed plays, 1W/7L — the session whose shape motivated this whole record
// surface. Flagged times are the live ET stamps (July = EDT, so ET+4h = UTC);
// P&L values are the session's live premium moves, here as their plan grades.
const LEDGER_7_13: ZeroDteSetupLogRow[] = [
  row({ ticker: "SPY", direction: "long", first_flagged_at: "2026-07-13T13:55:00Z", score_max: 72, plan_outcome: "stopped", plan_pnl_pct: -52.7 }),
  row({ ticker: "SPXW", direction: "long", first_flagged_at: "2026-07-13T14:00:00Z", score_max: 68, plan_outcome: "stopped", plan_pnl_pct: -69.4 }),
  // Entry-context row (C-2): commit-time score 54 must band this row <55 even
  // though its ratcheted score_max later reached 61.
  row({ ticker: "MU", direction: "long", first_flagged_at: "2026-07-13T13:55:00Z", score_max: 61, plan_outcome: "stopped", plan_pnl_pct: -46.0, entry_context: { score: 54, vix_open: 17.2, spy_bias: "down" } }),
  row({ ticker: "META", direction: "short", first_flagged_at: "2026-07-13T14:40:00Z", score_max: 66, plan_outcome: "stopped", plan_pnl_pct: -50.1 }),
  // Float-noise on purpose: the record must round at the data layer.
  row({ ticker: "QQQ", direction: "short", first_flagged_at: "2026-07-13T14:20:00Z", score_max: 77, plan_outcome: "doubled", plan_pnl_pct: 76.60000000000001 }),
  row({ ticker: "INTC", direction: "short", first_flagged_at: "2026-07-13T16:51:00Z", score_max: 58, plan_outcome: "stopped", plan_pnl_pct: -50.0 }),
  row({ ticker: "AMD", direction: "long", first_flagged_at: "2026-07-13T13:50:00Z", score_max: 70, plan_outcome: "stopped", plan_pnl_pct: -47.9 }),
  row({ ticker: "NVDA", direction: "long", first_flagged_at: "2026-07-13T16:40:00Z", score_max: 63, plan_outcome: "stopped", plan_pnl_pct: -57.3 }),
];

const WINDOW = { since: "2026-06-13", through: "2026-07-13", days: 30 };

test("7/13 fixture ledger: headline aggregates match the audited session (1W/7L)", () => {
  const rec = buildZeroDteRecord(LEDGER_7_13, WINDOW);
  assert.equal(rec.total_flagged, 8);
  assert.equal(rec.graded, 8);
  assert.equal(rec.ungraded, 0);
  assert.equal(rec.wins, 1);
  assert.equal(rec.losses, 7);
  assert.equal(rec.win_rate_pct, 12.5);
  // (-52.7 -69.4 -46.0 -50.1 +76.6 -50.0 -47.9 -57.3) / 8 = -37.1
  assert.equal(rec.avg_pnl_pct, -37.1);
  assert.equal(rec.window.sessions, 1);
  assert.equal(rec.methodology, ZERODTE_RECORD_METHODOLOGY);
  assert.equal(rec.available, true);
});

test("7/13 fixture ledger: direction cut shows the counter-tape long wipeout", () => {
  const rec = buildZeroDteRecord(LEDGER_7_13, WINDOW);
  const long = rec.by_direction.find((b) => b.label === "long");
  const short = rec.by_direction.find((b) => b.label === "short");
  assert.ok(long && short);
  assert.equal(long.n, 5);
  assert.equal(long.wins, 0);
  assert.equal(long.win_rate_pct, 0);
  assert.equal(long.low_n, false); // n=5 is exactly at the threshold — not low-N
  assert.equal(short.n, 3);
  assert.equal(short.wins, 1);
  assert.equal(short.low_n, true);
  // Deterministic ordering: long before short regardless of ledger order.
  assert.deepEqual(rec.by_direction.map((b) => b.label), ["long", "short"]);
});

test("7/13 fixture ledger: time-of-day buckets (9:50 boundary is prime, not open)", () => {
  const rec = buildZeroDteRecord(LEDGER_7_13, WINDOW);
  const prime = rec.by_time_of_day.find((b) => b.label === "prime 9:50-11:00");
  const midday = rec.by_time_of_day.find((b) => b.label === "midday 11:00-14:00");
  assert.ok(prime && midday);
  // AMD flagged exactly 9:50 ET belongs to prime (the open window is [9:30, 9:50)).
  assert.equal(prime.n, 6);
  assert.equal(prime.wins, 1); // QQQ
  assert.equal(midday.n, 2); // INTC 12:51, NVDA 12:40
  assert.equal(midday.low_n, true);
  assert.equal(rec.by_time_of_day.find((b) => b.label === "open 9:30-9:50"), undefined);
});

test("7/13 fixture ledger: outcome + score-band cuts, entry_context score wins banding", () => {
  const rec = buildZeroDteRecord(LEDGER_7_13, WINDOW);
  assert.deepEqual(
    rec.by_outcome.map((b) => [b.label, b.n, b.low_n]),
    [
      ["doubled", 1, true],
      ["stopped", 7, false],
    ]
  );
  // 65+: SPY 72, SPXW 68, META 66, QQQ 77, AMD 70. 55-64: INTC 58, NVDA 63.
  // <55: MU — score_max 61 but entry_context.score 54 (commit-time) must win.
  assert.deepEqual(
    rec.by_score_band.map((b) => [b.label, b.n, b.low_n]),
    [
      ["score 65+", 5, false],
      ["score 55-64", 2, true],
      ["score <55", 1, true],
    ]
  );
});

test("per-play rows: rounding at the data layer + ET rendering + context passthrough", () => {
  const rec = buildZeroDteRecord(LEDGER_7_13, WINDOW);
  const qqq = rec.plays.find((p) => p.ticker === "QQQ");
  assert.ok(qqq);
  assert.equal(qqq.plan_pnl_pct, 76.6); // 76.60000000000001 → rounded where the data is built
  assert.equal(qqq.flagged_et, "10:20 ET");
  const mu = rec.plays.find((p) => p.ticker === "MU");
  assert.ok(mu);
  assert.deepEqual(mu.entry_context, { score: 54, vix_open: 17.2, spy_bias: "down" });
  const amd = rec.plays.find((p) => p.ticker === "AMD");
  assert.equal(amd?.flagged_et, "09:50 ET");
});

test("ungraded and ungradeable rows appear per-play but never in aggregates", () => {
  const withExtras = [
    ...LEDGER_7_13,
    // Live/ungraded (today's session, grading is lazy next session).
    row({ ticker: "LIVE", session_date: "2026-07-14", plan_outcome: null, plan_pnl_pct: null, graded_at: null }),
    // Plan couldn't be measured — neither a win nor a loss.
    row({ ticker: "UNGR", plan_outcome: "ungradeable", plan_pnl_pct: null }),
  ];
  const rec = buildZeroDteRecord(withExtras, WINDOW);
  assert.equal(rec.total_flagged, 10);
  assert.equal(rec.graded, 8);
  assert.equal(rec.ungraded, 2);
  assert.equal(rec.wins, 1);
  assert.equal(rec.losses, 7);
  assert.equal(rec.window.sessions, 2);
  assert.ok(rec.plays.some((p) => p.ticker === "LIVE" && p.plan_outcome == null));
  // Newest session first in the per-play list.
  assert.equal(rec.plays[0]!.ticker, "LIVE");
});

test("empty ledger: available=false, no NaN/throw", () => {
  const rec = buildZeroDteRecord([], WINDOW);
  assert.equal(rec.available, false);
  assert.equal(rec.win_rate_pct, null);
  assert.equal(rec.avg_pnl_pct, null);
  assert.deepEqual(rec.by_outcome, []);
});

test("todBucket boundaries (ET): open/prime/midday/late/other", () => {
  // July ⇒ EDT ⇒ ET = UTC−4.
  assert.equal(todBucket("2026-07-13T13:29:00Z"), "other"); // 9:29 pre-open
  assert.equal(todBucket("2026-07-13T13:30:00Z"), "open 9:30-9:50");
  assert.equal(todBucket("2026-07-13T13:49:00Z"), "open 9:30-9:50");
  assert.equal(todBucket("2026-07-13T13:50:00Z"), "prime 9:50-11:00");
  assert.equal(todBucket("2026-07-13T15:00:00Z"), "midday 11:00-14:00");
  assert.equal(todBucket("2026-07-13T18:00:00Z"), "late 14:00-15:30");
  assert.equal(todBucket("2026-07-13T19:30:00Z"), "late 14:00-15:30"); // 15:30 inclusive
  assert.equal(todBucket("2026-07-13T19:31:00Z"), "other");
});

test("scoreBand + scoreForBanding + graded/win predicates", () => {
  assert.equal(scoreBand(65), "score 65+");
  assert.equal(scoreBand(64), "score 55-64");
  assert.equal(scoreBand(55), "score 55-64");
  assert.equal(scoreBand(54), "score <55");
  // Pre-context rows band by score_max; context rows by the committed score.
  assert.equal(scoreForBanding(row({ score_max: 70, entry_context: null })), 70);
  assert.equal(scoreForBanding(row({ score_max: 70, entry_context: { score: 58 } })), 58);
  assert.equal(scoreForBanding(row({ score_max: 70, entry_context: { score: "58" } })), 70); // non-number ctx ignored
  assert.equal(isGradedZeroDteRow(row({ plan_outcome: "time_stop" })), true);
  assert.equal(isGradedZeroDteRow(row({ plan_outcome: "ungradeable" })), false);
  assert.equal(isGradedZeroDteRow(row({ plan_outcome: null })), false);
  assert.equal(isZeroDteWin(row({ plan_pnl_pct: 0.01 })), true);
  assert.equal(isZeroDteWin(row({ plan_pnl_pct: 0 })), false);
  assert.equal(isZeroDteWin(row({ plan_pnl_pct: null })), false);
  assert.equal(LOW_N_THRESHOLD, 5);
});
