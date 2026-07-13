import test from "node:test";
import assert from "node:assert/strict";
import { formatPremiumAt } from "./spx-play-contract-label";

test("formatPremiumAt: live mid string for chain quote display", () => {
  assert.equal(formatPremiumAt("5.20"), "5.2");
  assert.equal(formatPremiumAt("4.80–5.40"), "5.1");
});
