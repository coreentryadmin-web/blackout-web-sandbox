// B-9 live-marks lane tests: the pure math (marks-math.ts) directly, and the
// impure lane (live-marks.ts) with the same wholesale-mock idiom scan.test.ts
// uses for this module graph (db / options-snapshot / options-socket / session).
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  advancePlayLatch,
  closedStopReason,
  isZeroDteMarkStale,
  ledgerDisplayPnlPct,
  pinnedLivePnlPct,
  resolveZeroDteMark,
  zeroDteMidOf,
  ZERODTE_LIVE_CONTRACT_CAP,
} from "./marks-math";
import type { ZeroDteSetupLogRow } from "@/lib/db";

// ── pure math (marks-math.ts) ──────────────────────────────────────────────────────

test("resolveZeroDteMark: mid of a two-sided quote is the mark, flagged 'mid'", () => {
  assert.deepEqual(resolveZeroDteMark(1.0, 1.2, 0.9), { mark: 1.1, source: "mid" });
  // bid may be 0 for deep-OTM — still a real quote when ask > 0.
  assert.deepEqual(resolveZeroDteMark(0, 0.1, null), { mark: 0.05, source: "mid" });
});

test("resolveZeroDteMark: last trade only as a FLAGGED fallback; never fabricates", () => {
  assert.deepEqual(resolveZeroDteMark(null, null, 0.95), { mark: 0.95, source: "last" });
  assert.deepEqual(resolveZeroDteMark(null, 0, 0.95), { mark: 0.95, source: "last" });
  assert.deepEqual(resolveZeroDteMark(null, null, null), { mark: null, source: "none" });
  assert.deepEqual(resolveZeroDteMark(null, null, 0), { mark: null, source: "none" });
});

test("pinnedLivePnlPct: the one P&L formula — 2dp, pinned entry, null-safe", () => {
  assert.equal(pinnedLivePnlPct(4.2, 4.62), 10);
  assert.equal(pinnedLivePnlPct(4.2, 2.1), -50);
  assert.equal(pinnedLivePnlPct(3, 3.3333), 11.11);
  assert.equal(pinnedLivePnlPct(null, 5), null);
  assert.equal(pinnedLivePnlPct(0, 5), null);
  assert.equal(pinnedLivePnlPct(4.2, null), null);
});

test("isZeroDteMarkStale: 5s bar — exactly at the bar is fresh, past it is stale", () => {
  const now = 1_000_000;
  assert.equal(isZeroDteMarkStale(now - 5_000, now), false);
  assert.equal(isZeroDteMarkStale(now - 5_001, now), true);
  assert.equal(isZeroDteMarkStale(0, now), true); // never quoted = stale, not "live"
});

test("closedStopReason: CLOSED with trough through the stop reads 'stopped'", () => {
  assert.equal(
    closedStopReason({ status: "CLOSED", entry_premium: 4.2, peak_premium: 5.0, trough_premium: 2.1 }),
    "stopped"
  );
  // Trough above the stop (a time-stop close) is NOT a stop.
  assert.equal(
    closedStopReason({ status: "CLOSED", entry_premium: 4.2, peak_premium: 5.0, trough_premium: 3.0 }),
    null
  );
  // Live rows never get a closed reason.
  assert.equal(
    closedStopReason({ status: "HOLD", entry_premium: 4.2, peak_premium: 5.0, trough_premium: 2.0 }),
    null
  );
});

test("closedStopReason: a doubled play (sticky TRIM) is never relabeled 'stopped'", () => {
  // Peak tagged the +100% target first; the later crater must not rewrite history —
  // matches derivePlayStatus's peak-before-trough ordering.
  assert.equal(
    closedStopReason({ status: "CLOSED", entry_premium: 4.2, peak_premium: 8.4, trough_premium: 1.0 }),
    null
  );
});

test("ledgerDisplayPnlPct: stopped play pins to −50 (D-1 frozen-mark fix); others derive from mark", () => {
  // The wrong-number class: row closed CLOSED with last_mark frozen at 2.6 (−38.1%)
  // while the play actually stopped at −50 — the grader will stamp −50 next session.
  assert.equal(
    ledgerDisplayPnlPct({ status: "CLOSED", entry_premium: 4.2, last_mark: 2.6, peak_premium: 4.4, trough_premium: 2.0 }),
    -50
  );
  // Time-stop close keeps the honest mark-derived P&L.
  assert.equal(
    ledgerDisplayPnlPct({ status: "CLOSED", entry_premium: 4.0, last_mark: 4.4, peak_premium: 4.5, trough_premium: 3.6 }),
    10
  );
  // Live row: plain pinned-entry math.
  assert.equal(
    ledgerDisplayPnlPct({ status: "HOLD", entry_premium: 4.0, last_mark: 3.0, peak_premium: 4.0, trough_premium: 3.0 }),
    -25
  );
});

