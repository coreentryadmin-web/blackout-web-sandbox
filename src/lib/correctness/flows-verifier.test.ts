import { test, mock } from "node:test";
import assert from "node:assert/strict";

// flows-verifier.ts's own top-level imports pull in "server-only" (directly, and
// transitively via @/lib/providers/option-trades) plus @/lib/db,
// @/lib/providers/{config,option-trades,spx-session} — mock.module() needs the
// RELATIVE path from THIS FILE's own location for every one of them (Node 20's
// tsx alias resolver does not run inside mock.module()'s specifier resolution;
// a "@/..." specifier there crashes with ERR_MODULE_NOT_FOUND even though it
// works under Node 22 — see docs/audit/FINDINGS.md and every sibling
// mock.module()-based test in this repo).
//
// Deliberately does NOT mock @/app/api/cron/market-regime-detector/
// flow-anomaly-detection: the whole point of this suite is proving the REAL
// detectFlowAnomalies() (task #131) agrees with flow-anomaly-scope.ts's
// independent recompute (task #132) when driven by the SAME injected rows. A
// deliberately-WRONG detectFlowAnomalies output is exercised separately in
// flow-anomaly-detector-regression.test.ts (a fresh process — node:test runs
// each test FILE in its own isolated module registry, confirmed empirically;
// mocking that module there cannot leak into this file) and in
// flow-anomaly-scope.test.ts's diffClassifiedLists unit tests (the same
// compare-logic this file's checks call, exercised directly against synthetic
// expected/actual lists for missing/extra/value-mismatch cases).
mock.module("server-only", { namedExports: {} });

const state = {
  tapeRows: [] as Array<Record<string, unknown>>,
  anomalyRows: [] as Array<Record<string, unknown>>,
};

function resetState() {
  state.tapeRows = [];
  state.anomalyRows = [];
}

mock.module("../db", {
  namedExports: {
    // The real fetchRecentFlows is called with two DIFFERENT window/order shapes
    // from two different call sites in flows-verifier.ts: the main 48h tape read
    // (verifyFlows) and the anomaly-detector's own 30-min window read
    // (verifyFlowAnomalyDetector) — switch on since_hours to serve each its own
    // fixture, mirroring the real two-window split.
    fetchRecentFlows: async (params: { since_hours?: number }) => {
      if (params?.since_hours === 0.5) return state.anomalyRows;
      return state.tapeRows;
    },
  },
});
mock.module("../providers/config", {
  namedExports: {
    // Skip the Massive cross-provider cross-check entirely — it is unrelated to
    // this suite's target (the anomaly-detector shadow-recompute) and skipping
    // it keeps the fixture data focused.
    polygonConfigured: () => false,
  },
});
mock.module("../providers/option-trades", {
  namedExports: {
    // Never actually called once polygonConfigured() is false (crossCheckAgainstMassive
    // returns its own "skipped" CheckResult before reaching fetchOptionTrades), but the
    // real module transitively pulls in polygon-options-gex/server-cache — stub it out
    // so loading it can't have any surprising import-time cost.
    fetchOptionTrades: async () => null,
  },
});
mock.module("../providers/spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-05" },
});

// Lazy import (ESM caches the module under test after the first call) so the
// mocks above are in place before flows-verifier.ts's own top-level imports
// resolve — same idiom every mock.module()-based sibling test in this repo uses.
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

/** A clean 6-row 48h tape fixture — enough to clear flows-verifier's own
 *  TOL.minRows(5) gate so the anomaly-detector section (which runs AFTER the
 *  main tape checks) is actually reached. */
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

