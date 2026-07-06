import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveHeatmapPageGuard,
  computeGexEvents,
  computeMaxPainFromChain,
  resolveExpiryAxis,
  computeZeroGammaFlip,
  computeCharmRegime,
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

test("fetchGexHeatmap keeps stale-while-revalidate during preset fast-move (no blocking guard)", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "polygon-options-gex.ts"),
    "utf8"
  );
  assert.doesNotMatch(
    src,
    /if\s*\(\s*!fastMove\s*\)\s*\{[\s\S]*?tryStaleWhileRevalidateHeatmap/,
    "fast-move must not disable SWR — TTL-boundary misses would block member GETs"
  );
  assert.match(src, /const stale = tryStaleWhileRevalidateHeatmap\(/);
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

// ── computeZeroGammaFlip: the primary per-strike crossing detector only matched
// neg→pos sign transitions, making it structurally blind to pos→neg crossings — which are
// just as common on real, lumpy per-strike gamma profiles and can legitimately be the one
// nearest spot. Live-verified against real SPY/QQQ chains (see FINDINGS.md): the code's
// answer was measurably farther from spot than the true nearest crossing on every metric
// checked (GEX flip, DEX/CHARM zero_level) whenever the true nearest crossing ran pos→neg.

test("computeZeroGammaFlip: finds a neg→pos crossing (already worked pre-fix)", () => {
  const strikeTotals = { "95": -50, "105": 150 }; // crosses zero at 95 + 10*(50/200) = 97.5
  assert.equal(computeZeroGammaFlip(strikeTotals, 100), 97.5);
});

test("computeZeroGammaFlip: finds a pos→neg crossing — the exact class the old neg→pos-only check missed", () => {
  const strikeTotals = { "95": 150, "105": -50 }; // crosses zero at 95 + 10*(150/200) = 102.5
  assert.equal(computeZeroGammaFlip(strikeTotals, 100), 102.5);
});

test("computeZeroGammaFlip: with BOTH a neg→pos and a pos→neg crossing, picks whichever is truly nearest spot — even when that's the pos→neg one", () => {
  // neg→pos crossing at 100 (95:-10 → 105:+10 → mid 100), pos→neg crossing at 210
  // (200:+10 → 220:-10 → mid 210). Spot at 205 is nearest the pos→neg crossing (5 away)
  // vs the neg→pos one (105 away) — the old neg→pos-only code would wrongly return 100.
  const strikeTotals = { "95": -10, "105": 10, "200": 10, "220": -10 };
  assert.equal(computeZeroGammaFlip(strikeTotals, 205), 210);
});

test("computeZeroGammaFlip: fewer than 2 strikes returns null", () => {
  assert.equal(computeZeroGammaFlip({ "100": 50 }, 100), null);
});

// ── computeCharmRegime: the narrative direction was backwards. charm = ∂Δ/∂t, so a
// POSITIVE total means the dealer book's delta increases as time passes → dealers must SELL
// to stay hedged → DOWNWARD pressure (not "pins upward" as the code previously claimed).
// Independently corroborated against published dealer-charm-exposure methodology (see
// FINDINGS.md) and against computeDexRegime's own dealer sign convention in this same file.

test("computeCharmRegime: positive charm reads DOWNWARD (dealers sell to stay hedged), not upward", () => {
  const regime = computeCharmRegime(50_000);
  assert.equal(regime.posture, "positive");
  assert.match(regime.read, /DRAGS price downward/);
  assert.doesNotMatch(regime.read, /PINS price upward/);
});

test("computeCharmRegime: negative charm reads UPWARD (dealers buy to stay hedged), not downward", () => {
  const regime = computeCharmRegime(-50_000);
  assert.equal(regime.posture, "negative");
  assert.match(regime.read, /PINS price upward/);
  assert.doesNotMatch(regime.read, /DRAGS price downward/);
});

test("computeCharmRegime: ~flat total never fabricates a directional posture", () => {
  const regime = computeCharmRegime(0);
  assert.equal(regime.posture, null);
  assert.match(regime.read, /~flat/);
});

// ── fetchPolygonIvTermStructure must share HEATMAP_PAGE_GUARD, not its own smaller
// hardcoded cap — live-caught truncating SPX's full chain every 5-min cache miss
// ("chain incomplete, walls/OI/IV understated") because this loop had a bespoke
// `guard < 20` that was never migrated when the same bug class was fixed for
// fetchHeatmapBand/fetchPolygonOiByExpiry elsewhere in this file. Paginating a
// live network fetch isn't practically unit-testable without heavy mocking, so —
// same style as the scan.ts/zerodte-service.ts wiring tests this session — this
// asserts the actual source, which fails against the pre-fix `guard < 20` literal
// and passes once the loop bound is the shared constant. ────────────────────────

test("fetchPolygonIvTermStructure's page-pagination loop shares HEATMAP_PAGE_GUARD, not a smaller bespoke cap", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "polygon-options-gex.ts"),
    "utf8"
  );
  const fnStart = src.indexOf("export async function fetchPolygonIvTermStructure");
  assert.ok(fnStart >= 0, "fetchPolygonIvTermStructure not found");
  const fnBody = src.slice(fnStart, fnStart + 2000);
  assert.match(fnBody, /while \(page && guard < HEATMAP_PAGE_GUARD\)/);
  assert.doesNotMatch(fnBody, /while \(page && guard < \d+\)/, "must not regress to a bespoke numeric cap");
});

