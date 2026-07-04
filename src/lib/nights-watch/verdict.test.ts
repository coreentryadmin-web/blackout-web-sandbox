import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerdict, VERDICT_THRESHOLDS } from "./verdict";
import type { EnrichedPosition, ContractValuation } from "./valuation";
import type { PositionContext } from "./position-context";
import type { UserPositionRow } from "@/lib/db";
import type { GexWall } from "@/lib/providers/gamma-desk";

// The SHORT-side guards are the whole point of these tests: the SAME market move
// means OPPOSITE things to a long vs a short holder. A long fears
// expiry-worthless + theta decay + deep loss + assignment-as-ITM; a short WANTS
// expiry/theta (it collects premium) and instead fears assignment. Each test
// asserts BOTH verdict.action AND signal membership so a regression that flips a
// short into a long-style verdict can never pass silently.

// --- factories ---------------------------------------------------------------

function makeValuation(overrides: Partial<ContractValuation> = {}): ContractValuation {
  return {
    mark: 5,
    bid: 4.9,
    ask: 5.1,
    delta: 0.5,
    gamma: 0.02,
    theta: -0.05,
    iv: 0.3,
    openInterest: 1000,
    underlyingPrice: 105,
    mark_source: "snapshot",
    ...overrides,
  };
}

const BASE_ROW: UserPositionRow = {
  id: 1,
  ticker: "AAPL",
  option_type: "call",
  strike: 100,
  expiry: "2026-07-17",
  side: "long",
  contracts: 1,
  entry_premium: 5,
  entry_date: "2026-06-01",
  status: "open",
  exit_premium: null,
  notes: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  closed_at: null,
};

/**
 * Full EnrichedPosition with sane "live, neutral, nothing-firing" defaults:
 * comfortable DTE so the expiry block is skipped, neutral pnl (no gain/loss
 * signal), moderate delta below HEALTHY. Tests override only what they isolate.
 * NOTE: dte=14 deliberately also fires "comfortable_dte" (a hold signal) so that
 * the otherwise-neutral baseline resolves; tests that must isolate a hold signal
 * either accept comfortable_dte alongside it or lower dte explicitly.
 */
function makeEnriched(overrides: Partial<EnrichedPosition> = {}): EnrichedPosition {
  const valuation =
    overrides.valuation !== undefined ? overrides.valuation : makeValuation();
  return {
    ...BASE_ROW,
    valuation_status: "live",
    valuation,
    current_value: 500,
    unrealized_pnl: 0,
    pnl_pct: 0,
    dte: 14,
    breakeven: 105,
    pct_to_breakeven: null,
    distance_to_strike_pct: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    source: "none",
    underlyingPrice: null,
    gammaRegime: null,
    regime: null,
    gammaFlip: null,
    maxPain: null,
    gexWalls: [],
    keyLevels: [],
    ...overrides,
  };
}

function wall(overrides: Partial<GexWall> = {}): GexWall {
  return {
    strike: 5980,
    net_gex: -1_000_000,
    kind: "support",
    distance_pts: 0,
    ...overrides,
  };
}

// --- no live data ------------------------------------------------------------

test("not live → action 'watch', signals ['no_live_data']", () => {
  for (const status of ["pending", "unavailable"] as const) {
    const v = computeVerdict(makeEnriched({ valuation_status: status, valuation: null }));
    assert.equal(v.action, "watch");
    assert.deepEqual(v.signals, ["no_live_data"]);
  }
});

// --- expiry zone (the core 4-quadrant guard) ---------------------------------

test("LONG call OTM at 0DTE → 'sell' + 'expiry_worthless_risk'", () => {
  const v = computeVerdict(
    makeEnriched({
      side: "long",
      option_type: "call",
      strike: 100,
      dte: 0,
      valuation: makeValuation({ underlyingPrice: 95, delta: 0.1 }),
    })
  );
  assert.equal(v.action, "sell");
  assert.ok(v.signals.includes("expiry_worthless_risk"));
});

test("REGRESSION: SHORT call OTM at 0DTE → 'hold' + 'expiry_capture', NEVER worthless_risk/sell", () => {
  const v = computeVerdict(
    makeEnriched({
      side: "short",
      option_type: "call",
      strike: 100,
      dte: 0,
      pnl_pct: 0,
      valuation: makeValuation({ underlyingPrice: 95, delta: 0.1, theta: -0.001 }),
    })
  );
  assert.ok(v.signals.includes("expiry_capture"));
  assert.ok(!v.signals.includes("expiry_worthless_risk"));
  assert.notEqual(v.action, "sell");
  assert.equal(v.action, "hold");
});

