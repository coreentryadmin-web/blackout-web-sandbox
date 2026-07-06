import { test, mock } from "node:test";
import assert from "node:assert/strict";

// flow-anomaly-detection.ts (the module under test) statically imports only
// @/lib/db's fetchRecentFlows — mock.module() resolves bare specifiers via the
// SAME relative-path convention src/app/api/cron/spx-issues-sync/route.test.ts
// already uses for a sibling at this exact directory depth (4 levels up to
// src/lib/db) — RELATIVE, never the "@/..." alias, which crashes outright under
// Node 20 (see docs/audit/FINDINGS.md's get_positioning/gex_king_strike entry).
//
// NOTE on row construction below: a ticker with premium on only ONE side (all
// calls or all puts) trivially satisfies the ORIGINAL code's skew-ratio check too
// — the losing side is 0, so its ratio resolves to the 99 sentinel, which clears
// even the real 10:1 threshold. That is genuine pre-existing behavior (unchanged
// by this PR), not a bug this suite is testing — so any test that wants to isolate
// the LARGE_PREMIUM_PRINT check on its own adds a small, deliberately-sized
// opposite-side row to keep the skew ratio harmless, the same way a real two-sided
// tape would.
type Row = {
  ticker: string;
  premium: number;
  option_type: string;
  strike: number;
  expiry: string;
  direction: string;
  score: number;
  route: string;
  alerted_at: string;
};

const state = {
  rows: [] as Row[],
  throwOnFetch: false,
};

function resetState() {
  state.rows = [];
  state.throwOnFetch = false;
}

mock.module("../../../../lib/db", {
  namedExports: {
    fetchRecentFlows: async () => {
      if (state.throwOnFetch) throw new Error("db unreachable");
      return state.rows;
    },
  },
});

// Lazy import (ESM caches the module under test after the first call) so the mock
// above is in place before flow-anomaly-detection.ts's own top-level import
// resolves — same idiom every mock.module()-based sibling test uses.
const mod = () => import("./flow-anomaly-detection");

function row(overrides: Partial<Row> = {}): Row {
  return {
    ticker: "NVDA",
    premium: 300_000,
    option_type: "call",
    strike: 190,
    expiry: "2026-07-06",
    direction: "bullish",
    score: 80,
    route: "flow",
    alerted_at: "2026-07-06T14:31:00Z",
    ...overrides,
  };
}

test("detectFlowAnomalies: no rows — empty anomalies, no near-misses even when the array is supplied", async () => {
  const { detectFlowAnomalies } = await mod();
  resetState();

  const nearMisses: unknown[] = [];
  const anomalies = await detectFlowAnomalies({ nearMisses });

  assert.deepEqual(anomalies, []);
  assert.equal(nearMisses.length, 0);
});

test("detectFlowAnomalies: omitted opts.nearMisses — behaves identically (no-op, no throw)", async () => {
  const { detectFlowAnomalies } = await mod();
  resetState();
  // Small offsetting put keeps the skew ratio harmless (3.57, well under both the
  // 10:1 threshold and the 5:1 near-miss floor) so only the print check is live.
  state.rows = [row({ premium: 2_500_000, option_type: "call" }), row({ premium: 700_000, option_type: "put" })];

  const anomalies = await detectFlowAnomalies();
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.type, "LARGE_PREMIUM_PRINT");
});

test("detectFlowAnomalies: a $2.5M single print clears the real threshold — fires an anomaly, NOT a near-miss", async () => {
  const { detectFlowAnomalies } = await mod();
  resetState();
  state.rows = [
    row({ ticker: "TSLA", premium: 2_500_000, option_type: "call" }),
    row({ ticker: "TSLA", premium: 700_000, option_type: "put" }),
  ];

  const nearMisses: unknown[] = [];
  const anomalies = await detectFlowAnomalies({ nearMisses });

  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.type, "LARGE_PREMIUM_PRINT");
  assert.equal(anomalies[0]!.metric_value, 2_500_000);
  assert.equal(nearMisses.length, 0, "a fully-qualifying candidate must not ALSO log a near-miss row");
});

test("detectFlowAnomalies: a $1.8M single print (in the near-miss band) — no anomaly, one BELOW_THRESHOLD near-miss with null severity", async () => {
  const { detectFlowAnomalies, LARGE_PRINT_THRESHOLD } = await mod();
  resetState();
  state.rows = [
    row({ ticker: "TSLA", premium: 1_800_000, option_type: "put", strike: 200 }),
    // Offsetting call keeps the skew ratio (3.6) under the 5:1 near-miss floor too.
    row({ ticker: "TSLA", premium: 500_000, option_type: "call" }),
  ];

  const nearMisses: Array<Record<string, unknown>> = [];
  const anomalies = await detectFlowAnomalies({ nearMisses });

  assert.equal(anomalies.length, 0);
  assert.equal(nearMisses.length, 1);
  const nm = nearMisses[0]!;
  assert.equal(nm.anomaly_type, "LARGE_PREMIUM_PRINT");
  assert.equal(nm.ticker, "TSLA");
  assert.equal(nm.reason, "BELOW_THRESHOLD");
  assert.equal(nm.metric_value, 1_800_000);
  assert.equal(nm.threshold, LARGE_PRINT_THRESHOLD);
  assert.equal(nm.direction, "bearish");
  assert.equal(nm.severity, null, "a below-threshold candidate never reaches the point the live detector assigns a severity");
});

