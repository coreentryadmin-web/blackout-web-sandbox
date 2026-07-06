import { test, mock } from "node:test";
import assert from "node:assert/strict";

// rejections.ts (the module under test) statically imports @/lib/db and
// @/lib/providers/spx-session only (deliberately import-light — see its module
// doc for why it lives outside scan.ts's much heavier provider-import graph), so
// unlike spx-signal-log.ts's siblings this file does NOT need a "server-only"
// stub — neither @/lib/db nor @/lib/providers/spx-session pulls that in. Confirmed
// by running this file standalone before adding the mocks below.
//
// persistZeroDteRejections (task #147) is the multi-ticker analogue of
// maybeLogSpxEngineSnapshot (spx-signal-log-engine-snapshot.test.ts) — it captures
// deriveZeroDteSetups' gate-rejection near-misses via the SAME "in-memory string
// stands in for one platform_meta row" throttle idiom, just keyed per-ticker via a
// JSON cursor map instead of a single scalar cursor (see rejections.ts's module
// doc for why: many simultaneous candidate tickers, not one instrument).
const state = {
  dbConfigured: true,
  cursor: null as string | null,
  inserted: [] as Array<Record<string, unknown>>,
};

function resetState() {
  state.dbConfigured = true;
  state.cursor = null;
  state.inserted = [];
}

mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    getMeta: async (key: string) => (key === "zerodte_scan_rejection_cursor" ? state.cursor : null),
    setMeta: async (key: string, value: string) => {
      if (key === "zerodte_scan_rejection_cursor") state.cursor = value;
    },
    insertZeroDteScanRejection: async (row: Record<string, unknown>) => {
      state.inserted.push(row);
    },
    // Newest-first, mirroring the real ORDER BY observed_at DESC — the in-memory
    // `inserted` array is append-order (oldest first), so this reverses it. Ticker
    // filtering mirrors the real fetchZeroDteScanRejections' WHERE ticker = $1.
    fetchZeroDteScanRejections: async (opts?: { ticker?: string; limit?: number }) => {
      const limit = opts?.limit ?? 50;
      const ticker = opts?.ticker?.toUpperCase();
      const rows = state.inserted
        .slice()
        .reverse()
        .filter((r) => !ticker || r.ticker === ticker)
        .slice(0, limit)
        .map((row, i) => ({ id: state.inserted.length - i, observed_at: "2026-07-06T14:00:00.000Z", ...row }));
      return rows;
    },
  },
});
mock.module("../providers/spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-06" },
});

// Lazy import (ESM caches the module under test after the first call) so the
// mocks above are in place before rejections.ts's own top-level imports resolve —
// same idiom every spx-signal-log-*.test.ts sibling uses.
const mod = () => import("./rejections");

type Rejection = {
  ticker: string;
  gate_failed: "min_gross" | "min_aggr_share" | "min_dominance" | "max_itm_pct" | "no_dominant_strike";
  threshold: number | null;
  gross_premium: number;
  aggression: number | null;
  side_dominance: number | null;
  otm_pct: number | null;
  direction: "long" | "short" | null;
  prints: number;
  first_seen: string | null;
  last_seen: string | null;
};

function rejection(overrides: Partial<Rejection> = {}): Rejection {
  return {
    ticker: "TINY",
    gate_failed: "min_gross",
    threshold: 750_000,
    gross_premium: 200_000,
    aggression: null,
    side_dominance: null,
    otm_pct: null,
    direction: null,
    prints: 1,
    first_seen: "2026-07-06T14:00:00Z",
    last_seen: "2026-07-06T14:00:00Z",
    ...overrides,
  };
}

test("persistZeroDteRejections: db not configured — never reads/writes platform_meta, zero inserts", async () => {
  const { persistZeroDteRejections } = await mod();
  resetState();
  state.dbConfigured = false;

  const n = await persistZeroDteRejections([rejection()]);

  assert.equal(n, 0);
  assert.equal(state.inserted.length, 0);
  assert.equal(state.cursor, null);
});

test("persistZeroDteRejections: empty input — short-circuits without touching the cursor", async () => {
  const { persistZeroDteRejections } = await mod();
  resetState();

  const n = await persistZeroDteRejections([]);

  assert.equal(n, 0);
  assert.equal(state.cursor, null);
});

test("persistZeroDteRejections: first rejection for a ticker — inserts a row with the right shape and rolls the cursor", async () => {
  const { persistZeroDteRejections } = await mod();
  resetState();

  const n = await persistZeroDteRejections([rejection()]);

  assert.equal(n, 1);
  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0];
  assert.equal(row.session_date, "2026-07-06");
  assert.equal(row.ticker, "TINY");
  assert.equal(row.gate_failed, "min_gross");
  assert.equal(row.threshold, 750_000);
  assert.equal(row.gross_premium, 200_000);
  assert.equal(row.aggression, null);
  assert.equal(row.side_dominance, null);
  assert.equal(row.otm_pct, null);
  assert.ok(state.cursor);
});

test("persistZeroDteRejections: same ticker, same (gate_failed, direction) on the next cycle — throttled, no duplicate row even though gross_premium/aggression jitter", async () => {
  const { persistZeroDteRejections } = await mod();
  resetState();

  await persistZeroDteRejections([rejection({ gross_premium: 200_000 })]);
  const n = await persistZeroDteRejections([rejection({ gross_premium: 210_000, prints: 2 })]);

  assert.equal(n, 0, "an unchanged rejection state must not write a second row");
  assert.equal(state.inserted.length, 1);
});

