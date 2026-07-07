import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

// spx-signal-log.ts (the module under test) statically imports the ecosystem
// shadow factor, whose fetchEcosystemContext -> getSpxPlayState chain
// (bie/ecosystem-context.ts -> platform/spx-service.ts -> spx-play-engine.ts)
// pulls in a real `import "server-only"` several hops deep. Stub it the same
// way run-tool.test.ts (and every other spx-signal-log-*.test.ts sibling)
// does, or a plain `node --test` load crashes at import time — this file
// never exercises that chain directly, so an empty stub is enough.
mock.module("server-only", { namedExports: {} });

// logSpxPrecedentsShadowFactor (this file's module under test) is the
// fire-and-forget wiring called from evaluateSpxPlay right after the real
// computeSpxConfluence() (src/lib/spx-play-engine.ts), sibling to
// logSpxShadowFactors covered in spx-signal-log-shadow.test.ts. It calls
// BIE's findSimilarPrecedents (src/lib/bie/precedent-search.ts) directly with
// a deterministically-built query (buildPrecedentSearchQuery), hands the
// result to the pure computePrecedentShadowFactor (left REAL here, not
// mocked, so this test also exercises the real query-building/parsing —
// mirroring spx-signal-log-skew.test.ts's own "leave the pure scorer real"
// convention), and persists each observation via insertShadowFactorObservation
// (src/lib/db.ts).
//
// Mocking findSimilarPrecedents/bieEmbeddingsConfigured directly (rather than
// letting the real bie/precedent-search.ts / bie/embeddings.ts load) avoids a
// second problem: precedent-search.ts imports fetchResolvedAlertAuditRows
// from "@/lib/db", a different export than this file's own "../db" mock
// below provides — mocking the real module out entirely sidesteps that
// entirely, same reasoning the ecosystem wiring test applies to its own
// "../spx-signals-shadow-ecosystem" mock.

const state = {
  dbConfigured: true,
  embeddingsConfigured: true,
  precedentHits: [] as Array<{ source: string; kind: string; chunk: string; similarity: number }>,
  searchCalls: [] as Array<{ query: string; k: number }>,
  inserted: [] as Array<Record<string, unknown>>,
};

function resetState() {
  state.dbConfigured = true;
  state.embeddingsConfigured = true;
  state.precedentHits = [];
  state.searchCalls = [];
  state.inserted = [];
}

mock.module("../db", {
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
mock.module("../bie/embeddings", {
  namedExports: {
    bieEmbeddingsConfigured: () => state.embeddingsConfigured,
  },
});
mock.module("../bie/precedent-search", {
  namedExports: {
    findSimilarPrecedents: async (query: string, k: number) => {
      state.searchCalls.push({ query, k });
      return state.precedentHits;
    },
  },
});

// Lazy import (ESM caches the module under test after the first call) so the
// mocks above are in place before spx-signal-log.ts's own top-level imports
// resolve.
const mod = () => import("../../features/spx/lib/spx-signal-log");

function deskStub(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return { available: true, price: 7420, gamma_regime: "unknown", ...overrides } as SpxDeskPayload;
}

function hit(chunk: string, similarity = 0.5) {
  return { source: "alert_audit:1", kind: "precedent", chunk, similarity };
}

test("logSpxPrecedentsShadowFactor: db not configured — never calls findSimilarPrecedents, zero inserts", async () => {
  const { logSpxPrecedentsShadowFactor } = await mod();
  resetState();
  state.dbConfigured = false;

  await logSpxPrecedentsShadowFactor(deskStub(), { score: 42, grade: "B", direction: "long" });

  assert.equal(state.searchCalls.length, 0);
  assert.equal(state.inserted.length, 0);
});

test("logSpxPrecedentsShadowFactor: embeddings not configured — skips the search call entirely, persists available:false", async () => {
  const { logSpxPrecedentsShadowFactor } = await mod();
  resetState();
  state.embeddingsConfigured = false;

  await logSpxPrecedentsShadowFactor(deskStub(), { score: 42, grade: "B", direction: "long" });

  assert.equal(state.searchCalls.length, 0); // cost guard: never even queries when not confirmed configured
  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].available, false);
  assert.match(String(state.inserted[0].detail), /not confirmed available/);
});

test("logSpxPrecedentsShadowFactor: builds the query from desk/confluence and calls findSimilarPrecedents with k=5", async () => {
  const { logSpxPrecedentsShadowFactor } = await mod();
  resetState();

  await logSpxPrecedentsShadowFactor(deskStub({ gamma_regime: "mean_revert" }), {
    score: 61.7,
    grade: "B",
    direction: "long",
  });

  assert.equal(state.searchCalls.length, 1);
  assert.equal(state.searchCalls[0].k, 5);
  assert.equal(state.searchCalls[0].query, "SPX 0DTE setup, long, B conviction (score 62), mean_revert gamma regime");
});

test("logSpxPrecedentsShadowFactor: too few precedents returned — persists available:false ('not enough precedents yet')", async () => {
  const { logSpxPrecedentsShadowFactor } = await mod();
  resetState();
  state.precedentHits = [hit("spx_claude_play alert on SPX, long, A conviction (score 70). Outcome: target.")];

  await logSpxPrecedentsShadowFactor(deskStub(), { score: 10, grade: "C", direction: "long" });

  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].factor_name, "precedent_search_agreement");
  assert.equal(state.inserted[0].available, false);
  assert.equal(state.inserted[0].implied_weight, 0);
});

test("logSpxPrecedentsShadowFactor: enough same-direction precedents resolving target — persists a signed, available:true row carrying real score/grade/price", async () => {
  const { logSpxPrecedentsShadowFactor } = await mod();
  resetState();
  state.precedentHits = [
    hit("spx_claude_play alert on SPX, long, A conviction (score 70). Outcome: target."),
    hit("0DTE Command alert on SPY, long, high conviction (score 80). Outcome: target."),
    hit("Night Hawk alert on QQQ, long, moderate conviction (score 60). Outcome: target."),
  ];

  await logSpxPrecedentsShadowFactor(deskStub({ price: 7420 }), { score: 42, grade: "B", direction: "long" });

  assert.equal(state.inserted.length, 1);
  const row = state.inserted[0];
  assert.equal(row.factor_name, "precedent_search_agreement");
  assert.equal(row.available, true);
  assert.equal(row.implied_weight, 8);
  assert.equal(row.direction, "bullish");
  assert.equal(row.price_at_observation, 7420);
  assert.equal(row.actual_score, 42);
  assert.equal(row.actual_grade, "B");
});

test("logSpxPrecedentsShadowFactor: short bias with same-direction target-resolved precedents persists a NEGATIVE (bearish) weight, not positive", async () => {
  const { logSpxPrecedentsShadowFactor } = await mod();
  resetState();
  state.precedentHits = [
    hit("spx_claude_play alert on SPX, short, A conviction (score 70). Outcome: target."),
    hit("0DTE Command alert on SPY, short, high conviction (score 80). Outcome: target."),
    hit("Night Hawk alert on QQQ, short, moderate conviction (score 60). Outcome: target."),
  ];

  await logSpxPrecedentsShadowFactor(deskStub(), { score: -5, grade: "D", direction: "short" });

  const row = state.inserted[0];
  assert.equal(row.implied_weight, -8);
  assert.equal(row.direction, "bearish");
});