// ── resolveExpiryAxis: near-term/far-dated boundary must never blend across the merge ─────
// buildGexHeatmapUncached must pass the near-term expiries captured BEFORE any far-dated
// contract is merged into the shared expiry set. These tests prove that passing the WRONG
// (post-merge) set instead genuinely changes the answer — a real, previously-shipped bug for
// thin-chain tickers with fewer real near-term expiries than NEAR_TERM_EXPIRY_COUNT (8).

test("resolveExpiryAxis: a thin chain (fewer near expiries than the count) keeps ONLY the real near-term dates — far-dated targets never leak into nearKeep", () => {
  const realNearTerm = ["2026-07-06", "2026-07-08", "2026-07-10", "2026-07-13"]; // only 4, thin chain
  const farTargets = ["2026-09-18", "2026-12-18"]; // standard 3rd-Friday monthlies, printed real contracts
  // expirySetAfterFarFetch = what expirySet looks like AFTER the far-dated fetch has merged in —
  // this is the buggy source the old code sliced from.
  const expirySetAfterFarFetch = new Set([...realNearTerm, ...farTargets]);

  const { nearKeep, farKeep, expiries } = resolveExpiryAxis(
    realNearTerm,
    farTargets,
    expirySetAfterFarFetch
  );

  assert.deepEqual(nearKeep, realNearTerm, "nearKeep must be exactly the pre-merge near-term axis");
  assert.deepEqual(farKeep, farTargets, "both far targets printed real contracts, so both are kept");
  assert.deepEqual(
    expiries,
    [...realNearTerm, ...farTargets].sort(),
    "the combined column axis still includes far-dated columns for the matrix"
  );
});

test("resolveExpiryAxis: the bug this replaces — slicing the POST-merge set instead of nearTermAxis lets far-dated expiries masquerade as near-term", () => {
  const realNearTerm = ["2026-07-06", "2026-07-08", "2026-07-10", "2026-07-13"]; // 4 real dates
  const farTargets = ["2026-09-18", "2026-12-18"];
  const expirySetAfterFarFetch = new Set([...realNearTerm, ...farTargets]);
  const NEAR_TERM_EXPIRY_COUNT = 8;

  // What the OLD (buggy) code did: re-slice the post-merge set instead of reusing nearTermAxis.
  const buggyNearKeep = Array.from(expirySetAfterFarFetch).sort().slice(0, NEAR_TERM_EXPIRY_COUNT);
  assert.deepEqual(
    buggyNearKeep,
    [...realNearTerm, ...farTargets].sort(),
    "reproduces the bug: with only 4 real near dates, the far-dated targets back-fill the rest of the slice"
  );

  // The fix: resolveExpiryAxis takes the pre-merge axis explicitly, so it can't reproduce this.
  const { nearKeep } = resolveExpiryAxis(realNearTerm, farTargets, expirySetAfterFarFetch);
  assert.notDeepEqual(nearKeep, buggyNearKeep, "the fixed nearKeep must differ from the buggy one in this exact scenario");
  assert.deepEqual(nearKeep, realNearTerm);
});

test("resolveExpiryAxis: a far target that never printed a real contract is excluded from farKeep and expiries", () => {
  const realNearTerm = ["2026-07-06", "2026-07-08"];
  const farTargets = ["2026-09-18", "2026-12-18"];
  // Only the September target actually returned contracts (December's fetch came back empty).
  const expirySetAfterFarFetch = new Set([...realNearTerm, "2026-09-18"]);

  const { farKeep, expiries } = resolveExpiryAxis(realNearTerm, farTargets, expirySetAfterFarFetch);

  assert.deepEqual(farKeep, ["2026-09-18"], "December never printed a contract — must not be fabricated into farKeep");
  assert.ok(!expiries.includes("2026-12-18"));
});
