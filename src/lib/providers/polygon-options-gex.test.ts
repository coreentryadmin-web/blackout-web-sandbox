import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveHeatmapPageGuard,
  computeGexEvents,
  computeMaxPainFromChain,
  type GexHistorySnapshot,
  type ChainContract,
} from "./polygon-options-gex";

function contract(
  strike: number,
  type: "call" | "put",
  openInterest: number,
  expiration: string
): ChainContract {
  return {
    details: { strike_price: strike, contract_type: type, expiration_date: expiration },
    open_interest: openInterest,
  };
}

test("defaults to 200 pages when OPTIONS_HEATMAP_PAGE_GUARD is unset", () => {
  assert.equal(resolveHeatmapPageGuard(undefined), 200);
});

test("defaults to 200 pages on a blank/non-numeric env value", () => {
  assert.equal(resolveHeatmapPageGuard(""), 200);
  assert.equal(resolveHeatmapPageGuard("not-a-number"), 200);
});

test("honors a larger env override for a venue that needs more pages", () => {
  assert.equal(resolveHeatmapPageGuard("500"), 500);
});

test("floors at 40 — the OLD cap already proven insufficient for SPX — even if env is set lower", () => {
  assert.equal(resolveHeatmapPageGuard("10"), 40);
});

test("an explicit 0 env value is falsy, so it's treated as unset (defaults to 200, not floored at 40)", () => {
  assert.equal(resolveHeatmapPageGuard("0"), 200);
});

// ── task #136: computeGexEvents — the pure diff durable persistence (gex-regime-
// events.ts) and /api/cron/gex-alerts both consume without re-deriving. ──

function snap(overrides: Partial<GexHistorySnapshot> = {}): GexHistorySnapshot {
  return { ts: 0, spot: 5000, flip: null, strike_totals: {}, ...overrides };
}

test("computeGexEvents: cold history (<2 usable snapshots) returns undefined — never fabricated", () => {
  const events = computeGexEvents([snap({ ts: 1000 })], {
    ts: 2000,
    spot: 5000,
    flip: null,
    call_wall: null,
    put_wall: null,
    total: 0,
  });
  assert.equal(events, undefined);
});

test("computeGexEvents: a real flip crossing produces flip_crossed + regime_flipped with correct level/direction/from_value/to_value; nothing else fires", () => {
  const ring = [
    snap({ ts: 1000, spot: 4990, flip: 5000, strike_totals: {} }),
    snap({ ts: 2000, spot: 4990, flip: 5000, strike_totals: {} }), // "prior" — most recent before current
  ];
  const events = computeGexEvents(ring, {
    ts: 3000,
    spot: 5010,
    flip: 5005,
    call_wall: null,
    put_wall: null,
    total: 0,
  });
  assert.ok(events);
  const flipCrossed = events!.find((e) => e.type === "flip_crossed");
  assert.ok(flipCrossed, "expected a flip_crossed event");
  assert.equal(flipCrossed!.level, 5000, "level is the PRIOR flip — the shared, stable reference");
  assert.equal(flipCrossed!.direction, "into long gamma");
  assert.equal(flipCrossed!.severity, "info");
  assert.equal(flipCrossed!.from_value, 4990, "from_value is spot BEFORE the cross");
  assert.equal(flipCrossed!.to_value, 5010, "to_value is spot AFTER the cross");

  const regimeFlipped = events!.find((e) => e.type === "regime_flipped");
  assert.ok(regimeFlipped, "expected a regime_flipped event (posture necessarily flips alongside)");
  assert.equal(regimeFlipped!.direction, "short → long");
  assert.equal(regimeFlipped!.from_value, 5000, "from_value is the PRIOR sample's own flip");
  assert.equal(regimeFlipped!.to_value, 5005, "to_value is the CURRENT sample's own flip");

  assert.equal(events!.some((e) => e.type === "wall_broken"), false, "no walls configured — must not fire");
  assert.equal(events!.some((e) => e.type === "net_gex_sign_flipped"), false, "priorTotal is 0 — must not fire");
});

test("computeGexEvents: spot staying on the same side of a stable flip produces NO spurious event row", () => {
  const ring = [
    snap({ ts: 1000, spot: 5010, flip: 5000, strike_totals: {} }),
    snap({ ts: 2000, spot: 5010, flip: 5000, strike_totals: {} }),
  ];
  const events = computeGexEvents(ring, {
    ts: 3000,
    spot: 5020,
    flip: 5000,
    call_wall: null,
    put_wall: null,
    total: 0,
  });
  assert.deepEqual(events, [], "a prior exists but nothing crossed — must be [] (never fabricated)");
});

