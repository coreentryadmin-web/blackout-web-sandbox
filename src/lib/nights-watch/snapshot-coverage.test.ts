import test from "node:test";
import assert from "node:assert/strict";
import { snapshotMatchesPosition } from "./snapshot-coverage";
import type { OptionSnapshot } from "@/lib/providers/options-snapshot";

test("snapshotMatchesPosition: matches held leg fields", () => {
  const snap: OptionSnapshot = {
    ticker: "O:ASTS260717C00120000",
    mark: 0.9,
    bid: 0.85,
    ask: 0.94,
    last: 0.94,
    dayClose: 0.94,
    delta: 0.1,
    gamma: 0.01,
    theta: -0.12,
    vega: 0.03,
    iv: 1.2,
    openInterest: 100,
    underlyingPrice: 85,
    strike: 120,
    optionType: "call",
    expiry: "2026-07-17",
    sharesPerContract: 100,
  };
  assert.equal(
    snapshotMatchesPosition(
      { ticker: "ASTS", expiry: "2026-07-17", strike: 120, option_type: "call" },
      snap
    ),
    true
  );
});
