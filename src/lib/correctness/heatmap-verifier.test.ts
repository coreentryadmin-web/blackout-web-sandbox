import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { GexHeatmap, DexMetricBlock, CharmMetricBlock } from "@/lib/providers/polygon-options-gex";
import type { CheckResult } from "./types";

// heatmap-verifier.ts (and its polygon-options-gex.ts / gex-positioning.ts imports) carry a
// real `import "server-only"` — stub the package so plain `node --test` (no Next.js
// "react-server" export condition) doesn't crash at module-load time, same gotcha
// documented across this repo's other provider/correctness test files (see
// gex-positioning.test.ts, gex-odte-scope.test.ts's siblings).
//
// Everything else heatmap-verifier.ts imports (polygon-options-gex.ts's own config/polygon/
// spx-session/unusual-whales/gex-regime-events chain, gex-positioning.ts) loads for REAL,
// unmocked — proven safe by gex-positioning.test.ts, which already exercises the identical
// import chain with only "server-only" stubbed. heatmap-verifier.ts's OWN imports are all
// "@/..." ALIAS specifiers (not relative), which per this repo's documented Node 20
// mock.module()-alias-crash finding CANNOT be intercepted with mock.module() at all (every
// mock.module() call in this repo targets a RELATIVE specifier for exactly that reason) —
// so the three new functions under test here are exercised as PURE functions against
// hand-built GexHeatmap fixtures, never through a mocked fetchGexHeatmap/network path
// (mirroring gex-positioning.test.ts's and gex-odte-scope.test.ts's own approach to this
// same file's neighboring pure helpers).
mock.module("server-only", { namedExports: {} });

let dexCharmInvariantChecks: typeof import("./heatmap-verifier").dexCharmInvariantChecks;
let dexCharmSanityChecks: typeof import("./heatmap-verifier").dexCharmSanityChecks;
let dexCharmCrossToolChecks: typeof import("./heatmap-verifier").dexCharmCrossToolChecks;

before(async () => {
  ({ dexCharmInvariantChecks, dexCharmSanityChecks, dexCharmCrossToolChecks } = await import("./heatmap-verifier"));
});

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const EXPIRY = "2026-07-05";

type Ctx = { ticker: string; now: number; today: string };

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return { ticker: "TEST", now: Date.now(), today: EXPIRY, ...overrides };
}

/** Cells for ONE near-term expiry, one cell per strike — matches strike_totals exactly
 *  (single-expiry axis), so the cell-resum / sign-integrity checks reconcile cleanly by
 *  construction unless a test deliberately corrupts a cell to prove the FLAG path. */
function cellsFromTotals(strikeTotals: Record<string, number>): Record<string, Record<string, number>> {
  const cells: Record<string, Record<string, number>> = {};
  for (const [strike, val] of Object.entries(strikeTotals)) {
    cells[strike] = { [EXPIRY]: val };
  }
  return cells;
}

function makeDexBlock(
  strikeTotals: Record<string, number>,
  opts: { zero_level?: number | null; posture?: "long" | "short" | null; cells?: Record<string, Record<string, number>>; total?: number } = {}
): DexMetricBlock {
  const total = opts.total ?? Object.values(strikeTotals).reduce((a, b) => a + b, 0);
  const posture = opts.posture !== undefined ? opts.posture : total > 0 ? "long" : total < 0 ? "short" : null;
  return {
    cells: opts.cells ?? cellsFromTotals(strikeTotals),
    strike_totals: strikeTotals,
    total,
    zero_level: opts.zero_level ?? null,
    regime: { posture, read: "test" },
  };
}

function makeCharmBlock(
  strikeTotals: Record<string, number>,
  opts: { zero_level?: number | null; posture?: "positive" | "negative" | null; cells?: Record<string, Record<string, number>>; total?: number } = {}
): CharmMetricBlock {
  const total = opts.total ?? Object.values(strikeTotals).reduce((a, b) => a + b, 0);
  const posture = opts.posture !== undefined ? opts.posture : total > 0 ? "positive" : total < 0 ? "negative" : null;
  return {
    cells: opts.cells ?? cellsFromTotals(strikeTotals),
    strike_totals: strikeTotals,
    total,
    zero_level: opts.zero_level ?? null,
    regime: { posture, read: "test" },
  };
}

