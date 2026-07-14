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

// The live FIG shape @ spot 23.2 (see docs/audit/FINDINGS.md GEX-vs-Skylit forensic). Real
// recomputed net-GEX per strike — the fat call wall at 30 (OI 47k → +$648K) and the true put wall
// at 17.5 (−$323K) both sit well outside a tight near-money window. Shared by the density tests.
const FIG_SPOT = 23.2;
const FIG_TOTALS: Record<string, number> = {
  "30": 648_000, "27": 46_000, "26": 68_000, "25.5": 2_000, "25": 832_000,
  "24.5": 11_000, "24": 157_000, "23.5": 37_000, "23": 212_000, "22.5": 83_000,
  "22": 125_000, "21.5": 31_000, "21": 400, "20.5": -10_000, "20": -174_000,
  "19.5": 12_000, "19": -10_000, "18": -20_000, "17.5": -323_000, "17": 19_000,
};

test("buildGexLadder: DENSE coverage — every material strike renders on the default ladder (FIG)", () => {
  // The product ask: show ALL strikes like Skylit, keep our canonical numbers. With the wide default
  // display band (0.50) + high row cap (200), the whole fetched FIG chain renders — not the ~11
  // strikes the old ±8% window + 40-row cap left. Nothing here is banded away.
  const l = buildGexLadder(FIG_TOTALS, FIG_SPOT); // defaults: bandPct 0.50, maxRows 200, keepPerSide 3

  // EVERY strike in the map renders (20/20) — full chain density, no silent drops.
  assert.equal(l.rows.length, Object.keys(FIG_TOTALS).length, "all 20 material strikes render");
  const strikes = new Set(l.rows.map((r) => r.strike));
  for (const k of Object.keys(FIG_TOTALS)) {
    assert.ok(strikes.has(Number(k)), `strike ${k} present in the dense ladder`);
  }
  // The specific strikes the member said were missing vs Skylit are now all present.
  for (const s of [30, 27, 26, 20, 18, 17.5, 17]) {
    assert.ok(strikes.has(s), `previously-dropped strike ${s} now renders`);
  }

  // Ordering stays strike-descending (price-axis order).
  const ordered = l.rows.map((r) => r.strike);
  assert.deepEqual(ordered, [...ordered].sort((a, b) => b - a), "rows stay strike-descending");

  // Wall markers correct on the dense set: exactly one king per side, at the true walls.
  const kings = l.rows.filter((r) => r.isKing);
  assert.equal(kings.length, 2, "exactly one king per side");
  assert.equal(kings.find((r) => r.side === "call")!.strike, 25, "call king = strongest call (25)");
  assert.equal(kings.find((r) => r.side === "put")!.strike, 17.5, "put king = TRUE put wall (17.5)");
  // −GEX peak (most-negative displayed row) is the true put wall, not a near-spot band edge.
  const minRow = l.rows.reduce((a, b) => (b.gex < a.gex ? b : a));
  assert.equal(minRow.strike, 17.5, "−GEX peak is 17.5, not a band-edge artifact");
});

