import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Companion to flows-verifier.test.ts (the "match" scenario, real detectFlowAnomalies)
// and flow-anomaly-scope.test.ts (diffClassifiedLists' own unit tests). This file is
// the END-TO-END "deliberately-injected mismatch" fixture: it mocks
// @/app/api/cron/market-regime-detector/flow-anomaly-detection's detectFlowAnomalies
// to return a WRONG result (as if a real regression had landed in that file — e.g. a
// dropped branch, a flipped comparison) and proves verifyFlows() actually FLAGS the
// divergence instead of silently reporting consistency-only. Kept in its own file
// (not flows-verifier.test.ts) because node:test isolates mock.module() per FILE —
// confirmed empirically (a mocked module in one file never leaks into a sibling test
// file run in the same `--test` invocation) — so this file can mock the detector
// wholesale without affecting flows-verifier.test.ts's real-detector coverage.
//
// The mocked module must ALSO re-export the four real threshold constants: this repo's
// flow-anomaly-scope.ts (the INDEPENDENT recompute) imports them from this exact
// module path (see its own module doc for why importing the shared POLICY numbers,
// as opposed to the classification LOGIC, doesn't compromise independence) — so a
// wholesale mock of the module needs to keep those numbers real, or the recompute
// side would drift from production for reasons unrelated to this test.
mock.module("server-only", { namedExports: {} });

const REAL = {
  LARGE_PRINT_THRESHOLD: 2_000_000,
  SKEW_RATIO_THRESHOLD: 10,
  SKEW_MIN_TOTAL_PREMIUM: 500_000,
  LARGE_PRINT_NEAR_MISS_FLOOR: 1_000_000,
  SKEW_RATIO_NEAR_MISS_FLOOR: 5,
};

const state = {
  tapeRows: [] as Array<Record<string, unknown>>,
  anomalyRows: [] as Array<Record<string, unknown>>,
  /** What the (mocked) "actual" detectFlowAnomalies returns — deliberately wrong in these tests. */
  detectorReturns: [] as Array<Record<string, unknown>>,
};

function resetState() {
  state.tapeRows = [];
  state.anomalyRows = [];
  state.detectorReturns = [];
}

mock.module("../db", {
  namedExports: {
    fetchRecentFlows: async (params: { since_hours?: number }) => {
      if (params?.since_hours === 0.5) return state.anomalyRows;
      return state.tapeRows;
    },
  },
});
mock.module("../providers/config", {
  namedExports: { polygonConfigured: () => false },
});
mock.module("../providers/option-trades", {
  namedExports: { fetchOptionTrades: async () => null },
});
mock.module("../providers/spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-05" },
});
// The deliberate mismatch: detectFlowAnomalies ignores its injected rows entirely and
// just returns whatever the test staged in state.detectorReturns — standing in for a
// hypothetical regression in the real classification loop.
mock.module("../../app/api/cron/market-regime-detector/flow-anomaly-detection", {
  namedExports: {
    ...REAL,
    detectFlowAnomalies: async () => state.detectorReturns,
  },
});

const mod = () => import("./flows-verifier");

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
  event_at?: string | null;
};

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

function tapeRow(overrides: Partial<Row> = {}): Row {
  return {
    ticker: "SPY",
    premium: 250_000,
    option_type: "call",
    strike: 550,
    expiry: "2026-07-10",
    direction: "bullish",
    score: 70,
    route: "flow",
    alerted_at: isoMinutesAgo(5),
    event_at: isoMinutesAgo(5),
    ...overrides,
  };
}

function cleanTapeRows(): Row[] {
  return [
    tapeRow({ option_type: "call", premium: 300_000 }),
    tapeRow({ option_type: "call", premium: 280_000 }),
    tapeRow({ option_type: "call", premium: 260_000 }),
    tapeRow({ option_type: "put", premium: 240_000 }),
    tapeRow({ option_type: "put", premium: 220_000 }),
    tapeRow({ option_type: "put", premium: 200_000 }),
  ];
}

function anomalyRow(overrides: Partial<Row> = {}): Row {
  return {
    ticker: "NVDA",
    premium: 300_000,
    option_type: "call",
    strike: 190,
    expiry: "2026-07-06",
    direction: "bullish",
    score: 80,
    route: "flow",
    alerted_at: isoMinutesAgo(10),
    event_at: isoMinutesAgo(10),
    ...overrides,
  };
}