test("persistZeroDteRejections: gate_failed changes for the same ticker — a new row is written (real state transition)", async () => {
  const { persistZeroDteRejections } = await mod();
  resetState();

  await persistZeroDteRejections([rejection({ ticker: "AAPL", gate_failed: "min_gross" })]);
  const n = await persistZeroDteRejections([
    rejection({ ticker: "AAPL", gate_failed: "min_aggr_share", threshold: 0.3, aggression: 0.15 }),
  ]);

  assert.equal(n, 1);
  assert.equal(state.inserted.length, 2);
  assert.equal(state.inserted[1].gate_failed, "min_aggr_share");
});

test("persistZeroDteRejections: direction flip with the same gate_failed still counts as a transition", async () => {
  const { persistZeroDteRejections } = await mod();
  resetState();

  await persistZeroDteRejections([
    rejection({ ticker: "AAPL", gate_failed: "min_dominance", direction: "long" }),
  ]);
  const n = await persistZeroDteRejections([
    rejection({ ticker: "AAPL", gate_failed: "min_dominance", direction: "short" }),
  ]);

  assert.equal(n, 1);
  assert.equal(state.inserted.length, 2);
  assert.equal(state.inserted[0].direction, "long");
  assert.equal(state.inserted[1].direction, "short");
});

test("persistZeroDteRejections: two DIFFERENT tickers rejecting in the same cycle both write, independently throttled thereafter", async () => {
  const { persistZeroDteRejections } = await mod();
  resetState();

  const first = await persistZeroDteRejections([
    rejection({ ticker: "AAPL" }),
    rejection({ ticker: "TSLA", gate_failed: "min_dominance", threshold: 0.65, direction: "short" }),
  ]);
  assert.equal(first, 2);

  // Same cycle repeated (both unchanged) — neither writes again.
  const second = await persistZeroDteRejections([
    rejection({ ticker: "AAPL" }),
    rejection({ ticker: "TSLA", gate_failed: "min_dominance", threshold: 0.65, direction: "short" }),
  ]);
  assert.equal(second, 0);
  assert.equal(state.inserted.length, 2);
});

test("persistZeroDteRejections: a stale cursor entry from a DIFFERENT session date does not suppress today's first rejection", async () => {
  const { persistZeroDteRejections } = await mod();
  resetState();
  // Simulate yesterday's leftover cursor for the same ticker/state.
  state.cursor = JSON.stringify({ TINY: { date: "2026-07-05", key: JSON.stringify({ gate: "min_gross", direction: null }) } });

  const n = await persistZeroDteRejections([rejection()]);

  assert.equal(n, 1, "today's first rejection for a previously-seen ticker must still log");
  assert.equal(state.inserted.length, 1);
});

test("fetchZeroDteRejections: db not configured — returns [] without calling the DB layer", async () => {
  const { fetchZeroDteRejections } = await mod();
  resetState();
  state.dbConfigured = false;

  const rows = await fetchZeroDteRejections({ limit: 10 });
  assert.deepEqual(rows, []);
});

test("fetchZeroDteRejections: delegates to the db layer and scopes by ticker", async () => {
  const { persistZeroDteRejections, fetchZeroDteRejections } = await mod();
  resetState();

  await persistZeroDteRejections([
    rejection({ ticker: "AAPL" }),
    rejection({ ticker: "TSLA", gate_failed: "min_dominance", threshold: 0.65, direction: "short" }),
  ]);

  const all = await fetchZeroDteRejections({ limit: 10 });
  assert.equal(all.length, 2);

  const scoped = await fetchZeroDteRejections({ ticker: "tsla", limit: 10 });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0]!.ticker, "TSLA");
});

test("zeroDteRejectionsForLargo: no history for the queried ticker — available:false with a clear note", async () => {
  const { zeroDteRejectionsForLargo } = await mod();
  resetState();

  const payload = await zeroDteRejectionsForLargo("AAPL");
  assert.equal(payload.available, false);
  assert.match(String(payload.note), /AAPL/);
});

test("zeroDteRejectionsForLargo: retrieves near-miss history for a queried ticker, distinct from other tickers", async () => {
  const { persistZeroDteRejections, zeroDteRejectionsForLargo } = await mod();
  resetState();

  await persistZeroDteRejections([
    rejection({ ticker: "AAPL", gate_failed: "min_gross", threshold: 750_000, gross_premium: 200_000 }),
    rejection({
      ticker: "TSLA",
      gate_failed: "min_dominance",
      threshold: 0.65,
      gross_premium: 900_000,
      aggression: 1,
      side_dominance: 0.55,
      direction: "long",
    }),
  ]);

  const payload = await zeroDteRejectionsForLargo("AAPL");
  assert.equal(payload.available, true);
  assert.equal(payload.ticker, "AAPL");
  const rows = payload.rejections as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.ticker, "AAPL");
  assert.equal(rows[0]!.gate_failed, "min_gross");

  // Querying with no ticker returns the most recent rejections across ALL candidates.
  const everyone = await zeroDteRejectionsForLargo();
  assert.equal(everyone.available, true);
  assert.equal(everyone.ticker, null);
  assert.equal((everyone.rejections as unknown[]).length, 2);
});
