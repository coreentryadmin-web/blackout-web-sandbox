import { test, mock } from "node:test";
import assert from "node:assert/strict";

// flow-anomaly-near-misses.ts (the module under test) statically imports @/lib/db
// and @/lib/providers/spx-session for its runtime logic, plus a TYPE-ONLY import
// of FlowAnomalyNearMiss from the market-regime-detector route's own detection
// module — type-only imports are erased at compile time, so that path needs no
// mock here (confirmed by this file running standalone with only the two mocks
// below). Deliberately import-light for the SAME reason rejections.ts
// (src/lib/zerodte/rejections.test.ts) is: a test of this throttle logic should
// never need to mock detectFlowAnomalies' own fetchRecentFlows dependency.
//
// persistFlowAnomalyNearMisses (task #131) is the THIRD instance of the
// "in-memory string stands in for one platform_meta row" throttle idiom, after
// maybeLogSpxEngineSnapshot (single scalar cursor) and persistZeroDteRejections
// (per-ticker JSON cursor map) — this one keys the cursor by
// `${ticker}|${anomaly_type}` since a single ticker can independently near-miss
// BOTH anomaly types in the same tick (see module doc for why).
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
    getMeta: async (key: string) => (key === "flow_anomaly_near_miss_cursor" ? state.cursor : null),
    setMeta: async (key: string, value: string) => {
      if (key === "flow_anomaly_near_miss_cursor") state.cursor = value;
    },
    insertFlowAnomalyNearMiss: async (row: Record<string, unknown>) => {
      state.inserted.push(row);
    },
    // Newest-first, mirroring the real ORDER BY observed_at DESC — the in-memory
    // `inserted` array is append-order (oldest first), so this reverses it. Ticker
    // filtering mirrors the real fetchFlowAnomalyNearMisses' WHERE ticker = $1.
    fetchFlowAnomalyNearMisses: async (opts?: { ticker?: string; limit?: number }) => {
      const limit = opts?.limit ?? 50;
      const ticker = opts?.ticker?.toUpperCase();
      const rows = state.inserted
        .slice()
        .reverse()
        .filter((r) => !ticker || r.ticker === ticker)
        .slice(0, limit)
        .map((row, i) => ({ id: state.inserted.length - i, observed_at: "2026-07-06T14:05:00.000Z", ...row }));
      return rows;
    },
  },
});
mock.module("../providers/spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-06" },
});

// Lazy import (ESM caches the module under test after the first call) so the
// mocks above are in place before flow-anomaly-near-misses.ts's own top-level
// imports resolve — same idiom every mock.module()-based sibling test uses.
const mod = () => import("./flow-anomaly-near-misses");

type NearMiss = {
  anomaly_type: string;
  ticker: string | null;
  reason: "BELOW_THRESHOLD" | "DEDUP_SUPPRESSED";
  metric_value: number;
  threshold: number;
  premium: number | null;
  direction: string | null;
  severity: string | null;
  detail: string;
};

function nearMiss(overrides: Partial<NearMiss> = {}): NearMiss {
  return {
    anomaly_type: "LARGE_PREMIUM_PRINT",
    ticker: "TSLA",
    reason: "BELOW_THRESHOLD",
    metric_value: 1_800_000,
    threshold: 2_000_000,
    premium: 1_800_000,
    direction: "bearish",
    severity: null,
    detail: "TSLA: $1.80M single PUT print at strike 200 — below the $2.0M anomaly threshold",
    ...overrides,
  };
}

test("persistFlowAnomalyNearMisses: db not configured — never reads/writes platform_meta, zero inserts", async () => {
  const { persistFlowAnomalyNearMisses } = await mod();
  resetState();
  state.dbConfigured = false;

  const n = await persistFlowAnomalyNearMisses([nearMiss()]);

  assert.equal(n, 0);
  assert.equal(state.inserted.length, 0);
  assert.equal(state.cursor, null);
});

test("persistFlowAnomalyNearMisses: empty input — short-circuits without touching the cursor", async () => {
  const { persistFlowAnomalyNearMisses } = await mod();
  resetState();

  const n = await persistFlowAnomalyNearMisses([]);

  assert.equal(n, 0);
  assert.equal(state.cursor, null);
});

