// B-9 board-payload integration: the D-1 stopped-play P&L pin and the live-marks
// lane overlay (mark_as_of / mark_source / fresher last_mark), through the REAL
// buildZeroDteBoardPayload with the same hermetic-mock idiom zerodte-service.test.ts
// uses. Separate file on purpose: node --test runs each file in its own process, so
// these mocks/fixtures can't leak into the existing service test (ESM module cache).
import { test, mock } from "node:test";
import assert from "node:assert/strict";

test("board ledger: stopped play pins live_pnl_pct to −50; live row carries lane mark + asOf", async () => {
  const OPEN_OCC = "O:NVDA260714C00180000";
  mock.module("server-only", { namedExports: {} });
  mock.module("../bie/ecosystem-context", {
    namedExports: { fetchNighthawkEchoForTickers: async () => new Map() },
  });
  const baseRow = {
    session_date: "2026-07-14",
    direction: "long",
    score: 80,
    score_max: 80,
    spike: false,
    underlying_at_flag: 178,
    first_flagged_at: new Date().toISOString(),
    flow_avg_fill: 4.2,
    top_strike: 180,
    conviction: null,
    gross_premium: 2_000_000,
    move_pct: null,
    direction_hit: null,
    plan_outcome: null,
    plan_pnl_pct: null,
    graded_at: null,
    underlying_latest: null,
    flags_json: null,
    expiry: null,
    dossier_score: null,
    last_seen_at: new Date().toISOString(),
    close_price: null,
    entry_context: null,
  };
  mock.module("../zerodte/scan", {
    namedExports: {
      readZeroDteLedger: async () => [
        {
          ...baseRow,
          ticker: "NVDA",
          entry_premium: 4.2,
          last_mark: 4.4, // deliberately older than the lane's 4.62 below
          status: "HOLD",
          plan_json: { occ: OPEN_OCC },
          peak_premium: 4.4,
          trough_premium: 4.0,
        },
        {
          // D-1 fixture: stopped out (trough through 2.1 = −50% of 4.2) but the
          // frozen last_mark reads 2.6 (−38.1%) — the exact wrong-number class.
          ...baseRow,
          ticker: "TSLA",
          entry_premium: 4.2,
          last_mark: 2.6,
          status: "CLOSED",
          plan_json: { occ: "O:TSLA260714C00300000" },
          peak_premium: 4.5,
          trough_premium: 2.0,
        },
      ],
      syncLedgerLiveState: async (rows: unknown[]) => rows,
      scanZeroDteBoard: async () => ({ setups: [], nighthawk_covered: [], upstream_ok: true, rejections: [] }),
      gradeZeroDteLedger: async () => 0,
    },
  });
  mock.module("../providers/polygon", { namedExports: { fetchBenzingaNews: async () => [] } });
  mock.module("../zerodte/earnings", { namedExports: { readGridEarnings: async () => null } });
  mock.module("../server-cache", {
    namedExports: {
      withServerCache: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
      serverCache: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
      TTL: { NEWS: 60 },
    },
  });
  mock.module("../../features/nighthawk/lib/session", {
    namedExports: {
      todayEt: () => "2026-07-14",
      etNowParts: () => ({ hour: 11, minute: 30 }),
      isTradingDayEt: () => true,
      nextTradingDayEt: () => "2026-07-15",
    },
  });

  // Seed the REAL live-marks store (the same module instance the service's lazy
  // import resolves) with a fresh lane quote for the open contract.
  const lane = await import("../zerodte/live-marks");
  lane._resetZeroDteLiveMarksForTest();
  const asOf = Date.now();
  lane.putZeroDteLiveMark({
    occ: OPEN_OCC,
    bid: 4.6,
    ask: 4.64,
    mid: 4.62,
    last: 4.6,
    mark: 4.62,
    source: "mid",
    asOf,
    lane: "rest",
  });

  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  const byTicker = new Map(board.ledger.map((r) => [r.ticker, r]));

  // Live row: the lane's fresher mark overlays the sync's last_mark, with per-quote
  // provenance + timestamp, and P&L reflects the overlaid mark vs the PINNED entry.
  const nvda = byTicker.get("NVDA")!;
  assert.equal(nvda.last_mark, 4.62);
  assert.equal(nvda.live_pnl_pct, 10);
  assert.equal(nvda.mark_source, "mid");
  assert.equal(nvda.mark_as_of, new Date(asOf).toISOString());
  assert.equal(nvda.closed_reason, null);

  // D-1: the stopped play's displayed result is the stop P&L (−50, what the grader
  // will stamp), not the frozen −38.1% — and it is labeled.
  const tsla = byTicker.get("TSLA")!;
  assert.equal(tsla.closed_reason, "stopped");
  assert.equal(tsla.live_pnl_pct, -50);
  // CLOSED rows never get a live overlay (frozen by design).
  assert.equal(tsla.mark_as_of, null);

  lane._resetZeroDteLiveMarksForTest();
});