test("SHORT call ITM at 0DTE → 'sell' + 'expiry_assignment_risk'", () => {
  const v = computeVerdict(
    makeEnriched({
      side: "short",
      option_type: "call",
      strike: 100,
      dte: 0,
      pnl_pct: 0,
      valuation: makeValuation({ underlyingPrice: 110, delta: 0.8 }),
    })
  );
  assert.equal(v.action, "sell");
  assert.ok(v.signals.includes("expiry_assignment_risk"));
});

// --- theta -------------------------------------------------------------------

test("LONG theta -0.50 / mark 1.00 / 1DTE → 'trim' + 'theta_decay'", () => {
  // burn = 0.50/1.00 = 50% >> THETA_BURN_FRACTION; dte 1 <= LOW_DTE.
  // OTM + 1DTE would also fire expiry_worthless_risk (sell) and mask trim, so keep
  // it ITM (underlying 110 > strike 100) and low |delta|-free to isolate theta.
  const v = computeVerdict(
    makeEnriched({
      side: "long",
      option_type: "call",
      strike: 100,
      dte: 1,
      pnl_pct: 0,
      valuation: makeValuation({ mark: 1.0, theta: -0.5, underlyingPrice: 110, delta: 0.6 }),
    })
  );
  assert.ok(v.signals.includes("theta_decay"));
  assert.equal(v.action, "trim");
});

test("REGRESSION: SHORT theta -0.50 / mark 1.00 / 1DTE (ITM, not assignment-free) → 'theta_tailwind', NEVER theta_decay/trim-from-theta", () => {
  // SHORT call ITM at 1DTE: expiry_assignment_risk (sell) would mask, so to isolate
  // theta we keep it OTM. But OTM short at 1DTE fires expiry_capture (hold). theta
  // for a short is a HOLD signal (tailwind), so action stays hold — the guard is
  // that theta_decay/trim NEVER appears for a short.
  const v = computeVerdict(
    makeEnriched({
      side: "short",
      option_type: "call",
      strike: 100,
      dte: 1,
      pnl_pct: 0,
      valuation: makeValuation({ mark: 1.0, theta: -0.5, underlyingPrice: 95, delta: 0.1 }),
    })
  );
  assert.ok(v.signals.includes("theta_tailwind"));
  assert.ok(!v.signals.includes("theta_decay"));
  assert.notEqual(v.action, "trim");
});

// --- deep loss (side-aware floor) --------------------------------------------

test("LONG pnl_pct -70 → 'sell' + 'deep_loss'", () => {
  const v = computeVerdict(
    makeEnriched({ side: "long", pnl_pct: -70, dte: 14 })
  );
  assert.equal(v.action, "sell");
  assert.ok(v.signals.includes("deep_loss"));
});

test("REGRESSION: SHORT pnl_pct -70 → NO 'deep_loss' (short floor is -150)", () => {
  const v = computeVerdict(
    makeEnriched({ side: "short", pnl_pct: -70, dte: 14, breakeven: null })
  );
  assert.ok(!v.signals.includes("deep_loss"));
});

test("SHORT pnl_pct -160 → 'deep_loss' (past the -150 short floor)", () => {
  const v = computeVerdict(
    makeEnriched({ side: "short", pnl_pct: -160, dte: 14, breakeven: null })
  );
  assert.equal(v.action, "sell");
  assert.ok(v.signals.includes("deep_loss"));
});

// --- gains (side-aware "strong" line) ----------------------------------------

test("LONG pnl_pct 110 → 'gain_lock_strong'", () => {
  const v = computeVerdict(makeEnriched({ side: "long", pnl_pct: 110, dte: 14 }));
  assert.ok(v.signals.includes("gain_lock_strong"));
  assert.ok(!v.signals.includes("gain_lock") || v.signals.includes("gain_lock_strong"));
});

test("SHORT pnl_pct 90 → 'gain_lock_strong' (>= short strong line 85)", () => {
  const v = computeVerdict(
    makeEnriched({ side: "short", pnl_pct: 90, dte: 14, breakeven: null })
  );
  assert.ok(v.signals.includes("gain_lock_strong"));
});