test("computeGexEvents: spot breaking above a call wall produces wall_broken with spot before/after, isolated from flip/regime (flip null)", () => {
  const strikeTotals = { "5000": -100_000, "5050": 200_000 }; // callWall=5050, putWall=5000
  const ring = [
    snap({ ts: 1000, spot: 5040, flip: null, strike_totals: strikeTotals }),
    snap({ ts: 2000, spot: 5040, flip: null, strike_totals: strikeTotals }),
  ];
  const events = computeGexEvents(ring, {
    ts: 3000,
    spot: 5060,
    flip: null,
    call_wall: 5050,
    put_wall: 5000,
    total: 0,
  });
  assert.ok(events);
  assert.equal(events!.length, 1, "flip is null on both ends — only wall_broken should fire");
  const wallBroken = events![0]!;
  assert.equal(wallBroken.type, "wall_broken");
  assert.equal(wallBroken.level, 5050);
  assert.equal(wallBroken.direction, "above call wall");
  assert.equal(wallBroken.severity, "warn");
  assert.equal(wallBroken.from_value, 5040);
  assert.equal(wallBroken.to_value, 5060);
});

test("computeGexEvents: net GEX flipping sign produces net_gex_sign_flipped with real dollar totals before/after", () => {
  const priorTotals = { "5000": -50_000 }; // priorTotal = -50,000; putWall=5000, callWall=null
  const ring = [
    snap({ ts: 1000, spot: 6000, flip: null, strike_totals: priorTotals }),
    snap({ ts: 2000, spot: 6000, flip: null, strike_totals: priorTotals }),
  ];
  const events = computeGexEvents(ring, {
    ts: 3000,
    spot: 6000, // unchanged — never crosses the put wall at 5000
    flip: null,
    call_wall: null,
    put_wall: 5000,
    total: 30_000,
  });
  assert.ok(events);
  assert.equal(events!.length, 1, "spot never moved and flip is null — only net_gex_sign_flipped should fire");
  const flipped = events![0]!;
  assert.equal(flipped.type, "net_gex_sign_flipped");
  assert.equal(flipped.direction, "negative → positive");
  assert.equal(flipped.severity, "info");
  assert.equal(flipped.from_value, -50_000);
  assert.equal(flipped.to_value, 30_000);
});

// ── Max pain must be scoped to ONE expiry (docs/audit/FINDINGS.md) ──────────────────
// Max pain answers "at what settlement price does THIS expiry's holders collectively
// lose the most" — a question tied to one settlement date. Blending OI across two
// unrelated expiries into one pain-minimization loop produces a number that looks
// like max pain but isn't scoped to any real event. These tests prove the function is
// scope-sensitive (blending genuinely changes the answer), which is exactly why the
// buildGexHeatmapUncached call site must filter to one expiry before calling it.

test("computeMaxPainFromChain: single-expiry OI pain-minimizes to the expected strike", () => {
  // Heavy call OI at 100 (holders lose most if settlement lands above their strike as
  // it moves further ITM/away from worthless) and heavy put OI at 100 too — 100 is the
  // dominant strike, so max pain should land there.
  const contracts = [
    contract(90, "call", 500, "2026-07-10"),
    contract(100, "call", 5000, "2026-07-10"),
    contract(100, "put", 5000, "2026-07-10"),
    contract(110, "put", 500, "2026-07-10"),
  ];
  assert.equal(computeMaxPainFromChain(contracts), 100);
});

test("computeMaxPainFromChain: blending two DIFFERENT expiries' OI changes the answer — the exact bug this fix targets", () => {
  // Expiry A alone: dominant OI at 100 (unambiguous max pain = 100).
  const expiryA = [
    contract(100, "call", 5000, "2026-07-10"),
    contract(100, "put", 5000, "2026-07-10"),
  ];
  // Expiry B: a completely different, unrelated settlement date with heavy OI at 200 —
  // e.g. a monthly/quarterly expiry that happens to fall inside the same strike band
  // fetchHeatmapBand pulls (no expiration_date filter on that fetch).
  const expiryB = [
    contract(200, "call", 50_000, "2026-08-21"),
    contract(200, "put", 50_000, "2026-08-21"),
  ];
  const scopedToA = computeMaxPainFromChain(expiryA);
  const blended = computeMaxPainFromChain([...expiryA, ...expiryB]);
  assert.equal(scopedToA, 100, "scoped to its own expiry, A's max pain is unambiguous");
  assert.notEqual(
    blended,
    scopedToA,
    "blending in expiry B's much larger, unrelated OI drags the answer toward B's strike — proving the call site MUST filter by expiry before computing max pain"
  );
});

test("computeMaxPainFromChain: empty input returns null, never a fabricated strike", () => {
  assert.equal(computeMaxPainFromChain([]), null);
});
