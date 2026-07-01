import test from "node:test";
import assert from "node:assert/strict";
import { computeGexProximity, enrichFlowWithGex } from "@/lib/flow-gex-proximity";

test("computeGexProximity at gamma flip", () => {
  assert.equal(computeGexProximity(6000, 6000, 6100, 5900), "at_gamma_flip");
});

test("computeGexProximity near call wall", () => {
  assert.equal(computeGexProximity(6030, 5900, 6050, 5900), "near_call_wall");
});

test("enrichFlowWithGex adds proximity field", () => {
  const row = { ticker: "SPX", strike: 6000, premium: 1_000_000 };
  const enriched = enrichFlowWithGex(row, { flip: 6000, call_wall: 6100, put_wall: 5900 });
  assert.equal(enriched.gex_proximity, "at_gamma_flip");
});
