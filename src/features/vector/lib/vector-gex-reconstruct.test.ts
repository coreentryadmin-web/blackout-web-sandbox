import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gammaFlipFromLadder,
  gammaPerShare,
  gexLadderAtSpot,
  reconstructGexRail,
  reconstructGexHeatmapGrid,
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

test("reconstructGexHeatmapGrid: dense strike×time matrix — signed cells, call+/put−", () => {
  const spots = Array.from({ length: 6 }, (_, i) => ({ time: 1000 + i * 300, spot: 7500 + i * 10 }));
  const grid = reconstructGexHeatmapGrid(chain, spots, "2026-07-10");
  // One column per spot sample; rows = the 4 chain strikes, ascending.
  assert.equal(grid.times.length, 6);
  assert.equal(grid.cells.length, 6);
  assert.deepEqual(grid.strikes, [7450, 7500, 7550, 7600]);
  for (const col of grid.cells) assert.equal(col.length, grid.strikes.length);
  // Signed: the call strikes (7550/7600) are +, the put strikes (7450/7500) are − at every column.
  const iCall = grid.strikes.indexOf(7600);
  const iPut = grid.strikes.indexOf(7450);
  for (const col of grid.cells) {
    assert.ok(col[iCall] > 0, "7600 call cell positive");
    assert.ok(col[iPut] < 0, "7450 put cell negative");
  }
  assert.ok(grid.maxAbs > 0);
});

test("reconstructGexHeatmapGrid: caps the strike axis to the heaviest strikes by peak |GEX|", () => {
  // 100 call strikes of trivial OI + the 4 heavy fixture strikes → cap keeps the heavy ones.
  const many: ReconstructContract[] = [
    ...chain,
    ...Array.from({ length: 100 }, (_, i) => ({
      strike: 8000 + i,
      expiry: "2026-07-13",
      openInterest: 1,
      iv: 0.15,
      type: "call" as const,
    })),
  ];
  const spots = [{ time: 1000, spot: 7550 }];
  const grid = reconstructGexHeatmapGrid(many, spots, "2026-07-10", 4);
  assert.equal(grid.strikes.length, 4);
  // The four fixture strikes (thousands of OI) dominate peak |GEX| over the OI=1 filler.
  assert.deepEqual(grid.strikes, [7450, 7500, 7550, 7600]);
});

test("reconstructGexHeatmapGrid: empty/invalid inputs → empty grid, never throws", () => {
  const empty = reconstructGexHeatmapGrid(chain, [], "2026-07-10");
  assert.deepEqual(empty, { times: [], strikes: [], cells: [], maxAbs: 0 });
  assert.deepEqual(reconstructGexHeatmapGrid([], [{ time: 1, spot: 7500 }], "2026-07-10"), {
    times: [],
    strikes: [],
    cells: [],
    maxAbs: 0,
  });
});

test("gammaFlipFromLadder: interpolates the single zero-crossing of cumulative net GEX", () => {
  // Cumulative low→high: 7400→-2, 7500→-2+(-1)=-3? build so the sum crosses once between two strikes.
  // Use a simple monotone-cross ladder: puts negative below, calls positive above.
  const ladder = new Map<number, number>([
    [7400, -4],
    [7500, -2], // cum: -4, -6
    [7550, 8], // cum: 2 → crossed between 7500 (-6) and 7550 (2)
    [7600, 3], // cum: 5
  ]);
  const flip = gammaFlipFromLadder(ladder, 7525)!;
  // Linear interp between 7500 (cum -6) and 7550 (cum 2): frac = 6/8 = 0.75 → 7500 + 0.75*50 = 7537.5
  assert.ok(Math.abs(flip - 7537.5) < 1e-6, `expected ~7537.5, got ${flip}`);
});

test("gammaFlipFromLadder: returns the crossing NEAREST spot, not the first from the bottom (weekly 5991 regression)", () => {
  // Reproduces the live bug: a spurious deep-OTM up-crossing far below spot PLUS the real near-spot
  // crossing. Spot 7575. Before the fix this returned the ~5990 crossing; it must return ~7470.
  const ladder = new Map<number, number>([
    [5900, -1], // cum: -1
    [6000, 3], //  cum:  2  → spurious up-crossing ~5967 (thin far-OTM noise)
    [6500, -5], // cum: -3  → back negative through the put-dominated body
    [7000, -4], // cum: -7
    [7450, -2], // cum: -9
    [7500, 6], //  cum: -3
    [7550, 8], //  cum:  5  → REAL up-crossing between 7500 (-3) and 7550 (5): 7500 + 3/8*50 = 7518.75
    [7600, 4], //  cum:  9
  ]);
  const spot = 7575;
  const flip = gammaFlipFromLadder(ladder, spot)!;
  assert.ok(flip > 7000, `flip must be the near-spot crossing, not the deep-OTM one — got ${flip}`);
  assert.ok(Math.abs(flip - 7518.75) < 1e-6, `expected ~7518.75, got ${flip}`);
  // And it must be far closer to spot than the spurious ~5967 crossing.
  assert.ok(Math.abs(flip - spot) < Math.abs(5967 - spot));
});

