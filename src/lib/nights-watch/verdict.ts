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
// If valuation isn't live, the verdict is "watch" (we can't judge). If there's no
// desk context, the GEX/wall signals are simply never evaluated — never faked.

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
  /** pnl_pct at/below this = deep loss, thesis likely broken. */
  DEEP_LOSS_PCT: -60,
  /** pnl_pct at/above this = lock partial / take some risk off. */
  GAIN_LOCK_PCT: 50,
  /** pnl_pct at/above this = strong winner, trim conviction rises. */
  GAIN_STRONG_PCT: 100,
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
  if (!ctx || ctx.source !== "spx-desk") return null;
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
  if (!ctx || ctx.source !== "spx-desk") return null;
  const spot = ctx.underlyingPrice;
  if (spot == null || !(spot > 0) || ctx.gexWalls.length === 0) return null;

  const wantsUp =
    (position.option_type === "call" && position.side === "long") ||
    (position.option_type === "put" && position.side === "short");

  // A wall acts as a floor (support) for bullish exposure / ceiling for bearish.
  // If price has dropped below what should be the nearest SUPPORT (bullish) or
  // risen above the nearest RESISTANCE (bearish), the protective wall has broken.
  if (wantsUp) {
    const supports = ctx.gexWalls.filter((w) => w.kind === "support");
    const brokenBelow = supports.find((w) => spot < w.strike); // support now above spot
    if (brokenBelow) return { wallStrike: brokenBelow.strike };
  } else {
    const resistances = ctx.gexWalls.filter((w) => w.kind === "resistance");
    const brokenAbove = resistances.find((w) => spot > w.strike); // resistance now below spot
    if (brokenAbove) return { wallStrike: brokenAbove.strike };
  }
  return null;
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

  const sellSignals: SignalHit[] = [];
  const trimSignals: SignalHit[] = [];
  const holdSignals: SignalHit[] = [];

  // -------------------- SELL-leaning --------------------

  // Expiry-worthless risk: at/near expiry AND OTM (or very low delta).
  if (dte <= T.EXPIRY_DTE) {
    const otm = isOtm(position, underlyingPrice);
    const lowDelta = absDelta != null && absDelta < T.LOW_ABS_DELTA;
    if (otm === true || lowDelta) {
      sellSignals.push({
        id: "expiry_worthless_risk",
        reason: `Expiry-worthless risk: ${dte}DTE and ${
          otm === true ? "out-of-the-money" : `low |delta| ${absDelta?.toFixed(2)}`
        }.`,
      });
    }
  }

  // Deep loss — thesis likely broken.
  if (pnl != null && pnl <= T.DEEP_LOSS_PCT) {
    sellSignals.push({
      id: "deep_loss",
      reason: `Deep loss (${pnl.toFixed(0)}%) — thesis likely broken.`,
    });
  }

  // Underlying pushed THROUGH a GEX wall against the position (SPX only).
  const broken = pushedThroughWallAgainst(position, ctx);
  if (broken) {
    sellSignals.push({
      id: "gex_wall_broken_against",
      reason: `Underlying pushed through the ${broken.wallStrike} GEX wall against the position.`,
    });
  }

  // -------------------- TRIM-leaning --------------------

  // Lock partial on a strong gain.
  if (pnl != null && pnl >= T.GAIN_LOCK_PCT) {
    const strong = pnl >= T.GAIN_STRONG_PCT;
    trimSignals.push({
      id: strong ? "gain_lock_strong" : "gain_lock",
      reason: `Up ${pnl.toFixed(0)}% — lock partial profit${strong ? " (strong winner)" : ""}.`,
    });
  }

  // Accelerating theta decay: large theta/day relative to mark, with low DTE.
  if (
    v.theta != null &&
    Number.isFinite(v.theta) &&
    v.mark > 0 &&
    dte <= T.LOW_DTE
  ) {
    const burn = Math.abs(v.theta) / v.mark;
    if (burn >= T.THETA_BURN_FRACTION) {
      trimSignals.push({
        id: "theta_decay",
        reason: `Accelerating decay: theta is ${(burn * 100).toFixed(0)}% of mark/day at ${dte}DTE.`,
      });
    }
  }

  // Price approaching a GEX wall / key level into the position (SPX only).
  const wall = nearestWallSignal(position, ctx);
  if (wall?.approaching) {
    trimSignals.push({
      id: "approaching_gex_wall",
      reason: `Price approaching the ${wall.wallStrike} GEX wall in the position's path.`,
    });
  }

  // -------------------- HOLD-leaning --------------------

  // Healthy directional exposure.
  if (absDelta != null && absDelta >= T.HEALTHY_ABS_DELTA) {
    holdSignals.push({
      id: "healthy_delta",
      reason: `Healthy directional exposure (|delta| ${absDelta.toFixed(2)}).`,
    });
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
