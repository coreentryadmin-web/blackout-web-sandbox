import test from "node:test";
import assert from "node:assert/strict";
import {
  scaledPlaybookGapPct,
  scaledPlaybookMtfBufferPts,
  scaledPlaybookStructureProximityPts,
} from "./playbook-volatility-scale";
import type { SpxDeskPayload } from "./spx-desk";
import type { PlayTechnicals } from "./spx-play-technicals";

const DESK = {
  price: 5400,
  vix: 28,
} as SpxDeskPayload;

const TECH = {
  available: true,
  or_defined: true,
  or_high: 5410,
  or_low: 5385,
} as PlayTechnicals;

test("scaledPlaybookMtfBufferPts: scales up with VIX and wide OR", () => {
  const buf = scaledPlaybookMtfBufferPts(DESK, TECH);
  assert.ok(buf > 1);
  assert.ok(buf <= 4);
});

test("scaledPlaybookStructureProximityPts: scales with VIX", () => {
  const calm = scaledPlaybookStructureProximityPts({ ...DESK, vix: 12 } as SpxDeskPayload);
  const hot = scaledPlaybookStructureProximityPts(DESK);
  assert.ok(hot > calm);
});

test("scaledPlaybookGapPct: high VIX widens gap threshold", () => {
  const base = 0.35;
  const calm = scaledPlaybookGapPct({ ...DESK, vix: 12 } as SpxDeskPayload, base);
  const hot = scaledPlaybookGapPct(DESK, base);
  assert.ok(hot > calm);
});
