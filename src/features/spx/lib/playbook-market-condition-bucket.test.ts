import test from "node:test";
import assert from "node:assert/strict";
import { marketConditionBucket, vixQuartileBucket } from "./playbook-market-condition-bucket";

test("vixQuartileBucket: buckets by level", () => {
  assert.equal(vixQuartileBucket(12), "vix_low");
  assert.equal(vixQuartileBucket(16), "vix_mid");
  assert.equal(vixQuartileBucket(20), "vix_elevated");
  assert.equal(vixQuartileBucket(30), "vix_high");
});

test("marketConditionBucket: composite key", () => {
  const b = marketConditionBucket({
    vix: 16,
    gamma_regime: "mean_revert",
    regime: "trend_up",
  });
  assert.match(b, /^vix_mid\|γ:mean_revert\|r:trend_up$/);
});
