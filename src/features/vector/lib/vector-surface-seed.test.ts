import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveVectorSurfaceSeed } from "./vector-surface-seed";
import { deriveVectorRegime } from "./vector-regime";
import { deriveGammaMagnet } from "./vector-gamma-magnet";
import type { VectorWalls } from "@/lib/api";

const walls: VectorWalls = {
  callWalls: [
    { strike: 7550, pct: 0.9 },
    { strike: 7600, pct: 0.4 },
  ],
  putWalls: [
    { strike: 7450, pct: 0.8 },
    { strike: 7400, pct: 0.3 },
  ],
} as unknown as VectorWalls;

test("deriveVectorSurfaceSeed: regime matches a standalone deriveVectorRegime on the same inputs", () => {
  const spot = 7500;
  const gammaFlip = 7480;
  const seed = deriveVectorSurfaceSeed({ spot, gammaFlip, walls });
  const direct = deriveVectorRegime({
    spot,
    gammaFlip,
    topCallWall: 7550,
    topPutWall: 7450,
  });
  // The seed's banner regime is the ONE canonical derivation — byte-identical to deriving it
  // directly from the same flip. (If a second flip source ever crept in, these would diverge.)
  assert.deepEqual(seed.regime, direct);
});

test("deriveVectorSurfaceSeed: magnet posture is the SAME regime the banner shows (one flip)", () => {
  const spot = 7500;
  const gammaFlip = 7480; // spot ABOVE flip → long-gamma posture
  const seed = deriveVectorSurfaceSeed({ spot, gammaFlip, walls });
  // The magnet must be seeded from the banner's regime posture, not a re-derivation. Rebuild the
  // magnet from the seed's own regime.posture and assert equality — proving the single-source wiring.
  const expectedMagnet = deriveGammaMagnet({ spot, walls, posture: seed.regime.posture });
  assert.deepEqual(seed.magnet, expectedMagnet);
  // And flipping spot below the flip flips the posture that feeds the magnet — the two move together.
  const below = deriveVectorSurfaceSeed({ spot: 7460, gammaFlip, walls });
  assert.notEqual(below.regime.posture, seed.regime.posture);
});

test("deriveVectorSurfaceSeed: null spot/flip yields the honest empty seed, never throws", () => {
  const seed = deriveVectorSurfaceSeed({ spot: null, gammaFlip: null, walls: null });
  // Regime degrades to its neutral read; the wall-derived surfaces are null; nothing throws.
  assert.ok(typeof seed.regime.read === "string");
  assert.equal(seed.proximity, null);
  assert.equal(seed.magnet, null);
  assert.deepEqual(seed.wallIntegrity, { call: null, put: null });
});

test("deriveVectorSurfaceSeed: proximity + integrity are populated when walls + spot are present", () => {
  const seed = deriveVectorSurfaceSeed({ spot: 7500, gammaFlip: 7480, walls });
  assert.ok(seed.proximity !== null, "nearest-wall proximity derived from the shared walls");
  assert.ok(
    seed.wallIntegrity.call !== null || seed.wallIntegrity.put !== null,
    "integrity scored from the shared walls"
  );
});
