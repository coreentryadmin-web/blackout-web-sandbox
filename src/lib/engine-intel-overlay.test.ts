import test from "node:test";
import assert from "node:assert/strict";
import { parseEngineIntelOverlay } from "./engine-intel-overlay";

test("parseEngineIntelOverlay: drops non-finite numerics", () => {
  const parsed = parseEngineIntelOverlay({
    available: true,
    gamma_flip: "not-a-number",
    gex_net: NaN,
    vwap: 5432.12,
    chart_levels: { regime: "mean_revert" },
  });
  assert.ok(parsed);
  assert.equal(parsed!.gamma_flip, null);
  assert.equal(parsed!.gex_net, null);
  assert.equal(parsed!.vwap, 5432.12);
  assert.equal(parsed!.regime, "mean_revert");
});

test("parseEngineIntelOverlay: returns null for non-objects", () => {
  assert.equal(parseEngineIntelOverlay(null), null);
  assert.equal(parseEngineIntelOverlay("x"), null);
});
