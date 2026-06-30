import { test } from "node:test";
import assert from "node:assert/strict";
import {
  luldIndicatorHaltState,
  normalizeLuldWsMessages,
} from "./polygon-luld";
import { hasActiveLuldHalt, applyLuldHaltEvents, luldHaltsStore } from "../ws/luld-halts-store";

test("luldIndicatorHaltState maps SIP halt/resume codes", () => {
  assert.equal(luldIndicatorHaltState(3), true);
  assert.equal(luldIndicatorHaltState(4), false);
  assert.equal(luldIndicatorHaltState(1), null);
});

test("normalizeLuldWsMessages parses LULD frames", () => {
  const rows = normalizeLuldWsMessages([
    { ev: "LULD", T: "SPY", h: 601, l: 599, i: 3, t: 1_718_000_000_000 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.symbol, "SPY");
  assert.equal(rows[0]?.active, true);
});

test("hasActiveLuldHalt proxies SPY halt to SPX watch list", () => {
  luldHaltsStore.halts.clear();
  applyLuldHaltEvents([{ symbol: "SPY", active: true, indicator: 3, ts: Date.now() }]);
  assert.equal(hasActiveLuldHalt(["SPX"]), true);
  luldHaltsStore.halts.clear();
});
