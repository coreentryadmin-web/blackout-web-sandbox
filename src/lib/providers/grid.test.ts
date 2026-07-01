import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlausibleMover } from "./grid";

// Grid Top Movers panel showed "DISK +22,245.62%" — a Polygon data artifact from a
// thinly-traded/near-zero-price ticker, not a real market move. isPlausibleMover()
// is the sanity filter applied before movers are sorted/selected for the panel.

test("penny-price artifact with an absurd % swing is excluded", () => {
  assert.equal(isPlausibleMover({ price: 0.03, change_pct: 22245.62 }), false);
});

test("normal liquid mover is included", () => {
  assert.equal(isPlausibleMover({ price: 150, change_pct: 8.2 }), true);
});

test("a >100% single-session move on a priced stock is excluded (sanity cap)", () => {
  assert.equal(isPlausibleMover({ price: 50, change_pct: 150 }), false);
});

test("a move under the 100% cap is included", () => {
  assert.equal(isPlausibleMover({ price: 50, change_pct: 45 }), true);
});

test("price at or below $1 is excluded even with a modest % move", () => {
  assert.equal(isPlausibleMover({ price: 1, change_pct: 5 }), false);
});

test("negative change_pct beyond the cap magnitude is excluded", () => {
  assert.equal(isPlausibleMover({ price: 50, change_pct: -120 }), false);
});

test("thin volume on the same row is excluded when volume is present", () => {
  assert.equal(isPlausibleMover({ price: 50, change_pct: 10, volume: 50_000 }), false);
});

test("volume omitted (not on the row) does not trigger the volume check", () => {
  assert.equal(isPlausibleMover({ price: 50, change_pct: 10 }), true);
});