test("persistFlowAnomalyNearMisses: first near-miss for a ticker/type — inserts a row with the right shape and rolls the cursor", async () => {
  const { persistFlowAnomalyNearMisses } = await mod();
  resetState();

  const n = await persistFlowAnomalyNearMisses([nearMiss()]);

  assert.equal(n, 1);
  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0]!;
  assert.equal(row.anomaly_type, "LARGE_PREMIUM_PRINT");
  assert.equal(row.ticker, "TSLA");
  assert.equal(row.reason, "BELOW_THRESHOLD");
  assert.equal(row.metric_value, 1_800_000);
  assert.equal(row.threshold, 2_000_000);
  assert.equal(row.severity, null);
  assert.ok(state.cursor);
});

test("persistFlowAnomalyNearMisses: same ticker/type, same (reason, direction) on the next tick — throttled, no duplicate row even though metric_value jitters", async () => {
  const { persistFlowAnomalyNearMisses } = await mod();
  resetState();

  await persistFlowAnomalyNearMisses([nearMiss({ metric_value: 1_800_000 })]);
  const n = await persistFlowAnomalyNearMisses([nearMiss({ metric_value: 1_850_000 })]);

  assert.equal(n, 0, "an unchanged near-miss state must not write a second row");
  assert.equal(state.inserted.length, 1);
});

test("persistFlowAnomalyNearMisses: reason changes for the same ticker/type — a new row is written (real state transition)", async () => {
  const { persistFlowAnomalyNearMisses } = await mod();
  resetState();

  await persistFlowAnomalyNearMisses([nearMiss({ ticker: "AAPL", reason: "BELOW_THRESHOLD" })]);
  const n = await persistFlowAnomalyNearMisses([
    nearMiss({ ticker: "AAPL", reason: "DEDUP_SUPPRESSED", severity: "HIGH" }),
  ]);

  assert.equal(n, 1);
  assert.equal(state.inserted.length, 2);
  assert.equal(state.inserted[1]!.reason, "DEDUP_SUPPRESSED");
});

test("persistFlowAnomalyNearMisses: direction flip with the same reason still counts as a transition", async () => {
  const { persistFlowAnomalyNearMisses } = await mod();
  resetState();

  await persistFlowAnomalyNearMisses([
    nearMiss({ ticker: "AAPL", anomaly_type: "DIRECTIONAL_FLOW_SKEW", direction: "bullish" }),
  ]);
  const n = await persistFlowAnomalyNearMisses([
    nearMiss({ ticker: "AAPL", anomaly_type: "DIRECTIONAL_FLOW_SKEW", direction: "bearish" }),
  ]);

  assert.equal(n, 1);
  assert.equal(state.inserted.length, 2);
  assert.equal(state.inserted[0]!.direction, "bullish");
  assert.equal(state.inserted[1]!.direction, "bearish");
});

test("persistFlowAnomalyNearMisses: the SAME ticker near-missing on BOTH anomaly types in one tick both write, independently throttled thereafter", async () => {
  const { persistFlowAnomalyNearMisses } = await mod();
  resetState();

  const first = await persistFlowAnomalyNearMisses([
    nearMiss({ ticker: "TSLA", anomaly_type: "LARGE_PREMIUM_PRINT" }),
    nearMiss({ ticker: "TSLA", anomaly_type: "DIRECTIONAL_FLOW_SKEW", metric_value: 8, threshold: 10, direction: "bullish" }),
  ]);
  assert.equal(first, 2, "one ticker can independently near-miss two different anomaly types in the same tick");

  // Same cycle repeated (both unchanged) — neither writes again, proving the
  // cursor is keyed by (ticker, anomaly_type), not ticker alone.
  const second = await persistFlowAnomalyNearMisses([
    nearMiss({ ticker: "TSLA", anomaly_type: "LARGE_PREMIUM_PRINT" }),
    nearMiss({ ticker: "TSLA", anomaly_type: "DIRECTIONAL_FLOW_SKEW", metric_value: 8, threshold: 10, direction: "bullish" }),
  ]);
  assert.equal(second, 0);
  assert.equal(state.inserted.length, 2);
});

