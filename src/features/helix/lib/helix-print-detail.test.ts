import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estContractSize,
  estNotional,
  aggressorRead,
  gexProximityLabel,
  printBias,
} from "./helix-print-detail";

test("estContractSize backs contracts out of premium ÷ (fill × 100)", () => {
  // 100 contracts × $5.00 × 100 = $50,000 premium
  assert.equal(estContractSize(50_000, 5), 100);
  // 1 contract × $1.20 × 100 = $120
  assert.equal(estContractSize(120, 1.2), 1);
  // rounds to nearest whole contract
  assert.equal(estContractSize(12_500, 2.5), 50);
});

test("estContractSize returns null on missing/degenerate inputs (no fabricated size)", () => {
  assert.equal(estContractSize(undefined, 5), null);
  assert.equal(estContractSize(50_000, undefined), null);
  assert.equal(estContractSize(50_000, 0), null);
  assert.equal(estContractSize(0, 5), null);
  assert.equal(estContractSize(Number.NaN, 5), null);
  assert.equal(estContractSize(50_000, Number.POSITIVE_INFINITY), null);
});

test("estNotional = est contracts × 100 × strike (= premium × strike / fill)", () => {
  // 100 contracts of the 600 strike → 100 × 100 × 600 = $6,000,000
  assert.equal(estNotional(600, 50_000, 5), 6_000_000);
  // identity check against the closed form premium × strike / fill
  const premium = 12_500,
    fill = 2.5,
    strike = 430;
  const size = estContractSize(premium, fill)!;
  assert.equal(estNotional(strike, premium, fill), size * 100 * strike);
});

test("estNotional returns null without a real strike or size", () => {
  assert.equal(estNotional(0, 50_000, 5), null);
  assert.equal(estNotional(600, undefined, 5), null);
});

test("aggressorRead splits ask-side into bought / sold / midpoint", () => {
  assert.deepEqual(aggressorRead(85), { label: "At ask · 85% bought", tone: "bull" });
  assert.deepEqual(aggressorRead(15), { label: "At bid · 85% sold", tone: "bear" });
  assert.deepEqual(aggressorRead(50), { label: "Midpoint · 50% ask", tone: "neutral" });
  assert.equal(aggressorRead(undefined), null);
  assert.equal(aggressorRead(Number.NaN), null);
});

test("gexProximityLabel maps only the known server enum, else null", () => {
  assert.equal(gexProximityLabel("at_gamma_flip"), "At gamma flip");
  assert.equal(gexProximityLabel("at_call_wall"), "At call wall");
  assert.equal(gexProximityLabel("near_put_wall"), "Near put wall");
  assert.equal(gexProximityLabel("something_else"), null);
  assert.equal(gexProximityLabel(undefined), null);
});

test("printBias combines side + aggressor (call bought = bullish, put bought = bearish)", () => {
  assert.equal(printBias({ option_type: "CALL", ask_pct: 80 }), "bullish");
  assert.equal(printBias({ option_type: "CALL", ask_pct: 20 }), "bearish");
  assert.equal(printBias({ option_type: "PUT", ask_pct: 80 }), "bearish");
  assert.equal(printBias({ option_type: "PUT", ask_pct: 20 }), "bullish");
  assert.equal(printBias({ option_type: "CALL", ask_pct: 50 }), "neutral");
  assert.equal(printBias({ option_type: "CALL", ask_pct: undefined }), "neutral");
});
