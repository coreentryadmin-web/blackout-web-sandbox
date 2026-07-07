import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { EcosystemContext, EcosystemZeroDteTake, EcosystemAnomaly } from "@/lib/bie/ecosystem-context";

// mock.module() must be registered before spx-signals-shadow-ecosystem.ts (and
// therefore its "@/lib/bie/ecosystem-context" import) is ever loaded — same
// ordering requirement as ecosystem-context.test.ts's own header comment (ES
// module imports are hoisted ahead of any other module-body code, including a
// mock.module() call written textually above them). So the module under test
// is loaded dynamically inside before(), same pattern as ecosystem-context.test.ts
// and spx-signal-log-shadow.test.ts.

function emptyCtx(overrides: Partial<EcosystemContext> = {}): EcosystemContext {
  return {
    ticker: "SPX",
    zerodte_today: null,
    nighthawk_recent: null,
    recent_audit_entries: [],
    recent_flow: null,
    recent_anomalies: [],
    spx_play: null,
    flow_feed_fresh: true,
    ...overrides,
  };
}

let mockCtx: EcosystemContext = emptyCtx();
let fetchCalls: string[] = [];

mock.module("../../../lib/bie/ecosystem-context", {
  namedExports: {
    fetchEcosystemContext: async (ticker: string) => {
      fetchCalls.push(ticker);
      return mockCtx;
    },
  },
});

let deriveEcosystemShadowFactors: typeof import("./spx-signals-shadow-ecosystem").deriveEcosystemShadowFactors;
let computeEcosystemShadowFactors: typeof import("./spx-signals-shadow-ecosystem").computeEcosystemShadowFactors;

before(async () => {
  ({ deriveEcosystemShadowFactors, computeEcosystemShadowFactors } = await import("./spx-signals-shadow-ecosystem"));
});

function deskStub(): SpxDeskPayload {
  return { available: true, price: 7420 } as SpxDeskPayload;
}

function zerodte(overrides: Partial<EcosystemZeroDteTake> = {}): EcosystemZeroDteTake {
  return {
    session_date: "2026-07-04",
    direction: "long",
    score: 80,
    conviction: "very strong",
    status: "active",
    first_flagged_at: "2026-07-04T14:00:00.000Z",
    ...overrides,
  };
}

function anomaly(overrides: Partial<EcosystemAnomaly> = {}): EcosystemAnomaly {
  return {
    anomaly_type: "LARGE_PREMIUM_PRINT",
    detected_at: "2026-07-04T17:50:00.000Z",
    detail: "$6.0M single CALL print at strike 7450",
    severity: "CRITICAL",
    direction: "bullish",
    ...overrides,
  };
}

// ---- Pure deriver tests (mirrors spx-signals-shadow.test.ts's structure) ----

test("deriveEcosystemShadowFactors: ecosystem flow_feed_fresh false — both factors available:false regardless of content", () => {
  const ctx = emptyCtx({ flow_feed_fresh: false, zerodte_today: zerodte(), recent_anomalies: [anomaly()] });
  const obs = deriveEcosystemShadowFactors(ctx, "long");
  assert.equal(obs.length, 2);
  for (const o of obs) {
    assert.equal(o.available, false);
    assert.equal(o.implied_weight, 0);
    assert.equal(o.direction, "neutral");
  }
  // Distinct factor_names even while both are unavailable — a later evidence
  // query can still tell the two factor families apart.
  assert.deepEqual(
    obs.map((o) => o.factor_name).sort(),
    ["ecosystem_spx_anomaly_watch", "ecosystem_zerodte_agreement"]
  );
});

test("deriveEcosystemShadowFactors: no 0DTE data — available:true, implied_weight:0, neutral (distinct from the unavailable case)", () => {
  const ctx = emptyCtx({ flow_feed_fresh: true, zerodte_today: null });
  const [zObs] = deriveEcosystemShadowFactors(ctx, "long");
  assert.equal(zObs.factor_name, "ecosystem_zerodte_agreement");
  assert.equal(zObs.available, true);
  assert.equal(zObs.implied_weight, 0);
  assert.equal(zObs.direction, "neutral");
  assert.match(zObs.detail, /No same-day 0DTE Command take/);
});

test("deriveEcosystemShadowFactors: 0DTE agreement — 0DTE long take + engine long bias AGREES, positive implied_weight from score tier", () => {
  const ctx = emptyCtx({ flow_feed_fresh: true, zerodte_today: zerodte({ direction: "long", score: 80 }) });
  const [zObs] = deriveEcosystemShadowFactors(ctx, "long");
  assert.equal(zObs.available, true);
  assert.equal(zObs.direction, "bullish");
  assert.equal(zObs.implied_weight, 8); // score 80 -> STRONG tier
  assert.match(zObs.detail, /AGREES/);
});

