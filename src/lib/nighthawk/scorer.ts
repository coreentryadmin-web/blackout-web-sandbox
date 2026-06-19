import type { FlowStrikeStack } from "@/lib/largo/flow-strike-stacks";
import type { PolygonFinancialRatios } from "@/lib/providers/polygon";
import type { PredictionConsensusSignal } from "@/lib/providers/unusual-whales";import type { TideBias } from "./format";
import { tideBias } from "./format";
import type { FlowStreak } from "./flow-streak";
import type { MarketWideContext } from "./market-wide";
import type { PositioningSummary } from "./positioning";
import type { TechnicalCard } from "./technicals";

export type NightHawkRegimeContext = {
  vix_iv_rank: number | null;
  tide_bias: TideBias;
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
  };
}

/** Scale total score by VIX IV rank + market tide regime. */
export function computeRegimeMultiplier(regime?: NightHawkRegimeContext | null): number {
  if (!regime) return 1;
  const { vix_iv_rank: vix, tide_bias: tide } = regime;
  if (vix != null && vix > 70 && tide === "BEARISH") return 0.7;
  if (vix != null && vix > 55 && tide === "BEARISH") return 0.85;
  if (vix != null && vix < 25 && tide === "BULLISH") return 1.15;
  if (vix != null && vix < 40 && tide === "BULLISH") return 1.1;
  return 1;
}

function normalizeRatioPct(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.abs(v) > 1 ? v / 100 : v;
}

/** Polygon P/E, ROE, D/E sanity check — blocks broken fundamentals from Night Hawk ranking. */
export function passesFundamentalSanity(ratios: PolygonFinancialRatios | null): {
  ok: boolean;
  reasons: string[];
} {
  if (!ratios) return { ok: true, reasons: [] };
  const reasons: string[] = [];
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
  return { ok: reasons.length === 0, reasons };
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
    trading_halt?: boolean;
    risk_reversal_skew?: number | null;
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
  const regimeMultiplier = computeRegimeMultiplier(regime);
  let total = Math.min(
    100,
    Math.round(
      (flow.score + techScore + posScore + newsScore + smartMoneyScore + skewAdj) * regimeMultiplier
    )
  );

  const fundCheck = passesFundamentalSanity(dossierExtras.fundamental_ratios ?? null);
  if (!fundCheck.ok) {
    total = Math.min(total, 20);
  }

  return {
    ticker,
    score: total,
    direction: flow.direction,
    flow_score: flow.score,
    tech_score: techScore,
    pos_score: posScore,
    news_score: newsScore,
    smart_money_score: smartMoneyScore,
    conviction: convictionFromScore(total),
    regime_multiplier: regimeMultiplier,
    fundamental_block: !fundCheck.ok,
    fundamental_flags: fundCheck.reasons,
    trading_halt: false,
  };
}

export function rankCandidates(
  scored: ScoredCandidate[],
  max = 5
): ScoredCandidate[] {
  return [...scored]
    .filter((c) => !c.trading_halt && !c.fundamental_block)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}
