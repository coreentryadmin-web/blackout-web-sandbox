import { test } from "node:test";
import assert from "node:assert/strict";
// Import the pure core from the side-effect-free module, NOT vector-dte-walls-server.ts:
// the latter is `import "server-only"`, which THROWS on a plain `tsx --test` import
// ("cannot be imported from a Client Component"). vector-dte-walls-server.ts re-exports
// perExpiryWallsFromContracts, so the runtime surface is identical — this just avoids
// tripping the server-only guard in the test runner (same pattern as vector-wall-db.test.ts).
import { perExpiryWallsFromContracts } from "./vector-dte-walls-core";
import type { ReconstructContract } from "./vector-gex-reconstruct";

// Spot ≈ 100, one call + one put per expiry across three horizons (0DTE / weekly / monthly).
const TODAY = "2026-07-13";
const SPOT = 100;
const chain: ReconstructContract[] = [
  // today's expiry (0DTE, dte 0)
  { strike: 105, expiry: "2026-07-13", openInterest: 1000, iv: 0.2, type: "call" },
  { strike: 95, expiry: "2026-07-13", openInterest: 1000, iv: 0.2, type: "put" },
  // this week (dte 4)
  { strike: 110, expiry: "2026-07-17", openInterest: 2000, iv: 0.2, type: "call" },
  { strike: 90, expiry: "2026-07-17", openInterest: 2000, iv: 0.2, type: "put" },
  // this month (dte 33)
  { strike: 115, expiry: "2026-08-15", openInterest: 3000, iv: 0.25, type: "call" },
  { strike: 85, expiry: "2026-08-15", openInterest: 3000, iv: 0.25, type: "put" },
];

test("0DTE keeps only today's-expiry contracts; walls differ from the monthly horizon", () => {
  const zero = perExpiryWallsFromContracts(chain, SPOT, "0dte", TODAY);
  const monthly = perExpiryWallsFromContracts(chain, SPOT, "monthly", TODAY);
  assert.ok(zero && monthly, "both horizons resolve walls");

  // 0DTE scopes to the single 2026-07-13 expiry → exactly one call strike + one put strike.
  const zeroStrikes = [
    ...zero!.walls.callWalls.map((w) => w.strike),
    ...zero!.walls.putWalls.map((w) => w.strike),
  ].sort((a, b) => a - b);
  assert.deepEqual(zeroStrikes, [95, 105], "0DTE keeps only today's 95/105 strikes");

  // Monthly pulls in the weekly + monthly expiries too → strictly more strikes, different walls.
  const monthlyStrikeCount = monthly!.walls.callWalls.length + monthly!.walls.putWalls.length;
  assert.ok(monthlyStrikeCount > zeroStrikes.length, "monthly spans more expiries → more strikes");
  assert.notDeepEqual(
    zero!.walls,
    monthly!.walls,
    "0DTE and monthly walls must differ over the same chain"
  );
});

test("call walls net-positive / put walls net-negative sign is preserved", () => {
  const zero = perExpiryWallsFromContracts(chain, SPOT, "0dte", TODAY);
  assert.ok(zero, "0DTE resolves walls");
  // computeGexWalls splits by net-gamma sign: the call strike above spot (105) is dealer-long
  // gamma (+) → callWalls; the put strike below spot (95) is dealer-short (−) → putWalls.
  assert.deepEqual(
    zero!.walls.callWalls.map((w) => w.strike),
    [105],
    "call strike lands in callWalls (net positive)"
  );
  assert.deepEqual(
    zero!.walls.putWalls.map((w) => w.strike),
    [95],
    "put strike lands in putWalls (net negative)"
  );
});

test("re-scopes at INDEX scale (SPX-like ~7500) — the oracle path now runs through this same core", () => {
  // Regression guard for the oracle DTE bug: SPX/SPY/QQQ were showing identical 0dte/weekly/
  // monthly walls because the UW WS ladder couldn't slice by horizon on a cold API task. The fix
  // routes oracle narrowed-horizons through this per-expiry chain core, so it must genuinely
  // narrow at index magnitudes too (not just the ~100 spot the other cases use).
  const spx = 7500;
  const spxChain: ReconstructContract[] = [
    { strike: 7575, expiry: "2026-07-13", openInterest: 5000, iv: 0.15, type: "call" }, // 0DTE
    { strike: 7425, expiry: "2026-07-13", openInterest: 5000, iv: 0.15, type: "put" },
    { strike: 7650, expiry: "2026-07-17", openInterest: 8000, iv: 0.16, type: "call" }, // weekly
    { strike: 7350, expiry: "2026-07-17", openInterest: 8000, iv: 0.16, type: "put" },
    { strike: 7800, expiry: "2026-08-15", openInterest: 12000, iv: 0.18, type: "call" }, // monthly
    { strike: 7200, expiry: "2026-08-15", openInterest: 12000, iv: 0.18, type: "put" },
  ];
  const zero = perExpiryWallsFromContracts(spxChain, spx, "0dte", TODAY);
  const monthly = perExpiryWallsFromContracts(spxChain, spx, "monthly", TODAY);
  assert.ok(zero && monthly, "both horizons resolve at index scale");
  assert.deepEqual(
    zero!.walls.callWalls.map((w) => w.strike).sort((a, b) => a - b),
    [7575],
    "0DTE keeps only today's 7575 call"
  );
  assert.notDeepEqual(zero!.walls, monthly!.walls, "SPX 0DTE vs monthly walls must differ");
});

test("honest null: empty chain, bad spot, or an all-expired horizon returns null (never blank walls)", () => {
  assert.equal(perExpiryWallsFromContracts([], SPOT, "0dte", TODAY), null, "empty chain → null");
  assert.equal(perExpiryWallsFromContracts(chain, 0, "0dte", TODAY), null, "spot ≤ 0 → null");
  // Every expiry in the past relative to `today` → expiriesForHorizon yields nothing live →
  // no scoped expiries → null (the caller then falls back to the blended near-term walls).
  const pastOnly: ReconstructContract[] = [
    { strike: 105, expiry: "2026-07-01", openInterest: 1000, iv: 0.2, type: "call" },
    { strike: 95, expiry: "2026-07-01", openInterest: 1000, iv: 0.2, type: "put" },
  ];
  assert.equal(
    perExpiryWallsFromContracts(pastOnly, SPOT, "weekly", "2026-07-13"),
    null,
    "all-expired chain → null"
  );
});
