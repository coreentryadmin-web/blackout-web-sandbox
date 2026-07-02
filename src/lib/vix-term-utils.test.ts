import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVixTermStructure } from "./vix-term-utils";

// Term structure is defined by the curve SLOPE (9d vs 3M), not by either leg's
// position relative to spot. The regression case is the audit's live capture:
// 9d 13.73 < spot 17.17 < 3M 19.0 — a textbook contango curve that the old
// near-vs-spot comparison served as "backwardation" while spx-signals.ts's
// engine correctly called the same data contango.

test("REGRESSION (2026-07-01 live capture): 9d 13.73 / spot 17.17 / 3M 19.0 is CONTANGO", () => {
  const r = computeVixTermStructure(17.17, 13.73, 19.0);
  assert.equal(r.structure, "contango");
  assert.equal(r.partial, undefined);
});

test("inverted curve (9d above 3M) is backwardation", () => {
  const r = computeVixTermStructure(25, 30, 22);
  assert.equal(r.structure, "backwardation");
});

test("slope within ±1.0 is flat regardless of spot", () => {
  assert.equal(computeVixTermStructure(17, 16.5, 17.2).structure, "flat");
  assert.equal(computeVixTermStructure(40, 16.5, 17.2).structure, "flat");
});

test("both legs present labels from slope even when spot is missing", () => {
  assert.equal(computeVixTermStructure(null, 13.73, 19.0).structure, "contango");
});

test("3M-only: far above spot = contango, far below spot = backwardation (partial)", () => {
  const up = computeVixTermStructure(17, null, 19);
  assert.equal(up.structure, "contango");
  assert.equal(up.partial, true);
  const down = computeVixTermStructure(25, null, 22);
  assert.equal(down.structure, "backwardation");
  assert.equal(down.partial, true);
});

test("9d-only: front BELOW spot = contango, front ABOVE spot = backwardation (old code had these swapped)", () => {
  const calm = computeVixTermStructure(17.17, 13.73, null);
  assert.equal(calm.structure, "contango");
  assert.equal(calm.partial, true);
  const fear = computeVixTermStructure(20, 24, null);
  assert.equal(fear.structure, "backwardation");
  assert.equal(fear.partial, true);
});

test("no data at all is unknown", () => {
  assert.equal(computeVixTermStructure(17, null, null).structure, "unknown");
  assert.equal(computeVixTermStructure(null, null, null).structure, "unknown");
});