test("detectFlowAnomalies: a $600k single print (well under the near-miss floor) — no anomaly, no near-miss either", async () => {
  const { detectFlowAnomalies } = await mod();
  resetState();
  state.rows = [
    row({ ticker: "AAPL", premium: 600_000, option_type: "call" }),
    row({ ticker: "AAPL", premium: 200_000, option_type: "put" }),
  ];

  const nearMisses: unknown[] = [];
  const anomalies = await detectFlowAnomalies({ nearMisses });

  assert.equal(anomalies.length, 0);
  assert.equal(nearMisses.length, 0, "routine sub-$1M prints are not a meaningful near-miss of a $2M threshold");
});

test("detectFlowAnomalies: 12:1 call skew on $900k total clears the real skew threshold — fires an anomaly, NOT a near-miss", async () => {
  const { detectFlowAnomalies } = await mod();
  resetState();
  state.rows = [
    row({ ticker: "AMD", premium: 830_000, option_type: "call" }),
    row({ ticker: "AMD", premium: 70_000, option_type: "put" }),
  ];

  const nearMisses: unknown[] = [];
  const anomalies = await detectFlowAnomalies({ nearMisses });

  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.type, "DIRECTIONAL_FLOW_SKEW");
  assert.equal(anomalies[0]!.direction, "bullish");
  assert.equal(nearMisses.length, 0);
});

test("detectFlowAnomalies: 8:1 put skew on $900k total (in the near-miss band, gate cleared) — one BELOW_THRESHOLD near-miss", async () => {
  const { detectFlowAnomalies, SKEW_RATIO_THRESHOLD } = await mod();
  resetState();
  state.rows = [
    row({ ticker: "META", premium: 100_000, option_type: "call" }),
    row({ ticker: "META", premium: 800_000, option_type: "put", strike: 500 }),
  ];

  const nearMisses: Array<Record<string, unknown>> = [];
  const anomalies = await detectFlowAnomalies({ nearMisses });

  assert.equal(anomalies.length, 0);
  assert.equal(nearMisses.length, 1);
  const nm = nearMisses[0]!;
  assert.equal(nm.anomaly_type, "DIRECTIONAL_FLOW_SKEW");
  assert.equal(nm.ticker, "META");
  assert.equal(nm.reason, "BELOW_THRESHOLD");
  assert.equal(nm.metric_value, 8);
  assert.equal(nm.threshold, SKEW_RATIO_THRESHOLD);
  assert.equal(nm.direction, "bearish");
  assert.equal(nm.premium, 900_000, "premium carries the TOTAL call+put premium, not the ratio");
});

test("detectFlowAnomalies: skew ratio would be extreme but total premium never clears the $500k volume gate — no near-miss (the live scan never reaches this gate either)", async () => {
  const { detectFlowAnomalies } = await mod();
  resetState();
  // 9:1 call/put ratio, but total is only $100k — the real detector's own
  // `total >= SKEW_MIN_TOTAL_PREMIUM` gate never lets this reach a ratio check.
  state.rows = [
    row({ ticker: "SOFI", premium: 90_000, option_type: "call" }),
    row({ ticker: "SOFI", premium: 10_000, option_type: "put" }),
  ];

  const nearMisses: unknown[] = [];
  const anomalies = await detectFlowAnomalies({ nearMisses });

  assert.equal(anomalies.length, 0);
  assert.equal(nearMisses.length, 0, "a candidate the live gate never evaluates must not get a synthetic near-miss");
});

test("detectFlowAnomalies: a mixed batch only logs the ticker that actually falls in the near-miss band, independently of a fully-qualifying ticker", async () => {
  const { detectFlowAnomalies } = await mod();
  resetState();
  state.rows = [
    // Fires for real (maxSingle clears $2M); offsetting put keeps skew harmless.
    row({ ticker: "NVDA", premium: 3_000_000, option_type: "call" }),
    row({ ticker: "NVDA", premium: 800_000, option_type: "put" }),
    // Near-miss band for the print check only; offsetting call keeps skew harmless.
    row({ ticker: "TSLA", premium: 1_500_000, option_type: "put", strike: 210 }),
    row({ ticker: "TSLA", premium: 400_000, option_type: "call" }),
    // Nowhere near either threshold or near-miss band, and under the $500k skew
    // volume gate too — must stay completely silent.
    row({ ticker: "AAPL", premium: 250_000, option_type: "call" }),
  ];

  const nearMisses: Array<Record<string, unknown>> = [];
  const anomalies = await detectFlowAnomalies({ nearMisses });

  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.ticker, "NVDA");
  assert.equal(nearMisses.length, 1);
  assert.equal(nearMisses[0]!.ticker, "TSLA");
});

test("detectFlowAnomalies: fetchRecentFlows throws — caught internally, returns empty anomalies and leaves nearMisses untouched", async () => {
  const { detectFlowAnomalies } = await mod();
  resetState();
  state.throwOnFetch = true;

  const nearMisses: unknown[] = [];
  const anomalies = await detectFlowAnomalies({ nearMisses });

  assert.deepEqual(anomalies, []);
  assert.equal(nearMisses.length, 0);
});