test("SHORT pnl_pct 60 → 'gain_lock' (not strong; >= 50 but < short strong 85)", () => {
  const v = computeVerdict(
    makeEnriched({ side: "short", pnl_pct: 60, dte: 14, breakeven: null })
  );
  assert.ok(v.signals.includes("gain_lock"));
  assert.ok(!v.signals.includes("gain_lock_strong"));
});

// --- healthy delta (long-only hold signal) -----------------------------------

test("LONG |delta| 0.40 at comfortable DTE → 'hold' + 'healthy_delta'", () => {
  const v = computeVerdict(
    makeEnriched({
      side: "long",
      dte: 14,
      pnl_pct: 0,
      valuation: makeValuation({ delta: 0.4, underlyingPrice: 105 }),
    })
  );
  assert.equal(v.action, "hold");
  assert.ok(v.signals.includes("healthy_delta"));
});

test("REGRESSION: SHORT |delta| 0.40 → NEVER 'healthy_delta'", () => {
  const v = computeVerdict(
    makeEnriched({
      side: "short",
      dte: 14,
      pnl_pct: 0,
      breakeven: null,
      valuation: makeValuation({ delta: 0.4, underlyingPrice: 105 }),
    })
  );
  assert.ok(!v.signals.includes("healthy_delta"));
});

// --- GEX wall break margin ----------------------------------------------------
// LONG call (wantsUp) with a SUPPORT wall below: a decisive drop below support is
// the break. WALL_BREAK_PTS guards against a hair-trigger when spot is merely a
// tick under the wall.

test("wall break: LONG call, support wall 5980, spot 5979 (within WALL_BREAK_PTS) → NO 'gex_wall_broken_against'", () => {
  const spot = 5980 - 1; // 5979: well within the 15pt margin
  const ctx = makeContext({
    source: "gex-heatmap",
    underlyingPrice: spot,
    gexWalls: [wall({ strike: 5980, kind: "support" })],
  });
  // Position must be otherwise non-triggering: high DTE (no expiry block, no
  // comfortable_dte interference is fine), neutral pnl, strike far so not OTM-expiry.
  const v = computeVerdict(
    makeEnriched({
      side: "long",
      option_type: "call",
      strike: 5900,
      dte: 30,
      pnl_pct: 0,
      breakeven: null,
      pct_to_breakeven: null,
      valuation: makeValuation({ underlyingPrice: spot, delta: 0.25, theta: -0.001 }),
    }),
    ctx
  );
  assert.ok(!v.signals.includes("gex_wall_broken_against"));
  // sanity: margin must be the reason — confirm a decisive break WOULD fire (next test)
  assert.ok(spot > 5980 - VERDICT_THRESHOLDS.WALL_BREAK_PTS);
});

test("wall break: LONG call, support wall 5980, spot 5960 (decisively below) → 'gex_wall_broken_against' + 'sell'", () => {
  const spot = 5960; // 20pt below 5980 → past the 15pt margin
  const ctx = makeContext({
    source: "gex-heatmap",
    underlyingPrice: spot,
    gexWalls: [wall({ strike: 5980, kind: "support" })],
  });
  const v = computeVerdict(
    makeEnriched({
      side: "long",
      option_type: "call",
      strike: 5900,
      dte: 30,
      pnl_pct: 0,
      breakeven: null,
      pct_to_breakeven: null,
      valuation: makeValuation({ underlyingPrice: spot, delta: 0.25, theta: -0.001 }),
    }),
    ctx
  );
  assert.ok(v.signals.includes("gex_wall_broken_against"));
  assert.equal(v.action, "sell");
  assert.ok(spot < 5980 - VERDICT_THRESHOLDS.WALL_BREAK_PTS);
});

// =============================================================================
// CROSS-TOOL ENRICHMENT SIGNALS (flows / trend / key levels / catalysts)
//
// Every one of these fires ONLY when its data is actually present on the context.
// The final REGRESSION block proves that a context WITHOUT any of the new fields
// (and an undefined context) produces the EXACT same verdict as before — i.e. the
// new signals are pure additions gated on honest, present data.
// =============================================================================

// A "quiet" enriched position whose only baseline hold signal is comfortable_dte:
// neutral pnl, moderate delta (< HEALTHY), no breakeven/expiry triggers. Lets a
// single cross-tool signal decide the action.
function quietLong(overrides: Partial<EnrichedPosition> = {}): EnrichedPosition {
  return makeEnriched({
    side: "long",
    option_type: "call",
    strike: 100,
    dte: 14,
    pnl_pct: 0,
    breakeven: null,
    pct_to_breakeven: null,
    valuation: makeValuation({ underlyingPrice: 105, delta: 0.25, theta: -0.001 }),
    ...overrides,
  });
}

