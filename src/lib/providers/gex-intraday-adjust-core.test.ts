import { test } from "node:test";
import assert from "node:assert/strict";

// Pure-core tests for the 0DTE intraday-adjusted GEX lens. The core has NO server-only / network
// deps (gex-intraday-adjust-core.ts), so it imports cleanly under `tsx --test`. These lock:
//  - the OI base is NEVER mutated (canonical GEX untouched — the headline guarantee);
//  - the front-expiry signed-flow nudge is applied with the correct DEALER sign + dollar scale;
//  - flip/walls are recomputed on the ADJUSTED totals;
//  - graceful degradation: no trades / cold matrix / no front expiry → OI base or null;
//  - coverage + model labeling reflect classification strength.

import {
  gexIntradayAdjustedFrom,
  zeroGammaFlip,
  walls,
  classifyTradeSide,
  GEX_INTRADAY_LABEL,
} from "./gex-intraday-adjust-core";
import type { GexHeatmap } from "./polygon-options-gex";
import type { OptionTradesAggregate, StrikePremium } from "./option-trades";

// ----------------------------- fixtures -----------------------------

/** Minimal GexHeatmap with a given gex.strike_totals + total. Only the fields the lens reads. */
function makeHeatmap(strikeTotals: Record<string, number>, spot = 100): GexHeatmap {
  const total = Object.values(strikeTotals).reduce((a, b) => a + b, 0);
  const strikes = Object.keys(strikeTotals).map(Number).sort((a, b) => b - a);
  return {
    underlying: "TEST",
    spot,
    change_pct: 0,
    asof: new Date().toISOString(),
    expiries: ["2026-06-26"],
    strikes,
    max_pain: null,
    gex: {
      cells: {},
      strike_totals: strikeTotals,
      call_wall: null,
      put_wall: null,
      total,
      flip: null,
      regime: { flip: null, posture: null, read: "" },
    },
    vex: {
      cells: {},
      strike_totals: {},
      pos_wall: null,
      neg_wall: null,
      total: 0,
      flip: null,
      regime: { posture: null, read: "" },
    },
    shift: { available: false, status: "collecting" },
    source: "polygon",
    data_delay: "test",
  } as GexHeatmap;
}

function makeStrike(partial: Partial<StrikePremium> & { strike: number }): StrikePremium {
  return {
    callPremium: 0,
    putPremium: 0,
    totalPremium: 0,
    prints: 0,
    netCallPremiumSigned: 0,
    netPutPremiumSigned: 0,
    netCallContractsSigned: 0,
    netPutContractsSigned: 0,
    classifiedPrints: 0,
    ...partial,
  };
}

function makeTrades(
  byStrike: StrikePremium[],
  meta: Partial<OptionTradesAggregate["meta"]> = {},
  totalPrints = 10
): OptionTradesAggregate {
  return {
    ticker: "TEST",
    optionsRoot: "TEST",
    expiry: "2026-06-26",
    windowStartMs: 0,
    windowEndMs: 1,
    totalPremium: 0,
    callPremium: 0,
    putPremium: 0,
    totalPrints,
    callPrints: 0,
    putPrints: 0,
    callPct: 50,
    byStrike,
    meta: {
      contractsRequested: byStrike.length,
      contractsWithTrades: byStrike.length,
      contractsCapped: false,
      filteredPrints: 0,
      partial: false,
      sideClassifiedPrints: totalPrints,
      ...meta,
    },
  };
}

// ----------------------------- quote-rule classifier -----------------------------

test("classifyTradeSide: price ≥ ask → customer BUY (+1)", () => {
  assert.equal(classifyTradeSide(10.4, 10.0, 10.4), 1); // at ask
  assert.equal(classifyTradeSide(10.6, 10.0, 10.4), 1); // through ask
});

test("classifyTradeSide: price ≤ bid → customer SELL (−1)", () => {
  assert.equal(classifyTradeSide(10.0, 10.0, 10.4), -1); // at bid
  assert.equal(classifyTradeSide(9.5, 10.0, 10.4), -1); // through bid
});

test("classifyTradeSide: strictly inside the spread → 0 (don't guess)", () => {
  assert.equal(classifyTradeSide(10.2, 10.0, 10.4), 0);
});

