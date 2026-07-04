// Night's Watch — DETERMINISTIC Hold/Trim/Sell verdict engine.
//
// PURE + FREE + TRANSPARENT:
//   - PURE: no network, no AI, no I/O. computeVerdict() is a pure function of
//     (position, ctx). Same inputs → same output, always. The ONLY imports are
//     TYPES — nothing in this file can touch upstream.
//   - FREE: it reads exactly what the caller already gathered (the enriched
//     position + an already-cached PositionContext). It never fetches anything.
//   - TRANSPARENT: every verdict carries the named `signals[]` it fired on and a
//     human `reasons[]` line per signal. No black box — the UI can show WHY.
//
// HONESTY RULE: a signal is fired ONLY when the data it needs is actually present.
// If valuation isn't live, the verdict is "watch" (we can't judge). If there are no
// REAL GEX walls on the context (source:"none", or empty walls), the GEX/wall signals
// are simply never evaluated — never faked. Walls can come from EITHER the SPX desk
// ("spx-desk") OR a per-ticker GEX heatmap ("gex-heatmap"); the wall signals read off
// the shared `gexWalls` field, so they generalize to any underlying with a real
// dealer-gamma profile without ever fabricating one.

import type { EnrichedPosition } from "@/lib/nights-watch/valuation";
import type { PositionContext } from "@/lib/nights-watch/position-context";

export type VerdictAction = "hold" | "trim" | "sell" | "watch";
export type VerdictConfidence = "low" | "medium" | "high";

export type Verdict = {
  action: VerdictAction;
  confidence: VerdictConfidence;
  /** Human-readable line per fired signal — what the UI shows the user. */
  reasons: string[];
  /** Machine-readable signal ids (stable) — one per fired rule. */
  signals: string[];
};

// ---------------------------------------------------------------------------
// Tunable thresholds — all named so the rules are auditable, not magic numbers.
// ---------------------------------------------------------------------------
export const VERDICT_THRESHOLDS = {
  /** DTE at/below this is the expiry danger zone (0DTE / 1DTE). */
  EXPIRY_DTE: 1,
  /** |delta| below this = effectively OTM / low-conviction directional value. */
  LOW_ABS_DELTA: 0.2,
  /** pnl_pct at/below this = deep loss, thesis likely broken. Side-aware: a long can only
   *  lose ~100% of premium, but a short's loss is unbounded and its pnl_pct base is the
   *  premium RECEIVED — so the "broken" line sits much deeper for a short. */
  DEEP_LOSS_PCT_LONG: -60,
  DEEP_LOSS_PCT_SHORT: -150,
  /** pnl_pct at/above this = lock partial / take some risk off (the 50%-of-max rule works
   *  for both a long and a premium-selling short). */
  GAIN_LOCK_PCT: 50,
  /** pnl_pct at/above this = strong winner, trim conviction rises. A short's profit is
   *  capped at +100% (mark→0), so its "strong" line sits just below that. */
  GAIN_STRONG_PCT_LONG: 100,
  GAIN_STRONG_PCT_SHORT: 85,
  /** DTE at/below this counts as "low DTE" for the decay-pressure rule. */
  LOW_DTE: 3,
  /** theta/day as a fraction of current mark above this = accelerating decay. */
  THETA_BURN_FRACTION: 0.06,
  /** A "comfortable" amount of time left for a clean hold. */
  COMFORTABLE_DTE: 7,
  /** |delta| at/above this = healthy directional exposure for a hold. */
  HEALTHY_ABS_DELTA: 0.35,
  /** Underlying within this many points of a GEX wall = "approaching" it. */
  WALL_APPROACH_PTS: 10,
  /** Underlying must be PAST a wall by at least this many points to count as a decisive
   *  break (not merely sitting a tick on the wrong side) — prevents a hair-trigger SELL. */
  WALL_BREAK_PTS: 15,

  // ----- Cross-tool enrichment signals (fire ONLY on present data) -----
  /** Minimum total options-flow premium ($) for the flow signal to be trusted. Below
   *  this it's noise — the flow signals are never evaluated. */
  FLOW_MIN_PREMIUM: 250_000,
  /** Dominant flow side must be at least this multiple of the other side to count as a
   *  real lean (prevents a near-even tape from firing a directional signal). */
  FLOW_SKEW_RATIO: 1.5,
  /** Spot within this fraction of a technical key level = "approaching" it. */
  LEVEL_APPROACH_PCT: 0.005, // 0.5%
  /** A binary catalyst (earnings) within this many days, landing on/before expiry, is a
   *  real risk worth acting on. */
  EARNINGS_SOON_DAYS: 7,
} as const;

