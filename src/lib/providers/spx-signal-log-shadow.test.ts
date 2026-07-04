import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

// logSpxShadowFactors (this file's module under test) is the fire-and-forget
// wiring called from evaluateSpxPlay right after the real computeSpxConfluence()
// (src/lib/spx-play-engine.ts) — it fetches recent flow_anomalies rows + the
// cluster flow-liveness flag, hands them to the pure computeShadowFactors()
// (src/lib/spx-signals-shadow.ts, unit-tested on its own in
// spx-signals-shadow.test.ts), and persists each observation via
// insertShadowFactorObservation (src/lib/db.ts).
//
// insertShadowFactorObservation itself lives inside db.ts next to
// insertSpxSignalLog and can't be unit-tested in isolation without a real or
// mocked Postgres connection — this codebase has no precedent for mocking the
// "pg" package under this project's tsx + --experimental-test-module-mocks
// test runner (attempted here; the mock silently fails to intercept "pg"'s
// CJS export under tsx's loader chain, so db.ts's real Pool tries a live TCP
// connect and times out). The codebase's OWN established DB-mocking
// convention (see whop-revocation.test.ts, platform-intel-snapshot.test.ts)
// is instead to mock "@/lib/db" itself from the consumer under test — which is
// exactly what this file does, asserting the precise row shape
// logSpxShadowFactors hands to insertShadowFactorObservation for each of the
// staleness/availability states.

const state = {
  dbConfigured: true,
  anomalyRows: [] as Array<{
    ticker: string;
    anomaly_type: string;
    detected_at: string;
    detail: string;
    severity: string;
    direction: string | null;
  }>,
  flowFeedFresh: true,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  inserted: [] as Array<Record<string, unknown>>,
};

function resetState() {
  state.dbConfigured = true;
  state.anomalyRows = [];
  state.flowFeedFresh = true;
  state.queries = [];
  state.inserted = [];
}

mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    dbQuery: async (sql: string, params: unknown[]) => {
      state.queries.push({ sql, params });
      return { rows: state.anomalyRows, rowCount: state.anomalyRows.length };
    },
    insertShadowFactorObservation: async (row: Record<string, unknown>) => {
      state.inserted.push(row);
    },
  },
});
mock.module("../flow-liveness", {
  namedExports: {
    isFlowFrameFreshAnywhere: async () => state.flowFeedFresh,
  },
});
mock.module("../providers/spx-session", {
  namedExports: {
    todayEtYmd: () => "2026-07-04",
  },
});

// Lazy import (ESM caches the module under test after the first call) so the
// mocks above are in place before spx-signal-log.ts's own top-level imports
// resolve.
const mod = () => import("./spx-signal-log");

function deskStub(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return { available: true, price: 7420, ...overrides } as SpxDeskPayload;
}

test("logSpxShadowFactors: db not configured — zero queries, zero inserts", async () => {
  const { logSpxShadowFactors } = await mod();
  resetState();
  state.dbConfigured = false;

  await logSpxShadowFactors(deskStub(), { score: 42, grade: "B" });

  assert.equal(state.queries.length, 0);
  assert.equal(state.inserted.length, 0);
});

test("logSpxShadowFactors: queries flow_anomalies scoped to the watched-ticker list via ANY($1)", async () => {
  const { logSpxShadowFactors } = await mod();
  resetState();

  await logSpxShadowFactors(deskStub(), { score: 42, grade: "B" });

  assert.equal(state.queries.length, 1);
  assert.match(state.queries[0].sql, /FROM flow_anomalies/);
  assert.match(state.queries[0].sql, /ticker = ANY\(\$1::text\[\]\)/);
  const [tickers] = state.queries[0].params;
  assert.deepEqual(tickers, ["SPY", "QQQ", "AAPL", "NVDA", "MSFT", "GOOG", "TSLA", "META"]);
});

test("logSpxShadowFactors: fresh feed, no anomaly rows — persists exactly one available:true / weight:0 observation, carrying the real score+grade+price for correlation", async () => {
  const { logSpxShadowFactors } = await mod();
  resetState();
  state.flowFeedFresh = true;
  state.anomalyRows = [];

  await logSpxShadowFactors(deskStub({ price: 7420 }), { score: 42, grade: "B" });

  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0];
  assert.equal(row.session_date, "2026-07-04");
  assert.equal(row.factor_name, "flow_anomaly_watch");
  assert.equal(row.available, true);
  assert.equal(row.implied_weight, 0);
  assert.equal(row.price_at_observation, 7420);
  assert.equal(row.actual_score, 42);
  assert.equal(row.actual_grade, "B");
});

test("logSpxShadowFactors: stale feed — persists available:false, never conflated with the no-anomaly reading", async () => {
  const { logSpxShadowFactors } = await mod();
  resetState();
  state.flowFeedFresh = false;
  // Even with a real anomaly row present, staleness must win — proves the guard
  // reads flowFeedFresh, not just an empty anomalies array.
  state.anomalyRows = [
    {
      ticker: "SPY",
      anomaly_type: "DIRECTIONAL_FLOW_SKEW",
      detected_at: new Date().toISOString(),
      detail: "extreme call skew",
      severity: "HIGH",
      direction: "bullish",
    },
  ];

  await logSpxShadowFactors(deskStub(), { score: -10, grade: "C" });

  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].available, false);
  assert.equal(state.inserted[0].implied_weight, 0);
});

test("logSpxShadowFactors: fresh feed + a real in-window anomaly on a watched ticker persists a directional, available:true observation", async () => {
  const { logSpxShadowFactors } = await mod();
  resetState();
  state.flowFeedFresh = true;
  state.anomalyRows = [
    {
      ticker: "SPY",
      anomaly_type: "DIRECTIONAL_FLOW_SKEW",
      detected_at: new Date().toISOString(),
      detail: "extreme call skew (12:1 call/put)",
      severity: "HIGH",
      direction: "bullish",
    },
  ];

  await logSpxShadowFactors(deskStub({ price: 7420 }), { score: 42, grade: "B" });

  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0];
  assert.equal(row.factor_name, "flow_anomaly_spy_skew");
  assert.equal(row.available, true);
  assert.equal(row.direction, "bullish");
  assert.equal(row.implied_weight, 7);
  assert.equal(row.actual_score, 42);
  assert.equal(row.actual_grade, "B");
});
