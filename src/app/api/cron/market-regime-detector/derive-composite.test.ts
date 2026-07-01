import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveComposite } from "./derive-composite";

// Regression for the GEX-regime enum mismatch: gammaRegime() (see
// src/lib/providers/gamma-desk.ts) only ever returns
// "mean_revert" | "amplification" | "unknown", but deriveComposite() used to
// compare against the literals "long"/"short", which never matched — so
// every RTH tick fell through to the NEUTRAL fallback regardless of actual
// dealer positioning.

test("deriveComposite maps mean_revert + up to MEAN_REVERT_TRENDING_UP", () => {
  const { composite } = deriveComposite("mean_revert", "up", "bullish");
  assert.equal(composite, "MEAN_REVERT_TRENDING_UP");
});

test("deriveComposite maps mean_revert + down to MEAN_REVERT_TRENDING_DOWN", () => {
  const { composite } = deriveComposite("mean_revert", "down", "bearish");
  assert.equal(composite, "MEAN_REVERT_TRENDING_DOWN");
});

test("deriveComposite maps amplification + up to AMPLIFY_BREAKOUT", () => {
  const { composite } = deriveComposite("amplification", "up", "bullish");
  assert.equal(composite, "AMPLIFY_BREAKOUT");
});

test("deriveComposite maps amplification + down to AMPLIFY_BREAKDOWN", () => {
  const { composite } = deriveComposite("amplification", "down", "bearish");
  assert.equal(composite, "AMPLIFY_BREAKDOWN");
});

test("deriveComposite maps amplification + sideways to AMPLIFY_MIXED", () => {
  const { composite } = deriveComposite("amplification", "sideways", "mixed");
  assert.equal(composite, "AMPLIFY_MIXED");
});

test("deriveComposite maps mean_revert + sideways to MEAN_REVERT_MIXED", () => {
  const { composite } = deriveComposite("mean_revert", "sideways", "mixed");
  assert.equal(composite, "MEAN_REVERT_MIXED");
});

test("deriveComposite maps unknown + sideways to NEUTRAL", () => {
  const { composite } = deriveComposite("unknown", "sideways", "neutral");
  assert.equal(composite, "NEUTRAL");
});