type SignalHit = { id: string; reason: string };

function absOrNull(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.abs(v);
}

/** Is the position currently out-of-the-money (needs underlying + strike)? */
function isOtm(position: EnrichedPosition, underlyingPrice: number | null): boolean | null {
  if (underlyingPrice == null || !(underlyingPrice > 0)) return null;
  return position.option_type === "call"
    ? underlyingPrice < position.strike
    : underlyingPrice > position.strike;
}

/**
 * Does this context carry REAL GEX walls we can reason about? True for any source
 * that supplied actual walls + a live spot — today the SPX desk ("spx-desk", richer:
 * regime/levels/max-pain) AND per-ticker GEX heatmaps ("gex-heatmap", call/put wall).
 * Reads walls off the SHARED `gexWalls` field rather than hard-gating on one source,
 * so the wall signals generalize to every underlying that has a real dealer-gamma
 * profile. Never fabricates: source:"none" (or empty walls / no spot) → false → the
 * wall signals are simply never evaluated (Greeks-only verdict, exactly as before).
 */
function hasWalls(ctx: PositionContext): boolean {
  return (
    ctx.source !== "none" &&
    ctx.gexWalls.length > 0 &&
    ctx.underlyingPrice != null &&
    ctx.underlyingPrice > 0
  );
}

/**
 * Nearest GEX wall the underlying is moving toward, and whether crossing it would
 * be AGAINST the position. Returns null when there's no desk context / no walls.
 *
 * "Against" semantics for a LONG holder:
 *   - long call wants price UP   → a resistance wall above is the threat.
 *   - long put  wants price DOWN → a support wall below is the threat.
 * For a SHORT holder the directional preference inverts.
 */
function nearestWallSignal(
  position: EnrichedPosition,
  ctx: PositionContext | undefined
): { approaching: boolean; through: boolean; wallStrike: number } | null {
  if (!ctx || !hasWalls(ctx)) return null;
  const spot = ctx.underlyingPrice;
  if (spot == null || !(spot > 0) || ctx.gexWalls.length === 0) return null;

  // Bullish exposure = wants price up (long call OR short put). Else bearish.
  const wantsUp =
    (position.option_type === "call" && position.side === "long") ||
    (position.option_type === "put" && position.side === "short");

  // The threatening wall is the one in the direction that hurts the position:
  // bullish exposure is threatened by resistance ABOVE; bearish by support BELOW.
  const candidates = ctx.gexWalls.filter((w) =>
    wantsUp ? w.strike > spot : w.strike < spot
  );
  if (candidates.length === 0) return null;

  // Closest threatening wall to spot.
  const wall = candidates.reduce((closest, w) =>
    Math.abs(w.strike - spot) < Math.abs(closest.strike - spot) ? w : closest
  );
  const dist = Math.abs(wall.strike - spot);
  return {
    approaching: dist <= VERDICT_THRESHOLDS.WALL_APPROACH_PTS,
    // "through" = price has already pushed past the wall against the position.
    // (Defensive: candidates are pre-filtered to the threatening side, so a wall
    //  that is now on the wrong side of spot means we've crossed it.)
    through: false,
    wallStrike: wall.strike,
  };
}

/**
 * Detect that the underlying has pushed THROUGH a GEX wall against the position.
 * We treat the gamma-regime + wall geometry: if the closest wall on the favorable
 * side is gone (price has moved past where support/resistance used to sit) we flag
 * a structural break. Conservative: only fires with real desk walls present.
 */
function pushedThroughWallAgainst(
  position: EnrichedPosition,
  ctx: PositionContext | undefined
): { wallStrike: number } | null {
  if (!ctx || !hasWalls(ctx)) return null;
  const spot = ctx.underlyingPrice;
  if (spot == null || !(spot > 0) || ctx.gexWalls.length === 0) return null;

  const wantsUp =
    (position.option_type === "call" && position.side === "long") ||
    (position.option_type === "put" && position.side === "short");

  // A wall acts as a floor (support) for bullish exposure / ceiling for bearish.
  // If price has dropped below what should be the nearest SUPPORT (bullish) or
  // risen above the nearest RESISTANCE (bearish), the protective wall has broken.
  // Require a DECISIVE penetration (WALL_BREAK_PTS past the wall), not merely sitting a tick
  // on the wrong side: with only one support / one resistance wall and no crossing history,
  // a zero-margin test is a hair-trigger that mislabels benign noise near a wall as a break.
  const margin = VERDICT_THRESHOLDS.WALL_BREAK_PTS;
  if (wantsUp) {
    const supports = ctx.gexWalls.filter((w) => w.kind === "support");
    const brokenBelow = supports.find((w) => spot < w.strike - margin); // decisively below support
    if (brokenBelow) return { wallStrike: brokenBelow.strike };
  } else {
    const resistances = ctx.gexWalls.filter((w) => w.kind === "resistance");
    const brokenAbove = resistances.find((w) => spot > w.strike + margin); // decisively above resistance
    if (brokenAbove) return { wallStrike: brokenAbove.strike };
  }
  return null;
}