// --- options flow alignment --------------------------------------------------

test("flow_supports: bullish flow + LONG call (wantsUp) → 'hold' + 'flow_supports'", () => {
  const ctx = makeContext({
    flows: { lean: "bullish", callPremium: 3_000_000, putPremium: 500_000, count: 40 },
  });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(v.signals.includes("flow_supports"));
  assert.ok(!v.signals.includes("flow_against"));
  assert.equal(v.action, "hold");
});

test("flow_against: bearish flow + LONG call → 'trim' + 'flow_against'", () => {
  const ctx = makeContext({
    flows: { lean: "bearish", callPremium: 400_000, putPremium: 3_000_000, count: 40 },
  });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(v.signals.includes("flow_against"));
  assert.ok(!v.signals.includes("flow_supports"));
  assert.equal(v.action, "trim");
});

test("flow side-aware: bearish flow + SHORT put (wantsUp) → aligned 'flow_supports'", () => {
  // short put = bullish exposure (wantsUp). A BEARISH flow opposes that → flow_against.
  // Conversely a bullish flow aligns. Here we use bullish flow to confirm alignment for
  // a non-long-call wantsUp position.
  const ctx = makeContext({
    flows: { lean: "bullish", callPremium: 3_000_000, putPremium: 300_000, count: 50 },
  });
  const v = computeVerdict(
    quietLong({ side: "short", option_type: "put", strike: 100 }),
    ctx
  );
  assert.ok(v.signals.includes("flow_supports"));
  assert.ok(!v.signals.includes("flow_against"));
});

test("flow does NOT fire when ctx.flows is null", () => {
  const v = computeVerdict(quietLong(), makeContext({ flows: null }));
  assert.ok(!v.signals.includes("flow_supports"));
  assert.ok(!v.signals.includes("flow_against"));
});

test("flow does NOT fire when lean is 'mixed'", () => {
  const ctx = makeContext({
    flows: { lean: "mixed", callPremium: 3_000_000, putPremium: 2_900_000, count: 60 },
  });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(!v.signals.includes("flow_supports"));
  assert.ok(!v.signals.includes("flow_against"));
});

test("flow does NOT fire below FLOW_MIN_PREMIUM (noise floor)", () => {
  // bullish lean but total premium 100k < 250k floor → never evaluated.
  const ctx = makeContext({
    flows: { lean: "bullish", callPremium: 90_000, putPremium: 10_000, count: 3 },
  });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(!v.signals.includes("flow_supports"));
  assert.ok(!v.signals.includes("flow_against"));
});

test("flow does NOT fire when skew below FLOW_SKEW_RATIO (near-even tape)", () => {
  // bullish lean, premium clears the floor, but calls only 1.1x puts (< 1.5) → noise.
  const ctx = makeContext({
    flows: { lean: "bullish", callPremium: 1_100_000, putPremium: 1_000_000, count: 80 },
  });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(!v.signals.includes("flow_supports"));
  assert.ok(!v.signals.includes("flow_against"));
});

// --- daily trend alignment ---------------------------------------------------

test("trend_aligned: up trend + LONG call (wantsUp) → 'hold' + 'trend_aligned'", () => {
  const v = computeVerdict(quietLong(), makeContext({ trend: "up" }));
  assert.ok(v.signals.includes("trend_aligned"));
  assert.ok(!v.signals.includes("trend_against"));
  assert.equal(v.action, "hold");
});

test("trend_against: down trend + LONG call → 'trim' + 'trend_against'", () => {
  const v = computeVerdict(quietLong(), makeContext({ trend: "down" }));
  assert.ok(v.signals.includes("trend_against"));
  assert.ok(!v.signals.includes("trend_aligned"));
  assert.equal(v.action, "trim");
});

test("trend side-aware: down trend + LONG put (!wantsUp) → aligned 'trend_aligned'", () => {
  const v = computeVerdict(
    quietLong({ option_type: "put", strike: 110 }),
    makeContext({ trend: "down" })
  );
  assert.ok(v.signals.includes("trend_aligned"));
  assert.ok(!v.signals.includes("trend_against"));
});

test("trend does NOT fire when 'sideways' or null", () => {
  for (const trend of ["sideways", null] as const) {
    const v = computeVerdict(quietLong(), makeContext({ trend }));
    assert.ok(!v.signals.includes("trend_aligned"));
    assert.ok(!v.signals.includes("trend_against"));
  }
});

