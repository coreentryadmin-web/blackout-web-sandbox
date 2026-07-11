import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gammaPerShare,
  gexLadderAtSpot,
  reconstructGexRail,
  yearsToExpiry,
  type ReconstructContract,
} from "./vector-gex-reconstruct";

test("gammaPerShare: peaks near ATM, decays OTM, zero on bad inputs", () => {
  const atm = gammaPerShare(100, 100, 0.05, 0.2);
  const otm = gammaPerShare(100, 130, 0.05, 0.2);
  assert.ok(atm > otm, "ATM gamma should exceed far-OTM gamma");
  assert.ok(atm > 0);
  assert.equal(gammaPerShare(0, 100, 0.05, 0.2), 0);
  assert.equal(gammaPerShare(100, 100, 0, 0.2), 0);
  assert.equal(gammaPerShare(100, 100, 0.05, 0), 0);
});

test("yearsToExpiry: positive & shrinks as expiry approaches, floored ≥ ~1min", () => {
  const far = yearsToExpiry("2026-08-15", "2026-07-10");
  const near = yearsToExpiry("2026-07-13", "2026-07-10");
  assert.ok(far > near && near > 0);
  assert.ok(yearsToExpiry("2026-07-10", "2026-07-10") > 0); // same-day floored, not zero
});

const chain: ReconstructContract[] = [
  { strike: 7550, expiry: "2026-07-13", openInterest: 5000, iv: 0.15, type: "call" },
  { strike: 7600, expiry: "2026-07-13", openInterest: 8000, iv: 0.15, type: "call" },
  { strike: 7500, expiry: "2026-07-13", openInterest: 6000, iv: 0.15, type: "put" },
  { strike: 7450, expiry: "2026-07-13", openInterest: 9000, iv: 0.15, type: "put" },
];

test("gexLadderAtSpot: calls net positive, puts net negative", () => {
  const ladder = gexLadderAtSpot(chain, 7550, "2026-07-10");
  assert.ok((ladder.get(7600) ?? 0) > 0, "call strike positive");
  assert.ok((ladder.get(7450) ?? 0) < 0, "put strike negative");
});

test("reconstructGexRail: produces a dense sample per spot point with real walls", () => {
  const spots = Array.from({ length: 20 }, (_, i) => ({ time: 1000 + i * 300, spot: 7500 + i * 5 }));
  const rail = reconstructGexRail(chain, spots, "2026-07-10");
  assert.equal(rail.length, 20, "one sample per spot point (dense)");
  for (const s of rail) {
    assert.ok(s.walls.callWalls.length > 0 || s.walls.putWalls.length > 0, "each sample has walls");
    assert.ok(Number.isFinite(s.time));
  }
});

test("reconstructGexRail: the top call wall's WEIGHT shifts as spot moves toward it (rail moves)", () => {
  // As spot climbs from 7500 toward the 7600 call wall, 7600's gamma weight rises
  // relative to 7550's — the reconstruction reflects the true spot path, not a
  // static snapshot copied across time.
  const low = gexLadderAtSpot(chain, 7500, "2026-07-10").get(7600)!;
  const high = gexLadderAtSpot(chain, 7590, "2026-07-10").get(7600)!;
  assert.ok(high > low, "7600 call GEX grows as spot approaches it");
});

test("empty/invalid inputs → empty rail, never throws or fabricates", () => {
  assert.deepEqual(reconstructGexRail([], [{ time: 1, spot: 7500 }], "2026-07-10"), []);
  assert.deepEqual(reconstructGexRail(chain, [], "2026-07-10"), []);
  assert.deepEqual(reconstructGexRail(chain, [{ time: 1, spot: 0 }], "2026-07-10"), []);
});
