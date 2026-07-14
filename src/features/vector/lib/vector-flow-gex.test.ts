import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFlowGexLadder } from "./vector-flow-gex";
import { buildGexLadder } from "./vector-gex-ladder";
import { FIG_SPOT_EXPOSURES, SKYLIT_FIG_POINTS } from "./vector-flow-gex.fixture";

/**
 * FLOW-GEX LENS — proves the flow-signed ladder reproduces Skylit's published $FIG board (the
 * reverse-engineered model, docs/audit/FINDINGS.md), and that it genuinely DIFFERS from the
 * canonical OI lens (which stays the default and is asserted unchanged below).
 */

test("computeFlowGexLadder: reproduces Skylit's $FIG sign pattern (5/6) + dominant strike 28", () => {
  const { strikeTotals, spot } = computeFlowGexLadder(FIG_SPOT_EXPOSURES);

  // Spot carried from the snapshot rows (`price`).
  assert.equal(spot != null && spot > 0, true);

  // Per-strike flow-signed net gamma at the 6 Skylit strikes (Σ call/put bid+ask).
  const at = (k: string) => strikeTotals[k];
  // The 5 strikes where flow matches Skylit's SIGN:
  assert.equal(Math.sign(at("25")), 1, "25 positive (Skylit +)");
  assert.equal(Math.sign(at("30")), 1, "30 positive (Skylit +)");
  assert.equal(Math.sign(at("26")), -1, "26 negative (Skylit −)");
  assert.equal(Math.sign(at("27")), -1, "27 negative (Skylit −)");
  assert.equal(Math.sign(at("28")), -1, "28 negative (Skylit −, the dominant peak)");

  // Sign-match count vs Skylit's 6 published points == 5 (22.5 is the single documented miss, a
  // snapshot-timing artifact on a 2-week-old IPO — our flow is EOD, Skylit's screenshot intraday).
  const matches = Object.entries(SKYLIT_FIG_POINTS).filter(
    ([k, sky]) => Math.sign(strikeTotals[k] ?? 0) === Math.sign(sky) && strikeTotals[k] !== 0
  );
  assert.equal(matches.length, 5, "5/6 sign match vs Skylit");
  // 22.5 is the known miss: flow reads it negative here, Skylit shows +.
  assert.equal(Math.sign(at("22.5")), -1, "22.5 is the documented single miss (negative here)");

  // Dominant strike: 28 has the largest |net GEX| across the WHOLE ladder (Skylit's ★ −8110.9 peak).
  let king = "";
  let kingAbs = -Infinity;
  for (const [k, v] of Object.entries(strikeTotals)) {
    if (Math.abs(v) > kingAbs) {
      kingAbs = Math.abs(v);
      king = k;
    }
  }
  assert.equal(king, "28", "strike 28 is the dominant (largest |GEX|) wall");

  // Least-squares scale onto Skylit ($K units): strike-28 fit should be within ~2% (findings: −1%).
  const skyStrikes = Object.keys(SKYLIT_FIG_POINTS);
  const numK = skyStrikes.reduce((a, k) => a + SKYLIT_FIG_POINTS[k]! * ((strikeTotals[k] ?? 0) / 1000), 0);
  const denK = skyStrikes.reduce((a, k) => a + ((strikeTotals[k] ?? 0) / 1000) ** 2, 0);
  const scale = numK / denK;
  const fit28 = (scale * (strikeTotals["28"] ?? 0)) / 1000;
  const err28 = Math.abs((fit28 - SKYLIT_FIG_POINTS["28"]!) / SKYLIT_FIG_POINTS["28"]!);
  assert.equal(err28 < 0.02, true, `strike-28 magnitude fit within 2% (got ${(err28 * 100).toFixed(1)}%)`);
});

test("flow lens feeds buildGexLadder: dominant put king at 28, same rendering as OI path", () => {
  const { strikeTotals, spot } = computeFlowGexLadder(FIG_SPOT_EXPOSURES);
  const ladder = buildGexLadder(strikeTotals, spot);

  // The dense ladder renders and 28 is the crowned PUT king (negative = put/support side).
  const row28 = ladder.rows.find((r) => r.strike === 28);
  assert.ok(row28, "strike 28 present in the ladder");
  assert.equal(row28!.side, "put");
  assert.equal(row28!.isKing, true);
  assert.equal(row28!.magnitude, 1, "28 is the magnitude normaliser (|gex| == maxAbs)");
  // Rows are strike-descending (shared rendering — identical to the OI ladder).
  const strikes = ladder.rows.map((r) => r.strike);
  assert.deepEqual([...strikes].sort((a, b) => b - a), strikes);
});