test("deriveEcosystemShadowFactors: 0DTE disagreement — 0DTE short take vs engine long bias DISAGREES, weight signed by 0DTE's own bearish call", () => {
  const ctx = emptyCtx({ flow_feed_fresh: true, zerodte_today: zerodte({ direction: "short", score: 60 }) });
  const [zObs] = deriveEcosystemShadowFactors(ctx, "long");
  assert.equal(zObs.direction, "bearish");
  assert.equal(zObs.implied_weight, -5); // score 60 -> MODERATE tier
  assert.match(zObs.detail, /DISAGREES/);
});

test("deriveEcosystemShadowFactors: 0DTE take present but engine has no directional bias yet — neutral, not fabricated agreement", () => {
  const ctx = emptyCtx({ flow_feed_fresh: true, zerodte_today: zerodte({ direction: "long", score: 90 }) });
  const [zObs] = deriveEcosystemShadowFactors(ctx, null);
  assert.equal(zObs.available, true);
  assert.equal(zObs.implied_weight, 0);
  assert.equal(zObs.direction, "neutral");
});

test("deriveEcosystemShadowFactors: unrecognized 0DTE direction value stays neutral, never fabricated bullish/bearish", () => {
  const ctx = emptyCtx({ flow_feed_fresh: true, zerodte_today: zerodte({ direction: "flat" }) });
  const [zObs] = deriveEcosystemShadowFactors(ctx, "long");
  assert.equal(zObs.direction, "neutral");
  assert.equal(zObs.implied_weight, 0);
});

test("deriveEcosystemShadowFactors: no SPX-tagged anomaly — available:true, weight 0, its own distinct factor_name", () => {
  const ctx = emptyCtx({ flow_feed_fresh: true, recent_anomalies: [] });
  const [, aObs] = deriveEcosystemShadowFactors(ctx, null);
  assert.equal(aObs.factor_name, "ecosystem_spx_anomaly_watch");
  assert.equal(aObs.available, true);
  assert.equal(aObs.implied_weight, 0);
});

test("deriveEcosystemShadowFactors: a real SPX-tagged anomaly produces a signed, available:true observation", () => {
  const ctx = emptyCtx({
    flow_feed_fresh: true,
    recent_anomalies: [anomaly({ direction: "bearish", severity: "HIGH", anomaly_type: "COORDINATED_SWEEP" })],
  });
  const [, aObs] = deriveEcosystemShadowFactors(ctx, null);
  assert.equal(aObs.available, true);
  assert.equal(aObs.direction, "bearish");
  assert.equal(aObs.implied_weight, -7);
  assert.equal(aObs.factor_name, "ecosystem_spx_anomaly_sweep");
});

test("deriveEcosystemShadowFactors: multiple SPX anomalies collapse to the single highest-severity observation", () => {
  const ctx = emptyCtx({
    flow_feed_fresh: true,
    recent_anomalies: [
      anomaly({ severity: "LOW", direction: "bullish", anomaly_type: "CONCENTRATION" }),
      anomaly({ severity: "CRITICAL", direction: "bearish", anomaly_type: "PUT_SURGE" }),
    ],
  });
  const [, aObs] = deriveEcosystemShadowFactors(ctx, null);
  assert.equal(aObs.implied_weight, -10);
  assert.equal(aObs.factor_name, "ecosystem_spx_anomaly_put_surge");
});

// ---- Async wrapper tests (mock.module convention, per ecosystem-context.test.ts) ----

test("computeEcosystemShadowFactors: calls fetchEcosystemContext with ticker SPX only (never SPY/QQQ or any other ticker)", async () => {
  fetchCalls = [];
  mockCtx = emptyCtx();
  await computeEcosystemShadowFactors(deskStub(), "long");
  assert.deepEqual(fetchCalls, ["SPX"]);
});

test("computeEcosystemShadowFactors: wires fetchEcosystemContext's fields straight through to the pure deriver", async () => {
  fetchCalls = [];
  mockCtx = emptyCtx({ flow_feed_fresh: true, zerodte_today: zerodte({ direction: "long", score: 80 }) });
  const obs = await computeEcosystemShadowFactors(deskStub(), "long");
  assert.equal(obs.length, 2);
  assert.equal(obs[0].factor_name, "ecosystem_zerodte_agreement");
  assert.equal(obs[0].implied_weight, 8);
});

test("computeEcosystemShadowFactors: flow_feed_fresh false from the fetched context — every observation available:false", async () => {
  fetchCalls = [];
  mockCtx = emptyCtx({ flow_feed_fresh: false, zerodte_today: zerodte() });
  const obs = await computeEcosystemShadowFactors(deskStub(), "long");
  assert.ok(obs.length > 0);
  assert.ok(obs.every((o) => o.available === false));
});