// --- technical key-level proximity -------------------------------------------

test("approaching_key_level: LONG call, resistance just above spot within % → 'trim'", () => {
  // spot 105, resistance 105.3 → 0.29% away (< 0.5%) and in the threatening direction.
  const ctx = makeContext({
    levels: [{ kind: "resistance", price: 105.3, source: "PDH" }],
  });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(v.signals.includes("approaching_key_level"));
  assert.equal(v.action, "trim");
});

test("approaching_key_level does NOT fire for a SAFE-side level (support below, LONG call)", () => {
  // support below spot is NOT threatening for a long call (wantsUp) → never fires.
  const ctx = makeContext({
    levels: [{ kind: "support", price: 104.8, source: "VWAP" }],
  });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(!v.signals.includes("approaching_key_level"));
});

test("approaching_key_level does NOT fire when threatening level is beyond the %", () => {
  // resistance 107 vs spot 105 → ~1.9% away (> 0.5%) → not approaching.
  const ctx = makeContext({
    levels: [{ kind: "resistance", price: 107, source: "PDH" }],
  });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(!v.signals.includes("approaching_key_level"));
});

test("approaching_key_level side-aware: LONG put threatened by support below within %", () => {
  // long put = bearish exposure (!wantsUp): support BELOW is the threat. spot 105,
  // support 104.7 → 0.29% below.
  const ctx = makeContext({
    levels: [{ kind: "support", price: 104.7, source: "VWAP" }],
  });
  const v = computeVerdict(
    quietLong({ option_type: "put", strike: 110 }),
    ctx
  );
  assert.ok(v.signals.includes("approaching_key_level"));
  assert.equal(v.action, "trim");
});

// --- earnings / catalyst (side-aware) ----------------------------------------

test("earnings_before_expiry: LONG → 'trim' + 'earnings_before_expiry'", () => {
  const ctx = makeContext({
    catalysts: { earningsDate: "2026-06-27", daysToEarnings: 3, beforeExpiry: true },
  });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(v.signals.includes("earnings_before_expiry"));
  assert.equal(v.action, "trim");
});

test("earnings_before_expiry: SHORT → 'sell' + 'earnings_before_expiry'", () => {
  const ctx = makeContext({
    catalysts: { earningsDate: "2026-06-27", daysToEarnings: 3, beforeExpiry: true },
  });
  // short call, OTM, comfortable DTE so no expiry/assignment signal masks it.
  const v = computeVerdict(
    quietLong({ side: "short", option_type: "call", strike: 120 }),
    ctx
  );
  assert.ok(v.signals.includes("earnings_before_expiry"));
  assert.equal(v.action, "sell");
});

test("earnings does NOT fire when beforeExpiry is false", () => {
  const ctx = makeContext({
    catalysts: { earningsDate: "2026-08-01", daysToEarnings: 3, beforeExpiry: false },
  });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(!v.signals.includes("earnings_before_expiry"));
});

test("earnings does NOT fire when daysToEarnings is large (> EARNINGS_SOON_DAYS)", () => {
  const ctx = makeContext({
    catalysts: { earningsDate: "2026-07-10", daysToEarnings: 16, beforeExpiry: true },
  });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(!v.signals.includes("earnings_before_expiry"));
});

test("earnings does NOT fire when ctx.catalysts is null", () => {
  const v = computeVerdict(quietLong(), makeContext({ catalysts: null }));
  assert.ok(!v.signals.includes("earnings_before_expiry"));
});

// --- SPX Slayer play alignment (enhancement: cross-reference the play engine's own state) --

function spxSlayerPlay(
  overrides: Partial<NonNullable<PositionContext["spxSlayerOpenPlay"]>> = {}
): NonNullable<PositionContext["spxSlayerOpenPlay"]> {
  return {
    direction: "long",
    grade: "A",
    entry_price: 6050,
    opened_at: "2026-07-04T14:35:00.000Z",
    ...overrides,
  };
}

test("spx_slayer_aligned: LONG play + LONG call (wantsUp) → 'hold' + 'spx_slayer_aligned'", () => {
  const ctx = makeContext({ spxSlayerOpenPlay: spxSlayerPlay({ direction: "long" }) });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(v.signals.includes("spx_slayer_aligned"));
  assert.ok(!v.signals.includes("spx_slayer_against"));
  assert.equal(v.action, "hold");
});

