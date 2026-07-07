import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crossValidateGexLevels,
  resolveNearTermExpiriesForCrossValidation,
  restFallbackAllowed,
  uwLevelsFromLadder,
  wallsFromStrikeTotals,
} from "./gex-cross-validation-core";

test("REST fallback is disallowed when the caller requires expiry scoping", () => {
  assert.equal(restFallbackAllowed(["2026-07-01", "2026-07-02"]), false);
});

test("REST fallback is allowed when no scoping is requested (back-compat, no current caller)", () => {
  assert.equal(restFallbackAllowed(undefined), true);
});

test("an empty nearTermExpiries array is treated as unscoped (REST allowed)", () => {
  assert.equal(restFallbackAllowed([]), true);
});

// Regression: two live call sites (gex-positioning.ts, gex-heatmap/route.ts) used
// `heatmap.expiries.slice(0, 8)` instead of the authoritative `near_term_expiries` field.
// On a thin-chain ticker (real near-term expiry count < 8), the post-far-merge, sorted
// `expiries` array pads the slice with far-dated monthly/quarterly columns — reintroducing
// the exact bug class resolveExpiryAxis() (polygon-options-gex.ts) was built to prevent.
test("resolveNearTermExpiriesForCrossValidation prefers the authoritative near_term_expiries field", () => {
  const hm = {
    near_term_expiries: ["2026-07-10", "2026-07-17"],
    expiries: ["2026-07-10", "2026-07-17", "2026-08-21", "2026-09-18"],
  };
  assert.deepEqual(resolveNearTermExpiriesForCrossValidation(hm), ["2026-07-10", "2026-07-17"]);
});

test("resolveNearTermExpiriesForCrossValidation: thin chain — near_term_expiries stays short, NOT padded to 8 with far-dated columns", () => {
  // A thin single-name chain: only 2 real near-term (weekly) expiries exist, then 2
  // far-dated monthlies got merged into `expiries` for the matrix's far-dated columns.
  const hm = {
    near_term_expiries: ["2026-07-10", "2026-07-17"],
    expiries: ["2026-07-10", "2026-07-17", "2026-08-21", "2026-09-18"],
  };
  const result = resolveNearTermExpiriesForCrossValidation(hm);
  assert.equal(result?.length, 2, "must NOT silently pad to 8 with the far-dated columns");
  assert.ok(!result?.includes("2026-08-21"), "far-dated monthly must not leak into the near-term scope");
});

test("resolveNearTermExpiriesForCrossValidation: legacy cached heatmap (no near_term_expiries field) falls back to the slice", () => {
  const hm = { expiries: Array.from({ length: 10 }, (_, i) => `2026-07-${10 + i}`) };
  const result = resolveNearTermExpiriesForCrossValidation(hm);
  assert.equal(result?.length, 8);
  assert.deepEqual(result, hm.expiries.slice(0, 8));
});

test("resolveNearTermExpiriesForCrossValidation: empty near_term_expiries array falls back to the slice, not an empty scope", () => {
  const hm = { near_term_expiries: [], expiries: Array.from({ length: 10 }, (_, i) => `2026-07-${10 + i}`) };
  const result = resolveNearTermExpiriesForCrossValidation(hm);
  assert.equal(result?.length, 8);
});

test("resolveNearTermExpiriesForCrossValidation: null/undefined heatmap returns undefined (unscoped)", () => {
  assert.equal(resolveNearTermExpiriesForCrossValidation(null), undefined);
  assert.equal(resolveNearTermExpiriesForCrossValidation(undefined), undefined);
});

test("wallsFromStrikeTotals picks max positive call and max negative put", () => {
  const { callWall, putWall } = wallsFromStrikeTotals({
    "700": -1e9,
    "710": 5e8,
    "720": 2e9,
    "730": -5e8,
  });
  assert.equal(callWall, 720);
  assert.equal(putWall, 700);
});

test("uwLevelsFromLadder is sign-aware — call wall is not the largest |GEX| if negative", () => {
  const ladder = new Map<number, number>([
    [700, -3e9],
    [710, 1e8],
    [720, 2e9],
    [730, -1e8],
  ]);
  const uw = uwLevelsFromLadder(ladder, 715);
  assert.equal(uw.callWall, 720);
  assert.equal(uw.putWall, 700);
  assert.notEqual(uw.callWall, 700);
});

test("crossValidateGexLevels matches when primary aligns with signed UW extrema", () => {
  const ladder = new Map<number, number>([
    [698, -2e9],
    [700, -3e9],
    [710, 1e8],
    [720, 2e9],
    [730, -1e8],
  ]);
  const result = crossValidateGexLevels(
    { callWall: 720, putWall: 700, gammaFlip: 705 },
    ladder,
    { spot: 715 }
  );
  assert.ok(result);
  assert.equal(result!.callWallMatch, true);
  assert.equal(result!.putWallMatch, true);
});

test("crossValidateGexLevels does not false-flag correct call wall vs top-|GEX| negative", () => {
  const ladder = new Map<number, number>([
    [700, -5e9],
    [720, 2e9],
    [740, -1e8],
  ]);
  const result = crossValidateGexLevels(
    { callWall: 720, putWall: 700, gammaFlip: null },
    ladder,
    { spot: 710 }
  );
  assert.ok(result);
  assert.equal(result!.callWallMatch, true);
  assert.equal(result!.putWallMatch, true);
});

test("crossValidateGexLevels respects ±2 strike tolerance", () => {
  const ladder = new Map<number, number>([
    [700, -1e9],
    [720, 2e9],
  ]);
  const ok = crossValidateGexLevels({ callWall: 722, putWall: 698, gammaFlip: null }, ladder);
  assert.ok(ok);
  assert.equal(ok!.callWallMatch, true);
  assert.equal(ok!.putWallMatch, true);

  const bad = crossValidateGexLevels({ callWall: 725, putWall: 698, gammaFlip: null }, ladder);
  assert.ok(bad);
  assert.equal(bad!.callWallMatch, false);
});

test("crossValidateGexLevels returns null for empty ladder", () => {
  assert.equal(crossValidateGexLevels({ callWall: 720, putWall: 700, gammaFlip: 710 }, new Map()), null);
});
