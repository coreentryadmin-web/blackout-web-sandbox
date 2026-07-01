import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crossValidateGexLevels,
  uwLevelsFromLadder,
  wallsFromStrikeTotals,
} from "./gex-cross-validation-core";

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