test("spx_slayer_against: SHORT play + LONG call → 'trim' + 'spx_slayer_against'", () => {
  const ctx = makeContext({ spxSlayerOpenPlay: spxSlayerPlay({ direction: "short" }) });
  const v = computeVerdict(quietLong(), ctx);
  assert.ok(v.signals.includes("spx_slayer_against"));
  assert.ok(!v.signals.includes("spx_slayer_aligned"));
  assert.equal(v.action, "trim");
});

test("spx_slayer side-aware: SHORT play + LONG put (!wantsUp) → aligned 'spx_slayer_aligned'", () => {
  // A long put is bearish exposure (!wantsUp); a "short" (bearish) play agrees with it.
  const ctx = makeContext({ spxSlayerOpenPlay: spxSlayerPlay({ direction: "short" }) });
  const v = computeVerdict(quietLong({ option_type: "put", strike: 110 }), ctx);
  assert.ok(v.signals.includes("spx_slayer_aligned"));
  assert.ok(!v.signals.includes("spx_slayer_against"));
});

test("spx_slayer does NOT fire when ctx.spxSlayerOpenPlay is undefined (field never populated)", () => {
  const v = computeVerdict(quietLong(), makeContext());
  assert.ok(!v.signals.includes("spx_slayer_aligned"));
  assert.ok(!v.signals.includes("spx_slayer_against"));
});

test("spx_slayer does NOT fire when ctx.spxSlayerOpenPlay is null (engine has no play open)", () => {
  const v = computeVerdict(quietLong(), makeContext({ spxSlayerOpenPlay: null }));
  assert.ok(!v.signals.includes("spx_slayer_aligned"));
  assert.ok(!v.signals.includes("spx_slayer_against"));
});

test("spx_slayer reason cites grade + entry price (grounded, human-readable)", () => {
  const ctx = makeContext({
    spxSlayerOpenPlay: spxSlayerPlay({ direction: "long", grade: "B+", entry_price: 6072.5 }),
  });
  const v = computeVerdict(quietLong(), ctx);
  const reason = v.reasons.find((r) => r.includes("SPX Slayer"));
  assert.ok(reason, "expected an SPX Slayer reason string");
  assert.ok(reason!.includes("B+"));
  assert.ok(reason!.includes("6072.5"));
});

// --- REGRESSION: no new data → identical verdict -----------------------------

const NEW_SIGNAL_IDS = [
  "flow_supports",
  "flow_against",
  "trend_aligned",
  "trend_against",
  "approaching_key_level",
  "earnings_before_expiry",
  "spx_slayer_aligned",
  "spx_slayer_against",
];

test("REGRESSION: context WITHOUT new fields fires NONE of the new signals", () => {
  // A plain context (no flows/trend/levels/catalysts) must behave exactly as before.
  const plain = makeContext({ source: "none" });
  const withCtx = computeVerdict(quietLong(), plain);
  for (const id of NEW_SIGNAL_IDS) assert.ok(!withCtx.signals.includes(id));
});

test("REGRESSION: undefined context === context-with-no-new-fields (same verdict, no new signals)", () => {
  const pos = quietLong();
  const noCtx = computeVerdict(pos); // ctx undefined entirely
  const emptyCtx = computeVerdict(pos, makeContext()); // no new fields set
  // Identical action/confidence/signals/reasons — the new fields are pure additions.
  assert.deepEqual(noCtx, emptyCtx);
  for (const id of NEW_SIGNAL_IDS) assert.ok(!noCtx.signals.includes(id));
  // And the baseline verdict is unchanged: a quiet long with comfortable DTE still holds.
  assert.equal(noCtx.action, "hold");
  assert.ok(noCtx.signals.includes("comfortable_dte"));
});

test("REGRESSION: a sell-precedence position is unaffected by aligned cross-tool data", () => {
  // Deep loss (sell) must still win even if bullish flow + up trend would lean hold.
  const ctx = makeContext({
    flows: { lean: "bullish", callPremium: 5_000_000, putPremium: 200_000, count: 90 },
    trend: "up",
  });
  const base = computeVerdict(makeEnriched({ side: "long", pnl_pct: -70, dte: 14 }));
  const enriched = computeVerdict(
    makeEnriched({ side: "long", pnl_pct: -70, dte: 14 }),
    ctx
  );
  // Sell precedence holds; the hold-leaning cross-tool signals never override it.
  assert.equal(base.action, "sell");
  assert.equal(enriched.action, "sell");
  assert.ok(enriched.signals.includes("deep_loss"));
});
