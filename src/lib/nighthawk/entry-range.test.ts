import { test } from "node:test";
import assert from "node:assert/strict";
import { entryRangeMid } from "./entry-range";

test("entryRangeMid averages a legitimate tight band", () => {
  assert.equal(entryRangeMid(448, 452), 450);
});

test("entryRangeMid rejects a non-positive bound", () => {
  assert.equal(entryRangeMid(0, 452), null);
  assert.equal(entryRangeMid(-5, 452), null);
  assert.equal(entryRangeMid(448, 0), null);
});

test("entryRangeMid rejects a corrupt stray value (e.g. a '17' against a ~450 stock)", () => {
  assert.equal(entryRangeMid(17, 452), null);
});

test("entryRangeMid accepts a range right at the 20% width boundary", () => {
  // avg=100, width=20 -> exactly 20% of avg -> not > threshold, still accepted
  assert.equal(entryRangeMid(90, 110), 100);
});

test("entryRangeMid rejects a range just past the 20% width boundary", () => {
  assert.equal(entryRangeMid(89, 110), null);
});

test("entryRangeMid returns null when either bound is missing", () => {
  assert.equal(entryRangeMid(null, 452), null);
  assert.equal(entryRangeMid(448, null), null);
  assert.equal(entryRangeMid(null, null), null);
});