test("persistFlowAnomalyNearMisses: two DIFFERENT tickers near-missing in the same tick both write, independently throttled thereafter", async () => {
  const { persistFlowAnomalyNearMisses } = await mod();
  resetState();

  const first = await persistFlowAnomalyNearMisses([
    nearMiss({ ticker: "AAPL" }),
    nearMiss({ ticker: "MSFT", direction: "bullish" }),
  ]);
  assert.equal(first, 2);

  const second = await persistFlowAnomalyNearMisses([
    nearMiss({ ticker: "AAPL" }),
    nearMiss({ ticker: "MSFT", direction: "bullish" }),
  ]);
  assert.equal(second, 0);
  assert.equal(state.inserted.length, 2);
});

test("persistFlowAnomalyNearMisses: a stale cursor entry from a DIFFERENT session date does not suppress today's first near-miss", async () => {
  const { persistFlowAnomalyNearMisses } = await mod();
  resetState();
  // Simulate yesterday's leftover cursor for the same ticker/type/state.
  state.cursor = JSON.stringify({
    "TSLA|LARGE_PREMIUM_PRINT": {
      date: "2026-07-05",
      key: JSON.stringify({ reason: "BELOW_THRESHOLD", direction: "bearish" }),
    },
  });

  const n = await persistFlowAnomalyNearMisses([nearMiss()]);

  assert.equal(n, 1, "today's first near-miss for a previously-seen ticker/type must still log");
  assert.equal(state.inserted.length, 1);
});

test("fetchFlowAnomalyNearMissesFor: db not configured — returns [] without calling the DB layer", async () => {
  const { fetchFlowAnomalyNearMissesFor } = await mod();
  resetState();
  state.dbConfigured = false;

  const rows = await fetchFlowAnomalyNearMissesFor({ limit: 10 });
  assert.deepEqual(rows, []);
});

test("fetchFlowAnomalyNearMissesFor: delegates to the db layer and scopes by ticker", async () => {
  const { persistFlowAnomalyNearMisses, fetchFlowAnomalyNearMissesFor } = await mod();
  resetState();

  await persistFlowAnomalyNearMisses([
    nearMiss({ ticker: "AAPL" }),
    nearMiss({ ticker: "MSFT", direction: "bullish" }),
  ]);

  const all = await fetchFlowAnomalyNearMissesFor({ limit: 10 });
  assert.equal(all.length, 2);

  const scoped = await fetchFlowAnomalyNearMissesFor({ ticker: "msft", limit: 10 });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0]!.ticker, "MSFT");
});

test("flowAnomalyNearMissesForLargo: no history for the queried ticker — available:false with a clear note", async () => {
  const { flowAnomalyNearMissesForLargo } = await mod();
  resetState();

  const payload = await flowAnomalyNearMissesForLargo("AAPL");
  assert.equal(payload.available, false);
  assert.match(String(payload.note), /AAPL/);
});

test("flowAnomalyNearMissesForLargo: retrieves near-miss history for a queried ticker, distinct from other tickers", async () => {
  const { persistFlowAnomalyNearMisses, flowAnomalyNearMissesForLargo } = await mod();
  resetState();

  await persistFlowAnomalyNearMisses([
    nearMiss({ ticker: "AAPL", anomaly_type: "LARGE_PREMIUM_PRINT" }),
    nearMiss({
      ticker: "MSFT",
      anomaly_type: "DIRECTIONAL_FLOW_SKEW",
      reason: "DEDUP_SUPPRESSED",
      metric_value: 11,
      threshold: 10,
      severity: "HIGH",
      direction: "bullish",
    }),
  ]);

  const payload = await flowAnomalyNearMissesForLargo("AAPL");
  assert.equal(payload.available, true);
  assert.equal(payload.ticker, "AAPL");
  const rows = payload.near_misses as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.ticker, "AAPL");
  assert.equal(rows[0]!.anomaly_type, "LARGE_PREMIUM_PRINT");

  // Querying with no ticker returns the most recent near-misses across ALL candidates.
  const everyone = await flowAnomalyNearMissesForLargo();
  assert.equal(everyone.available, true);
  assert.equal(everyone.ticker, null);
  assert.equal((everyone.near_misses as unknown[]).length, 2);
});