/** Minimal valid GexHeatmap. Only the fields the DEX/CHARM checks read are populated with
 *  real values; `gex`/`vex` are present (required by the type) but empty/inert. */
function makeHeatmap(overrides: Partial<GexHeatmap> = {}): GexHeatmap {
  const strikes = overrides.strikes ?? [95, 100, 105];
  return {
    underlying: "TEST",
    spot: 100,
    change_pct: 0,
    asof: new Date().toISOString(),
    expiries: [EXPIRY],
    strikes,
    max_pain: null,
    gex: {
      cells: {},
      strike_totals: {},
      call_wall: null,
      put_wall: null,
      total: 0,
      flip: null,
      regime: { flip: null, posture: null, read: "" },
    },
    vex: {
      cells: {},
      strike_totals: {},
      pos_wall: null,
      neg_wall: null,
      total: 0,
      flip: null,
      regime: { posture: null, read: "" },
    },
    shift: { available: false, status: "collecting" },
    source: "polygon",
    data_delay: "test",
    ...overrides,
  } as GexHeatmap;
}

function findChecks(checks: CheckResult[], metric: string): CheckResult[] {
  return checks.filter((c) => c.metric === metric);
}
/**
 * `mk()` (heatmap-verifier.ts) builds `id` from a `${ticker}:${metric}:${layer}:...` template
 * but then spreads `...extra` (which carries the SAME `id` key passed at each call site) AFTER
 * that computed field — so the short `extra.id` (e.g. "strike-sum-eq-total") ends up as the
 * check's ENTIRE `id`, verbatim, not appended to the template. Matching on the exact short id
 * here (not a substring of a longer composed id) reflects that actual, current behavior —
 * this is pre-existing GEX-layer behavior (not something this task changes; see FINDINGS.md).
 */
function findCheck(checks: CheckResult[], metric: string, id: string): CheckResult | undefined {
  return checks.find((c) => c.metric === metric && c.id === id);
}

// ---------------------------------------------------------------------------
// dexCharmInvariantChecks
// ---------------------------------------------------------------------------

test("dexCharmInvariantChecks: DEX/CHARM blocks absent on the matrix — skipped, never flagged", () => {
  const ctx = makeCtx();
  const hm = makeHeatmap(); // no dex/charm
  const out = dexCharmInvariantChecks(ctx, hm);
  const dex = findChecks(out, "net_dex");
  const charm = findChecks(out, "net_charm");
  assert.equal(dex.length, 1);
  assert.equal(dex[0]!.outcome, "skipped");
  assert.match(dex[0]!.detail, /No DEX block/);
  assert.equal(charm.length, 1);
  assert.equal(charm[0]!.outcome, "skipped");
  assert.match(charm[0]!.detail, /No CHARM block/);
});

test("dexCharmInvariantChecks: a clean DEX block (Σ==total, cells reconcile, real zero-level crossing, posture matches sign) is all consistency-only, zero flags", () => {
  const ctx = makeCtx();
  // -50 at 95, +150 at 105 → total 100 (long), neg→pos crossing at 95 + 10*(50/200) = 97.5.
  const strikeTotals = { "95": -50, "105": 150 };
  const dex = makeDexBlock(strikeTotals, { zero_level: 97.5, posture: "long" });
  const hm = makeHeatmap({ dex });

  const out = dexCharmInvariantChecks(ctx, hm);
  const flags = out.filter((c) => c.outcome === "flag");
  assert.deepEqual(flags, [], `expected zero flags, got: ${JSON.stringify(flags)}`);

  assert.equal(findCheck(out, "net_dex", "strike-sum-eq-total")?.outcome, "consistency-only");
  assert.equal(findCheck(out, "net_dex", "cells-eq-strike-totals")?.outcome, "consistency-only");
  assert.equal(findCheck(out, "net_dex", "cell-sign-eq-strike-total")?.outcome, "consistency-only");
  assert.equal(findCheck(out, "dex_zero_level", "zero-level-real-crossing")?.outcome, "consistency-only");
  assert.equal(findCheck(out, "dex_posture", "posture-matches-sign")?.outcome, "consistency-only");
});