test("verifyFlows: anomaly-detector shadow-recompute matches the real detectFlowAnomalies output — one anomaly, one near-miss", async () => {
  const { verifyFlows } = await mod();
  resetState();
  state.tapeRows = cleanTapeRows();
  state.anomalyRows = [
    // NVDA: $3M call print clears LARGE_PREMIUM_PRINT; $700k offsetting put keeps
    // the skew ratio (~4.3) under the 10:1 anomaly threshold AND the 5:1 near-miss floor.
    anomalyRow({ ticker: "NVDA", premium: 3_000_000, option_type: "call" }),
    anomalyRow({ ticker: "NVDA", premium: 700_000, option_type: "put" }),
    // TSLA: $1.8M put is in the LARGE_PREMIUM_PRINT near-miss band (below $2M, at/above
    // the 50% floor); $500k offsetting call keeps its skew ratio (3.6) harmless too.
    anomalyRow({ ticker: "TSLA", premium: 1_800_000, option_type: "put" }),
    anomalyRow({ ticker: "TSLA", premium: 500_000, option_type: "call" }),
  ];

  const score = await verifyFlows(false);

  const anomalyMetric = findMetric(score, "anomaly_detection");
  assert.ok(anomalyMetric, "anomaly_detection metric must be present");
  assert.equal(anomalyMetric!.status, "consistency-only", `expected consistency-only, got flag: ${JSON.stringify(anomalyMetric!.checks)}`);
  assert.match(anomalyMetric!.checks[0]!.detail, /matches the independent threshold-math recompute/);
  assert.equal(anomalyMetric!.checks[0]!.expected, 1);
  assert.equal(anomalyMetric!.checks[0]!.actual, 1);

  const nearMissMetric = findMetric(score, "anomaly_near_miss");
  assert.ok(nearMissMetric, "anomaly_near_miss metric must be present");
  assert.equal(nearMissMetric!.status, "consistency-only", `expected consistency-only, got flag: ${JSON.stringify(nearMissMetric!.checks)}`);
  assert.equal(nearMissMetric!.checks[0]!.expected, 1);
  assert.equal(nearMissMetric!.checks[0]!.actual, 1);
});

test("verifyFlows: anomaly-detector shadow-recompute — quiet 30-min window skips cleanly (not a flag)", async () => {
  const { verifyFlows } = await mod();
  resetState();
  state.tapeRows = cleanTapeRows();
  state.anomalyRows = []; // nothing printed in the last 30 minutes

  const score = await verifyFlows(false);

  const anomalyMetric = findMetric(score, "anomaly_detection");
  assert.ok(anomalyMetric, "anomaly_detection metric must be present even when the window is empty");
  assert.equal(anomalyMetric!.status, "skipped");
  assert.equal(anomalyMetric!.checks.length, 1);
  assert.match(anomalyMetric!.checks[0]!.detail, /No flow prints in the last 30 minutes/);
  // The empty-window skip returns early — no separate anomaly_near_miss check is produced.
  assert.equal(findMetric(score, "anomaly_near_miss"), undefined);
});

test("verifyFlows: anomaly-detector shadow-recompute — a quiet ticker with no anomaly and no near-miss produces a clean, empty match", async () => {
  const { verifyFlows } = await mod();
  resetState();
  state.tapeRows = cleanTapeRows();
  state.anomalyRows = [
    // Nowhere near either threshold or near-miss band, and under the $500k skew
    // volume gate too — the real detector and the recompute both stay silent.
    anomalyRow({ ticker: "AAPL", premium: 250_000, option_type: "call" }),
    anomalyRow({ ticker: "AAPL", premium: 150_000, option_type: "put" }),
  ];

  const score = await verifyFlows(false);

  const anomalyMetric = findMetric(score, "anomaly_detection");
  assert.equal(anomalyMetric!.status, "consistency-only");
  assert.equal(anomalyMetric!.checks[0]!.expected, 0);
  assert.equal(anomalyMetric!.checks[0]!.actual, 0);

  const nearMissMetric = findMetric(score, "anomaly_near_miss");
  assert.equal(nearMissMetric!.status, "consistency-only");
  assert.equal(nearMissMetric!.checks[0]!.expected, 0);
  assert.equal(nearMissMetric!.checks[0]!.actual, 0);
});