/**
 * Options-flow alignment for the position. Returns null (signal never evaluated) when:
 *   - no flow context present, OR
 *   - the lean is "mixed"/"neutral" (no clear direction), OR
 *   - total premium is below FLOW_MIN_PREMIUM (noise), OR
 *   - neither side dominates by at least FLOW_SKEW_RATIO (near-even tape).
 * Otherwise reports whether the dominant flow lean AGREES with the position's exposure
 * (`aligned`) and a human reason. HONEST: fires only on real, decisive flow data.
 */
function flowAlignment(
  ctx: PositionContext | undefined,
  wantsUp: boolean
): { aligned: boolean; reason: string } | null {
  const flows = ctx?.flows;
  if (!flows) return null;
  if (flows.lean !== "bullish" && flows.lean !== "bearish") return null;

  const call = Number.isFinite(flows.callPremium) ? Math.max(0, flows.callPremium) : 0;
  const put = Number.isFinite(flows.putPremium) ? Math.max(0, flows.putPremium) : 0;
  const total = call + put;
  if (total < VERDICT_THRESHOLDS.FLOW_MIN_PREMIUM) return null;

  // Decisive skew: the dominant side must be >= FLOW_SKEW_RATIO x the other. The lean
  // label and the premium skew must agree on which side is dominant, else it's noise.
  const bullishDominant = call >= put * VERDICT_THRESHOLDS.FLOW_SKEW_RATIO;
  const bearishDominant = put >= call * VERDICT_THRESHOLDS.FLOW_SKEW_RATIO;
  const flowWantsUp =
    flows.lean === "bullish" && bullishDominant
      ? true
      : flows.lean === "bearish" && bearishDominant
      ? false
      : null;
  if (flowWantsUp == null) return null;

  const aligned = flowWantsUp === wantsUp;
  const callM = (call / 1_000_000).toFixed(1);
  const putM = (put / 1_000_000).toFixed(1);
  const reason = aligned
    ? `Options flow leans ${flows.lean} ($${callM}m calls vs $${putM}m puts) — aligned with this position.`
    : `Options flow leans ${flows.lean} against this position ($${
        flows.lean === "bearish" ? putM : callM
      }m ${flows.lean === "bearish" ? "puts" : "calls"} vs $${
        flows.lean === "bearish" ? callM : putM
      }m ${flows.lean === "bearish" ? "calls" : "puts"}).`;
  return { aligned, reason };
}

/**
 * Daily-trend alignment. Returns null unless ctx.trend is a directional label
 * ("up"/"down"; "sideways"/null/absent never fire). Reports whether the trend AGREES
 * with the position's exposure and a human reason.
 */
function trendAlignment(
  ctx: PositionContext | undefined,
  wantsUp: boolean
): { aligned: boolean; reason: string } | null {
  const trend = ctx?.trend;
  if (trend !== "up" && trend !== "down") return null;
  const trendWantsUp = trend === "up";
  const aligned = trendWantsUp === wantsUp;
  const reason = `Daily trend is ${trend}, ${
    aligned ? "aligned with" : "against"
  } this position.`;
  return { aligned, reason };
}

/**
 * SPX Slayer play-engine alignment (SPX/SPXW only). Returns null unless
 * ctx.spxSlayerOpenPlay is a REAL open play (undefined → field never populated for this
 * underlying/non-SPX; null → engine checked and genuinely has nothing open right now —
 * both cases mean "nothing to compare," so the signal is never evaluated, per the honesty
 * rule). `direction` is the play engine's own "long"/"short" bullish/bearish label (NOT
 * call/put): a long CALL or short PUT position (wantsUp) agrees with a "long" play; a long
 * PUT or short CALL position agrees with a "short" play. An aligned play is a genuine
 * confirmation signal (the engine's own live trade agrees with this position); an opposing
 * play is a genuine caution signal (the engine has gone the other way) — both grounded in
 * a real row in `spx_open_play`, never inferred or guessed.
 */