test("buildGexLadder: DENSE ladder keeps CANONICAL values — existing strikes' gex + magnitude unchanged", () => {
  // The ONLY thing density changes is COVERAGE. Every strike that appeared before must keep the
  // EXACT same signed dollar-gamma and the exact same magnitude (|gex|/maxAbs). We prove it by
  // diffing the dense default ladder against a narrow-band ladder (the pre-density behaviour): every
  // strike common to both carries identical numbers — only NEW strikes are added by the wider band.
  const dense = buildGexLadder(FIG_TOTALS, FIG_SPOT);
  const narrow = buildGexLadder(FIG_TOTALS, FIG_SPOT, { bandPct: 0.08, maxRows: 40 });

  const denseByStrike = new Map(dense.rows.map((r) => [r.strike, r]));
  assert.ok(narrow.rows.length < dense.rows.length, "the narrow ladder really is sparser (density increased)");
  // maxAbs (the magnitude normaliser) is identical — the king is retained in both, so no strike's
  // bar/intensity shifts when the ladder gets denser.
  assert.equal(dense.maxAbs, narrow.maxAbs, "maxAbs unchanged → magnitudes are on the same scale");
  for (const nr of narrow.rows) {
    const dr = denseByStrike.get(nr.strike);
    assert.ok(dr, `strike ${nr.strike} still present in the dense ladder`);
    assert.equal(dr!.gex, nr.gex, `strike ${nr.strike} keeps identical signed net-GEX`);
    assert.equal(dr!.side, nr.side, `strike ${nr.strike} keeps identical side`);
    assert.equal(dr!.magnitude, nr.magnitude, `strike ${nr.strike} keeps identical magnitude`);
  }
  // And every dense row's gex equals the raw canonical map value — the formula is untouched.
  for (const r of dense.rows) {
    assert.equal(r.gex, FIG_TOTALS[String(r.strike)], `strike ${r.strike} gex == canonical map value`);
  }
});

test("buildGexLadder: dense band spans deep OTM both sides — 12.5 put through 30+ call all render", () => {
  // A wider-chain fixture (the member's actual complaint: strikes 28/29/30 above and everything
  // below 17.5 were skipped). With the dense defaults a chain spanning 12.5 → 34 all renders when
  // the strikes carry real OI — the "dense where there's real OI" Skylit parity, in one ladder.
  const wide: Record<string, number> = {
    "34": 90_000, "33": 40_000, "32": 55_000, "31": 70_000, "30": 648_000, "29": 120_000,
    "28": 210_000, "26": 68_000, "25": 832_000, "24": 157_000, "23": 212_000, "22": 125_000,
    "21": 90_000, "20": -174_000, "18": -20_000, "17.5": -323_000, "15": -60_000, "12.5": -40_000,
  };
  const l = buildGexLadder(wide, 24);
  const strikes = new Set(l.rows.map((r) => r.strike));
  for (const s of [28, 29, 30, 31, 32, 33, 34, 17.5, 15, 12.5]) {
    assert.ok(strikes.has(s), `strike ${s} renders (dense both-sided coverage)`);
  }
  assert.equal(l.rows.length, Object.keys(wide).length, "the whole wide chain renders, no drops");
  // Ordering + one-king-per-side still hold on the wide set.
  const ordered = l.rows.map((r) => r.strike);
  assert.deepEqual(ordered, [...ordered].sort((a, b) => b - a), "strike-descending");
  assert.equal(l.rows.filter((r) => r.isKing).length, 2, "one king per side");
  assert.equal(l.rows.find((r) => r.isKing && r.side === "call")!.strike, 25, "call king 25");
  assert.equal(l.rows.find((r) => r.isKing && r.side === "put")!.strike, 17.5, "put king 17.5");
});

test("buildGexLadder: keepPerSide=1 + narrow band reproduces the old single-king retain (runner-ups dropped)", () => {
  // Regression guard for the #345 top-N-per-side retain: with an explicit NARROW band (±8%) and
  // keepPerSide=1 only the king per side is force-retained, so a fat out-of-band runner-up wall is
  // dropped — the exact pre-#345 behaviour. (The band must be passed explicitly now that the default
  // is wide; the whole point of the new default is that 30 is NO LONGER out of band.)
  const fig: Record<string, number> = {
    "30": 648_000, "25": 832_000, "24": 157_000, "23": 212_000, "22": 125_000, "17.5": -323_000, "20": -174_000,
  };
  const l = buildGexLadder(fig, 23.2, { keepPerSide: 1, bandPct: 0.08 });
  const strikes = new Set(l.rows.map((r) => r.strike));
  assert.ok(!strikes.has(30), "with keepPerSide=1 + ±8% band the out-of-band call runner-up 30 is dropped");
  assert.ok(strikes.has(25), "call king still retained");
  assert.ok(strikes.has(17.5), "put king still retained");
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
