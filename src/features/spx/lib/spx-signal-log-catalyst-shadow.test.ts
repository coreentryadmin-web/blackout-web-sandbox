import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

// spx-signal-log.ts (the module under test) now also statically imports the
// ecosystem shadow factor, whose fetchEcosystemContext -> getSpxPlayState chain
// (bie/ecosystem-context.ts -> platform/spx-service.ts -> spx-play-engine.ts)
// pulls in a real `import "server-only"` several hops deep. Stub it the same
// way run-tool.test.ts does, or a plain `node --test` load crashes at import
// time — this file never exercises that chain directly, so an empty stub is
// enough.
mock.module("server-only", { namedExports: {} });

// logMegaCapCatalystShadowFactors (this file's module under test) is the
// fire-and-forget wiring called from evaluateSpxPlay right after the real
// computeSpxConfluence() (src/features/spx/lib/spx-play-engine.ts), sibling to
// logSpxShadowFactors covered in spx-signal-log-shadow.test.ts. It fetches
// Benzinga catalysts per mega-cap leader ticker (fetchBenzingaCatalysts,
// src/lib/providers/polygon.ts), hands them to the pure
// computeCatalystShadowFactors (src/features/spx/lib/spx-signals-shadow-catalysts.ts,
// unit-tested on its own), and persists each observation via
// insertShadowFactorObservation (src/lib/db.ts).
//
// Same DB-mocking convention as spx-signal-log-shadow.test.ts (mock "@/lib/db"
// from the consumer under test, not the "pg" package — see that file's header
// comment for why).

const state = {
  dbConfigured: true,
  polygonConfigured: true,
  // ticker -> catalysts fetchBenzingaCatalysts would return for it
  catalystsByTicker: {} as Record<string, Array<{ channel: string; type: string; title: string; published: string }>>,
  fetchCalls: [] as Array<{ ticker: string; limit: number }>,
  inserted: [] as Array<Record<string, unknown>>,
};

function resetState() {
  state.dbConfigured = true;
  state.polygonConfigured = true;
  state.catalystsByTicker = {};
  state.fetchCalls = [];
  state.inserted = [];
}

mock.module("../../../lib/db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    dbQuery: async () => ({ rows: [], rowCount: 0 }),
    getMeta: async () => null,
    setMeta: async () => {},
    insertSpxSignalLog: async () => {},
    insertShadowFactorObservation: async (row: Record<string, unknown>) => {
      state.inserted.push(row);
    },
  },
});
mock.module("../../../lib/flow-liveness", {
  namedExports: {
    isFlowFrameFreshAnywhere: async () => true,
  },
});
mock.module("../../../lib/providers/spx-session", {
  namedExports: {
    todayEtYmd: () => "2026-07-04",
  },
});
mock.module("../../../lib/providers/config", {
  namedExports: {
    polygonConfigured: () => state.polygonConfigured,
  },
});
mock.module("../../../lib/providers/polygon", {
  namedExports: {
    polygonRestBase: () => "https://api.polygon.io",
    polygonRestApiKey: () => "test-key",
    fetchBenzingaCatalysts: async (ticker: string, limit: number) => {
      state.fetchCalls.push({ ticker, limit });
      return state.catalystsByTicker[ticker.toUpperCase()] ?? [];
    },
  },
});

// Lazy import (ESM caches the module under test after the first call) so the
// mocks above are in place before spx-signal-log.ts's own top-level imports
// resolve.
const mod = () => import("./spx-signal-log");

function deskStub(leaders: Array<{ ticker: string; change_pct: number }> = [], overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return {
    available: true,
    price: 7420,
    leader_stocks: leaders.map((l) => ({ name: l.ticker, ticker: l.ticker, change_pct: l.change_pct })),
    ...overrides,
  } as SpxDeskPayload;
}

