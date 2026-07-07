import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

// spx-signal-log.ts (the module under test) now also statically imports the
// ecosystem shadow factor, whose fetchEcosystemContext -> getSpxPlayState chain
// (bie/ecosystem-context.ts -> platform/spx-service.ts -> spx-play-engine.ts)
// pulls in a real `import "server-only"` several hops deep. Stub it the same
// way run-tool.test.ts does, or a plain `node --test` load crashes at import
// time — this file never exercises that chain directly, so an empty stub is
// enough.
mock.module("server-only", { namedExports: {} });

// logSpxSkewShadowFactors (this file's module under test) is the fire-and-forget wiring
// called from evaluateSpxPlay right after logSpxShadowFactors (src/lib/spx-play-engine.ts).
// It resolves a risk-reversal-skew reading (UW, SPX-then-SPY fallback) and a
// realized-vs-implied-vol reading (Polygon primary, UW combined-endpoint fallback), hands
// each to the pure compute*ShadowFactor functions (src/lib/spx-signals-shadow-skew.ts,
// unit-tested on their own in spx-signals-shadow-skew.test.ts — left REAL here, not mocked,
// so this test also exercises the real parsing helpers in @/lib/nighthawk/vol-metrics), and
// persists each observation via insertShadowFactorObservation (src/lib/db.ts).
//
// Same DB-mocking convention as spx-signal-log-shadow.test.ts: insertShadowFactorObservation
// itself isn't unit-testable in isolation (no working "pg" mock under this project's
// tsx + --experimental-test-module-mocks runner — see that file's own doc comment), so this
// mocks "@/lib/db" from the consumer under test instead.

const state = {
  dbConfigured: true,
  spxSkewRows: [] as Array<Record<string, unknown>>,
  spySkewRows: [] as Array<Record<string, unknown>>,
  polyRealizedVol: null as { realized_vol_30d: number; realized_vol_10d: number } | null,
  polyIvTerm: [] as Array<{ expiry: string; avg_iv: number; call_iv: number; put_iv: number; dte: number }>,
  uwRealizedVolRows: [] as Array<Record<string, unknown>>,
  calls: { skew: [] as string[], uwRealizedVol: 0, polyRealizedVol: 0, polyIvTerm: 0 },
  inserted: [] as Array<Record<string, unknown>>,
};

function resetState() {
  state.dbConfigured = true;
  state.spxSkewRows = [];
  state.spySkewRows = [];
  state.polyRealizedVol = null;
  state.polyIvTerm = [];
  state.uwRealizedVolRows = [];
  state.calls = { skew: [], uwRealizedVol: 0, polyRealizedVol: 0, polyIvTerm: 0 };
  state.inserted = [];
}

mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    insertShadowFactorObservation: async (row: Record<string, unknown>) => {
      state.inserted.push(row);
    },
  },
});
mock.module("./unusual-whales", {
  namedExports: {
    fetchUwRiskReversalSkew: async (ticker: string) => {
      state.calls.skew.push(ticker);
      return ticker === "SPX" ? state.spxSkewRows : state.spySkewRows;
    },
    fetchUwRealizedVol: async () => {
      state.calls.uwRealizedVol += 1;
      return state.uwRealizedVolRows;
    },
  },
});
mock.module("./polygon-options-gex", {
  namedExports: {
    fetchPolygonRealizedVol: async () => {
      state.calls.polyRealizedVol += 1;
      return state.polyRealizedVol ?? { realized_vol_30d: 0, realized_vol_10d: 0 };
    },
    fetchPolygonIvTermStructure: async () => {
      state.calls.polyIvTerm += 1;
      return state.polyIvTerm;
    },
  },
});
mock.module("../flow-liveness", {
  namedExports: {
    isFlowFrameFreshAnywhere: async () => true,
  },
});
mock.module("../providers/spx-session", {
  namedExports: {
    todayEtYmd: () => "2026-07-04",
  },
});

// Lazy import (ESM caches the module under test after the first call) so the mocks above are
// in place before spx-signal-log.ts's own top-level imports resolve.
const mod = () => import("./spx-signal-log");

function deskStub(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return { available: true, price: 7420, ...overrides } as SpxDeskPayload;
}

// computeSkewShadowFactor/computeVolDivergenceShadowFactor (spx-signals-shadow-skew.ts) are
// left REAL here (not mocked — see module doc above), and their staleness guard compares each
// row's `date` against the REAL Date.now() (this test doesn't/can't inject `now` through
// logSpxSkewShadowFactors, which has no clock-injection param). A hardcoded calendar date
// there passes only until HISTORICAL_ROW_MAX_AGE_MS (5 days) elapses from whenever this was
// written, then silently starts failing as "stale" — reproduced 2026-07-07 against a
// "2026-07-02" fixture. Always derive the fixture date from the real clock instead.
function recentDateStr(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function skewRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { date: recentDateStr(1), ticker: "SPY", delta: 25, risk_reversal: "0.0663361729210146", ...overrides };
}

function realizedVolRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    date: recentDateStr(1),
    implied_volatility: "0.131000",
    realized_volatility: "0.087404",
    ...overrides,
  };
}

test("logSpxSkewShadowFactors: db not configured — zero fetches, zero inserts", async () => {
  const { logSpxSkewShadowFactors } = await mod();
  resetState();
  state.dbConfigured = false;

  await logSpxSkewShadowFactors(deskStub(), { score: 42, grade: "B" });

  assert.equal(state.calls.skew.length, 0);
  assert.equal(state.calls.polyRealizedVol, 0);
  assert.equal(state.calls.polyIvTerm, 0);
  assert.equal(state.calls.uwRealizedVol, 0);
  assert.equal(state.inserted.length, 0);
});