test("flow ≠ oi: strike 28 flips sign between lenses (call-heavy OI +, heavy-bought flow −)", () => {
  // $FIG canonical OI-lens raw per findings ($K, all POSITIVE — every strike is call-OI-heavy):
  // 22.5=+87.6  25=+821.1  26=+69.9  27=+46.4  28=+28.2  30=+669.7.
  const oiCanonical: Record<string, number> = {
    "22.5": 87.6, "25": 821.1, "26": 69.9, "27": 46.4, "28": 28.2, "30": 669.7,
  };
  const oi = buildGexLadder(oiCanonical, 23.77);
  const flow = buildGexLadder(computeFlowGexLadder(FIG_SPOT_EXPOSURES).strikeTotals, 23.77);

  const oi28 = oi.rows.find((r) => r.strike === 28)!;
  const flow28 = flow.rows.find((r) => r.strike === 28)!;
  // Same strike, opposite side between the two lenses — the entire point of the second lens.
  assert.equal(oi28.side, "call", "OI lens: 28 is call/positive (call-OI-heavy)");
  assert.equal(flow28.side, "put", "Flow lens: 28 is put/negative (heavy call BUYING today)");
  // And every OI strike here is positive (findings: static call+ on call-heavy OI can't go negative).
  for (const r of oi.rows) assert.equal(r.side, "call", `OI strike ${r.strike} stays call/positive`);
});

test("oi lens rendering is byte-identical (golden) — canonical ladder untouched by the flow work", () => {
  // Golden snapshot of the canonical OI ladder for the FIG OI map. buildGexLadder is NOT modified by
  // this feature; this pins its output so any accidental regression to the DEFAULT lens fails here.
  const oiCanonical: Record<string, number> = {
    "22.5": 87.6, "25": 821.1, "26": 69.9, "27": 46.4, "28": 28.2, "30": 669.7,
  };
  const l = buildGexLadder(oiCanonical, 23.77);
  assert.deepEqual(
    l.rows.map((r) => ({ strike: r.strike, gex: r.gex, side: r.side, isKing: r.isKing, magnitude: r.magnitude })),
    [
      { strike: 30, gex: 669.7, side: "call", isKing: false, magnitude: 669.7 / 821.1 },
      { strike: 28, gex: 28.2, side: "call", isKing: false, magnitude: 28.2 / 821.1 },
      { strike: 27, gex: 46.4, side: "call", isKing: false, magnitude: 46.4 / 821.1 },
      { strike: 26, gex: 69.9, side: "call", isKing: false, magnitude: 69.9 / 821.1 },
      { strike: 25, gex: 821.1, side: "call", isKing: true, magnitude: 1 },
      { strike: 22.5, gex: 87.6, side: "call", isKing: false, magnitude: 87.6 / 821.1 },
    ]
  );
  assert.equal(l.maxAbs, 821.1);
});

test("computeFlowGexLadder: empty / malformed input degrades to an empty ladder (never throws)", () => {
  assert.deepEqual(computeFlowGexLadder(null), { strikeTotals: {}, spot: null });
  assert.deepEqual(computeFlowGexLadder([]), { strikeTotals: {}, spot: null });
  // A row with a bad strike is skipped; a good row still lands.
  const { strikeTotals } = computeFlowGexLadder([
    { strike: "0", call_gamma_bid: "5", call_gamma_ask: "-1", put_gamma_bid: "0", put_gamma_ask: "0" },
    { strike: "abc", call_gamma_bid: "5" },
    { strike: "50", price: "10", call_gamma_bid: "100", call_gamma_ask: "-40", put_gamma_bid: "0", put_gamma_ask: "0" },
  ]);
  assert.deepEqual(Object.keys(strikeTotals), ["50"]);
  assert.equal(strikeTotals["50"], 60);
});