test("dexCharmInvariantChecks: DEX Σ(strike_totals) != reported total — FLAGs a scale/aggregation bug", () => {
  const ctx = makeCtx();
  const strikeTotals = { "95": -50, "105": 150 }; // sums to 100
  const dex = makeDexBlock(strikeTotals, { total: 500 }); // engine reports 500 — a 5x scale bug
  const hm = makeHeatmap({ dex });

  const out = dexCharmInvariantChecks(ctx, hm);
  const check = findCheck(out, "net_dex", "strike-sum-eq-total");
  assert.ok(check);
  assert.equal(check!.outcome, "flag");
  assert.match(check!.detail, /does NOT match reported total/);
});

test("dexCharmInvariantChecks: DEX per-strike cell sign contradicts strike_total — FLAGs (temporal-immune self-contradiction)", () => {
  const ctx = makeCtx();
  const strikeTotals = { "95": -1_000_000, "105": 1_000_000 };
  // Strike 95's served cell re-sum is POSITIVE while its strike_total is NEGATIVE — a
  // self-contradiction within the SAME served payload (no fresh fetch involved).
  const cells = { "95": { [EXPIRY]: 1_000_000 }, "105": { [EXPIRY]: 1_000_000 } };
  const dex = makeDexBlock(strikeTotals, { cells });
  const hm = makeHeatmap({ dex });

  const out = dexCharmInvariantChecks(ctx, hm);
  const check = findCheck(out, "net_dex", "cell-sign-eq-strike-total");
  assert.ok(check);
  assert.equal(check!.outcome, "flag");
  assert.match(check!.detail, /SIGN CONFLICT at 95/);
});

test("dexCharmInvariantChecks: near_term_expiries prevents false SIGN CONFLICT when far-dated cells would poison slice(0,8)", () => {
  const near1 = "2026-07-06";
  const near2 = "2026-07-07";
  const far = "2026-09-19";
  const strikeTotals = { "7450": -100_000_000 };
  const cells = {
    "7450": { [near1]: -60_000_000, [near2]: -40_000_000, [far]: 500_000_000 },
  };
  const dex = makeDexBlock(strikeTotals, { cells });
  const hm = makeHeatmap({
    expiries: [near1, near2, far],
    near_term_expiries: [near1, near2],
    dex,
  });

  const out = dexCharmInvariantChecks(makeCtx(), hm);
  const check = findCheck(out, "net_dex", "cell-sign-eq-strike-total");
  assert.ok(check);
  assert.equal(check!.outcome, "consistency-only");
});

test("dexCharmInvariantChecks: DEX zero_level reported far from the real sign-change crossing — FLAGs", () => {
  const ctx = makeCtx();
  const strikeTotals = { "95": -50, "105": 150 }; // real crossing at 97.5
  const dex = makeDexBlock(strikeTotals, { zero_level: 50 }); // nowhere near 97.5
  const hm = makeHeatmap({ dex });

  const out = dexCharmInvariantChecks(ctx, hm);
  const check = findCheck(out, "dex_zero_level", "zero-level-real-crossing");
  assert.ok(check);
  assert.equal(check!.outcome, "flag");
  assert.match(check!.detail, /NOT at an independent sign-change crossing/);
});

test("dexCharmInvariantChecks: DEX zero_level real crossing runs pos→neg (not just neg→pos) — still detected, not missed", () => {
  const ctx = makeCtx();
  // +150 at 95, -50 at 105 → crossing at 95 + 10*(150/200) = 102.5, running the OPPOSITE
  // direction from the sibling test above — the exact class of crossing the old neg→pos-only
  // restriction in deriveFlip() would have silently missed.
  const strikeTotals = { "95": 150, "105": -50 };
  const dex = makeDexBlock(strikeTotals, { zero_level: 102.5, posture: "short" });
  const hm = makeHeatmap({ dex });

  const out = dexCharmInvariantChecks(ctx, hm);
  const check = findCheck(out, "dex_zero_level", "zero-level-real-crossing");
  assert.ok(check);
  assert.equal(check!.outcome, "consistency-only");
});

