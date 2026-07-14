// Run: node --import tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/sources/opening-harvest.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { baseInputs } from "../test-helpers";
import type { CortexOpeningBar, CortexOpeningSlice } from "../types";
import {
  classifyOpeningCharacter,
  deriveOpeningHarvestEvidence,
  OPENING_HARVEST_WEIGHT,
  OPENING_UNCONFIRMED_WEIGHT,
} from "./opening-harvest";

// 2026-07-13 is EDT: 9:30 ET = 13:30Z. The harvest unlocks at 9:45 ET = 13:45Z.
const AT_950_ET = "2026-07-13T13:50:00.000Z";
const AT_940_ET = "2026-07-13T13:40:00.000Z";

function bars(open: number, last: number): CortexOpeningBar[] {
  const t0 = Date.parse("2026-07-13T13:30:00Z") / 1000;
  const step = (last - open) / 14;
  return Array.from({ length: 15 }, (_, i) => {
    const o = open + step * i;
    const c = open + step * (i + 1);
    return { time: t0 + i * 60, open: o, close: c, high: Math.max(o, c) + 0.2, low: Math.min(o, c) - 0.2 };
  });
}

function opening(over: Partial<CortexOpeningSlice> = {}): CortexOpeningSlice {
  return { asOf: AT_950_ET, bars: bars(100, 101.5), priorClose: 98.5, tick: 500, add: 1200, ...over };
}

describe("opening-harvest: character classification", () => {
  test("gap up extending beyond the open => gap-and-go bullish", () => {
    const c = classifyOpeningCharacter(bars(100, 101.5), 98.5, 4); // gap +1.5 >= 1, last > open
    assert.equal(c?.shape, "gap-and-go");
    assert.equal(c?.bias, "bullish");
  });

  test("gap up reversing back through the open => gap-fade bearish", () => {
    const c = classifyOpeningCharacter(bars(100, 99.1), 98.5, 4);
    assert.equal(c?.shape, "gap-fade");
    assert.equal(c?.bias, "bearish");
  });

  test("gap down extending lower => gap-and-go bearish; fading back up => bullish", () => {
    assert.equal(classifyOpeningCharacter(bars(100, 99), 101.5, 4)?.bias, "bearish");
    assert.equal(classifyOpeningCharacter(bars(100, 100.8), 101.5, 4)?.bias, "bullish");
  });

  test("gapless open: only a >=0.25x EM drive is a character", () => {
    const drive = classifyOpeningCharacter(bars(100, 101.2), 100.1, 4); // gap 0.1 < 1; drive 1.2 >= 1
    assert.equal(drive?.shape, "opening drive");
    assert.equal(drive?.bias, "bullish");
    assert.equal(classifyOpeningCharacter(bars(100, 100.4), 100.1, 4), null); // flat: no character
  });

  test("no priorClose degrades to the drive branch (never a fabricated gap)", () => {
    const c = classifyOpeningCharacter(bars(100, 98.7), null, 4);
    assert.equal(c?.shape, "opening drive");
    assert.equal(c?.gapPts, null);
  });
});

describe("opening-harvest: evidence (B-2 gate: unlock at 9:45 ET)", () => {
  test("gap-and-go long support fixture", () => {
    const input = baseInputs({ direction: "long", now: AT_950_ET, expectedMovePts: 4, opening: opening() });
    const item = deriveOpeningHarvestEvidence(input)[0];
    assert.equal(item.stance, "supports");
    assert.equal(item.weight, OPENING_HARVEST_WEIGHT);
    assert.match(item.detail, /gap up 1\.5 pts/);
    assert.match(item.detail, /gap-and-go/);
    assert.match(item.detail, /agrees with the long/);
    // Freshness anchors to the last in-window bar (9:44 ET), not fetch time.
    assert.equal(item.asOf, "2026-07-13T13:44:00.000Z");
  });

  test("gap-fade fade-support fixture (short agrees with the faded gap)", () => {
    const input = baseInputs({
      direction: "short",
      now: AT_950_ET,
      expectedMovePts: 4,
      opening: opening({ bars: bars(100, 99.1), tick: -400, add: -900 }),
    });
    const item = deriveOpeningHarvestEvidence(input)[0];
    assert.equal(item.stance, "supports");
    assert.match(item.detail, /gap-fade/);
  });

  test("a character that fights the play opposes it", () => {
    const input = baseInputs({ direction: "short", now: AT_950_ET, expectedMovePts: 4, opening: opening() });
    const item = deriveOpeningHarvestEvidence(input)[0];
    assert.equal(item.stance, "opposes");
    assert.match(item.detail, /fights the short/);
  });

  test("unanimous internals disagreement halves the weight, visibly", () => {
    const input = baseInputs({
      direction: "long",
      now: AT_950_ET,
      expectedMovePts: 4,
      opening: opening({ tick: -300, add: -700 }), // bullish price character, both internals red
    });
    const item = deriveOpeningHarvestEvidence(input)[0];
    assert.equal(item.weight, OPENING_UNCONFIRMED_WEIGHT);
    assert.match(item.detail, /unconfirmed, half weight/);
  });

  test("pre-9:45 absent (window still forming)", () => {
    const input = baseInputs({ direction: "long", now: AT_940_ET, expectedMovePts: 4, opening: opening() });
    const item = deriveOpeningHarvestEvidence(input)[0];
    assert.equal(item.stance, "absent");
    assert.match(item.detail, /still forming/);
  });

  test("missing-bars absent", () => {
    const input = baseInputs({
      direction: "long",
      now: AT_950_ET,
      expectedMovePts: 4,
      opening: opening({ bars: [] }),
    });
    const item = deriveOpeningHarvestEvidence(input)[0];
    assert.equal(item.stance, "absent");
    assert.match(item.detail, /no minute bars/);
  });

  test("bars outside 9:30-9:45 ET are ignored (premarket/later tape is not the open)", () => {
    const lateBars = bars(100, 105).map((b) => ({ ...b, time: b.time + 3600 })); // 10:30+
    const input = baseInputs({
      direction: "long",
      now: AT_950_ET,
      expectedMovePts: 4,
      opening: opening({ bars: lateBars }),
    });
    assert.equal(deriveOpeningHarvestEvidence(input)[0].stance, "absent");
  });

  test("absent without the slice / expected move; error class surfaces", () => {
    assert.equal(deriveOpeningHarvestEvidence(baseInputs({ now: AT_950_ET }))[0].stance, "absent");
    const noEm = baseInputs({ now: AT_950_ET, opening: opening(), expectedMovePts: null });
    assert.match(deriveOpeningHarvestEvidence(noEm)[0].detail, /no expected move/);
    const failed = baseInputs({ now: AT_950_ET, errors: { "opening-harvest": "CortexSourceTimeout" } });
    assert.match(deriveOpeningHarvestEvidence(failed)[0].detail, /CortexSourceTimeout/);
  });
});