test("gammaFlipFromLadder: null when no up-crossing and when <2 strikes", () => {
  // All-negative cumulative (never turns net-long) → no honest flip.
  assert.equal(gammaFlipFromLadder(new Map([[7400, -1], [7500, -2], [7600, -3]]), 7500), null);
  // All-positive (starts net-long, never was short) → the running sum only ever rises, no ≤0→>0 edge.
  assert.equal(gammaFlipFromLadder(new Map([[7400, 1], [7500, 2]]), 7450) === null, false); // first strike >0 registers a crossing at the bottom strike
  assert.equal(gammaFlipFromLadder(new Map([[7500, 5]]), 7500), null); // <2 strikes
});

test("gammaFlipFromLadder: rejects implausible far-from-spot crossings (SPX weekly 5,996 artifact)", () => {
  // Ladder shaped so the running sum crosses zero deep OTM (-20% from spot) AND near spot (+6%).
  const ladder = new Map<number, number>([
    [6000, 1], // deep-OTM artifact crossing (≤0 → >0 at 6000)
    [6500, -3], // back negative
    [8000, 5], // real crossing near-ish spot
  ]);
  const spot = 7522;
  const flip = gammaFlipFromLadder(ladder, spot);
  assert.ok(flip != null && Math.abs(flip - spot) <= spot * 0.12, `flip ${flip} within plausibility band`);
  // Only-implausible-crossings ladder → null (honest no-flip), never the 20%-away artifact.
  const artifactOnly = new Map<number, number>([[6000, 1], [6500, -3], [7000, -1]]);
  assert.equal(gammaFlipFromLadder(artifactOnly, spot), null);
});

test("gexLadderAtSpot volumeAdjusted: today's volume builds walls OI can't see (mid-session births)", () => {
  const contracts = [
    { strike: 400, expiry: "2026-07-17", openInterest: 10000, dayVolume: 0, iv: 0.4, type: "call" as const },
    // brand-new wall: barely any OI (built TODAY), huge same-day volume
    { strike: 405, expiry: "2026-07-17", openInterest: 0, dayVolume: 25000, iv: 0.4, type: "call" as const },
  ];
  const oiOnly = gexLadderAtSpot(contracts, 402, "2026-07-13");
  assert.equal(oiOnly.has(405), false, "OI-only: the new strike is invisible");
  const volAdj = gexLadderAtSpot(contracts, 402, "2026-07-13", { volumeAdjusted: true });
  assert.ok((volAdj.get(405) ?? 0) > (volAdj.get(400) ?? 0), "vol-adjusted: today's flow dominates");
});

test("gexLadderAtSpot: dayVolume absent → identical to OI-only (reconstruction unchanged)", () => {
  const contracts = [{ strike: 400, expiry: "2026-07-17", openInterest: 5000, iv: 0.35, type: "put" as const }];
  const a = gexLadderAtSpot(contracts, 402, "2026-07-13");
  const b = gexLadderAtSpot(contracts, 402, "2026-07-13", { volumeAdjusted: true });
  assert.deepEqual([...a.entries()], [...b.entries()]);
});

test("flip sign safety: unsigned day-volume must not move the zero-crossing (sweep #4 N4-1)", () => {
  // Calls hold the cumulative sum positive above 400 under OI; a giant same-day put volume print
  // must NOT drag the OI-only crossing — only the volumeAdjusted ladder may see it.
  const contracts = [
    { strike: 390, expiry: "2026-07-17", openInterest: 2000, dayVolume: 50000, iv: 0.4, type: "put" as const },
    { strike: 400, expiry: "2026-07-17", openInterest: 8000, dayVolume: 0, iv: 0.4, type: "call" as const },
  ];
  const oi = gexLadderAtSpot(contracts, 401, "2026-07-13");
  const vol = gexLadderAtSpot(contracts, 401, "2026-07-13", { volumeAdjusted: true });
  // OI-only: put side small vs call side; volumeAdjusted: put side dominates.
  assert.ok(Math.abs(oi.get(390) ?? 0) < (oi.get(400) ?? 0));
  assert.ok(Math.abs(vol.get(390) ?? 0) > (vol.get(400) ?? 0));
});