function findMetric(score: { metrics: Array<{ metric: string }> }, metric: string) {
  return score.metrics.find((m) => m.metric === metric);
}

test("verifyFlows: a detector that silently drops a real anomaly (regression) is FLAGGED, not waved through", async () => {
  const { verifyFlows } = await mod();
  resetState();
  state.tapeRows = cleanTapeRows();
  // The independent recompute WILL see a real $3M NVDA print — this SHOULD classify
  // as a LARGE_PREMIUM_PRINT anomaly. The mocked "actual" detector returns nothing,
  // simulating a regression (e.g. the >= flipped to > flipped the wrong way).
  state.anomalyRows = [
    anomalyRow({ ticker: "NVDA", premium: 3_000_000, option_type: "call" }),
    anomalyRow({ ticker: "NVDA", premium: 700_000, option_type: "put" }),
  ];
  state.detectorReturns = [];

  const score = await verifyFlows(false);

  const anomalyMetric = findMetric(score, "anomaly_detection");
  assert.ok(anomalyMetric);
  assert.equal(anomalyMetric!.status, "flag");
  assert.equal(anomalyMetric!.independentlyConfirmed, false);
  const detail = anomalyMetric!.checks[0]!.detail;
  assert.match(detail, /DIVERGES from the independent recompute/);
  assert.match(detail, /MISSING from the actual output/);
  assert.match(detail, /NVDA/);
  assert.equal(anomalyMetric!.checks[0]!.expected, 1);
  assert.equal(anomalyMetric!.checks[0]!.actual, 0);

  // The ticker-level rollup must reflect the flag too (worst-status propagation).
  assert.equal(score.status, "flag");
});

test("verifyFlows: a detector that fabricates an anomaly the recompute does not support is FLAGGED", async () => {
  const { verifyFlows } = await mod();
  resetState();
  state.tapeRows = cleanTapeRows();
  // Nothing in this window should classify as anything at all.
  state.anomalyRows = [anomalyRow({ ticker: "AAPL", premium: 100_000, option_type: "call" })];
  // But the mocked "actual" detector fabricates a bogus anomaly for a ticker that
  // never even appeared in the row set — simulating a stale-state / wrong-key bug.
  state.detectorReturns = [
    {
      type: "LARGE_PREMIUM_PRINT",
      ticker: "GHOST",
      detail: "GHOST: fabricated",
      premium: 9_000_000,
      direction: "bullish",
      severity: "CRITICAL",
      metric_value: 9_000_000,
    },
  ];

  const score = await verifyFlows(false);

  const anomalyMetric = findMetric(score, "anomaly_detection");
  assert.equal(anomalyMetric!.status, "flag");
  const detail = anomalyMetric!.checks[0]!.detail;
  assert.match(detail, /UNEXPECTED in the actual output/);
  assert.match(detail, /GHOST/);
  assert.equal(anomalyMetric!.checks[0]!.expected, 0);
  assert.equal(anomalyMetric!.checks[0]!.actual, 1);
});

test("verifyFlows: a detector that reports the right ticker/type but a wrong metric_value (ratio-math bug) is FLAGGED", async () => {
  const { verifyFlows } = await mod();
  resetState();
  state.tapeRows = cleanTapeRows();
  // AMD: 830k call vs 70k put -> real callRatio = 11.857..., clears the 10:1 threshold.
  state.anomalyRows = [
    anomalyRow({ ticker: "AMD", premium: 830_000, option_type: "call" }),
    anomalyRow({ ticker: "AMD", premium: 70_000, option_type: "put" }),
  ];
  // Mocked detector agrees on ticker/type/direction but reports a wrong ratio (as if
  // it divided the wrong way or rounded incorrectly) — a value-only disagreement.
  state.detectorReturns = [
    {
      type: "DIRECTIONAL_FLOW_SKEW",
      ticker: "AMD",
      detail: "AMD: extreme call skew (bogus ratio)",
      premium: 900_000,
      direction: "bullish",
      severity: "HIGH",
      metric_value: 42, // real value would be ~11.86
    },
  ];

  const score = await verifyFlows(false);

  const anomalyMetric = findMetric(score, "anomaly_detection");
  assert.equal(anomalyMetric!.status, "flag");
  assert.match(anomalyMetric!.checks[0]!.detail, /value mismatch/);
  assert.match(anomalyMetric!.checks[0]!.detail, /AMD/);
});
