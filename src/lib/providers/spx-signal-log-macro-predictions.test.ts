import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PredictionConsensusSignal } from "@/lib/providers/unusual-whales";

// spx-signal-log.ts (the module under test) now also statically imports the
// ecosystem shadow factor, whose fetchEcosystemContext -> getSpxPlayState chain
// (bie/ecosystem-context.ts -> platform/spx-service.ts -> spx-play-engine.ts)
// pulls in a real `import "server-only"` several hops deep. Stub it the same
// way run-tool.test.ts does, or a plain `node --test` load crashes at import
// time — this file never exercises that chain directly, so an empty stub is
// enough.
mock.module("server-only", { namedExports: {} });

// logSpxMacroPredictionsShadowFactor (this file's module under test) is the
// fire-and-forget wiring called from evaluateSpxPlay right after the real
// computeSpxConfluence() (src/lib/spx-play-engine.ts), sibling to
// logSpxShadowFactors (see spx-signal-log-shadow.test.ts for that one). It
// decides whether a macro hard-block window is active/near (pure —
// resolveMacroWindowState, unit-tested on its own in
// spx-signals-shadow-predictions.test.ts), fetches (and caches) UW prediction
// consensus ONLY when it might matter, hands everything to the pure
// computeMacroPredictionsShadowFactor, and persists each observation via
// insertShadowFactorObservation (src/lib/db.ts) — same DB-mocking convention
// as the sibling test file (mock "@/lib/db" from the consumer under test,
// since this codebase has no working "pg"-level mock under tsx +
// --experimental-test-module-mocks).
//
// CACHE NOTE: logSpxMacroPredictionsShadowFactor caches the UW consensus read
// for MACRO_PREDICTIONS_CACHE_TTL_MS (90s of real wall-clock time) across
// calls, module-scoped (like spx-desk.ts's own cachedPriorDay/
// cachedPulseStructure). Each test below that needs a GUARANTEED fresh fetch
// mocks Date to a calendar day far apart (whole months) from every other such
// test in this file, so the TTL is always trivially expired going in —
// avoiding any cross-test cache bleed without needing a test-only reset hook.

type InsertedRow = Record<string, unknown>;

const state = {
  dbConfigured: true,
  uwConfigured: true,
  inserted: [] as InsertedRow[],
  consensusCalls: 0,
  consensusResult: null as { top_signals: PredictionConsensusSignal[]; raw_counts: Record<string, number> } | null,
  consensusThrows: false,
};

function resetState() {
  state.dbConfigured = true;
  state.uwConfigured = true;
  state.inserted = [];
  state.consensusCalls = 0;
  state.consensusResult = { top_signals: [], raw_counts: { insiders: 5, smart_money: 5, unusual: 5, whales: 5 } };
  state.consensusThrows = false;
}

function signal(overrides: Partial<PredictionConsensusSignal> = {}): PredictionConsensusSignal {
  return {
    ticker: "SPY",
    direction: "bullish",
    confidence_pct: 85,
    sources: ["smart_money"],
    headline: "smart money 85% bullish on SPY",
    ...overrides,
  };
}

mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    insertShadowFactorObservation: async (row: InsertedRow) => {
      state.inserted.push(row);
    },
  },
});
mock.module("../flow-liveness", {
  namedExports: {
    isFlowFrameFreshAnywhere: async () => true,
  },
});
mock.module("./spx-session", {
  namedExports: {
    todayEtYmd: () => "2026-07-04",
  },
});
mock.module("./config", {
  namedExports: {
    uwConfigured: () => state.uwConfigured,
  },
});
mock.module("./unusual-whales", {
  namedExports: {
    fetchUwPredictionsConsensus: async () => {
      state.consensusCalls += 1;
      if (state.consensusThrows) throw new Error("UW outage (simulated)");
      return {
        source: "unusual_whales",
        signal_count: state.consensusResult?.top_signals.length ?? 0,
        top_signals: state.consensusResult?.top_signals ?? [],
        raw_counts: state.consensusResult?.raw_counts ?? { insiders: 0, smart_money: 0, unusual: 0, whales: 0 },
      };
    },
  },
});

// Lazy import (ESM caches the module under test after the first call) so the
// mocks above are in place before spx-signal-log.ts's own top-level imports
// resolve.
const mod = () => import("../../features/spx/lib/spx-signal-log");

function deskStub(macroEvents: SpxDeskPayload["macro_events"] = []): SpxDeskPayload {
  return { available: true, price: 7420, macro_events: macroEvents } as SpxDeskPayload;
}

function cpiEvent() {
  return { time: "08:30", event: "CPI", country: "US", impact: "high", actual: null, estimate: null };
}

test("logSpxMacroPredictionsShadowFactor: db not configured — zero UW fetches, zero inserts", async () => {
  const { logSpxMacroPredictionsShadowFactor } = await mod();
  resetState();
  state.dbConfigured = false;

  await logSpxMacroPredictionsShadowFactor(deskStub([cpiEvent()]), { score: 42, grade: "B" });

  assert.equal(state.consensusCalls, 0);
  assert.equal(state.inserted.length, 0);
});

