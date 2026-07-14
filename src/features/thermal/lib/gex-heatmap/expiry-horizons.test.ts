import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMonthlyExpiry, splitExpiryHorizons } from "./expiry-horizons";

describe("isMonthlyExpiry", () => {
  it("is true for the 3rd Friday (standard/quarterly OpEx)", () => {
    assert.equal(isMonthlyExpiry("2026-07-17"), true); // July 2026 3rd Friday
    assert.equal(isMonthlyExpiry("2026-09-18"), true); // Sept 2026 quarterly OpEx
  });
  it("is false for non-3rd-Friday dates and malformed input", () => {
    assert.equal(isMonthlyExpiry("2026-07-10"), false); // 2nd Friday weekly
    assert.equal(isMonthlyExpiry("2026-07-16"), false); // Thursday
    assert.equal(isMonthlyExpiry("garbage"), false);
    assert.equal(isMonthlyExpiry(""), false);
  });
});

describe("splitExpiryHorizons — server near_term_expiries is authoritative", () => {
  // The live P1 (2026-07-14): the server's near set INCLUDES the 3rd-Friday July OpEx 07-17
  // (it's one of the ~8 nearest kept expiries and carries the dominant near GEX). The old client
  // heuristic reclassified 07-17 as "far/monthly" by calendar and dropped it from the near
  // aggregate, flipping the "Near" net sign vs the server's Net. This is the regression guard.
  const expiries = [
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17", // 3rd Friday — server counts it as NEAR
    "2026-08-21", // 3rd Friday — far/monthly OpEx
    "2026-09-18", // 3rd Friday — far/quarterly OpEx
  ];
  const nearTermExpiries = [
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
  ];

  it("keeps a 3rd-Friday date in the NEAR set when the server counts it as near", () => {
    const { nearExpiries, farExpiries } = splitExpiryHorizons(expiries, nearTermExpiries);
    // 07-17 is a 3rd Friday but the server puts it in near_term_expiries → it MUST stay near,
    // NOT be dropped into the monthly/far bucket by the calendar heuristic.
    assert.ok(nearExpiries.includes("2026-07-17"), "07-17 must remain in the near set");
    assert.ok(!farExpiries.includes("2026-07-17"), "07-17 must NOT be classified far");
    assert.deepEqual(nearExpiries, [
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ]);
    assert.deepEqual(farExpiries, ["2026-08-21", "2026-09-18"]);
  });

  it("the NEAR total sign matches the server's near sum (not the heuristic subset)", () => {
    // Per-expiry net GEX. The near OpEx column 07-17 dominates and is NEGATIVE (dealers net
    // short), while the small weeklies are mildly positive. Summing the SERVER near set yields a
    // net-SHORT (negative) total; the old heuristic would have excluded 07-17 → net-LONG
    // (positive) — the exact wrong-sign bug members saw.
    const perExpiryNet: Record<string, number> = {
      "2026-07-14": 50,
      "2026-07-15": 40,
      "2026-07-16": 30,
      "2026-07-17": -580, // dominant near OpEx, net short
      "2026-08-21": 900, // far — not part of near Net
      "2026-09-18": 1200, // far — not part of near Net
    };
    const { nearExpiries } = splitExpiryHorizons(expiries, nearTermExpiries);

    const serverNearSum = nearTermExpiries.reduce((s, e) => s + perExpiryNet[e], 0);
    const clientNearSum = nearExpiries.reduce((s, e) => s + perExpiryNet[e], 0);

    // Client near aggregate equals the server's near sum, and both are NEGATIVE (net short).
    assert.equal(clientNearSum, serverNearSum);
    assert.ok(clientNearSum < 0, "server-aligned near sum is net-SHORT (negative)");

    // Regression: the OLD calendar heuristic would have dropped 07-17, flipping the sign positive.
    const heuristicNear = expiries.filter((e) => !isMonthlyExpiry(e));
    const heuristicNearSum = heuristicNear.reduce((s, e) => s + perExpiryNet[e], 0);
    assert.ok(heuristicNearSum > 0, "old heuristic subset flips to net-LONG (the bug)");
    assert.notEqual(Math.sign(heuristicNearSum), Math.sign(serverNearSum));
  });

  it("does not double-count a near 3rd-Friday into the Monthly total", () => {
    const { farExpiries } = splitExpiryHorizons(expiries, nearTermExpiries);
    // "Monthly" preset sums only farExpiries — 07-17 (near) must be absent so Monthly + Near
    // don't both include it.
    assert.deepEqual(farExpiries, ["2026-08-21", "2026-09-18"]);
  });
});

describe("splitExpiryHorizons — legacy fallback (no server near set)", () => {
  const expiries = ["2026-07-14", "2026-07-17", "2026-08-21"];

  it("falls back to the 3rd-Friday calendar heuristic when near_term_expiries is absent", () => {
    for (const nt of [undefined, null, []] as const) {
      const { nearExpiries, farExpiries } = splitExpiryHorizons(expiries, nt);
      assert.deepEqual(nearExpiries, ["2026-07-14"]);
      assert.deepEqual(farExpiries, ["2026-07-17", "2026-08-21"]);
    }
  });

  it("preserves input order in both buckets", () => {
    const { nearExpiries } = splitExpiryHorizons(
      ["2026-07-16", "2026-07-14", "2026-07-15"],
      ["2026-07-16", "2026-07-14", "2026-07-15"]
    );
    assert.deepEqual(nearExpiries, ["2026-07-16", "2026-07-14", "2026-07-15"]);
  });
});
