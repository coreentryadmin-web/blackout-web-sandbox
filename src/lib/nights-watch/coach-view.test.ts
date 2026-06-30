import assert from "node:assert/strict";
import test from "node:test";
import { isSpxFamily, holdsSpxFamily, resolveCoachView } from "./coach-view";

test("isSpxFamily recognises SPX-family roots case/space-insensitively", () => {
  assert.equal(isSpxFamily("SPX"), true);
  assert.equal(isSpxFamily("spx"), true);
  assert.equal(isSpxFamily(" SPXW "), true);
  assert.equal(isSpxFamily("SPY"), false);
  assert.equal(isSpxFamily("NVDA"), false);
  assert.equal(isSpxFamily(null), false);
  assert.equal(isSpxFamily(undefined), false);
  assert.equal(isSpxFamily(""), false);
});

test("holdsSpxFamily is true only when an SPX-family ticker is present", () => {
  assert.equal(holdsSpxFamily(["NVDA", "AAPL"]), false);
  assert.equal(holdsSpxFamily(["NVDA", "SPX"]), true);
  assert.equal(holdsSpxFamily(["spxw"]), true);
  assert.equal(holdsSpxFamily([]), false);
  assert.equal(holdsSpxFamily([null, undefined]), false);
});

test("resolveCoachView hides the coach entirely when there are no open positions", () => {
  // The bug: with no open positions the user saw the global SPX coaching feed (random data).
  assert.equal(resolveCoachView(false, false), "hidden");
  // holdsSpx is irrelevant when there is no open book.
  assert.equal(resolveCoachView(false, true), "hidden");
});

test("resolveCoachView shows SPX coaching only when holding an SPX-family position", () => {
  assert.equal(resolveCoachView(true, true), "spx-alerts");
});

test("resolveCoachView shows a position-grounded note for non-SPX open positions", () => {
  assert.equal(resolveCoachView(true, false), "position-note");
});
