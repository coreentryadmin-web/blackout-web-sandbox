import type { FlowStrikeStack } from "@/lib/largo/flow-strike-stacks";
import type { BenzingaCatalyst, BenzingaPriceTarget, FundamentalSignals, PolygonFinancialRatios } from "@/lib/providers/polygon";
import type { PredictionConsensusSignal } from "@/lib/providers/unusual-whales";
import type { TickerGreekFlowSummary } from "./dossier";
import type { TideBias } from "./format";
import { tideBias } from "./format";
import type { FlowStreak } from "./flow-streak";
import type { MarketWideContext } from "./market-wide";
import type { PositioningSummary } from "./positioning";
import type { TechnicalCard } from "./technicals";
import { assignNighthawkTier } from "./nighthawk-tiers";

export type NightHawkRegimeContext = {
  vix_iv_rank: number | null;
  tide_bias: TideBias;
  /** Percentage of advancing issues (0–100). Used in breadth-regime multiplier. */
  advance_pct?: number | null;
  /** Composite regime from market_regime table (platform intel). */
  composite_regime?: string | null;
  /** Critical flow anomalies in the last hour — names to treat cautiously. */
  anomaly_tickers?: string[];
};

export type ScoredCandidate = {
  ticker: string;
  score: number;
  direction: "long" | "short";
  flow_score: number;
  tech_score: number;
  pos_score: number;
  news_score: number;
  smart_money_score: number;
  /** Signed fundamental tailwind/headwind contribution (bounded ±FUNDAMENTAL_CAP). */
  fundamental_score?: number;
  /** Small signed catalyst-awareness nudge (bounded ±CATALYST_CAP) — minor modifier, never an override. */
  catalyst_score?: number;
  /** Human-readable catalyst notes surfaced into the dossier/edition meta (e.g. "binary FDA event ahead"). */
  catalyst_flags?: string[];
  /** Short-interest squeeze bonus (longs only, capped +5). */
  short_interest_score?: number;
  /** Earnings proximity penalty applied to catalyst_score. Set when earnings are tomorrow with matching expiry. */
  earnings_risk?: boolean;
  /** Count of scoring dimensions with material positive contribution (≥ threshold). */
  confirming_signals?: number;
  conviction: string;
  regime_multiplier?: number;
  fundamental_block?: boolean;
  fundamental_flags?: string[];
  trading_halt?: boolean;
  sector?: string;
};

export function regimeContextFromMarket(ctx: MarketWideContext): NightHawkRegimeContext {
  return {
    vix_iv_rank: ctx.vix_iv_rank,
    tide_bias: tideBias(ctx.tide),
    advance_pct: ctx.market_breadth?.pct_advancing ?? null,
    composite_regime: ctx.platform_intel?.composite_regime ?? null,
    anomaly_tickers: ctx.platform_intel?.anomaly_tickers ?? [],
  };
}

/** Scale total score by VIX IV rank + market tide regime + market breadth. Cap at 1.20. */
export function computeRegimeMultiplier(regime?: NightHawkRegimeContext | null): number {
  if (!regime) return 1;
  const { vix_iv_rank: vix, tide_bias: tide, advance_pct: adv } = regime;
  let m: number;
  if (vix != null && vix > 70 && tide === "BEARISH") m = 0.7;
  else if (vix != null && vix > 55 && tide === "BEARISH") m = 0.85;
  else if (vix != null && vix < 25 && tide === "BULLISH") m = 1.15;
  else if (vix != null && vix < 40 && tide === "BULLISH") m = 1.1;
  else m = 1;

  // Market breadth nudge: bullish breadth thrust (>75% advancing) or breadth collapse (<30%).
  if (adv != null) {
    if (adv > 75) m += 0.05;
    else if (adv < 30) m -= 0.05;
  }

  return Math.min(1.20, m);
}

function normalizeRatioPct(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.abs(v) > 1 ? v / 100 : v;
}

/**
 * Fundamental sanity check — flags broken fundamentals for SOFT demotion in Night Hawk ranking.
 * Uses the widened real-time ratios (valuation/leverage/liquidity) PLUS the derived statement
 * signals (collapsing margins, P/S blowout). Each flag is a soft demotion, never a hard cut (#77).
 */