test("dexCharmInvariantChecks: DEX posture contradicts sign(total) — FLAGs a label/number divergence (#80 class)", () => {
  const ctx = makeCtx();
  const strikeTotals = { "95": -50, "105": 150 }; // total = 100 (positive) → posture should be "long"
  const dex = makeDexBlock(strikeTotals, { zero_level: 97.5, posture: "short" }); // served WRONG
  const hm = makeHeatmap({ dex });

  const out = dexCharmInvariantChecks(ctx, hm);
  const check = findCheck(out, "dex_posture", "posture-matches-sign");
  assert.ok(check);
  assert.equal(check!.outcome, "flag");
  assert.match(check!.detail, /CONTRADICTS sign/);
  assert.equal(check!.expected, "long");
  assert.equal(check!.actual, "short");
});

test("dexCharmInvariantChecks: total ~flat (0) → posture must be null, not fabricated long/short", () => {
  const ctx = makeCtx();
  const strikeTotals = { "95": -50, "105": 50 }; // sums to exactly 0
  const dex = makeDexBlock(strikeTotals, { posture: null });
  const hm = makeHeatmap({ dex });

  const out = dexCharmInvariantChecks(ctx, hm);
  const check = findCheck(out, "dex_posture", "posture-matches-sign");
  assert.ok(check);
  assert.equal(check!.outcome, "consistency-only");
  assert.equal(check!.expected, null);
});

test("dexCharmInvariantChecks: CHARM mirrors DEX — clean block passes, posture contradiction FLAGs", () => {
  const ctx = makeCtx();
  // Both strikes negative — total = -100 (negative → posture "negative") with NO sign crossing
  // at all (same-signed throughout), so null-reported zero_level is genuinely consistency-only
  // regardless of crossing direction — this test is about the posture invariant, not zero-level.
  const strikeTotals = { "95": -50, "105": -50 };
  const cleanCharm = makeCharmBlock(strikeTotals, { zero_level: null, posture: "negative" });
  const cleanOut = dexCharmInvariantChecks(ctx, makeHeatmap({ charm: cleanCharm }));
  assert.deepEqual(
    cleanOut.filter((c) => c.outcome === "flag"),
    []
  );

  const wrongCharm = makeCharmBlock(strikeTotals, { zero_level: null, posture: "positive" });
  const flaggedOut = dexCharmInvariantChecks(ctx, makeHeatmap({ charm: wrongCharm }));
  const check = findCheck(flaggedOut, "charm_posture", "posture-matches-sign");
  assert.ok(check);
  assert.equal(check!.outcome, "flag");
});

// ---------------------------------------------------------------------------
// dexCharmSanityChecks
// ---------------------------------------------------------------------------

test("dexCharmSanityChecks: DEX/CHARM blocks absent — skipped, never flagged", () => {
  const ctx = makeCtx();
  const hm = makeHeatmap();
  const out = dexCharmSanityChecks(ctx, hm);
  assert.equal(findChecks(out, "net_dex").every((c) => c.outcome === "skipped"), true);
  assert.equal(findChecks(out, "net_charm").every((c) => c.outcome === "skipped"), true);
});

test("dexCharmSanityChecks: clean DEX values (finite, near spot, plausible magnitude) are all consistency-only", () => {
  const ctx = makeCtx();
  const dex = makeDexBlock({ "95": -50, "105": 150 }, { zero_level: 97.5 });
  const hm = makeHeatmap({ dex });
  const out = dexCharmSanityChecks(ctx, hm);
  assert.deepEqual(
    out.filter((c) => c.outcome === "flag"),
    []
  );
});