test("classifyTradeSide: missing / inverted / zero-width NBBO → 0", () => {
  assert.equal(classifyTradeSide(10.2, null, 10.4), 0);
  assert.equal(classifyTradeSide(10.2, 10.0, null), 0);
  assert.equal(classifyTradeSide(10.2, 0, 10.4), 0);
  assert.equal(classifyTradeSide(10.2, 10.4, 10.0), 0); // inverted
  assert.equal(classifyTradeSide(10.0, 10.0, 10.0), 0); // zero-width
});

// ----------------------------- helper-level math -----------------------------

test("zeroGammaFlip interpolates the neg→pos crossing nearest spot", () => {
  // strike 95 = -10, 105 = +10 → crosses 0 at 100.
  const flip = zeroGammaFlip({ "95": -10, "105": 10 }, 100);
  assert.equal(flip, 100);
});

test("walls picks largest-positive (call) and largest-negative (put) strikes", () => {
  const w = walls({ "90": -50, "100": 30, "110": 80, "120": -90 });
  assert.equal(w.call, 110); // +80 is the largest positive
  assert.equal(w.put, 120); // -90 is the largest negative
});

// ----------------------------- the headline guarantee -----------------------------

test("CANONICAL OI base is NEVER mutated by the adjustment", () => {
  const oi = { "95": -100, "100": 50, "105": 120 };
  const hm = makeHeatmap(oi, 100);
  const trades = makeTrades([
    makeStrike({ strike: 100, netCallContractsSigned: 200, classifiedPrints: 5 }),
  ]);
  const coeffs = { "100": 10 };
  const before = JSON.stringify(hm.gex.strike_totals);

  const view = gexIntradayAdjustedFrom("TEST", hm, trades, coeffs, "2026-06-26", 100, 240);
  assert.ok(view);
  // The source matrix object must be byte-identical after the build.
  assert.equal(JSON.stringify(hm.gex.strike_totals), before);
  // And the adjusted totals are a SEPARATE object, not the same reference.
  assert.notEqual(view.strike_totals_adjusted, hm.gex.strike_totals);
});

test("net customer BUYING at a strike makes dealers MORE SHORT gamma there (negative nudge)", () => {
  // Customers net-buy 200 calls at strike 100, gammaCoeff 10 → dealerAdjust = -(10*200) = -2000.
  const oi = { "100": 500 };
  const hm = makeHeatmap(oi, 100);
  const trades = makeTrades([
    makeStrike({ strike: 100, netCallContractsSigned: 200, classifiedPrints: 5 }),
  ]);
  const view = gexIntradayAdjustedFrom("TEST", hm, trades, { "100": 10 }, "2026-06-26", 100, 240);
  assert.ok(view);
  assert.equal(view.net_gex_adjustment, -2000);
  assert.equal(view.net_gex_oi, 500);
  assert.equal(view.net_gex_adjusted, 500 - 2000);
  assert.equal(view.strike_totals_adjusted["100"], 500 - 2000);
  assert.equal(view.model, "signed-flow");
});

test("net customer SELLING (negative signed contracts) makes dealers LESS short (positive nudge)", () => {
  const hm = makeHeatmap({ "100": 0 }, 100);
  const trades = makeTrades([
    makeStrike({ strike: 100, netPutContractsSigned: -150, classifiedPrints: 4 }),
  ]);
  const view = gexIntradayAdjustedFrom("TEST", hm, trades, { "100": 8 }, "2026-06-26", 100, 240);
  assert.ok(view);
  // dealerAdjust = -(8 * -150) = +1200
  assert.equal(view.net_gex_adjustment, 1200);
});

test("calls + puts both contribute long-gamma (signed contracts summed) at a strike", () => {
  const hm = makeHeatmap({ "100": 0 }, 100);
  const trades = makeTrades([
    makeStrike({
      strike: 100,
      netCallContractsSigned: 100,
      netPutContractsSigned: 50,
      classifiedPrints: 6,
    }),
  ]);
  const view = gexIntradayAdjustedFrom("TEST", hm, trades, { "100": 10 }, "2026-06-26", 100, 240);
  assert.ok(view);
  // net customer contracts = 150 → dealerAdjust = -(10*150) = -1500
  assert.equal(view.net_gex_adjustment, -1500);
});

