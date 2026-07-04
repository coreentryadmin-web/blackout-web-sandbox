import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

// logSpxEcosystemShadowFactors (this file's module under test) is the sibling
// fire-and-forget wiring to logSpxShadowFactors, called from evaluateSpxPlay
// right after it (src/lib/spx-play-engine.ts). It delegates the actual
// scoring to computeEcosystemShadowFactors (src/lib/spx-signals-shadow-ecosystem.ts,
// unit-tested on its own in spx-signals-shadow-ecosystem.test.ts) and persists
// each observation via insertShadowFactorObservation (src/lib/db.ts) — same
// generic table logSpxShadowFactors already writes into (factor_name is the
// discriminator column).
//
// Same DB-mocking convention as spx-signal-log-shadow.test.ts: mock "@/lib/db"
// (as "../db" here) rather than attempting to mock the "pg" package directly
// (this repo has no working precedent for that under tsx + node:test).

const state = {
  dbConfigured: true,
  ecosystemFactors: [] as Array<{
    factor_name: string;
    available: boolean;
    implied_weight: number;
    direction: string;
    detail: string;
  }>,
  ecosystemCalls: [] as Array<{ desk: unknown; direction: unknown }>,
  inserted: [] as Array<Record<string, unknown>>,
};

function resetState() {
  state.dbConfigured = true;
  state.ecosystemFactors = [];
  state.ecosystemCalls = [];
  state.inserted = [];
}

mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    // The pre-existing flow_anomalies-shadow query path (dbQuery) is unused by
    // logSpxEcosystemShadowFactors — stub it anyway since spx-signal-log.ts's
    // top-level imports pull it in regardless of which exported function a
    // given test calls.
    dbQuery: async () => ({ rows: [], rowCount: 0 }),
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
mock.module("../providers/spx-session", {
  namedExports: {
    todayEtYmd: () => "2026-07-04",
  },
});
mock.module("../spx-signals-shadow-ecosystem", {
  namedExports: {
    computeEcosystemShadowFactors: async (desk: unknown, direction: unknown) => {
      state.ecosystemCalls.push({ desk, direction });
      return state.ecosystemFactors;
    },
  },
});

// Lazy import (ESM caches the module under test after the first call) so the
// mocks above are in place before spx-signal-log.ts's own top-level imports
// resolve.
const mod = () => import("./spx-signal-log");

function deskStub(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return { available: true, price: 7420, ...overrides } as SpxDeskPayload;
}

test("logSpxEcosystemShadowFactors: db not configured — computeEcosystemShadowFactors never called, zero inserts", async () => {
  const { logSpxEcosystemShadowFactors } = await mod();
  resetState();
  state.dbConfigured = false;

  await logSpxEcosystemShadowFactors(deskStub(), { score: 42, grade: "B", direction: "long" });

  assert.equal(state.ecosystemCalls.length, 0);
  assert.equal(state.inserted.length, 0);
});

test("logSpxEcosystemShadowFactors: passes the engine's own confluence.direction through to computeEcosystemShadowFactors", async () => {
  const { logSpxEcosystemShadowFactors } = await mod();
  resetState();

  await logSpxEcosystemShadowFactors(deskStub(), { score: 42, grade: "B", direction: "short" });

  assert.equal(state.ecosystemCalls.length, 1);
  assert.equal(state.ecosystemCalls[0].direction, "short");
});

test("logSpxEcosystemShadowFactors: persists one row per returned observation, carrying the real score/grade/price for correlation", async () => {
  const { logSpxEcosystemShadowFactors } = await mod();
  resetState();
  state.ecosystemFactors = [
    {
      factor_name: "ecosystem_zerodte_agreement",
      available: true,
      implied_weight: 8,
      direction: "bullish",
      detail: "0DTE Command long take AGREES with engine's long bias",
    },
    {
      factor_name: "ecosystem_spx_anomaly_watch",
      available: true,
      implied_weight: 0,
      direction: "neutral",
      detail: "No SPX-tagged anomaly",
    },
  ];

  await logSpxEcosystemShadowFactors(deskStub({ price: 7420 }), { score: 42, grade: "B", direction: "long" });

  assert.equal(state.inserted.length, 2);
  const [first, second] = state.inserted;
  assert.equal(first.session_date, "2026-07-04");
  assert.equal(first.factor_name, "ecosystem_zerodte_agreement");
  assert.equal(first.implied_weight, 8);
  assert.equal(first.price_at_observation, 7420);
  assert.equal(first.actual_score, 42);
  assert.equal(first.actual_grade, "B");
  assert.equal(second.factor_name, "ecosystem_spx_anomaly_watch");
});

test("logSpxEcosystemShadowFactors: an unavailable observation persists with available:false, not silently dropped", async () => {
  const { logSpxEcosystemShadowFactors } = await mod();
  resetState();
  state.ecosystemFactors = [
    {
      factor_name: "ecosystem_zerodte_agreement",
      available: false,
      implied_weight: 0,
      direction: "neutral",
      detail: "BIE ecosystem-context flow feed not confirmed fresh",
    },
  ];

  await logSpxEcosystemShadowFactors(deskStub(), { score: -10, grade: "C", direction: "short" });

  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].available, false);
});