function spxSlayerAlignment(
  ctx: PositionContext | undefined,
  wantsUp: boolean
): { aligned: boolean; reason: string } | null {
  const play = ctx?.spxSlayerOpenPlay;
  if (!play) return null;
  const playWantsUp = play.direction === "long";
  const aligned = playWantsUp === wantsUp;
  const reason = aligned
    ? `SPX Slayer's own engine has a live ${play.direction.toUpperCase()} play open (grade ${play.grade}, entry ${play.entry_price}) — aligned with this position.`
    : `SPX Slayer's own engine has a live ${play.direction.toUpperCase()} play open (grade ${play.grade}, entry ${play.entry_price}) — against this position's direction.`;
  return { aligned, reason };
}

/**
 * Technical key-level proximity. Mirrors nearestWallSignal but for chart support/
 * resistance levels: returns the nearest level in the THREATENING direction (resistance
 * ABOVE for bullish exposure, support BELOW for bearish) when spot is within
 * LEVEL_APPROACH_PCT of it. Returns null when no levels / no usable spot / no threatening
 * level in range — so a level on the SAFE side never fires.
 */
function approachingKeyLevel(
  ctx: PositionContext | undefined,
  spot: number | null,
  wantsUp: boolean
): { reason: string } | null {
  const levels = ctx?.levels;
  if (!levels || levels.length === 0) return null;
  if (spot == null || !(spot > 0)) return null;

  // Threatening side: bullish exposure is threatened by RESISTANCE above; bearish by
  // SUPPORT below.
  const threatening = levels.filter((lvl) => {
    if (!Number.isFinite(lvl.price)) return false;
    return wantsUp
      ? lvl.kind === "resistance" && lvl.price > spot
      : lvl.kind === "support" && lvl.price < spot;
  });
  if (threatening.length === 0) return null;

  // Closest threatening level to spot.
  const lvl = threatening.reduce((closest, l) =>
    Math.abs(l.price - spot) < Math.abs(closest.price - spot) ? l : closest
  );
  const withinPct = Math.abs(lvl.price - spot) / spot <= VERDICT_THRESHOLDS.LEVEL_APPROACH_PCT;
  if (!withinPct) return null;

  const src = lvl.source ? ` (${lvl.source})` : "";
  const kindLabel = lvl.kind === "resistance" ? "resistance" : "support";
  return {
    reason: `Price approaching ${kindLabel} at ${lvl.price}${src} in the position's path.`,
  };
}

/**
 * Deterministic Hold/Trim/Sell/Watch verdict for one enriched position.
 *
 * Resolution order:
 *   1. No live valuation → "watch" (can't judge — honest abstention).
 *   2. Collect every fired signal (sell-leaning, trim-leaning, hold-leaning).
 *   3. Pick action by precedence: any sell signal → sell; else any trim → trim;
 *      else if hold conditions hold → hold; else → watch.
 *   4. Confidence scales with the count of agreeing signals.
 */