export function passesFundamentalSanity(
  ratios: PolygonFinancialRatios | null,
  signals?: FundamentalSignals | null
): {
  ok: boolean;
  reasons: string[];
} {
  if (!ratios && !signals) return { ok: true, reasons: [] };
  const reasons: string[] = [];
  if (ratios) {
    const pe = ratios.pe_ratio;
    if (pe != null && (pe < 0 || pe > 120)) {
      reasons.push(`P/E ${pe.toFixed(1)} extreme`);
    }
    const roe = normalizeRatioPct(ratios.roe);
    if (roe != null && roe < -0.05) {
      reasons.push(`ROE ${(roe * 100).toFixed(1)}% negative`);
    }
    const de = ratios.debt_to_equity;
    if (de != null && de > 3) {
      reasons.push(`D/E ${de.toFixed(1)} elevated`);
    }
    // Liquidity: a current ratio below 1 (or negative/zero) means current liabilities exceed
    // current assets — a working-capital squeeze. Negative is nonsensical = data break.
    const cr = ratios.current_ratio;
    if (cr != null && cr < 1) {
      reasons.push(`current ratio ${cr.toFixed(2)} (<1, working-capital squeeze)`);
    }
    // P/S blowout: a price-to-sales multiple north of 30 is a froth/valuation-risk signal.
    const ps = ratios.price_to_sales;
    if (ps != null && ps > 30) {
      reasons.push(`P/S ${ps.toFixed(1)} blowout`);
    }
  }
  // Collapsing margins: a contracting net margin AND a falling EPS trajectory together = a
  // deteriorating earnings engine the flow may be running ahead of.
  if (signals) {
    if (signals.margin_trend === "contracting" && signals.eps_trajectory === "falling") {
      reasons.push("margins contracting + EPS falling");
    }
    if (signals.net_margin_pct != null && signals.net_margin_pct < -10) {
      reasons.push(`net margin ${signals.net_margin_pct.toFixed(0)}% deeply negative`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Fundamental tailwind/headwind MODIFIER. Returns a small signed point adjustment (bounded
 * ±FUNDAMENTAL_CAP) layered onto the technical/flow base — a nudge, NOT an override. Rewards
 * revenue growth, strong/expanding margins, positive/rising FCF, low debt / net cash, and buybacks;
 * demotes the opposite. Direction-aware: for SHORTs the sign flips (weak fundamentals favor the short).
 */
export const FUNDAMENTAL_CAP = 8;

export function scoreFundamentalTailwind(
  ratios: PolygonFinancialRatios | null | undefined,
  signals: FundamentalSignals | null | undefined,
  direction: "long" | "short"
): number {
  if (!ratios && !signals) return 0;
  let raw = 0;

  if (signals) {
    // Revenue growth.
    if (signals.revenue_yoy_pct != null) {
      if (signals.revenue_yoy_pct >= 25) raw += 3;
      else if (signals.revenue_yoy_pct >= 10) raw += 2;
      else if (signals.revenue_yoy_pct < 0) raw -= 2;
    }
    // Margins (level + trend).
    if (signals.operating_margin_pct != null && signals.operating_margin_pct >= 20) raw += 1;
    if (signals.margin_trend === "expanding") raw += 2;
    else if (signals.margin_trend === "contracting") raw -= 2;
    // Free cash flow.
    if (signals.fcf_positive === true) raw += 2;
    else if (signals.fcf_positive === false) raw -= 2;
    if (signals.fcf_trend === "rising") raw += 1;
    else if (signals.fcf_trend === "falling") raw -= 1;
    // Balance sheet: net cash vs net debt.
    if (signals.net_cash_positive === true) raw += 2;
    else if (signals.net_cash_positive === false) raw -= 1;
    // Capital return / dilution.
    if (signals.share_count_trend === "buyback") raw += 2;
    else if (signals.share_count_trend === "dilution") raw -= 1;
    // EPS trajectory.
    if (signals.eps_trajectory === "rising") raw += 1;
    else if (signals.eps_trajectory === "falling") raw -= 1;
  }

  if (ratios) {
    // Strong returns on equity (normalized — handles 0.82 or 82 input).
    const roe = normalizeRatioPct(ratios.roe);
    if (roe != null && roe >= 0.2) raw += 1;
    // Low leverage bonus when statements didn't already cover debt.
    const de = ratios.debt_to_equity;
    if (de != null && de >= 0 && de < 0.5) raw += 1;
  }

  // For a SHORT, weak fundamentals SUPPORT the thesis — flip the sign so a deteriorating name
  // contributes positively to a short and a pristine balance sheet works against it.
  const signed = direction === "short" ? -raw : raw;
  return Math.max(-FUNDAMENTAL_CAP, Math.min(FUNDAMENTAL_CAP, signed));
}

/**
 * CONSERVATIVE catalyst-awareness MODIFIER from the free Benzinga catalyst channels.
 *
 * Deliberately small (bounded ±CATALYST_CAP) — a NUDGE on top of the flow/technical base, NEVER an
 * override of flow. Two effects, both conservative:
 *   1. PENALIZE buying directional premium straight into a known BINARY (FDA decision). A binary is a
 *      coin-flip on a gap, not a flow-confirmable edge — we shade the score DOWN regardless of
 *      direction so a play into an unhedged binary ranks below an equivalent play with no binary risk.
 *   2. NOTE positive catalysts (buyback authorizations, M&A involvement, guidance) with a small
 *      direction-aware tailwind: supportive for a long, a (smaller) headwind for a short.
 *
 * Returns the signed nudge plus human-readable flags for the dossier/meta. Empty catalysts ⇒ 0.
 */
export const CATALYST_CAP = 5;

export function scoreCatalystAwareness(
  catalysts: BenzingaCatalyst[] | null | undefined,
  direction: "long" | "short"
): { score: number; flags: string[] } {
  if (!catalysts || !catalysts.length) return { score: 0, flags: [] };
  let raw = 0;
  const flags: string[] = [];

  let binaryFlagged = false;
  let positiveFlagged = false;
  for (const c of catalysts) {
    switch (c.type) {
      case "binary":
        // FDA-type binary ahead — penalize a directional premium play regardless of side. Only
        // count it ONCE so a name with three FDA headlines isn't triple-penalized.
        if (!binaryFlagged) {
          raw -= 3;
          binaryFlagged = true;
          flags.push("binary event ahead (FDA) — directional premium is a coin-flip");
        }
        break;
      case "buyback":
        if (!positiveFlagged) {
          raw += direction === "long" ? 2 : -1;
          positiveFlagged = true;
          flags.push("buyback authorization");
        }
        break;
      case "m&a":
        if (!positiveFlagged) {
          raw += direction === "long" ? 2 : -1;
          positiveFlagged = true;
          flags.push("M&A involvement");
        }
        break;
      case "guidance":
        // Guidance is a known catalyst but direction-ambiguous from the channel alone — a tiny,
        // side-neutral awareness note only (no scoring weight), so we don't guess raise vs cut.
        flags.push("guidance update");
        break;
      case "insider":
        flags.push("insider transaction");
        break;
      case "offering":
        // A dilutive offering is a headwind for a long; mild tailwind for a short.
        raw += direction === "long" ? -2 : 1;
        flags.push("offering (potential dilution)");
        break;
      case "short":
        flags.push("short-seller activity");
        break;
      default:
        break;
    }
  }

  const score = Math.max(-CATALYST_CAP, Math.min(CATALYST_CAP, raw));
  return { score, flags };
}

function safeFloat(v: unknown): number {
  const n = Number(String(v ?? 0).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function boolish(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function flowTradeSide(r: Record<string, unknown>): "A" | "B" | "M" {
  const raw = String(r.side ?? r.trade_side ?? r.tag_side ?? "").toUpperCase().trim();
  if (raw === "A" || raw === "ASK" || raw.startsWith("ASK")) return "A";
  if (raw === "B" || raw === "BID" || raw.startsWith("BID")) return "B";
  if (raw === "M" || raw === "MID" || raw.startsWith("MID")) return "M";

  const askPct = safeFloat(r.ask_side_pct);
  if (askPct >= 60) return "A";
  const bidPct = safeFloat(r.bid_side_pct);
  if (bidPct >= 60) return "B";

  const prem = safeFloat(r.total_premium ?? r.premium);
  const askPrem = safeFloat(r.total_ask_side_prem);
  const bidPrem = safeFloat(r.total_bid_side_prem);
  if (prem > 0 && askPrem / prem >= 0.6) return "A";
  if (prem > 0 && bidPrem / prem >= 0.6) return "B";
  return "M";
}

function flowOpeningMultiplier(r: Record<string, unknown>): number {
  if (boolish(r.is_opening) || boolish(r.all_opening_trades)) return 1.2;
  if (boolish(r.is_closing) || boolish(r.all_closing_trades)) return 0.8;
  return 1;
}

function flowSweepMultiplier(r: Record<string, unknown>): number {
  return boolish(r.is_sweep ?? r.has_sweep) ? 2 : 1;
}

function flowSideMultiplier(side: "A" | "B" | "M"): number {
  if (side === "A") return 1.3;
  if (side === "B") return 0.7;
  return 1;
}

export function scoreFlowQuality(
  flows: Record<string, unknown>[],
  flowStreak?: FlowStreak,
  opts?: { streakWeight?: number; riskReversalSkew?: number | null }
): { score: number; direction: "long" | "short"; directionFlippedBySkew: boolean } {
  if (!flows.length) return { score: 0, direction: "long", directionFlippedBySkew: false };

  let totalPrem = 0;
  let sweepPrem = 0;
  let askPrem = 0;
  let openingPrem = 0;
  let callPrem = 0;
  let putPrem = 0;
  let callWeightedPrem = 0;
  let putWeightedPrem = 0;
  const strikes = new Set<string>();

  for (const r of flows) {
    const prem = safeFloat(r.total_premium ?? r.premium);
    if (prem <= 0) continue;
    totalPrem += prem;
    const opt = String(r.type ?? r.option_type ?? "").toLowerCase();
    const isCall = opt.startsWith("c");
    if (isCall) callPrem += prem;
    else putPrem += prem;

    const base = prem / 1_000_000;
    const weightedPremium =
      base *
      flowSweepMultiplier(r) *
      flowSideMultiplier(flowTradeSide(r)) *
      flowOpeningMultiplier(r);
    if (isCall) callWeightedPrem += weightedPremium;
    else putWeightedPrem += weightedPremium;

    if (boolish(r.has_sweep ?? r.is_sweep)) sweepPrem += prem;
    const askPct = safeFloat(r.ask_side_pct ?? r.total_ask_side_prem);
    if (askPct >= 60 || safeFloat(r.total_ask_side_prem) / prem >= 0.6) askPrem += prem;
    if (boolish(r.all_opening_trades ?? r.is_opening)) openingPrem += prem;
    const strike = String(r.strike ?? "");
    const exp = String(r.expiry ?? r.expiration ?? "").slice(0, 10);
    if (strike && exp) strikes.add(`${strike}_${exp}`);
  }

  let score = 0;
  if (totalPrem >= 5_000_000) score += 15;
  else if (totalPrem >= 2_000_000) score += 12;
  else if (totalPrem >= 1_000_000) score += 9;
  else if (totalPrem >= 500_000) score += 6;
  else if (totalPrem >= 250_000) score += 3;

  const sweepPct = totalPrem > 0 ? sweepPrem / totalPrem : 0;
  if (sweepPct >= 0.8) score += 10;
  else if (sweepPct >= 0.5) score += 7;
  else if (sweepPct >= 0.2) score += 4;

  const askPct = totalPrem > 0 ? askPrem / totalPrem : 0;
  if (askPct >= 0.75) score += 7;
  else if (askPct >= 0.6) score += 4;
  else if (askPct >= 0.4) score += 2;

  const openPct = totalPrem > 0 ? openingPrem / totalPrem : 0;
  if (openPct >= 0.8) score += 5;
  else if (openPct >= 0.5) score += 3;
  else if (openPct >= 0.2) score += 1;

  if (strikes.size >= 3) score += 3;
  else if (strikes.size >= 2) score += 2;

  if (totalPrem > 0) {
    const dom = Math.max(callPrem, putPrem) / totalPrem;
    if (dom >= 0.85) score += 3;
    else if (dom >= 0.7) score += 1;
  }

  if (flowStreak?.streak_days) {
    const streakWeight = opts?.streakWeight ?? 1;
    if (flowStreak.streak_days >= 5) score += Math.round(12 * streakWeight);
    else if (flowStreak.streak_days >= 3) score += Math.round(8 * streakWeight);
  }

  score = Math.min(38, score);
  let direction: "long" | "short" =
    callWeightedPrem >= putWeightedPrem ? "long" : "short";
  let directionFlippedBySkew = false;

  const skew = opts?.riskReversalSkew;
  if (skew != null && Number.isFinite(skew) && skew !== 0) {
    // UW's `risk_reversal` field is (put IV − call IV), not (call IV − put IV) — verified
    // against live data, not just inference (see scoreSkewConfirmation's docstring below for
    // the full derivation and evidence). Positive = puts bid over calls = bearish; negative =
    // calls bid over puts = bullish. This branch was inverted until the
    // fix/nighthawk-skew-sign-flip fix (docs/audit/FINDINGS.md) — it used to treat positive
    // skew as a bullish signal, which could flip a candidate's flow-implied direction to the
    // WRONG side when flow margin was thin and skew magnitude was large.
    const skewDir: "long" | "short" = skew > 0 ? "short" : "long";
    const weightedTotal = callWeightedPrem + putWeightedPrem;
    const flowMargin = weightedTotal > 0 ? Math.abs(callWeightedPrem - putWeightedPrem) / weightedTotal : 1;

    if (skewDir !== direction) {
      if (flowMargin < 0.12 && Math.abs(skew) >= 0.3) {
        direction = skewDir;
        directionFlippedBySkew = true;
      } else if (flowMargin < 0.25 && Math.abs(skew) >= 1) {
        direction = skewDir;
        directionFlippedBySkew = true;
      }
    }
  }

  return { score, direction, directionFlippedBySkew };
}

export function scoreTechnicalSetup(tech: TechnicalCard | null, direction: "long" | "short"): number {
  if (!tech) return 0;
  let score = 0;
  const tags = tech.setup_tags.join(" ").toLowerCase();

  if (direction === "long") {
    if (tech.trend === "bullish") score += 8;
    if (tags.includes("breakout") || tags.includes("hod")) score += 6;
    if (tags.includes("bullish ma")) score += 4;
    if (tech.rsi14 != null && tech.rsi14 >= 45 && tech.rsi14 <= 65) score += 3;
    if (tags.includes("bearish") || tags.includes("overbought")) score -= 6;
  } else {
    if (tech.trend === "bearish") score += 8;
    // "gap down" only — the old `tags.includes("below")` matched the GAP-UP tag
    // "gap-fill risk below" (technicals.ts emits it for gap>0), handing +5 to a
    // short on a name that gapped UP. Substring matching on a single common word
    // against free-form tags is exactly how that slipped in.
    if (tags.includes("gap down")) score += 5;
    // Mirror of the long branch's MA-stack reward — shorts previously had no
    // structure reward at all beyond the trend read.
    if (tags.includes("bearish ma")) score += 4;
    if (tech.rsi14 != null && tech.rsi14 >= 55) score += 3;
    // Mirror of the long branch's breakout reward: a name printing fresh highs
    // (20d breakout / HOD break) is structurally AGAINST a short — penalize it
    // the same way bullish structure was never penalized before.
    if (tags.includes("breakout") || tags.includes("hod")) score -= 6;
    if (tags.includes("bullish ma") || tags.includes("oversold")) score -= 6;
  }

  if ((tech.rel_volume ?? 0) >= 1.5) score += 4;
  return Math.max(-10, Math.min(28, score));
}

function darkPoolBiasMatchesDirection(
  bias: string | undefined,
  direction: "long" | "short"
): boolean | null {
  const b = (bias ?? "").toLowerCase();
  if (!b || b === "neutral" || b === "mixed") return null;
  if (direction === "long") return b === "bullish";
  return b === "bearish";
}

/** Does a strike stack's option side support the play direction? Calls back longs, puts back shorts. */
function stackAlignsWithDirection(stack: FlowStrikeStack, direction: "long" | "short"): boolean {
  const t = (stack.option_type ?? "").toLowerCase();
  if (!t) return false;
  return direction === "long" ? t.startsWith("c") : t.startsWith("p");
}

export function scoreOptionsPositioning(
  dossier: {
    dark_pool?: { total_premium?: number; bias?: string } | null;
    oi_change?: Array<{ oi_change?: number; option_type?: string }>;
    positioning?: PositioningSummary;
    strike_stacks?: FlowStrikeStack[];
    greek_flow?: TickerGreekFlowSummary | null;
  },
  direction: "long" | "short"
): number {
  let score = 0;
  const dp = dossier.dark_pool?.total_premium ?? 0;
  let dpPoints = 0;
  if (dp >= 50_000_000) dpPoints = 6;
  else if (dp >= 20_000_000) dpPoints = 4;
  else if (dp >= 5_000_000) dpPoints = 2;

  // Alignment-weighted, not magnitude-for-free: full points only when the dark-pool
  // bias CONFIRMS the direction; half when the bias is unknown/neutral (size alone is
  // weak evidence); zero when it CONTRADICTS. The old weighting was inverted at both
  // ends — unknown bias got full points and a contradicting bias still got half.
  const biasMatch = darkPoolBiasMatchesDirection(dossier.dark_pool?.bias, direction);
  if (dpPoints > 0) {
    if (biasMatch === true) score += dpPoints;
    else if (biasMatch === null) score += dpPoints * 0.5;
    // contradicting bias: 0
  }

  // Strike stacks carry their option side — a stack of PUTS is not evidence for a
  // LONG. Only direction-aligned stacks score (the old check was side-blind).
  const stacks = (dossier.strike_stacks ?? []).filter((s) => stackAlignsWithDirection(s, direction));
  if (stacks.some((s) => s.repeated_hits)) score += 4;
  if (stacks.some((s) => s.same_strike_accumulation)) score += 3;

  const pos = dossier.positioning;
  // Negative gamma = dealers amplify moves — momentum tailwind for EITHER direction,
  // deliberately unsigned.
  if (pos?.negative_gamma) score += 2;
  // (Removed: +1 for net_vex merely being present and +1 for max_pain being present —
  // those rewarded data AVAILABILITY, not signal, granting free points to tickers
  // with richer coverage.)

  // OI change only counts when it agrees with the thesis: rising call OI backs a
  // long, rising put OI backs a short. Row count alone (the old `length >= 3`) was
  // another presence-as-signal freebie.
  const oi = dossier.oi_change ?? [];
  const alignedOi = oi.filter((r) => {
    const grew = (r.oi_change ?? 0) > 0;
    if (!grew) return false;
    const t = (r.option_type ?? "").toLowerCase();
    return direction === "long" ? t.startsWith("c") : t.startsWith("p");
  });
  if (alignedOi.length >= 2) score += 2;

  // Dealer greek flow alignment: if per-ticker net delta confirms direction, bonus +3.
  // Contradicting flow penalises −1 (mild — dealers can be wrong short-term).
  const gf = dossier.greek_flow;
  if (gf && gf.row_count > 0) {
    const deltaAligns =
      direction === "long" ? gf.bias === "bullish" : gf.bias === "bearish";
    const deltaContradicts =
      direction === "long" ? gf.bias === "bearish" : gf.bias === "bullish";
    if (deltaAligns) score += 3;
    else if (deltaContradicts) score -= 1;
  }

  return Math.min(18, Math.max(0, score));
}

function predictionAlignsWithDirection(
  signal: PredictionConsensusSignal | null | undefined,
  direction: "long" | "short"
): boolean {
  if (!signal || signal.direction === "neutral") return false;
  return direction === "long" ? signal.direction === "bullish" : signal.direction === "bearish";
}

/** Net institutional direction: +1 net buying, -1 net selling, 0 unknown/flat. */
function institutionalNetSignal(rows: Record<string, unknown>[]): -1 | 0 | 1 {
  if (!rows.length) return 0;
  let net = 0;
  for (const row of rows) {
    const change = Number(
      row.change ?? row.shares_change ?? row.units_change ?? row.change_in_shares ?? row.net_change ?? NaN
    );
    if (Number.isFinite(change) && change !== 0) {
      net += change;
      continue;
    }
    const action = String(row.action ?? row.transaction_type ?? row.type ?? "").toLowerCase();
    if (/buy|added|increase|new|accumul/.test(action)) net += 1;
    else if (/sell|reduced|decrease|trim|liquidat/.test(action)) net -= 1;
  }
  if (net > 0) return 1;
  if (net < 0) return -1;
  return 0;
}

/**
 * Direction weight for a congressional trade row: 1 when the disclosed side backs the
 * play (buys back longs, sells back shorts), 0 when it contradicts, 0.5 when the side
 * is missing/unparseable (presence is weak evidence either way). The old code summed
 * pure recency with no side check — a congressperson SELLING scored a LONG.
 */
function congressSideWeight(row: Record<string, unknown>, direction: "long" | "short"): number {
  const side = String(
    row.txn_type ?? row.transaction_type ?? row.transaction ?? row.type ?? row.trade_type ?? ""
  ).toLowerCase();
  if (!side) return 0.5;
  const isBuy = /buy|purchase/.test(side);
  const isSell = /sell|sale/.test(side);
  if (!isBuy && !isSell) return 0.5;
  if (direction === "long") return isBuy ? 1 : 0;
  return isSell ? 1 : 0;
}

/**
 * Recency decay for congressional trades — more recent disclosures carry more signal.
 * 0-7 days: 1.0x, 8-14 days: 0.7x, 15-30 days: 0.4x.
 */
function congressTradeDecayMultiplier(row: Record<string, unknown>): number {
  const raw =
    row.filed_at ??
    row.filed_date ??
    row.transaction_date ??
    row.transactionDate ??
    row.disclosure_date ??
    row.date ??
    row.created_at;
  if (raw == null || raw === "") return 0.4;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return 0.4;
  const ageDays = (Date.now() - d.getTime()) / 86_400_000;
  if (ageDays <= 7) return 1.0;
  if (ageDays <= 14) return 0.7;
  return 0.4;
}

export function scoreSmartMoney(
  dossier: {
    predictions_signal?: PredictionConsensusSignal | null;
    congress_unusual?: Record<string, unknown>[];
    congress_trades?: Record<string, unknown>[];
    institutional_activity?: Record<string, unknown>[];
  },
  direction: "long" | "short"
): number {
  let score = 0;
  if (predictionAlignsWithDirection(dossier.predictions_signal, direction)) score += 4;
  // congress_unusual: recency-weighted AND side-aligned (max 3 pts). A disclosed sale
  // no longer scores a long.
  if ((dossier.congress_unusual?.length ?? 0) > 0) {
    const unusualScore = (dossier.congress_unusual ?? []).reduce(
      (sum, row) => sum + congressTradeDecayMultiplier(row) * congressSideWeight(row, direction),
      0
    );
    score += Math.min(3, unusualScore);
  }
  // congress_trades: same recency × side weighting (max 2 pts).
  if ((dossier.congress_trades?.length ?? 0) > 0) {
    const tradeScore = (dossier.congress_trades ?? []).reduce(
      (sum, row) => sum + congressTradeDecayMultiplier(row) * congressSideWeight(row, direction),
      0
    );
    score += Math.min(2, tradeScore);
  }
  // Institutional flow is mirrored: net buying backs a LONG (+3) and actively
  // contradicts a SHORT (-2), and vice versa — the old unconditional
  // `netBuying → +3` handed institutional ACCUMULATION as a bonus to shorts.
  const inst = institutionalNetSignal(dossier.institutional_activity ?? []);
  if (inst !== 0) {
    const aligns = direction === "long" ? inst > 0 : inst < 0;
    score += aligns ? 3 : -2;
  }
  return Math.max(-2, Math.min(8, score));
}

/**
 * Short-interest squeeze bonus for LONG plays only.
 * Uses days_to_cover as the proxy for short float size (no short_float available from Polygon).
 * days_to_cover > 5 ≈ moderate short (>20% float); > 10 ≈ heavy short (>30% float).
 * Cap at +5 for longs; 0 for shorts (high short interest headwinds a short thesis less reliably).
 */
export function scoreShortInterest(
  short_days_to_cover: number | null | undefined,
  direction: "long" | "short"
): number {
  if (direction !== "long") return 0;
  if (short_days_to_cover == null || !Number.isFinite(short_days_to_cover) || short_days_to_cover <= 0) return 0;
  if (short_days_to_cover > 10) return 5;
  if (short_days_to_cover > 5) return 3;
  return 0;
}

export function scoreNewsCatalyst(
  dossier: {
    news_headlines?: string[];
    insider_buys?: number;
  },
  direction: "long" | "short"
): number {
  const headlines = dossier.news_headlines ?? [];
  // Coverage bonus is direction-neutral: a name in the news is more liquid/tradable
  // either way.
  let score = headlines.length >= 3 ? 2 : 0;

  // Sentiment is computed on a BULLISH axis, then signed by direction — the old code
  // added bullish sentiment unconditionally, so a SHORT on a stock with upgrades and
  // positive headlines got up to +8 added to its short score. Bearish news is what
  // supports a short.
  let bullish = 0;
  const positiveCount = headlines.filter((h) => h.toLowerCase().startsWith("positive:")).length;
  const negativeCount = headlines.filter((h) => h.toLowerCase().startsWith("negative:")).length;
  if (positiveCount > negativeCount) bullish += 2;
  else if (negativeCount > positiveCount) bullish -= 2;
  const text = headlines.join(" ").toLowerCase();
  // NOTE: "buyback" deliberately absent — announced buybacks already score in
  // scoreCatalystAwareness (event, direction-aware) and realized buybacks in
  // scoreFundamentalTailwind (share-count trend). Keeping it here triple-counted
  // one corporate action for up to +7.
  if (/upgrade|beat|approval|partnership/.test(text)) bullish += 3;
  if (/downgrade|miss|investigation|lawsuit/.test(text)) bullish -= 2;
  // Insider buying is a bullish datapoint — it supports a long and contradicts a short.
  if ((dossier.insider_buys ?? 0) > 0) bullish += 2;

  score += direction === "long" ? bullish : -bullish;
  return Math.max(-6, Math.min(8, score));
}

export function convictionFromScore(score: number): string {
  if (score >= 70) return "A+";
  if (score >= 55) return "A";
  if (score >= 40) return "B";
  return "C";
}

/** Ordinal rank for conviction letters (higher = stronger). Unknown letters read as B. */
export function convictionRank(conviction: string): number {
  const c = conviction.trim().toUpperCase();
  if (c === "A+") return 4;
  if (c === "A") return 3;
  if (c === "B") return 2;
  if (c === "C") return 1;
  return 2;
}

/**
 * UW's `risk_reversal` field (the source of `dossierExtras.risk_reversal_skew`, parsed by
 * vol-metrics.ts's `parseLatestRiskReversalSkew`) is (put IV − call IV), NOT (call IV − put
 * IV) — verified against LIVE data: `GET /api/stock/SPY/historical-risk-reversal-skew` on
 * 2026-07-04 returned 29 daily 25-delta rows spanning 2026-05-21..2026-07-02, EVERY ONE
 * positive (+0.0067 to +0.0663), e.g. `{"date":"2026-07-02","ticker":"SPY","delta":25,
 * "risk_reversal":"0.0663361729210146"}`. A "call IV minus put IV" definition would be
 * predominantly NEGATIVE for an equity index — the persistent put-side volatility
 * smirk/skew is one of the most robust stylized facts in index options, so a multi-week run
 * of all-positive values under that definition would be the anomaly, not the norm. That
 * confirms positive = puts bid over calls = fear/hedging demand = BEARISH; negative = calls
 * bid over puts = complacency/call demand = BULLISH. Matches vol-metrics.ts's
 * `parseLatestRiskReversalSkew` docstring and src/lib/spx-signals-shadow-skew.ts's
 * `computeSkewShadowFactor` (SPX Slayer's shadow-mode equivalent, which already had this
 * sign right).
 *
 * PRE-FIX HISTORY: this function previously read "positive RR skew = calls bid over puts =
 * bullish" — backwards relative to the evidence above. Because this feeds NightHawk's live
 * `scoreCandidate` path (unlike SPX Slayer's shadow-only skew factor, which never touches a
 * real score), the inverted sign was actively mis-scoring real ticker candidates: a
 * bearish-skew (positive) reading was rewarding LONG candidates and penalizing SHORT
 * candidates, the exact opposite of what the options market was pricing. Fixed in
 * fix/nighthawk-skew-sign-flip — see docs/audit/FINDINGS.md for the full writeup.
 */
export function scoreSkewConfirmation(
  skew: number | null | undefined,
  direction: "long" | "short"
): number {
  if (skew == null || !Number.isFinite(skew) || skew === 0) return 0;
  const skewDir: "long" | "short" = skew > 0 ? "short" : "long";
  return skewDir === direction ? 3 : -2;
}

export function scoreCandidate(
  ticker: string,
  flows: Record<string, unknown>[],
  tech: TechnicalCard | null,
  dossierExtras: {
    dark_pool?: { total_premium?: number; bias?: string } | null;
    oi_change?: Array<{ oi_change?: number; option_type?: string }>;
    positioning?: PositioningSummary;
    strike_stacks?: FlowStrikeStack[];
    news_headlines?: string[];
    insider_buys?: number;
    predictions_signal?: PredictionConsensusSignal | null;
    congress_unusual?: Record<string, unknown>[];
    congress_trades?: Record<string, unknown>[];
    institutional_activity?: Record<string, unknown>[];
    fundamental_ratios?: PolygonFinancialRatios | null;
    fundamental_signals?: FundamentalSignals | null;
    catalysts?: BenzingaCatalyst[] | null;
    trading_halt?: boolean;
    risk_reversal_skew?: number | null;
    /** Short interest days-to-cover from Polygon. Used for squeeze bonus on long plays. */
    short_days_to_cover?: number | null;
    /** Nearest earnings date (YYYY-MM-DD). Used for binary-event penalty when play expiry is same day. */
    earnings_date?: string | null;
    /** Today's date (YYYY-MM-DD ET). Used for earnings proximity calculation. */
    today_ymd?: string | null;
    /** Tomorrow's date (YYYY-MM-DD ET). Used for earnings proximity calculation. */
    tomorrow_ymd?: string | null;
    /** Most recent analyst price target action from Benzinga. Used to nudge catalyst_score. */
    benzinga_price_target?: BenzingaPriceTarget | null;
    /** Per-ticker dealer greek flow summary (net delta/gamma bias). */
    greek_flow?: TickerGreekFlowSummary | null;
    /** IV rank percentile (0-100). Elevated IV = expensive options, risk flag. */
    iv_rank?: number | null;
    /** Upcoming FDA calendar events for this ticker (UW). */
    fda_events?: Record<string, unknown>[];
  },
  flowStreak?: FlowStreak,
  regime?: NightHawkRegimeContext | null,
  scoring?: { streakWeight?: number }
): ScoredCandidate {
  if (dossierExtras.trading_halt) {
    return {
      ticker,
      score: 0,
      direction: "long",
      flow_score: 0,
      tech_score: 0,
      pos_score: 0,
      news_score: 0,
      smart_money_score: 0,
      conviction: "C",
      trading_halt: true,
      fundamental_block: true,
      fundamental_flags: ["Trading halt active"],
    };
  }

  const flow = scoreFlowQuality(flows, flowStreak, {
    streakWeight: scoring?.streakWeight,
    riskReversalSkew: dossierExtras.risk_reversal_skew,
  });
  const techScore = scoreTechnicalSetup(tech, flow.direction);
  const posScore = scoreOptionsPositioning(dossierExtras, flow.direction);
  const newsScore = scoreNewsCatalyst(dossierExtras, flow.direction);
  const smartMoneyScore = scoreSmartMoney(dossierExtras, flow.direction);
  const skewAdj = flow.directionFlippedBySkew
    ? 0
    : scoreSkewConfirmation(dossierExtras.risk_reversal_skew, flow.direction);
  // Fundamental tailwind/headwind is a MODIFIER layered on the flow/technical base — never an override.
  const fundamentalScore = scoreFundamentalTailwind(
    dossierExtras.fundamental_ratios,
    dossierExtras.fundamental_signals,
    flow.direction
  );
  // Short-interest squeeze bonus (longs only, proxy via days_to_cover).
  const shortInterestScore = scoreShortInterest(dossierExtras.short_days_to_cover, flow.direction);

  // Catalyst awareness — a SMALL, conservative nudge (binary-event penalty + positive-catalyst note).
  // Like the fundamental modifier, it layers on the base and never overrides flow direction.
  const catalyst = scoreCatalystAwareness(dossierExtras.catalysts, flow.direction);

  // Earnings proximity penalty: if earnings are today or tomorrow-premarket and the nearest
  // flow expiry is tomorrow, apply −6 to the catalyst score (floor behavior) and flag earnings_risk.
  let earningsRisk = false;
  let earningsPenalty = 0;
  const earningsDate = dossierExtras.earnings_date;
  const todayYmd = dossierExtras.today_ymd;
  const tomorrowYmd = dossierExtras.tomorrow_ymd;
  if (earningsDate && (earningsDate === todayYmd || earningsDate === tomorrowYmd)) {
    // Check if any flow expires tomorrow (within 1 day).
    const flowExpiries = flows.map((f) => String(f.expiry ?? f.expiration ?? "").slice(0, 10)).filter(Boolean);
    const expiresNearEarnings = flowExpiries.some((exp) => exp === tomorrowYmd || exp === todayYmd);
    if (expiresNearEarnings) {
      earningsRisk = true;
      earningsPenalty = -6;
    }
  }

  // Analyst PT direction nudge: if the most recent PT action is within 7 days, apply a direction-
  // aware nudge (+2 raise for long, -2 cut for long) capped within CATALYST_CAP with everything else.
  // Honesty rule: only fires when benzinga_price_target is present and dated within 7 days.
  let ptNudge = 0;
  const ptData = dossierExtras.benzinga_price_target;
  if (ptData?.published && ptData.action) {
    const ptAgeMs = Date.now() - new Date(ptData.published).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (ptAgeMs >= 0 && ptAgeMs <= sevenDaysMs) {
      if (ptData.action === "raised" && flow.direction === "long") {
        ptNudge = 2;
        catalyst.flags.push(`analyst PT raised within 7 days (${ptData.firm ?? "firm unknown"})`);
      } else if (ptData.action === "lowered" && flow.direction === "long") {
        ptNudge = -2;
        catalyst.flags.push(`analyst PT cut within 7 days (${ptData.firm ?? "firm unknown"}) — headwind for long`);
      }
    }
  }

  // IV rank flag: elevated IV warns members options are expensive (wider spreads, higher decay).
  const ivRank = dossierExtras.iv_rank;
  let ivPenalty = 0;
  if (ivRank != null && Number.isFinite(ivRank) && ivRank > 70) {
    ivPenalty = -1;
    catalyst.flags.push(`IV rank ${Math.round(ivRank)} — options expensive, tighter stops`);
  }

  // FDA calendar reinforcement: if UW FDA calendar has upcoming dates, strengthen the binary
  // penalty (scoreCatalystAwareness may have already flagged from Benzinga catalysts).
  let fdaPenalty = 0;
  const fdaRows = dossierExtras.fda_events ?? [];
  if (fdaRows.length > 0 && !catalyst.flags.some((f) => f.includes("FDA"))) {
    fdaPenalty = -2;
    catalyst.flags.push("FDA calendar event upcoming — binary risk");
  }

  const totalCatalystScore = Math.max(-CATALYST_CAP, Math.min(CATALYST_CAP, catalyst.score + earningsPenalty + ptNudge + ivPenalty + fdaPenalty));

  // Flow-anomaly penalty: names flagged critical in the last hour get demoted unless flow is exceptional.
  let anomalyPenalty = 0;
  const anomalySet = new Set((regime?.anomaly_tickers ?? []).map((t) => t.toUpperCase()));
  if (anomalySet.has(ticker.toUpperCase())) {
    anomalyPenalty = -10;
    catalyst.flags.push("critical flow anomaly in last 60m — size down or skip unless flow confirms");
  }

  const regimeMultiplier = computeRegimeMultiplier(regime);
  const total = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        (flow.score +
          techScore +
          posScore +
          newsScore +
          smartMoneyScore +
          skewAdj +
          fundamentalScore +
          shortInterestScore +
          totalCatalystScore +
          anomalyPenalty) *
          regimeMultiplier
      )
    )
  );

  const fundCheck = passesFundamentalSanity(
    dossierExtras.fundamental_ratios ?? null,
    dossierExtras.fundamental_signals ?? null
  );

  const catalystFlags = earningsRisk
    ? [...catalyst.flags, "earnings tomorrow — binary risk, expiry into event"]
    : catalyst.flags;

  const confirmingSignals = [
    flow.score >= 8,
    techScore >= 6,
    posScore >= 4,
    newsScore >= 2,
    smartMoneyScore >= 2,
    fundamentalScore >= 2,
    shortInterestScore >= 2,
  ].filter(Boolean).length;

  return {
    ticker,
    score: total,
    direction: flow.direction,
    flow_score: flow.score,
    tech_score: techScore,
    pos_score: posScore,
    news_score: newsScore,
    smart_money_score: smartMoneyScore,
    fundamental_score: fundamentalScore,
    short_interest_score: shortInterestScore,
    catalyst_score: totalCatalystScore,
    catalyst_flags: catalystFlags,
    earnings_risk: earningsRisk,
    confirming_signals: confirmingSignals,
    conviction: assignNighthawkTier({
      score: total,
      confirmingSignals: confirmingSignals,
      earningsRisk: earningsRisk,
    }).tier,
    regime_multiplier: regimeMultiplier,
    fundamental_block: !fundCheck.ok,
    fundamental_flags: fundCheck.reasons,
    trading_halt: false,
  };
}

export type RankCandidatesResult = {
  ranked: ScoredCandidate[];
  /** Non-empty when all candidates were filtered out; explains which fundamental checks blocked them. */
  exclusionReason?: string;
};

/**
 * Rank candidates for synthesis. ONLY `trading_halt` is a hard exclusion — you genuinely cannot trade
 * a halted name. `fundamental_block` (extreme P/E, negative ROE, elevated D/E) is a SOFT demotion, not
 * a hard cut: a high-flow momentum name with a stretched P/E is exactly the kind of forward-looking
 * setup Night Hawk exists to surface, and the critic + Claude still vet every play downstream. The old
 * behaviour hard-cut every fundamental_block candidate, which on a momentum-heavy session could zero
 * the entire pool (or strip out the strongest-flow names, leaving a thin feed that the critic then
 * emptied). Demoting instead keeps the feed populated while still preferring clean fundamentals. (#77)
 */
export function rankCandidates(
  scored: ScoredCandidate[],
  max = 5
): RankCandidatesResult {
  const tradable = scored.filter((c) => !c.trading_halt);

  // Sort: clean fundamentals first, then by score. fundamental_block names sink below their clean
  // peers but remain eligible — they only get used when there aren't enough clean candidates to fill.
  const ranked = [...tradable]
    .sort((a, b) => {
      const blockA = a.fundamental_block ? 1 : 0;
      const blockB = b.fundamental_block ? 1 : 0;
      if (blockA !== blockB) return blockA - blockB; // clean (0) before blocked (1)
      return b.score - a.score;
    })
    .slice(0, max);

  if (ranked.length === 0 && scored.length > 0) {
    // Only reachable when EVERY candidate is halted (the sole hard exclusion).
    const haltedTickers = scored.filter((c) => c.trading_halt).map((c) => c.ticker);
    const exclusionReason = haltedTickers.length
      ? `All ${scored.length} candidate(s) excluded — trading halt: ${haltedTickers.join(", ")}.`
      : `All ${scored.length} candidate(s) excluded.`;
    console.warn("[nighthawk/scorer] rankCandidates returning empty.", exclusionReason);
    return { ranked: [], exclusionReason };
  }

  // Surface that we leaned on fundamentally-flagged names so the edition meta is self-explaining.
  const usedBlocked = ranked.filter((c) => c.fundamental_block);
  const exclusionReason = usedBlocked.length
    ? `Included ${usedBlocked.length} fundamentally-flagged name(s) (soft-demoted, critic-vetted): ${usedBlocked
        .map((c) => `${c.ticker} [${(c.fundamental_flags ?? []).join(", ") || "flagged"}]`)
        .join(" | ")}.`
    : undefined;

  return { ranked, exclusionReason };
}