test("advancePlayLatch: latches only widen; status follows derivePlayStatus", () => {
  const play = { entry_premium: 4.0, peak_premium: null, trough_premium: null };
  const noon = 12 * 60;
  // First tick seeds latches at entry, then widens with the mark.
  const l1 = advancePlayLatch(play, null, 4.4, noon);
  // Mark exactly at entry×1.1 before the cutoff = still enterable → OPEN.
  assert.deepEqual(l1, { peak: 4.4, trough: 4.0, status: "OPEN" });
  // A dip latches the trough; the peak never regresses.
  const l2 = advancePlayLatch(play, l1, 3.0, noon);
  assert.equal(l2.peak, 4.4);
  assert.equal(l2.trough, 3.0);
  // Stop touch → CLOSED, and it is sticky even after a bounce.
  const l3 = advancePlayLatch(play, l2, 1.9, noon);
  assert.equal(l3.status, "CLOSED");
  const l4 = advancePlayLatch(play, l3, 4.1, noon);
  assert.equal(l4.status, "CLOSED");
  assert.equal(l4.trough, 1.9);
});

test("advancePlayLatch: target touch makes TRIM sticky; null mark still time-stops", () => {
  const play = { entry_premium: 4.0, peak_premium: null, trough_premium: null };
  const noon = 12 * 60;
  const l1 = advancePlayLatch(play, null, 8.1, noon);
  assert.equal(l1.status, "TRIM");
  const l2 = advancePlayLatch(play, l1, 3.0, noon); // gave the double back — still TRIM
  assert.equal(l2.status, "TRIM");
  // Past 15:30 ET everything closes, even with no quote this tick.
  const l3 = advancePlayLatch(play, l2, null, 15 * 60 + 31);
  assert.equal(l3.status, "CLOSED");
  assert.equal(l3.peak, 8.1); // null mark never touches the latches
});

// ── the impure lane (live-marks.ts) — hermetic stand-ins for the provider graph ────

const state = {
  ledgerRows: [] as ZeroDteSetupLogRow[],
  snapshotCalls: [] as string[][],
  snapshots: new Map<string, { bid: number | null; ask: number | null; last: number | null }>(),
  wsMarks: new Map<string, { mark: number; bid: number | null; ask: number | null; ts: number }>(),
  persistCalls: [] as Array<{ ticker: string; status: string; mark: number | null }>,
};

mock.module("../db", {
  namedExports: {
    dbConfigured: () => false, // the lane's own DB reads are injected in tests
    fetchZeroDteSetupLog: async () => state.ledgerRows,
    updateZeroDteLiveState: async () => {},
  },
});
mock.module("../providers/options-snapshot", {
  namedExports: {
    fetchOptionsUnifiedSnapshot: async (occs: string[]) => {
      state.snapshotCalls.push(occs);
      const out = new Map<string, unknown>();
      for (const occ of occs) {
        const s = state.snapshots.get(occ);
        if (s) out.set(occ, { ticker: occ, ...s, dayClose: null });
      }
      return out;
    },
  },
});
mock.module("../ws/options-socket", {
  namedExports: {
    getLiveOptionMark: async (occ: string) => state.wsMarks.get(occ) ?? null,
    subscribeContracts: () => {},
    unsubscribeContracts: () => {},
  },
});
mock.module("../../features/nighthawk/lib/session", {
  namedExports: {
    todayEt: () => "2026-07-14",
    etNowParts: () => ({ hour: 12, minute: 0 }),
  },
});

const loadLane = () => import("./live-marks");

function ledgerRow(over: Partial<ZeroDteSetupLogRow>): ZeroDteSetupLogRow {
  return {
    session_date: "2026-07-14",
    ticker: "NVDA",
    direction: "long",
    top_strike: 180,
    expiry: "2026-07-14",
    score: 70,
    score_max: 70,
    dossier_score: null,
    conviction: null,
    gross_premium: 2_000_000,
    spike: false,
    underlying_at_flag: 178,
    underlying_latest: null,
    flags_json: null,
    first_flagged_at: "2026-07-14T14:31:00.000Z",
    last_seen_at: "2026-07-14T15:00:00.000Z",
    close_price: null,
    move_pct: null,
    direction_hit: null,
    graded_at: null,
    entry_premium: 4.0,
    flow_avg_fill: 4.0,
    plan_json: { occ: "O:NVDA260714C00180000" },
    plan_outcome: null,
    plan_pnl_pct: null,
    status: "HOLD",
    last_mark: null,
    peak_premium: null,
    trough_premium: null,
    entry_context: null,
    ...over,
  };
}