test("logSpxSkewShadowFactors: SPX skew empty, SPY has data — falls back to SPY, persists a directional skew row", async () => {
  const { logSpxSkewShadowFactors } = await mod();
  resetState();
  state.spxSkewRows = [];
  state.spySkewRows = [skewRow()];

  await logSpxSkewShadowFactors(deskStub({ price: 7420 }), { score: 42, grade: "B" });

  assert.deepEqual(state.calls.skew, ["SPX", "SPY"]);
  const skewObs = state.inserted.find((r) => r.factor_name === "risk_reversal_skew");
  assert.ok(skewObs);
  assert.equal(skewObs!.available, true);
  assert.equal(skewObs!.direction, "bearish"); // positive risk_reversal = puts bid over calls
  assert.equal(skewObs!.implied_weight, -8); // 0.0663 >= the 0.05 extreme threshold
  assert.equal(skewObs!.price_at_observation, 7420);
  assert.equal(skewObs!.actual_score, 42);
  assert.equal(skewObs!.actual_grade, "B");
});

test("logSpxSkewShadowFactors: both SPX and SPY skew empty — persists available:false", async () => {
  const { logSpxSkewShadowFactors } = await mod();
  resetState();
  state.spxSkewRows = [];
  state.spySkewRows = [];

  await logSpxSkewShadowFactors(deskStub(), { score: 0, grade: "C" });

  const skewObs = state.inserted.find((r) => r.factor_name === "risk_reversal_skew");
  assert.ok(skewObs);
  assert.equal(skewObs!.available, false);
  assert.equal(skewObs!.implied_weight, 0);
});

test("logSpxSkewShadowFactors: Polygon has both realized + implied vol — sources from polygon, never calls the UW fallback", async () => {
  const { logSpxSkewShadowFactors } = await mod();
  resetState();
  state.polyRealizedVol = { realized_vol_30d: 0.087404, realized_vol_10d: 0.09 };
  state.polyIvTerm = [
    { expiry: "2026-07-05", avg_iv: 0.2, call_iv: 0.2, put_iv: 0.2, dte: 1 },
    { expiry: "2026-08-01", avg_iv: 0.131, call_iv: 0.13, put_iv: 0.132, dte: 28 }, // nearest 30 DTE
    { expiry: "2026-09-01", avg_iv: 0.11, call_iv: 0.11, put_iv: 0.11, dte: 59 },
  ];

  await logSpxSkewShadowFactors(deskStub(), { score: 10, grade: "A" });

  assert.equal(state.calls.uwRealizedVol, 0); // Polygon-primary short-circuits the UW fallback
  const volObs = state.inserted.find((r) => r.factor_name === "realized_vs_implied_vol");
  assert.ok(volObs);
  assert.equal(volObs!.available, true);
  assert.equal(volObs!.direction, "bearish"); // IV 0.131 > RV 0.087404 -> implied running rich
  assert.equal(volObs!.implied_weight, -4); // moderate tier: 0.0436 spread, inside [0.02, 0.05)
});

test("logSpxSkewShadowFactors: Polygon unavailable — falls back to UW's combined realized+implied endpoint", async () => {
  const { logSpxSkewShadowFactors } = await mod();
  resetState();
  state.polyRealizedVol = { realized_vol_30d: 0, realized_vol_10d: 0 };
  state.polyIvTerm = [];
  state.uwRealizedVolRows = [realizedVolRow()];

  await logSpxSkewShadowFactors(deskStub(), { score: -5, grade: "D" });

  assert.equal(state.calls.uwRealizedVol, 1);
  const volObs = state.inserted.find((r) => r.factor_name === "realized_vs_implied_vol");
  assert.ok(volObs);
  assert.equal(volObs!.available, true);
  assert.equal(volObs!.direction, "bearish");
});

test("logSpxSkewShadowFactors: both Polygon and UW vol sources unavailable — persists available:false", async () => {
  const { logSpxSkewShadowFactors } = await mod();
  resetState();
  state.polyRealizedVol = { realized_vol_30d: 0, realized_vol_10d: 0 };
  state.polyIvTerm = [];
  state.uwRealizedVolRows = [];

  await logSpxSkewShadowFactors(deskStub(), { score: 0, grade: "C" });

  const volObs = state.inserted.find((r) => r.factor_name === "realized_vs_implied_vol");
  assert.ok(volObs);
  assert.equal(volObs!.available, false);
  assert.equal(volObs!.implied_weight, 0);
});

test("logSpxSkewShadowFactors: happy path persists exactly 2 rows (skew + vol divergence), each carrying the real score/grade for correlation", async () => {
  const { logSpxSkewShadowFactors } = await mod();
  resetState();
  state.spxSkewRows = [skewRow({ risk_reversal: "0.005" })]; // flat band
  state.polyRealizedVol = { realized_vol_30d: 0.1, realized_vol_10d: 0.1 };
  state.polyIvTerm = [{ expiry: "2026-08-01", avg_iv: 0.1, call_iv: 0.1, put_iv: 0.1, dte: 28 }]; // flat band

  await logSpxSkewShadowFactors(deskStub({ price: 7500 }), { score: 55, grade: "A+" });

  assert.equal(state.inserted.length, 2);
  for (const row of state.inserted) {
    assert.equal(row.price_at_observation, 7500);
    assert.equal(row.actual_score, 55);
    assert.equal(row.actual_grade, "A+");
  }
  assert.deepEqual(
    state.inserted.map((r) => r.factor_name).sort(),
    ["realized_vs_implied_vol", "risk_reversal_skew"]
  );
});
