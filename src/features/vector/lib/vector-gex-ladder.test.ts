import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGexLadder } from "./vector-gex-ladder";

test("buildGexLadder: signs, king per side, magnitude normalisation, descending order", () => {
  const totals = { "100": 2_000, "105": 500, "95": -4_000, "90": -1_000 };
  const l = buildGexLadder(totals, 100, { bandPct: 0.2 });

  // Descending by strike (highest on top, like a price axis).
  assert.deepEqual(l.rows.map((r) => r.strike), [105, 100, 95, 90]);
  // Sign convention: positive net GEX → call, negative → put.
  assert.equal(l.rows.find((r) => r.strike === 100)!.side, "call");
  assert.equal(l.rows.find((r) => r.strike === 95)!.side, "put");
  // maxAbs is the largest |gex| (the 95 put at 4000).
  assert.equal(l.maxAbs, 4_000);
  assert.equal(l.rows.find((r) => r.strike === 100)!.magnitude, 2_000 / 4_000);
  // King per side: strongest call (100) and strongest put (95); the others are not kings.
  assert.equal(l.rows.find((r) => r.strike === 100)!.isKing, true);
  assert.equal(l.rows.find((r) => r.strike === 95)!.isKing, true);
  assert.equal(l.rows.find((r) => r.strike === 105)!.isKing, false);
  assert.equal(l.rows.find((r) => r.strike === 90)!.isKing, false);
});

test("buildGexLadder: bands around spot and caps to the nearest maxRows", () => {
  const totals: Record<string, number> = {};
  for (let s = 80; s <= 120; s += 1) totals[String(s)] = s % 2 === 0 ? 100 : -100;
  // ±5% band around 100 = [95,105]; then keep the 6 nearest spot.
  const l = buildGexLadder(totals, 100, { bandPct: 0.05, maxRows: 6 });
  assert.equal(l.rows.length, 6);
  // Every kept strike is inside the band and among the nearest to spot.
  for (const r of l.rows) assert.ok(Math.abs(r.strike - 100) <= 5, `strike ${r.strike} in band`);
  const strikes = l.rows.map((r) => r.strike);
  assert.ok(strikes.includes(100) && strikes.includes(101) && strikes.includes(99), "nearest kept");
  assert.ok(!strikes.includes(80) && !strikes.includes(120), "far strikes dropped");
});

test("buildGexLadder: drops zero-gex and non-finite strikes", () => {
  const totals = { "100": 0, "101": 1_000, "abc": 5_000, "102": -2_000 } as Record<string, number>;
  const l = buildGexLadder(totals, 101, { bandPct: 0.5 });
  assert.deepEqual(l.rows.map((r) => r.strike), [102, 101]);
});

test("buildGexLadder: band excluding everything falls back to unbanded (never blank)", () => {
  // Spot 500 far from a chain clustered at 100 — the ±8% band excludes all strikes.
  const totals = { "100": 1_000, "105": -2_000 };
  const l = buildGexLadder(totals, 500, { bandPct: 0.08 });
  assert.equal(l.rows.length, 2, "falls back to the unbanded set instead of blanking");
});

test("buildGexLadder: empty / missing input yields an empty ladder, never throws", () => {
  assert.deepEqual(buildGexLadder(null, 100), { spot: 100, rows: [], maxAbs: 0 });
  assert.deepEqual(buildGexLadder({}, 100), { spot: 100, rows: [], maxAbs: 0 });
});

test("buildGexLadder: no spot → keeps the strongest maxRows by |gex|", () => {
  const totals = { "100": 100, "105": 5_000, "95": -9_000, "110": 200 };
  const l = buildGexLadder(totals, null, { maxRows: 2 });
  const strikes = new Set(l.rows.map((r) => r.strike));
  assert.ok(strikes.has(95) && strikes.has(105), "strongest two kept");
  assert.equal(l.rows.length, 2);
});