test("boundActivePlays: caps at 16, skips CLOSED rows and rows with no plan OCC", async () => {
  const lm = await loadLane();
  const rows: ZeroDteSetupLogRow[] = [];
  for (let i = 0; i < 20; i++) {
    rows.push(ledgerRow({ ticker: `T${i}`, plan_json: { occ: `O:T${i}260714C00100000` } }));
  }
  rows.push(ledgerRow({ ticker: "CLOSEDX", status: "CLOSED" }));
  rows.push(ledgerRow({ ticker: "NOPLAN", plan_json: null }));
  const active = lm.boundActivePlays(rows);
  assert.equal(active.length, ZERODTE_LIVE_CONTRACT_CAP);
  assert.equal(active.length, 16);
  assert.ok(!active.some((p) => p.ticker === "CLOSEDX" || p.ticker === "NOPLAN"));
  // Pinned entry rides along — the ONLY entry reference the lane may push.
  assert.equal(active[0]!.entry_premium, 4.0);
});

test("mark store: newest asOf wins — an older write never regresses a fresher tick", async () => {
  const lm = await loadLane();
  lm._resetZeroDteLiveMarksForTest();
  const occ = "O:NVDA260714C00180000";
  lm.putZeroDteLiveMark({ occ, bid: 4.0, ask: 4.2, mid: 4.1, last: null, mark: 4.1, source: "mid", asOf: 2_000, lane: "rest" });
  lm.putZeroDteLiveMark({ occ, bid: 3.0, ask: 3.2, mid: 3.1, last: null, mark: 3.1, source: "mid", asOf: 1_000, lane: "rest" });
  assert.equal(lm.getZeroDteLiveMark(occ)?.mark, 4.1);
});

test("SSE payload shape: pinned-entry P&L, per-quote asOf, stale flag, idle marker", async () => {
  const lm = await loadLane();
  lm._resetZeroDteLiveMarksForTest();
  const occ = "O:NVDA260714C00180000";
  const now = Date.now();
  lm.putZeroDteLiveMark({ occ, bid: 4.3, ask: 4.5, mid: 4.4, last: 4.35, mark: 4.4, source: "mid", asOf: now - 1_000, lane: "rest" });
  const plays = lm.boundActivePlays([ledgerRow({})]);
  const payload = lm.buildZeroDteLiveMarksPayloadFrom(plays, now, "2026-07-14");
  assert.equal(payload.idle, false);
  assert.equal(payload.cap, 16);
  const row = payload.marks[0]!;
  assert.equal(row.ticker, "NVDA");
  assert.equal(row.occ, occ);
  assert.equal(row.entry_premium, 4.0);
  assert.equal(row.mark, 4.4);
  assert.equal(row.source, "mid");
  assert.equal(row.live_pnl_pct, 10); // (4.4-4.0)/4.0 — from pinnedLivePnlPct, nothing else
  assert.equal(row.mark_as_of, new Date(now - 1_000).toISOString());
  assert.equal(row.mark_age_ms, 1_000);
  assert.equal(row.stale, false);

  // A quote older than the 5s bar is pushed as STALE, never impersonating live.
  const later = lm.buildZeroDteLiveMarksPayloadFrom(plays, now + 10_000, "2026-07-14");
  assert.equal(later.marks[0]!.stale, true);

  // Never-quoted contract: nulls + source "none" + stale — no fabricated numbers.
  lm._resetZeroDteLiveMarksForTest();
  const empty = lm.buildZeroDteLiveMarksPayloadFrom(plays, now, "2026-07-14");
  assert.equal(empty.marks[0]!.mark, null);
  assert.equal(empty.marks[0]!.source, "none");
  assert.equal(empty.marks[0]!.stale, true);
  assert.equal(empty.marks[0]!.live_pnl_pct, null);

  // No open plays → idle payload (the SSE lane has nothing to stream).
  const idle = lm.buildZeroDteLiveMarksPayloadFrom([], now, "2026-07-14");
  assert.equal(idle.idle, true);
  assert.equal(idle.marks.length, 0);
});