test("logSpxMacroPredictionsShadowFactor: no macro events at all — skips the UW fetch entirely, persists a 'not applicable' row", async () => {
  const { logSpxMacroPredictionsShadowFactor } = await mod();
  resetState();

  await logSpxMacroPredictionsShadowFactor(deskStub([]), { score: 10, grade: "C" });

  assert.equal(state.consensusCalls, 0, "outside any macro window — must not pay for the UW round trip");
  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0];
  assert.equal(row.factor_name, "macro_prediction_consensus");
  assert.equal(row.available, true);
  assert.equal(row.implied_weight, 0);
  assert.equal(row.session_date, "2026-07-04");
  assert.equal(row.actual_score, 10);
  assert.equal(row.actual_grade, "C");
});

test("logSpxMacroPredictionsShadowFactor: inside a CPI window but UW not configured — skips the fetch, persists available:false", async (t) => {
  const { logSpxMacroPredictionsShadowFactor } = await mod();
  resetState();
  state.uwConfigured = false;
  // 2027-01-13 08:35 ET == 13:35Z (EST, UTC-5 in January) — inside CPI's [08:25,09:30) window.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-01-13T13:35:00.000Z") });

  await logSpxMacroPredictionsShadowFactor(deskStub([cpiEvent()]), { score: 5, grade: "B" });

  assert.equal(state.consensusCalls, 0, "uwConfigured()=false must short-circuit before the fetch/cache layer");
  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].available, false);
  assert.equal(state.inserted[0].factor_name, "macro_prediction_cpi");
});

test("logSpxMacroPredictionsShadowFactor: inside a CPI window, UW configured, clear bullish SPY consensus — fetches once, persists a signed observation", async (t) => {
  const { logSpxMacroPredictionsShadowFactor } = await mod();
  resetState();
  state.consensusResult = {
    top_signals: [signal({ ticker: "SPY", direction: "bullish", confidence_pct: 88 })],
    raw_counts: { insiders: 10, smart_money: 10, unusual: 10, whales: 10 },
  };
  // Distinct calendar month vs every other "fetch" test in this file — guarantees the
  // module-scoped cache is expired going into this test (see CACHE NOTE above).
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-02-13T13:35:00.000Z") }); // CPI day, 08:35 ET (EST)

  await logSpxMacroPredictionsShadowFactor(deskStub([cpiEvent()]), { score: 60, grade: "A" });

  assert.equal(state.consensusCalls, 1);
  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0];
  assert.equal(row.factor_name, "macro_prediction_cpi");
  assert.equal(row.available, true);
  assert.equal(row.direction, "bullish");
  assert.equal(row.implied_weight, 13); // 80th-pct tier for 88%
  assert.equal(row.price_at_observation, 7420);
  assert.equal(row.actual_score, 60);
  assert.equal(row.actual_grade, "A");
});

test("logSpxMacroPredictionsShadowFactor: two calls within the TTL reuse the cached UW consensus read (fetched once, inserted twice)", async (t) => {
  const { logSpxMacroPredictionsShadowFactor } = await mod();
  resetState();
  state.consensusResult = {
    top_signals: [signal({ ticker: "QQQ", direction: "bearish", confidence_pct: 91 })],
    raw_counts: { insiders: 8, smart_money: 8, unusual: 8, whales: 8 },
  };
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-03-11T13:35:00.000Z") }); // CPI day, 08:35 ET (EST)

  await logSpxMacroPredictionsShadowFactor(deskStub([cpiEvent()]), { score: -20, grade: "B" });
  await logSpxMacroPredictionsShadowFactor(deskStub([cpiEvent()]), { score: -22, grade: "B" });

  assert.equal(state.consensusCalls, 1, "second call within the 90s TTL must reuse the cached read, not refetch");
  assert.equal(state.inserted.length, 2, "the DB write still happens on every tick regardless of the fetch cache");
  assert.equal(state.inserted[0].direction, "bearish");
  assert.equal(state.inserted[1].direction, "bearish");
  assert.equal(state.inserted[0].implied_weight, -18);
});

test("logSpxMacroPredictionsShadowFactor: UW fetch throws (simulated outage) — caught, persists available:false rather than propagating", async (t) => {
  const { logSpxMacroPredictionsShadowFactor } = await mod();
  resetState();
  state.consensusThrows = true;
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-04-10T12:35:00.000Z") }); // CPI day, 08:35 ET

  await assert.doesNotReject(() =>
    logSpxMacroPredictionsShadowFactor(deskStub([cpiEvent()]), { score: 0, grade: "D" })
  );

  assert.equal(state.consensusCalls, 1);
  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].available, false);
});

test("logSpxMacroPredictionsShadowFactor: UW fetch resolves but all four sources returned zero rows — treated as an outage, not a real empty market", async (t) => {
  const { logSpxMacroPredictionsShadowFactor } = await mod();
  resetState();
  state.consensusResult = {
    top_signals: [],
    raw_counts: { insiders: 0, smart_money: 0, unusual: 0, whales: 0 },
  };
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-05-12T12:35:00.000Z") }); // CPI day, 08:35 ET

  await logSpxMacroPredictionsShadowFactor(deskStub([cpiEvent()]), { score: 0, grade: "D" });

  assert.equal(state.consensusCalls, 1);
  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].available, false);
});
