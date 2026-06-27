import type { FlowStrikeStack } from "@/lib/largo/flow-strike-stacks";
import type { BenzingaCatalyst, BenzingaPriceTarget, FundamentalSignals, PolygonFinancialRatios } from "@/lib/providers/polygon";
import type { PredictionConsensusSignal } from "@/lib/providers/unusual-whales";import type { TideBias } from "./format";
import { tideBias } from "./format";
import type { FlowStreak } from "./flow-streak";
import type { MarketWideContext } from "./market-wide";
import type { PositioningSummary } from "./positioning";
import type { TechnicalCard } from "./technicals";

export type NightHawkRegimeContext = {
  vix_iv_rank: number | null;
  tide_bias: TideBias;
  /** Percentage of advancing issues (0–100). Used in breadth-regime multiplier. */
  advance_pct?: number | null;
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
  conviction: string;
  regime_multiplier?: number;
  fundamental_block?: boolean;
  fundamental_flags?: string[];
  trading_halt?: boolean;
};

export function regimeContextFromMarket(ctx: MarketWideContext): NightHawkRegimeContext {
  return {
    vix_iv_rank: ctx.vix_iv_rank,
    tide_bias: tideBias(ctx.tide),
    advance_pct: ctx.market_breadth?.pct_advancing ?? null,
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
    const skewDir: "long" | "short" = skew > 0 ? "long" : "short";
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
    if (tags.includes("gap down") || tags.includes("below")) score += 5;
    if (tech.rsi14 != null && tech.rsi14 >= 55) score += 3;
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

export function scoreOptionsPositioning(
  dossier: {
    dark_pool?: { total_premium?: number; bias?: string } | null;
    oi_change?: Array<{ oi_change?: number; option_type?: string }>;
    positioning?: PositioningSummary;
    strike_stacks?: FlowStrikeStack[];
  },
  direction: "long" | "short"
): number {
  let score = 0;
  const dp = dossier.dark_pool?.total_premium ?? 0;
  let dpPoints = 0;
  if (dp >= 50_000_000) dpPoints = 6;
  else if (dp >= 20_000_000) dpPoints = 4;
  else if (dp >= 5_000_000) dpPoints = 2;

  const biasMatch = darkPoolBiasMatchesDirection(dossier.dark_pool?.bias, direction);
  if (dpPoints > 0) {
    if (biasMatch === false) score += dpPoints * 0.5;
    else score += dpPoints;
  }

  const stacks = dossier.strike_stacks ?? [];
  if (stacks.some((s) => s.repeated_hits)) score += 4;
  if (stacks.some((s) => s.same_strike_accumulation)) score += 3;

  const pos = dossier.positioning;
  if (pos?.negative_gamma) score += 2;
  if (pos?.net_vex != null && Math.abs(pos.net_vex) > 0) score += 1;
  if (pos?.max_pain != null) score += 1;

  const oi = dossier.oi_change ?? [];
  if (oi.length >= 3) score += 2;

  return Math.min(18, score);
}

function predictionAlignsWithDirection(
  signal: PredictionConsensusSignal | null | undefined,
  direction: "long" | "short"
): boolean {
  if (!signal || signal.direction === "neutral") return false;
  return direction === "long" ? signal.direction === "bullish" : signal.direction === "bearish";
}

function institutionalShowsNetBuying(rows: Record<string, unknown>[]): boolean {
  if (!rows.length) return false;
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
  return net > 0;
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
  if ((dossier.congress_unusual?.length ?? 0) > 0) score += 3;
  if ((dossier.congress_trades?.length ?? 0) > 0) score += 2;
  if (institutionalShowsNetBuying(dossier.institutional_activity ?? [])) score += 3;
  return Math.min(8, score);
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

export function scoreNewsCatalyst(dossier: {
  news_headlines?: string[];
  insider_buys?: number;
}): number {
  let score = 0;
  const headlines = dossier.news_headlines ?? [];
  if (headlines.length >= 3) score += 2;
  const positiveCount = headlines.filter((h) => h.toLowerCase().startsWith("positive:")).length;
  const negativeCount = headlines.filter((h) => h.toLowerCase().startsWith("negative:")).length;
  if (positiveCount > negativeCount) score += 2;
  else if (negativeCount > positiveCount) score -= 2;
  const text = headlines.join(" ").toLowerCase();
  if (/upgrade|beat|approval|partnership|buyback/.test(text)) score += 3;
  if (/downgrade|miss|investigation|lawsuit/.test(text)) score -= 2;
  if ((dossier.insider_buys ?? 0) > 0) score += 2;
  return Math.max(-3, Math.min(8, score));
}

export function convictionFromScore(score: number): string {
  if (score >= 70) return "A+";
  if (score >= 55) return "A";
  if (score >= 40) return "B";
  return "C";
}

/** Positive RR skew (calls bid over puts) = bullish; negative = bearish. */
export function scoreSkewConfirmation(
  skew: number | null | undefined,
  direction: "long" | "short"
): number {
  if (skew == null || !Number.isFinite(skew) || skew === 0) return 0;
  const skewDir: "long" | "short" = skew > 0 ? "long" : "short";
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
  const newsScore = scoreNewsCatalyst(dossierExtras);
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

  const totalCatalystScore = Math.max(-CATALYST_CAP, Math.min(CATALYST_CAP, catalyst.score + earningsPenalty + ptNudge));

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
          totalCatalystScore) *
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
    conviction: convictionFromScore(total),
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
