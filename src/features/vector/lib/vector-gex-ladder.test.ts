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

test("buildGexLadder: a put king OUTSIDE the nearest-N band is force-retained + crowned (live SPX bug)", () => {
  // Mirror the live shape: spot sits HIGH in the chain, so the N nearest strikes all land above the
  // true put wall. SPX live: banner/chart put wall 7475 vs a panel band [7480,7675] crowning 7480.
  const totals: Record<string, number> = {};
  for (let s = 7480; s <= 7675; s += 5) totals[String(s)] = s % 2 === 0 ? 500 : -200; // 40 strikes
  totals["7475"] = -9_000; // the TRUE put king — farther from spot than all 40 above
  totals["7600"] = 8_000; // call king, inside the band
  const l = buildGexLadder(totals, 7575, { bandPct: 0.08, maxRows: 40 });

  assert.equal(l.rows.length, 40, "row cap still respected");
  const putKing = l.rows.find((r) => r.isKing && r.side === "put");
  assert.ok(putKing, "put king present");
  assert.equal(putKing!.strike, 7475, "the TRUE put wall is crowned, not the strongest-in-band");
  // The call king is unaffected and per-side kings stay unique.
  const kings = l.rows.filter((r) => r.isKing);
  assert.equal(kings.length, 2);
  assert.equal(kings.find((r) => r.side === "call")!.strike, 7600);
  // The evicted row was the farthest-from-spot NON-king (7675), never a king.
  assert.ok(!l.rows.some((r) => r.strike === 7675), "farthest non-king row evicted to make room");
  // Magnitude renormalises against the retained king (it is the new maxAbs).
  assert.equal(l.maxAbs, 9_000);
  assert.equal(putKing!.magnitude, 1);
});

test("buildGexLadder: equal-|gex| ties crown the strike nearest spot (no far-OTM tie dragged in)", () => {
  const totals: Record<string, number> = {};
  for (let s = 80; s <= 120; s += 1) totals[String(s)] = s % 2 === 0 ? 100 : -100;
  const l = buildGexLadder(totals, 100, { bandPct: 0.05, maxRows: 6 });
  // All |gex| equal → kings are the nearest call/put to spot, so nothing outside the band is
  // force-retained and every kept strike stays inside it.
  for (const r of l.rows) assert.ok(Math.abs(r.strike - 100) <= 5, `strike ${r.strike} stays in band`);
  const kings = l.rows.filter((r) => r.isKing);
  assert.equal(kings.length, 2);
  assert.equal(kings.find((r) => r.side === "call")!.strike, 100, "call tie → nearest spot");
  assert.equal(kings.find((r) => r.side === "put")!.strike, 99, "put tie → nearest spot (99 vs 101 → lower distance ties keep first-beaten winner)");
});

test("buildGexLadder: kingStrikes override crowns the CANONICAL wall, not the ladder's max-|gex|", () => {
  // Mirrors the live SPX/SPY divergence: the OI ladder's biggest |gex| per side (105 call, 90 put)
  // is NOT the wall the banner/chart/desk cite (100 call, 95 put — from the volume-adjusted / warm
  // aggregate walls). Passing those canonical strikes must move the ⚑ to them so all surfaces agree.
  const totals = { "105": 9_000, "100": 6_000, "95": -6_000, "90": -9_000 };
  const l = buildGexLadder(totals, 100, { bandPct: 0.5, kingStrikes: { call: 100, put: 95 } });
  const kings = l.rows.filter((r) => r.isKing);
  assert.equal(kings.length, 2, "still exactly one king per side");
  assert.equal(kings.find((r) => r.side === "call")!.strike, 100, "call ⚑ crowned to the canonical wall (100), not max-|gex| (105)");
  assert.equal(kings.find((r) => r.side === "put")!.strike, 95, "put ⚑ crowned to the canonical wall (95), not max-|gex| (90)");
  // DISPLAY is untouched: 105 still renders with the tallest bar (magnitude 1) — only the crown moved.
  assert.equal(l.rows.find((r) => r.strike === 105)!.magnitude, 1);
  assert.equal(l.rows.find((r) => r.strike === 105)!.isKing, false);
});

test("buildGexLadder: kingStrikes override falls back to self-crown when the strike is absent or wrong-signed", () => {
  const totals = { "105": 9_000, "100": 6_000, "95": -6_000, "90": -9_000 };
  // call override 200 isn't in the chain; put override 100 exists but is a CALL (wrong sign) — both
  // fall back to the ladder's own max-|gex| king (105 call, 90 put) so there is always one per side.
  const l = buildGexLadder(totals, 100, { bandPct: 0.5, kingStrikes: { call: 200, put: 100 } });
  const kings = l.rows.filter((r) => r.isKing);
  assert.equal(kings.length, 2);
  assert.equal(kings.find((r) => r.side === "call")!.strike, 105, "absent override → self-crowned call king");
  assert.equal(kings.find((r) => r.side === "put")!.strike, 90, "wrong-signed override → self-crowned put king");
});

test("buildGexLadder: omitting kingStrikes preserves the pure self-crowned behavior (BIE/seed path)", () => {
  const totals = { "105": 9_000, "100": 6_000, "95": -6_000, "90": -9_000 };
  const l = buildGexLadder(totals, 100, { bandPct: 0.5 });
  assert.equal(l.rows.find((r) => r.strike === 105)!.isKing, true, "call king = max-|gex| (105)");
  assert.equal(l.rows.find((r) => r.strike === 90)!.isKing, true, "put king = max-|gex| (90)");
});

test("buildGexLadder: volume-adjusted ladder crowns the wall strike that OI-only would miss (NVDA RTH regression)", () => {
  // NVDA live bug: OI-only ladder had put king at 195 while the volume-adjusted walls put the
  // wall at 205. With getHorizonStrikeTotals now using volumeAdjusted: true, the ladder data
  // includes the 205 put volume — so the kingStrikes override succeeds instead of falling back.
  // This test simulates the scenario: the volume-adjusted data has a put at 205 (from day volume)
  // that OI-only didn't see, so the override now crowns 205 as the put king.
  const volAdjusted: Record<string, number> = {
    "210": 5_000,   // call king (walls agree)
    "205": -4_000,  // put wall from volume-adjusted (wasn't present or was wrong-signed in OI-only)
    "200": 1_000,
    "195": -3_000,  // OI-only would crown this as the put king (strongest negative by OI)
  };
  const l = buildGexLadder(volAdjusted, 208, { bandPct: 0.5, kingStrikes: { call: 210, put: 205 } });
  const kings = l.rows.filter((r) => r.isKing);
  assert.equal(kings.length, 2);
  assert.equal(kings.find((r) => r.side === "call")!.strike, 210, "call king matches banner");
  assert.equal(kings.find((r) => r.side === "put")!.strike, 205, "put king matches banner (volume-adjusted wall)");
});