export function computeVerdict(
  position: EnrichedPosition,
  ctx?: PositionContext
): Verdict {
  // 1) No live data → we cannot honestly judge.
  if (position.valuation_status !== "live" || !position.valuation) {
    return {
      action: "watch",
      confidence: "low",
      reasons: ["No live valuation — can't judge this position yet."],
      signals: ["no_live_data"],
    };
  }

  const v = position.valuation;
  const underlyingPrice = v.underlyingPrice ?? ctx?.underlyingPrice ?? null;
  const absDelta = absOrNull(v.delta);
  const dte = position.dte;
  const pnl = position.pnl_pct;
  const T = VERDICT_THRESHOLDS;
  // The SAME market move means OPPOSITE things to a long vs a short holder, so every signal
  // below is side-aware. A long fears expiry-worthless + theta decay; a short WANTS them
  // (it's collecting premium) and instead fears assignment (the option going ITM).
  const isShort = position.side === "short";

  // Bullish exposure = wants price up (long call OR short put). Else bearish.
  // Computed ONCE here and reused by every side-aware cross-tool signal below
  // (mirrors the same convention already used inside the GEX-wall helpers).
  const wantsUp =
    (position.option_type === "call" && position.side === "long") ||
    (position.option_type === "put" && position.side === "short");

  const sellSignals: SignalHit[] = [];
  const trimSignals: SignalHit[] = [];
  const holdSignals: SignalHit[] = [];

  // -------------------- Expiry zone (side-aware) --------------------
  if (dte <= T.EXPIRY_DTE) {
    const otm = isOtm(position, underlyingPrice);
    const lowDelta = absDelta != null && absDelta < T.LOW_ABS_DELTA;
    if (!isShort) {
      // LONG: OTM / low-delta into expiry → likely expires worthless → cut it.
      if (otm === true || lowDelta) {
        sellSignals.push({
          id: "expiry_worthless_risk",
          reason: `Expiry-worthless risk: ${dte}DTE and ${
            otm === true ? "out-of-the-money" : `low |delta| ${absDelta?.toFixed(2)}`
          }.`,
        });
      }
    } else {
      // SHORT: OTM into expiry is the GOAL (decays to max profit — let it expire). ITM into
      // expiry is the danger (assignment / realizing the loss leg) → close to manage it.
      if (otm === false) {
        sellSignals.push({
          id: "expiry_assignment_risk",
          reason: `Assignment risk: short is in-the-money at ${dte}DTE — close to avoid assignment / cap the loss.`,
        });
      } else if (otm === true || lowDelta) {
        holdSignals.push({
          id: "expiry_capture",
          reason: `Short is ${
            otm === true ? "out-of-the-money" : `low |delta| ${absDelta?.toFixed(2)}`
          } at ${dte}DTE — decaying toward max profit; let it expire.`,
        });
      }
    }
  }

  // -------------------- SELL-leaning --------------------

  // Deep loss — thesis likely broken. Side-aware floor (a short's loss scale is far deeper).
  const deepLossPct = isShort ? T.DEEP_LOSS_PCT_SHORT : T.DEEP_LOSS_PCT_LONG;
  if (pnl != null && pnl <= deepLossPct) {
    sellSignals.push({
      id: "deep_loss",
      reason: `Deep loss (${pnl.toFixed(0)}%) — thesis likely broken.`,
    });
  }

  // Underlying pushed THROUGH a GEX wall against the position (any underlying with
  // real walls: SPX desk or per-ticker GEX heatmap).
  const broken = pushedThroughWallAgainst(position, ctx);
  if (broken) {
    sellSignals.push({
      id: "gex_wall_broken_against",
      reason: `Underlying pushed through the ${broken.wallStrike} GEX wall against the position.`,
    });
  }

  // -------------------- Cross-tool: catalyst / earnings (side-aware) --------------------
  // A binary event (earnings) landing ON OR BEFORE expiry is a real, two-sided risk:
  // the print can gap the underlying and IV collapses afterward. Fires ONLY when the
  // catalyst data is present AND it's confirmed before expiry AND it's imminent.
  // SELL-leaning for a SHORT here (gap/assignment risk through a binary event is more
  // dangerous than a long's IV-crush risk); the LONG (TRIM) variant lives below.
  const earnings = ctx?.catalysts;
  const earningsDays = earnings?.daysToEarnings;
  // beforeExpiry: explicit value from the detail path wins; panel path stores only
  // earningsDate (ticker-level) and we derive it here from position.expiry (position-level).
  const earningsBeforeExpiry =
    earnings?.beforeExpiry === true ||
    (earnings?.earningsDate != null && earnings.earningsDate <= position.expiry.slice(0, 10));
  const earningsImminent =
    earningsBeforeExpiry &&
    earningsDays != null &&
    Number.isFinite(earningsDays) &&
    earningsDays >= 0 &&
    earningsDays <= T.EARNINGS_SOON_DAYS;
  if (earningsImminent && isShort) {
    sellSignals.push({
      id: "earnings_before_expiry",
      reason: `Earnings in ${earningsDays} days (before expiry) — gap/assignment risk on a short through a binary event; consider closing.`,
    });
  }

  // -------------------- TRIM-leaning --------------------

  // Lock partial on a strong gain. Side-aware "strong" line (a short's profit caps at +100%).
  if (pnl != null && pnl >= T.GAIN_LOCK_PCT) {
    const gainStrongPct = isShort ? T.GAIN_STRONG_PCT_SHORT : T.GAIN_STRONG_PCT_LONG;
    const strong = pnl >= gainStrongPct;
    trimSignals.push({
      id: strong ? "gain_lock_strong" : "gain_lock",
      reason: `Up ${pnl.toFixed(0)}% — lock partial profit${strong ? " (strong winner)" : ""}.`,
    });
  }

  // Theta pressure near expiry. For a LONG, fast decay erodes value → trim. For a SHORT, that
  // same decay is INCOME working in your favor → it supports holding, not trimming.
  if (
    v.theta != null &&
    Number.isFinite(v.theta) &&
    v.mark > 0 &&
    dte <= T.LOW_DTE
  ) {
    const burn = Math.abs(v.theta) / v.mark;
    if (burn >= T.THETA_BURN_FRACTION) {
      if (isShort) {
        holdSignals.push({
          id: "theta_tailwind",
          reason: `Theta tailwind: decay is ${(burn * 100).toFixed(0)}% of mark/day at ${dte}DTE — working for this short.`,
        });
      } else {
        trimSignals.push({
          id: "theta_decay",
          reason: `Accelerating decay: theta is ${(burn * 100).toFixed(0)}% of mark/day at ${dte}DTE.`,
        });
      }
    }
  }

  // Price approaching a GEX wall / key level into the position (any underlying with
  // real walls: SPX desk or per-ticker GEX heatmap).
  const wall = nearestWallSignal(position, ctx);
  if (wall?.approaching) {
    trimSignals.push({
      id: "approaching_gex_wall",
      reason: `Price approaching the ${wall.wallStrike} GEX wall in the position's path.`,
    });
  }

  // LONG earnings before expiry → TRIM (IV-crush risk after the print; less severe than
  // the SHORT's gap/assignment risk, which is SELL-leaning above).
  if (earningsImminent && !isShort) {
    trimSignals.push({
      id: "earnings_before_expiry",
      reason: `Earnings in ${earningsDays} days (before expiry) — IV-crush risk after the print; consider trimming.`,
    });
  }

  // -------------------- Cross-tool: options flow alignment (side-aware) --------------------
  // Fires ONLY when real flow data is present, the total premium clears the noise floor,
  // and one side meaningfully dominates (skew ratio) — a mixed/neutral or near-even tape
  // never fires. A lean that OPPOSES the position is TRIM-leaning; an aligned lean is a
  // HOLD signal (added in the HOLD section below).
  const flowSignal = flowAlignment(ctx, wantsUp);
  if (flowSignal && !flowSignal.aligned) {
    trimSignals.push({ id: "flow_against", reason: flowSignal.reason });
  }

  // -------------------- Cross-tool: chart trend alignment (side-aware) --------------------
  // Fires ONLY when ctx.trend is a directional label ("up"/"down"; "sideways"/null never
  // fire). A trend that OPPOSES the position's exposure is TRIM-leaning; an aligned trend
  // is a HOLD signal (added below).
  const trendSignal = trendAlignment(ctx, wantsUp);
  if (trendSignal && !trendSignal.aligned) {
    trimSignals.push({ id: "trend_against", reason: trendSignal.reason });
  }

  // -------------------- Cross-tool: SPX Slayer play alignment (SPX/SPXW, side-aware) -----
  // Fires ONLY when SPX Slayer's own play engine currently has a REAL open play (ctx.spxSlayerOpenPlay
  // is a non-null object — a non-SPX position or "engine has nothing open right now" both leave this
  // unevaluated, per the honesty rule). An OPPOSING live play is TRIM-leaning (the engine's own trade
  // has gone the other way — a genuine caution signal); an ALIGNED live play is a HOLD signal (added
  // below) — the engine's own trade agrees with this position, a genuine confirmation signal.
  const spxSlayerSignal = spxSlayerAlignment(ctx, wantsUp);
  if (spxSlayerSignal && !spxSlayerSignal.aligned) {
    trimSignals.push({ id: "spx_slayer_against", reason: spxSlayerSignal.reason });
  }

  // -------------------- Cross-tool: technical key-level proximity (side-aware) -----------
  // Mirrors the GEX-wall approaching logic but for chart support/resistance levels: if spot
  // sits within LEVEL_APPROACH_PCT of a level in the THREATENING direction (resistance ABOVE
  // for bullish exposure, support BELOW for bearish) → TRIM. Fires ONLY when ctx.levels has a
  // real threatening level in range with a usable spot. A level on the SAFE side never fires.
  const levelSignal = approachingKeyLevel(ctx, underlyingPrice, wantsUp);
  if (levelSignal) {
    trimSignals.push({ id: "approaching_key_level", reason: levelSignal.reason });
  }

  // -------------------- HOLD-leaning --------------------

  // Options flow / trend that AGREE with the position support holding it (only the aligned
  // branch lands here; the opposing branch already pushed TRIM above).
  if (flowSignal && flowSignal.aligned) {
    holdSignals.push({ id: "flow_supports", reason: flowSignal.reason });
  }
  if (trendSignal && trendSignal.aligned) {
    holdSignals.push({ id: "trend_aligned", reason: trendSignal.reason });
  }
  if (spxSlayerSignal && spxSlayerSignal.aligned) {
    holdSignals.push({ id: "spx_slayer_aligned", reason: spxSlayerSignal.reason });
  }

  // Directional exposure reads OPPOSITELY by side. For a LONG, high |delta| = healthy
  // conviction (the thesis is working) → hold. For a SHORT, high |delta| means the option
  // has moved ITM (assignment risk), while LOW |delta| (comfortably OTM) is the safe,
  // decaying state a premium-seller wants → hold.
  if (absDelta != null) {
    if (!isShort && absDelta >= T.HEALTHY_ABS_DELTA) {
      holdSignals.push({
        id: "healthy_delta",
        reason: `Healthy directional exposure (|delta| ${absDelta.toFixed(2)}).`,
      });
    } else if (isShort && absDelta < T.LOW_ABS_DELTA && dte > T.EXPIRY_DTE) {
      holdSignals.push({
        id: "low_assignment_risk",
        reason: `Low assignment risk (|delta| ${absDelta.toFixed(2)}) — short is comfortably out-of-the-money.`,
      });
    }
  }

  // Comfortable time left.
  if (dte >= T.COMFORTABLE_DTE) {
    holdSignals.push({
      id: "comfortable_dte",
      reason: `Comfortable time left (${dte}DTE).`,
    });
  }

  // Favorable vs breakeven: underlying already past breakeven in the right way.
  if (
    position.pct_to_breakeven != null &&
    Number.isFinite(position.pct_to_breakeven)
  ) {
    // pct_to_breakeven > 0 → breakeven is ABOVE spot (price must rise to break even);
    // for a long call that's still underwater on the underlying, for a long put it's
    // favorable. We treat "small/negative gap in the position's favor" as supportive.
    const favorable =
      position.option_type === "call"
        ? position.pct_to_breakeven <= 0
        : position.pct_to_breakeven >= 0;
    if (favorable) {
      holdSignals.push({
        id: "favorable_breakeven",
        reason: "Underlying is on the favorable side of breakeven.",
      });
    }
  }

  // -------------------- Night Hawk dossier enrichment signals --------------------
  // These fire ONLY when the detail view has populated the corresponding PositionContext
  // fields from the staged dossier (list path leaves them undefined → never fires).
  // Each signal is side-aware and follows the honesty rule: data absent → skip.

  // Analyst downgrade → bearish signal. Trimming a long / holding a short.
  if (ctx?.analystDowngrade === true) {
    if (!isShort) {
      trimSignals.push({
        id: "analyst_downgrade",
        reason: "Recent analyst downgrade — bearish fundamental shift; consider trimming the long.",
      });
    } else {
      holdSignals.push({
        id: "analyst_downgrade_supports_short",
        reason: "Recent analyst downgrade supports the short thesis.",
      });
    }
  }

  // High IV crush risk → trim a long (IV collapse after a print erodes the premium paid).
  // For a short, elevated IV is income — it's a tailwind, so we add a hold signal.
  if (ctx?.highIvCrushRisk === true) {
    if (!isShort) {
      trimSignals.push({
        id: "high_iv_crush_risk",
        reason: "IV rank is elevated — high risk of IV crush collapsing option premium after a catalyst.",
      });
    } else {
      holdSignals.push({
        id: "high_iv_premium_tailwind",
        reason: "Elevated IV rank — high premium supports this short; decay accelerates from a high base.",
      });
    }
  }

  // Dark pool bias against the position → trim (smart money leaning the wrong way).
  // Dark pool bias aligned with the position → hold support.
  if (ctx?.darkPoolBias && ctx.darkPoolBias !== "neutral") {
    const dpBullish = ctx.darkPoolBias === "bullish";
    const dpAligned = dpBullish === wantsUp;
    if (!dpAligned) {
      trimSignals.push({
        id: "dark_pool_against",
        reason: `Dark pool prints lean ${ctx.darkPoolBias} — against this position's exposure.`,
      });
    } else {
      holdSignals.push({
        id: "dark_pool_aligned",
        reason: `Dark pool prints lean ${ctx.darkPoolBias} — aligned with this position.`,
      });
    }
  }

  // Insider net selling → trim a long (directors/officers reducing exposure is bearish).
  // For a short, insider selling supports the thesis.
  if (ctx?.insiderNetSell === true) {
    if (!isShort) {
      trimSignals.push({
        id: "insider_sell",
        reason: "Recent insider net selling — insiders reducing exposure; consider trimming.",
      });
    } else {
      holdSignals.push({
        id: "insider_sell_supports_short",
        reason: "Recent insider net selling supports the short thesis.",
      });
    }
  }

  // Short squeeze risk → hold/trim-aware signal. High days-to-cover means a sharp up move
  // could trigger a squeeze — bullish for a long call/short put. For a long put/short call
  // (bearish exposure), it's a headwind.
  if (ctx?.shortSqueezeRisk === true) {
    if (wantsUp) {
      holdSignals.push({
        id: "short_squeeze_risk",
        reason: "High short interest (days-to-cover ≥ 5) — squeeze potential supports the bullish position.",
      });
    } else {
      trimSignals.push({
        id: "short_squeeze_against",
        reason: "High short interest (days-to-cover ≥ 5) — squeeze risk is a headwind for this bearish position.",
      });
    }
  }

  // -------------------- IV rank signals (fire ONLY when ivRank is present on ctx) --------------------
  // Three granular IV rank signals — all honor the data-absent honesty rule:
  //   1. High IV rank (>75) on a long → elevated risk of IV crush collapsing premium (TRIM).
  //      Distinct from the existing highIvCrushRisk (dossier-sourced boolean): this fires on the
  //      raw rank value with a tighter threshold so it can trigger even when no catalyst is known.
  //   2. Low IV rank (<25) on a short premium position → collected premium is thin; risk/reward
  //      of holding a short with depressed IV is poor (TRIM).
  //   3. IV rank has dropped >15 points from entry → IV crush already in progress, TRIM regardless
  //      of current level. Fires only when entryIv is also present (honesty rule: no entry baseline
  //      → signal never fires). TRIM for longs (P&L damage from vega bleed); HOLD note for shorts
  //      (IV crush is their income engine working as intended, not a risk).

  const ivRank = ctx?.ivRank;
  const ivRankPresent = ivRank != null && Number.isFinite(ivRank);

  if (ivRankPresent && ivRank > 75 && !isShort) {
    trimSignals.push({
      id: "iv_elevated_long_risk",
      reason: `IV rank ${ivRank.toFixed(0)} is elevated (>75) — high risk of IV crush collapsing option premium on this long position.`,
    });
  }

  if (ivRankPresent && ivRank < 25 && isShort) {
    trimSignals.push({
      id: "iv_low_short_risk",
      reason: `IV rank ${ivRank.toFixed(0)} is depressed (<25) — premium collected on this short is thin; risk/reward of holding is poor.`,
    });
  }

  const entryIv = ctx?.entryIv;
  const entryIvPresent = entryIv != null && Number.isFinite(entryIv);
  if (ivRankPresent && entryIvPresent && entryIv - ivRank > 15) {
    if (!isShort) {
      trimSignals.push({
        id: "iv_crush_in_progress",
        reason: `IV rank dropped ${(entryIv - ivRank).toFixed(0)} points since entry (${entryIv.toFixed(0)} → ${ivRank.toFixed(0)}) — IV crush is eroding this long's vega value.`,
      });
    } else {
      holdSignals.push({
        id: "iv_crush_tailwind",
        reason: `IV rank dropped ${(entryIv - ivRank).toFixed(0)} points since entry (${entryIv.toFixed(0)} → ${ivRank.toFixed(0)}) — IV crush is working for this short (premium decaying faster).`,
      });
    }
  }

  // -------------------- Resolve action by precedence --------------------

  let action: VerdictAction;
  let fired: SignalHit[];

  if (sellSignals.length > 0) {
    action = "sell";
    fired = sellSignals;
  } else if (trimSignals.length > 0) {
    action = "trim";
    fired = trimSignals;
  } else if (holdSignals.length > 0) {
    action = "hold";
    fired = holdSignals;
  } else {
    // Live data, but nothing decisive fired (e.g. mid-range, no Greeks). Watch.
    action = "watch";
    fired = [
      {
        id: "no_decisive_signal",
        reason: "No decisive signal — monitoring; not enough to act on.",
      },
    ];
  }

  // Confidence: more agreeing signals → higher conviction.
  let confidence: VerdictConfidence;
  if (action === "watch") {
    confidence = "low";
  } else if (fired.length >= 3) {
    confidence = "high";
  } else if (fired.length === 2) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    action,
    confidence,
    reasons: fired.map((s) => s.reason),
    signals: fired.map((s) => s.id),
  };
}