test("logMegaCapCatalystShadowFactors: db not configured — zero fetches, zero inserts", async () => {
  const { logMegaCapCatalystShadowFactors } = await mod();
  resetState();
  state.dbConfigured = false;

  await logMegaCapCatalystShadowFactors(deskStub([{ ticker: "NVDA", change_pct: 2 }]), { score: 42, grade: "B" });

  assert.equal(state.fetchCalls.length, 0);
  assert.equal(state.inserted.length, 0);
});

test("logMegaCapCatalystShadowFactors: Polygon not configured — no fetch attempted, persists a single available:false observation", async () => {
  const { logMegaCapCatalystShadowFactors } = await mod();
  resetState();
  state.polygonConfigured = false;

  await logMegaCapCatalystShadowFactors(deskStub([{ ticker: "NVDA", change_pct: 2 }]), { score: 42, grade: "B" });

  assert.equal(state.fetchCalls.length, 0);
  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].factor_name, "megacap_catalyst_watch");
  assert.equal(state.inserted[0].available, false);
});

test("logMegaCapCatalystShadowFactors: no leader_stocks in desk — no fetch attempted, persists available:false", async () => {
  const { logMegaCapCatalystShadowFactors } = await mod();
  resetState();

  await logMegaCapCatalystShadowFactors(deskStub([]), { score: 42, grade: "B" });

  assert.equal(state.fetchCalls.length, 0);
  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].available, false);
});

test("logMegaCapCatalystShadowFactors: fetches one call per leader ticker, no qualifying catalysts — persists exactly one available:true / weight:0 observation carrying score+grade+price", async () => {
  const { logMegaCapCatalystShadowFactors } = await mod();
  resetState();

  await logMegaCapCatalystShadowFactors(
    deskStub([
      { ticker: "NVDA", change_pct: 2 },
      { ticker: "AAPL", change_pct: 0.5 },
    ], { price: 7420 }),
    { score: 42, grade: "B" }
  );

  assert.equal(state.fetchCalls.length, 2);
  assert.deepEqual(state.fetchCalls.map((c) => c.ticker).sort(), ["AAPL", "NVDA"]);
  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0];
  assert.equal(row.session_date, "2026-07-04");
  assert.equal(row.factor_name, "megacap_catalyst_watch");
  assert.equal(row.available, true);
  assert.equal(row.implied_weight, 0);
  assert.equal(row.price_at_observation, 7420);
  assert.equal(row.actual_score, 42);
  assert.equal(row.actual_grade, "B");
});

test("logMegaCapCatalystShadowFactors: a real in-window binary catalyst on a leader ticker persists a directional, available:true observation", async () => {
  const { logMegaCapCatalystShadowFactors } = await mod();
  resetState();
  state.catalystsByTicker.NVDA = [
    {
      channel: "fda",
      type: "binary",
      title: "FDA approves NVDA-partnered device",
      published: new Date().toISOString(),
    },
  ];

  await logMegaCapCatalystShadowFactors(deskStub([{ ticker: "NVDA", change_pct: 2 }], { price: 7420 }), {
    score: 42,
    grade: "B",
  });

  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0];
  assert.equal(row.factor_name, "megacap_catalyst_nvda_binary");
  assert.equal(row.available, true);
  assert.equal(row.direction, "bullish");
  assert.equal(row.implied_weight, 15);
  assert.equal(row.actual_score, 42);
  assert.equal(row.actual_grade, "B");
});

test("logMegaCapCatalystShadowFactors: out-of-scope catalyst type (insider) from the fetcher does not produce a directional row", async () => {
  const { logMegaCapCatalystShadowFactors } = await mod();
  resetState();
  state.catalystsByTicker.NVDA = [
    { channel: "insider trades", type: "insider", title: "NVDA CEO buys shares", published: new Date().toISOString() },
  ];

  await logMegaCapCatalystShadowFactors(deskStub([{ ticker: "NVDA", change_pct: 2 }]), { score: 42, grade: "B" });

  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].factor_name, "megacap_catalyst_watch");
  assert.equal(state.inserted[0].implied_weight, 0);
});