test("poller tick: WS-fresh contracts skip REST; misses get ONE batched snapshot call", async () => {
  const lm = await loadLane();
  lm._resetZeroDteLiveMarksForTest();
  state.snapshotCalls = [];
  state.snapshots = new Map([["O:B260714C00100000", { bid: 1.0, ask: 1.2, last: 1.05 }]]);
  state.wsMarks = new Map([["O:A260714C00100000", { mark: 2.5, bid: 2.4, ask: 2.6, ts: Date.now() }]]);
  const plays = lm.boundActivePlays([
    ledgerRow({ ticker: "A", plan_json: { occ: "O:A260714C00100000" } }),
    ledgerRow({ ticker: "B", plan_json: { occ: "O:B260714C00100000" } }),
  ]);
  await lm.runZeroDteMarkTick({
    plays,
    fetchSnapshots: async (occs: string[]) => {
      state.snapshotCalls.push(occs);
      return new Map([
        ["O:B260714C00100000", { ticker: "O:B260714C00100000", bid: 1.0, ask: 1.2, last: 1.05 } as never],
      ]);
    },
    readWsMark: (async (occ: string) => state.wsMarks.get(occ) ?? null) as never,
    skipPersist: true,
  });
  // Exactly one REST batch, containing ONLY the WS-miss contract.
  assert.equal(state.snapshotCalls.length, 1);
  assert.deepEqual(state.snapshotCalls[0], ["O:B260714C00100000"]);
  assert.equal(lm.getZeroDteLiveMark("O:A260714C00100000")?.lane, "ws");
  assert.equal(lm.getZeroDteLiveMark("O:A260714C00100000")?.mark, 2.5);
  const b = lm.getZeroDteLiveMark("O:B260714C00100000");
  assert.equal(b?.lane, "rest");
  assert.equal(b?.mark, 1.1); // mid of 1.0/1.2, not the last trade
  assert.equal(b?.source, "mid");
});

test("poller tick: persists a status flip immediately, heartbeats otherwise", async () => {
  const lm = await loadLane();
  lm._resetZeroDteLiveMarksForTest();
  const occ = "O:NVDA260714C00180000";
  const plays = lm.boundActivePlays([ledgerRow({})]); // entry 4.0 → stop 2.0
  const persisted: Array<{ ticker: string; status: string; mark: number | null }> = [];
  const persist = (async (_d: string, ticker: string, s: { status: string; mark: number | null }) => {
    persisted.push({ ticker, status: s.status, mark: s.mark });
  }) as never;
  const noWs = (async () => null) as never;
  const snapOf = (bid: number, ask: number) =>
    (async () => new Map([[occ, { ticker: occ, bid, ask, last: null } as never]])) as never;

  const t0 = Date.now();
  await lm.runZeroDteMarkTick({ plays, fetchSnapshots: snapOf(3.9, 4.1), readWsMark: noWs, persist, nowMs: t0, nowEtMinutes: 12 * 60 } as never);
  assert.equal(persisted.length, 1); // first sighting persists
  assert.equal(persisted[0]!.status, "OPEN"); // mark at entry, before the 15:00 cutoff
  assert.equal(persisted[0]!.mark, 4.0);

  // 1s later, same status, inside the heartbeat window → NO write.
  await lm.runZeroDteMarkTick({ plays, fetchSnapshots: snapOf(3.8, 4.0), readWsMark: noWs, persist, nowMs: t0 + 1_000, nowEtMinutes: 12 * 60 } as never);
  assert.equal(persisted.length, 1);

  // Stop touch → status flips to CLOSED → persists IMMEDIATELY (no heartbeat wait).
  await lm.runZeroDteMarkTick({ plays, fetchSnapshots: snapOf(1.8, 2.0), readWsMark: noWs, persist, nowMs: t0 + 2_000, nowEtMinutes: 12 * 60 } as never);
  assert.equal(persisted.length, 2);
  assert.equal(persisted[1]!.status, "CLOSED");
  assert.equal(persisted[1]!.mark, 1.9);

  // Heartbeat: same status past PERSIST_HEARTBEAT_MS → one refresh write.
  await lm.runZeroDteMarkTick({ plays, fetchSnapshots: snapOf(1.8, 2.0), readWsMark: noWs, persist, nowMs: t0 + 13_000, nowEtMinutes: 12 * 60 } as never);
  assert.equal(persisted.length, 3);
  assert.equal(persisted[2]!.status, "CLOSED");
});