test("dexCharmSanityChecks: non-finite DEX total — FLAGs no-nan-inf", () => {
  const ctx = makeCtx();
  const dex = makeDexBlock({ "95": -50, "105": 150 }, { total: Number.NaN });
  const hm = makeHeatmap({ dex });
  const out = dexCharmSanityChecks(ctx, hm);
  const check = findCheck(out, "net_dex", "no-nan-inf");
  assert.ok(check);
  assert.equal(check!.outcome, "flag");
  assert.match(check!.detail, /Non-finite/);
});

test("dexCharmSanityChecks: CHARM zero_level implausibly far from spot (>50%) — FLAGs a strike-key/scale bug", () => {
  const ctx = makeCtx();
  const charm = makeCharmBlock({ "95": 50, "105": -150 }, { zero_level: 1000 }); // spot=100, far > 50% away
  const hm = makeHeatmap({ charm });
  const out = dexCharmSanityChecks(ctx, hm);
  const check = findCheck(out, "charm_zero_level", "charm_zero_level-near-spot");
  assert.ok(check);
  assert.equal(check!.outcome, "flag");
  assert.match(check!.detail, /implausibly far from spot/);
});

test("dexCharmSanityChecks: DEX magnitude exceeds the absurd-blow-up ceiling — FLAGs a scale/units bug", () => {
  const ctx = makeCtx();
  const spot = 100;
  const insane = spot * spot * 1e9; // well past the spot²·1e8 tripwire
  const dex = makeDexBlock({ "95": -insane, "105": insane * 2 }, { total: insane });
  const hm = makeHeatmap({ dex, spot });
  const out = dexCharmSanityChecks(ctx, hm);
  const check = findCheck(out, "net_dex", "net_dex-magnitude");
  assert.ok(check);
  assert.equal(check!.outcome, "flag");
  assert.match(check!.detail, /exceeds the absurd-blow-up ceiling/);
});

// ---------------------------------------------------------------------------
// dexCharmCrossToolChecks
// ---------------------------------------------------------------------------

test("dexCharmCrossToolChecks: cold/empty matrix (no spot, no strikes) — getGexPositioning returns null, checks skip", () => {
  const ctx = makeCtx();
  const hm = makeHeatmap({ spot: 0, strikes: [] });
  const out = dexCharmCrossToolChecks(ctx, hm);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.outcome, "skipped");
  assert.match(out[0]!.detail, /returned null/);
});

test("dexCharmCrossToolChecks: no DEX/CHARM block on the matrix — cross-tool checks skip cleanly", () => {
  const ctx = makeCtx();
  const hm = makeHeatmap(); // spot=100, strikes non-empty, no dex/charm
  const out = dexCharmCrossToolChecks(ctx, hm);
  const dex = findChecks(out, "net_dex");
  const charm = findChecks(out, "net_charm");
  assert.equal(dex.length, 1);
  assert.equal(dex[0]!.outcome, "skipped");
  assert.equal(charm.length, 1);
  assert.equal(charm[0]!.outcome, "skipped");
});

test("dexCharmCrossToolChecks: getGexPositioning agrees with the matrix's own DEX/CHARM blocks (real mapper, not mocked) — consistency-only, zero flags", () => {
  const ctx = makeCtx();
  const dex = makeDexBlock({ "95": -50, "105": 150 }, { zero_level: 97.5, posture: "long" });
  const charm = makeCharmBlock({ "95": 50, "105": -150 }, { zero_level: null, posture: "negative" });
  const hm = makeHeatmap({ dex, charm });

  const out = dexCharmCrossToolChecks(ctx, hm);
  const flags = out.filter((c) => c.outcome === "flag");
  assert.deepEqual(flags, [], `expected zero flags, got: ${JSON.stringify(flags)}`);

  assert.equal(findCheck(out, "net_dex", "positioning-vs-matrix-dex")?.outcome, "consistency-only");
  assert.equal(findCheck(out, "dex_posture", "positioning-vs-matrix-dex-posture")?.outcome, "consistency-only");
  assert.equal(findCheck(out, "net_charm", "positioning-vs-matrix-charm")?.outcome, "consistency-only");
  assert.equal(findCheck(out, "charm_posture", "positioning-vs-matrix-charm-posture")?.outcome, "consistency-only");
});