test("strike with NO gamma coefficient is skipped (no fabricated nudge)", () => {
  const hm = makeHeatmap({ "100": 100, "200": -100 }, 100);
  const trades = makeTrades([
    makeStrike({ strike: 200, netCallContractsSigned: 999, classifiedPrints: 9 }),
  ]);
  // coeff only for 100, not 200 → the 200 flow can't be converted → no adjustment.
  const view = gexIntradayAdjustedFrom("TEST", hm, trades, { "100": 10 }, "2026-06-26", 100, 240);
  assert.ok(view);
  assert.equal(view.net_gex_adjustment, 0);
  assert.equal(view.strike_totals_adjusted["200"], -100); // unchanged OI
  assert.equal(view.model, "thin"); // no net adjustment → thin
});

test("flip + walls are recomputed on the ADJUSTED totals", () => {
  // OI: flip would be ~100 (95:-10, 105:+10). Customers buy huge calls at 105 → it flips negative,
  // moving the call wall / flip.
  const oi = { "95": -10, "105": 10 };
  const hm = makeHeatmap(oi, 100);
  const trades = makeTrades([
    makeStrike({ strike: 105, netCallContractsSigned: 100, classifiedPrints: 5 }),
  ]);
  // coeff 1 at 105 → adjust = -(1*100) = -100 → 105 becomes 10-100 = -90 (now negative).
  const view = gexIntradayAdjustedFrom("TEST", hm, trades, { "105": 1 }, "2026-06-26", 100, 240);
  assert.ok(view);
  assert.equal(view.strike_totals_adjusted["105"], -90);
  // Both strikes now negative → no neg→pos crossing → flip null on adjusted (distinct from OI flip).
  assert.equal(view.flip_adjusted, null);
  assert.equal(view.put_wall_adjusted, 105); // -90 is the largest negative now
});

// ----------------------------- graceful degradation -----------------------------

test("cold / empty matrix → null (no standalone fabricated view)", () => {
  assert.equal(gexIntradayAdjustedFrom("TEST", null, null, null, "2026-06-26", 100, 240), null);
  const emptyHm = makeHeatmap({}, 0);
  assert.equal(gexIntradayAdjustedFrom("TEST", emptyHm, null, null, "2026-06-26", 0, 240), null);
});

test("no front expiry → null", () => {
  const hm = makeHeatmap({ "100": 10, "90": -10 }, 100);
  assert.equal(gexIntradayAdjustedFrom("TEST", hm, null, null, null, 100, 240), null);
});

test("no trades → view equals the OI base, model 'thin'", () => {
  const oi = { "95": -10, "105": 10 };
  const hm = makeHeatmap(oi, 100);
  const view = gexIntradayAdjustedFrom("TEST", hm, null, null, "2026-06-26", 100, 240);
  assert.ok(view);
  assert.equal(view.net_gex_adjustment, 0);
  assert.equal(view.net_gex_adjusted, view.net_gex_oi);
  assert.deepEqual(view.strike_totals_adjusted, oi);
  assert.equal(view.model, "thin");
  assert.equal(view.label, GEX_INTRADAY_LABEL);
});

test("coverage = sideClassified / totalPrints; 0 classified ⇒ thin even with byStrike rows", () => {
  const hm = makeHeatmap({ "100": 100 }, 100);
  // Rows present but classifiedPrints/sideClassifiedPrints are 0 AND signed contracts 0 → no nudge.
  const trades = makeTrades(
    [makeStrike({ strike: 100, classifiedPrints: 0 })],
    { sideClassifiedPrints: 0 },
    20
  );
  const view = gexIntradayAdjustedFrom("TEST", hm, trades, { "100": 10 }, "2026-06-26", 100, 240);
  assert.ok(view);
  assert.equal(view.meta.classification_coverage, 0);
  assert.equal(view.meta.total_prints, 20);
  assert.equal(view.model, "thin");
});

test("coverage reflects the classified fraction", () => {
  const hm = makeHeatmap({ "100": 100 }, 100);
  const trades = makeTrades(
    [makeStrike({ strike: 100, netCallContractsSigned: 10, classifiedPrints: 8 })],
    { sideClassifiedPrints: 8 },
    16
  );
  const view = gexIntradayAdjustedFrom("TEST", hm, trades, { "100": 10 }, "2026-06-26", 100, 240);
  assert.ok(view);
  assert.equal(view.meta.classification_coverage, 0.5); // 8 / 16
  assert.equal(view.model, "signed-flow");
});
