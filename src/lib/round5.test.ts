import { test } from "node:test";
import assert from "node:assert/strict";
import { round5, clamp } from "./round5";

// round5 feeds SPX strike sizing — assert the exact rounding contract the
// duplicated copies had. Run: npx tsx --test src/lib/round5.test.ts

test("round5 rounds to nearest multiple of 5", () => {
  assert.equal(round5(0), 0);
  assert.equal(round5(5), 5);
  assert.equal(round5(4), 5);
  assert.equal(round5(2), 0);
  assert.equal(round5(2.5), 5);
  assert.equal(round5(7.4), 5);
  assert.equal(round5(7.5), 10);
  assert.equal(round5(5432.1), 5430);
  assert.equal(round5(5433), 5435);
});

test("round5 handles negatives like the originals", () => {
  assert.equal(round5(-3), -5);
  assert.equal(round5(-7.5), -5);
});

test("clamp bounds n into [min, max]", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(0, 0, 10), 0);
  assert.equal(clamp(10, 0, 10), 10);
});
