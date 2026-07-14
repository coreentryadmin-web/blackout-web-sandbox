// B-9 board-payload integration: the D-1 stopped-play P&L pin and the live-marks
// lane overlay (mark_as_of / mark_source / fresher last_mark), through the REAL
// buildZeroDteBoardPayload with the same hermetic-mock idiom zerodte-service.test.ts
// uses. Separate file on purpose: node --test runs each file in its own process, so
// these mocks/fixtures can't leak into the existing service test (ESM module cache).
//
// TIMING DISCIPLINE (CI flake fix, run 29296357116): the overlay only applies lane
// marks fresher than ZERODTE_MARK_STALE_MS (5s) — that check runs against the REAL
// clock inside attachLiveMarkMeta and is exactly the honesty rule under test, so this
// file must never race it. The first version seeded `asOf = Date.now()` BEFORE the
// tsx compile of the whole service graph (`await import("./zerodte-service")`); on a
// loaded 4-core CI runner executing dozens of test processes concurrently, that gap
// exceeded 5s, the overlay (correctly) rejected the "fresh" seed as stale, and the
// assertion saw the sync mark (4.4) instead of the lane mark (4.62). Fix, without
// loosening any assertion:
//   1. ALL imports happen before seeding, so no compile cost sits inside the window.
//   2. The fresh-direction seed is future-dated (+30s) — a fixture timestamp that
//      stays inside the freshness window regardless of scheduler stalls. The
//      REJECTION direction (stale marks never overlay) is asserted with a far-PAST
//      asOf, which is timing-safe by construction, so both sides of the honesty rule
//      stay covered deterministically.
//   3. The lane store is seeded through the SAME module specifier the service's
//      lazy import resolves ("@/lib/zerodte/live-marks"), so a path-alias/mock-cache
//      split can never leave the test writing to a different module instance than
//      the one the service reads.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

test("board ledger: stopped play pins live_pnl_pct to −50; live row carries lane mark + asOf; stale lane marks never overlay", async () => {
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
          last_mark: 4.4, // deliberately different from the lane's 4.62 below
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

  // ALL imports up front (see TIMING DISCIPLINE above): pay the full tsx compile
  // cost of both graphs BEFORE any clock-sensitive seeding. RELATIVE specifier, not
  // the "@/" alias: CI's tsx ESM loader does not resolve tsconfig path aliases inside
  // dynamic import() from test files (ERR_MODULE_NOT_FOUND on ".../platform/@/lib/...")
  // while the local CJS transformer does. Both specifiers resolve to the same absolute
  // file → the same module instance the service's lazy import reads.
  const lane = await import("../zerodte/live-marks");
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");

  const laneMark = (asOf: number) => ({
    occ: OPEN_OCC,
    bid: 4.6,
    ask: 4.64,
    mid: 4.62,
    last: 4.6,
    mark: 4.62,
    source: "mid" as const,
    asOf,
    lane: "rest" as const,
  });

  // ── Direction 1 (timing-safe by construction): a STALE lane mark must NOT
  // overlay — the sync mark stands and no per-quote timestamp is claimed.
  lane._resetZeroDteLiveMarksForTest();
  lane.putZeroDteLiveMark(laneMark(Date.now() - 60_000));
  {
    const board = await buildZeroDteBoardPayload();
    const nvda = board.ledger.find((r) => r.ticker === "NVDA")!;
    assert.equal(nvda.last_mark, 4.4); // sync value — the stale lane mark was refused
    assert.equal(nvda.mark_as_of, null);
    assert.equal(nvda.mark_source, null);
  }

  // ── Direction 2: a FRESH lane mark overlays with provenance + timestamp.
  // Future-dated fixture (+30s) so a CI scheduler stall between this line and the
  // overlay's real-clock staleness check can never flip the outcome (the staleness
  // rejection itself is proven above and in live-marks.test.ts / ZeroDteBoard.test.ts).
  const asOf = Date.now() + 30_000;
  lane.putZeroDteLiveMark(laneMark(asOf));
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
