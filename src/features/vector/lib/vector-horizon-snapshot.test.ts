import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatSnapshotClock,
  HORIZON_SNAPSHOT_STALE_MS,
  isSnapshotStale,
  nextHorizonSnapshot,
  snapshotMatches,
  type VectorHorizonCycle,
  type VectorHorizonSnapshot,
} from "./vector-horizon-snapshot";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { GexLadder } from "./vector-gex-ladder";

const WALLS: GexWalls = {
  callWalls: [{ strike: 7575, pct: 9 }],
  putWalls: [{ strike: 7475, pct: 8 }],
};
const LADDER: GexLadder = {
  spot: 7520,
  maxAbs: 100,
  rows: [
    { strike: 7575, gex: 100, side: "call", magnitude: 1, isKing: true },
    { strike: 7475, gex: -80, side: "put", magnitude: 0.8, isKing: true },
  ],
};

function okCycle(): VectorHorizonCycle {
  return {
    walls: { ok: true, value: { walls: WALLS, flip: 7500 } },
    ladder: { ok: true, value: { ladder: LADDER, spot: 7520 } },
    maxPain: { ok: true, value: 7510 },
    expectedMove: { ok: true, value: null }, // honest null: no ATM IV — still a SUCCESSFUL read
  };
}

test("nextHorizonSnapshot: a fully-ok cycle swaps in one frozen snapshot with one asOf", () => {
  const snap = nextHorizonSnapshot(null, "SPX", "weekly", okCycle(), 1_700_000_000_000);
  assert.ok(snap);
  assert.equal(snap.ticker, "SPX");
  assert.equal(snap.horizon, "weekly");
  assert.equal(snap.asOf, 1_700_000_000_000);
  assert.equal(snap.walls?.callWalls[0]?.strike, 7575);
  assert.equal(snap.flip, 7500);
  assert.equal(snap.ladder?.rows.length, 2);
  assert.equal(snap.spot, 7520);
  assert.equal(snap.maxPain, 7510);
  assert.equal(snap.expectedMove, null, "ok:true + null value = honest 'no expected move'");
  assert.ok(Object.isFrozen(snap), "snapshot is frozen — no surface can half-update it in place");
  try {
    (snap as { maxPain: number | null }).maxPain = 1;
  } catch {
    /* strict-mode contexts throw; either way the write must not land */
  }
  assert.equal(snap.maxPain, 7510, "mutation of the shared story never lands");
});

test("nextHorizonSnapshot: ATOMIC — a partial failure keeps the PREVIOUS snapshot untouched", () => {
  const prev = nextHorizonSnapshot(null, "SPX", "weekly", okCycle(), 1000)!;
  const cycle = okCycle();
  cycle.maxPain = { ok: false, value: null }; // one endpoint blipped this cycle
  const next = nextHorizonSnapshot(prev, "SPX", "weekly", cycle, 2000);
  assert.equal(next, prev, "same reference — coherent old story beats a mixed-instant patch");
  assert.equal(next!.asOf, 1000, "asOf honestly stays the old cycle's stamp");
});

test("nextHorizonSnapshot: partial failure with NO usable prev builds a coherent partial (one instant)", () => {
  const cycle = okCycle();
  cycle.walls = { ok: false, value: null };
  const snap = nextHorizonSnapshot(null, "NVDA", "0dte", cycle, 3000);
  assert.ok(snap);
  assert.equal(snap.walls, null, "failed part is honestly null");
  assert.equal(snap.flip, null);
  assert.equal(snap.ladder?.rows.length, 2, "succeeded parts present");
  assert.equal(snap.maxPain, 7510);
  assert.equal(snap.asOf, 3000, "everything shown stamps THIS cycle's instant");
});

test("nextHorizonSnapshot: horizon/ticker switch INVALIDATES prev — never resurrected for the new key", () => {
  const prev = nextHorizonSnapshot(null, "SPX", "weekly", okCycle(), 1000)!;
  const cycle = okCycle();
  cycle.ladder = { ok: false, value: null };
  // Member toggled weekly → 0dte; the weekly snapshot must not be returned for the 0dte key even
  // though this first 0dte cycle is partial.
  const next = nextHorizonSnapshot(prev, "SPX", "0dte", cycle, 2000);
  assert.notEqual(next, prev);
  assert.equal(next!.horizon, "0dte");
  assert.equal(next!.ladder, null);
  assert.equal(next!.walls?.callWalls[0]?.strike, 7575);
});

test("snapshotMatches: keys on BOTH ticker and horizon", () => {
  const snap = nextHorizonSnapshot(null, "SPX", "weekly", okCycle(), 1000);
  assert.equal(snapshotMatches(snap, "SPX", "weekly"), true);
  assert.equal(snapshotMatches(snap, "SPX", "0dte"), false);
  assert.equal(snapshotMatches(snap, "NVDA", "weekly"), false);
  assert.equal(snapshotMatches(null, "SPX", "weekly"), false);
});

test("isSnapshotStale: boundary at maxAge; null is always stale", () => {
  const snap = nextHorizonSnapshot(null, "SPX", "weekly", okCycle(), 10_000)!;
  assert.equal(isSnapshotStale(snap, 10_000 + HORIZON_SNAPSHOT_STALE_MS), false, "exactly at cap — fresh");
  assert.equal(isSnapshotStale(snap, 10_001 + HORIZON_SNAPSHOT_STALE_MS), true, "past cap — stale");
  assert.equal(isSnapshotStale(null, 0), true);
});

test("formatSnapshotClock: renders the shared stamp as ET with seconds", () => {
  // 2026-07-13T18:32:15Z = 2:32:15 PM ET (EDT).
  const label = formatSnapshotClock(Date.UTC(2026, 6, 13, 18, 32, 15));
  assert.equal(label, "2:32:15 PM");
});
