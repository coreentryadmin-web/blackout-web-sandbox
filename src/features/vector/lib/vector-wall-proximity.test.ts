import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveWallProximity } from "./vector-wall-proximity";

const walls = {
  callWalls: [{ strike: 7600, pct: 6, gex: 3e9 }],
  putWalls: [{ strike: 7500, pct: 5, gex: -2e9 }],
};

test("returns null when spot is in open space (no level within band)", () => {
  assert.equal(deriveWallProximity({ spot: 7550, walls, gammaFlip: 7400, bandPct: 0.3 }), null);
});

test("picks the nearest level within the band — call wall above", () => {
  const p = deriveWallProximity({ spot: 7595, walls, gammaFlip: 7400, bandPct: 0.5 });
  assert.ok(p);
  assert.equal(p!.side, "call");
  assert.equal(p!.strike, 7600);
  assert.ok(p!.distancePct > 0); // above spot
  assert.match(p!.callout, /call wall/);
  assert.match(p!.callout, /sell into strength/);
});

test("put wall below → support callout", () => {
  const p = deriveWallProximity({ spot: 7505, walls, gammaFlip: 7400, bandPct: 0.5 });
  assert.ok(p);
  assert.equal(p!.side, "put");
  assert.match(p!.callout, /put wall/);
  assert.match(p!.callout, /buy weakness/);
});

test("gamma flip proximity → regime-hinge callout wins when closest", () => {
  // flip (7501, 0.013% away) is closer than the put wall (7500, 0.027%).
  const p = deriveWallProximity({
    spot: 7502,
    walls,
    gammaFlip: 7501,
    bandPct: 0.5,
  });
  assert.ok(p);
  assert.equal(p!.side, "flip");
  assert.match(p!.callout, /flips the regime/);
});

test("nearness tiers scale with distance", () => {
  const at = deriveWallProximity({ spot: 7599.5, walls, gammaFlip: 7000, bandPct: 0.6 });
  assert.equal(at!.nearness, "at");
  const near = deriveWallProximity({ spot: 7566, walls, gammaFlip: 7000, bandPct: 0.6 });
  assert.equal(near!.side, "call");
  assert.equal(near!.nearness, "near");
});

test("invalid spot → null (never fabricates a level)", () => {
  assert.equal(deriveWallProximity({ spot: null, walls, gammaFlip: 7500 }), null);
  assert.equal(deriveWallProximity({ spot: 0, walls, gammaFlip: 7500 }), null);
});
