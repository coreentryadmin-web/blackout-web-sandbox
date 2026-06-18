import type { FlowStrikeStack } from "@/lib/largo/flow-strike-stacks";
import type { FlowStreak } from "./flow-streak";
import type { PositioningSummary } from "./positioning";
import type { TechnicalCard } from "./technicals";

export type ScoredCandidate = {
  ticker: string;
  score: number;
  direction: "long" | "short";
  flow_score: number;
  tech_score: number;
  pos_score: number;
  news_score: number;
  conviction: string;
};

function safeFloat(v: unknown): number {
  const n = Number(String(v ?? 0).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function boolish(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

export function scoreFlowQuality(
  flows: Record<string, unknown>[],
  flowStreak?: FlowStreak
): { score: number; direction: "long" | "short" } {
  if (!flows.length) return { score: 0, direction: "long" };

  let totalPrem = 0;
  let sweepPrem = 0;
  let askPrem = 0;
  let openingPrem = 0;
  let callPrem = 0;
  let putPrem = 0;
  const strikes = new Set<string>();

  for (const r of flows) {
    const prem = safeFloat(r.total_premium ?? r.premium);
    if (prem <= 0) continue;
    totalPrem += prem;
    const opt = String(r.type ?? r.option_type ?? "").toLowerCase();
    if (opt.startsWith("c")) callPrem += prem;
    else putPrem += prem;
    if (boolish(r.has_sweep)) sweepPrem += prem;
    const askPct = safeFloat(r.ask_side_pct ?? r.total_ask_side_prem);
    if (askPct >= 60 || safeFloat(r.total_ask_side_prem) / prem >= 0.6) askPrem += prem;
    if (boolish(r.all_opening_trades)) openingPrem += prem;
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
    if (flowStreak.streak_days >= 5) score += 12;
    else if (flowStreak.streak_days >= 3) score += 8;
  }

  score = Math.min(40, score);
  return { score, direction: callPrem >= putPrem ? "long" : "short" };
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
  return Math.max(-10, Math.min(30, score));
}

export function scoreOptionsPositioning(dossier: {
  dark_pool?: { total_premium?: number; bias?: string } | null;
  oi_change?: Array<{ oi_change?: number; option_type?: string }>;
  positioning?: PositioningSummary;
  strike_stacks?: FlowStrikeStack[];
}): number {
  let score = 0;
  const dp = dossier.dark_pool?.total_premium ?? 0;
  if (dp >= 50_000_000) score += 6;
  else if (dp >= 20_000_000) score += 4;
  else if (dp >= 5_000_000) score += 2;

  const stacks = dossier.strike_stacks ?? [];
  if (stacks.some((s) => s.repeated_hits)) score += 4;
  if (stacks.some((s) => s.same_strike_accumulation)) score += 3;

  const pos = dossier.positioning;
  if (pos?.negative_gamma) score += 2;
  if (pos?.net_vex != null && Math.abs(pos.net_vex) > 0) score += 1;
  if (pos?.max_pain != null) score += 1;

  const oi = dossier.oi_change ?? [];
  if (oi.length >= 3) score += 2;

  return Math.min(20, score);
}

export function scoreNewsCatalyst(dossier: {
  news_headlines?: string[];
  insider_buys?: number;
}): number {
  let score = 0;
  const headlines = dossier.news_headlines ?? [];
  if (headlines.length >= 3) score += 2;
  const text = headlines.join(" ").toLowerCase();
  if (/upgrade|beat|approval|partnership|buyback/.test(text)) score += 3;
  if (/downgrade|miss|investigation|lawsuit/.test(text)) score -= 2;
  if ((dossier.insider_buys ?? 0) > 0) score += 2;
  return Math.max(-3, Math.min(10, score));
}

export function convictionFromScore(score: number): string {
  if (score >= 70) return "A+";
  if (score >= 55) return "A";
  if (score >= 40) return "B";
  return "C";
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
  },
  flowStreak?: FlowStreak
): ScoredCandidate {
  const flow = scoreFlowQuality(flows, flowStreak);
  const techScore = scoreTechnicalSetup(tech, flow.direction);
  const posScore = scoreOptionsPositioning(dossierExtras);
  const newsScore = scoreNewsCatalyst(dossierExtras);
  const total = Math.round(flow.score + techScore + posScore + newsScore);

  return {
    ticker,
    score: total,
    direction: flow.direction,
    flow_score: flow.score,
    tech_score: techScore,
    pos_score: posScore,
    news_score: newsScore,
    conviction: convictionFromScore(total),
  };
}

export function rankCandidates(
  scored: ScoredCandidate[],
  max = 5
): ScoredCandidate[] {
  return [...scored].sort((a, b) => b.score - a.score).slice(0, max);
}
