import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveGammaMagnet } from "./vector-gamma-magnet";
import type { VectorWalls } from "@/lib/api";

const walls: VectorWalls = {
  callWalls: [
    { strike: 7600, pct: 100 },
    { strike: 7650, pct: 40 },
  ],
  putWalls: [
    { strike: 7500, pct: 80 },
    { strike: 7450, pct: 20 },
  ],
};

test("deriveGammaMagnet: strength-weighted center of mass of the walls", () => {
  const m = deriveGammaMagnet({ spot: 7550, walls, posture: "long" });
  assert.ok(m);
  // (7600*100 + 7650*40 + 7500*80 + 7450*20) / 240 = 1,815,000 / 240 = 7562.5
  assert.equal(m!.strike, 7562.5);
  assert.equal(m!.pull, "up", "magnet sits above spot 7550");
  assert.ok(m!.distancePct > 0);
});

test("deriveGammaMagnet: LONG gamma phrases it as a magnet/pin", () => {
  const m = deriveGammaMagnet({ spot: 7550, walls, posture: "long" });
  assert.match(m!.callout, /gamma magnet/);
  assert.match(m!.callout, /pull(s)? spot up/);
});

test("deriveGammaMagnet: SHORT gamma phrases the SAME level as a pivot (no false pin claim)", () => {
  const m = deriveGammaMagnet({ spot: 7550, walls, posture: "short" });
  assert.equal(m!.strike, 7562.5, "same center of mass regardless of posture");
  assert.match(m!.callout, /gamma pivot/);
  assert.doesNotMatch(m!.callout, /magnet|pin/, "must NOT claim a pin in short gamma");
});

test("deriveGammaMagnet: 'at' when spot sits on the magnet (within dead-band)", () => {
  const m = deriveGammaMagnet({ spot: 7562.5, walls, posture: "long" });
  assert.equal(m!.pull, "at");
  assert.match(m!.callout, /pinned/);
});

test("deriveGammaMagnet: unknown posture → neutral center-of-mass phrasing", () => {
  const m = deriveGammaMagnet({ spot: 7550, walls });
  assert.equal(m!.posture, "unknown");
  assert.match(m!.callout, /center of mass/);
});

test("deriveGammaMagnet: null on no spot / no walls / zero-weight walls — never fabricates", () => {
  assert.equal(deriveGammaMagnet({ spot: 0, walls, posture: "long" }), null);
  assert.equal(deriveGammaMagnet({ spot: 7550, walls: null }), null);
  assert.equal(deriveGammaMagnet({ spot: 7550, walls: { callWalls: [], putWalls: [] } }), null);
  assert.equal(
    deriveGammaMagnet({ spot: 7550, walls: { callWalls: [{ strike: 7600, pct: 0 }], putWalls: [] } }),
    null,
    "zero total strength → no honest magnet"
  );
});
