import {
  CANDIDATE_MIN_BASELINE_PREMIUM,
  CANDIDATE_MIN_UNDERLYING_PRICE,
  CANDIDATE_PREMIUM_SLOTS,
  CANDIDATE_UNUSUAL_SLOTS,
  CANDIDATE_UNUSUALNESS_LOOKBACK_DAYS,
  INDEX_SET,
  LEVERAGED_ETP_SET,
} from "./constants";
import { dbConfigured, fetchTickersAvgDailyPremium } from "@/lib/db";
import { fetchTickersFlowStreaks } from "./flow-streak";
import type { MarketWideContext } from "./market-wide";
import type { PredictionConsensusSignal } from "@/lib/providers/unusual-whales";

function safeFloat(v: unknown): number {
  const n = Number(String(v ?? 0).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function flowPrintKey(row: Record<string, unknown>): string {
  const strike = safeFloat(row.strike ?? row.price);
  const expiry = String(row.expiry ?? row.expiration ?? "").slice(0, 10);
  return `${strike}|${expiry}`;
}

function spreadMultiplier(distinctStrikes: number): number {
  if (distinctStrikes <= 2) return 0.7;
  if (distinctStrikes >= 4) return 1.2;
  return 1;
}

function streakMultiplier(streakDays: number): number {
  if (streakDays >= 5) return 1.7;
  if (streakDays >= 3) return 1.4;
  return 1;
}

function unusualnessMultiplier(ratio: number): number {
  return clamp(ratio, 0.5, 3);
}

/**
 * Structural instrument filter (audit MEDIUM: none existed — a 3x leveraged ETF,
 * SPAC warrant, or unit with one unusual print became a full "stock" candidate and
 * was scored by machinery built for single names). Excludes:
 *  - index products (INDEX_SET) and leveraged/inverse ETPs + VIX wrappers,
 *  - SPAC-suffix instruments: 5-char tickers ending W/U/R (warrant/unit/right
 *    convention) and explicit ".WS"/"-WT"-style suffixes.
 */
export function isExcludedInstrument(ticker: string): boolean {
  const t = ticker.toUpperCase();
  if (INDEX_SET.has(t) || LEVERAGED_ETP_SET.has(t)) return true;
  if (/[.\-+](WS|WT|W|U|R|RT)$/.test(t)) return true;
  if (/^[A-Z]{4}[WUR]$/.test(t)) return true;
  return false;
}

type TickerAggregate = {
  ticker: string;
  rawPremium: number;
  baseScore: number;
  distinctPrints: Set<string>;
  /** Highest underlying price observed on this ticker's rows (0 = never carried). */
  maxUnderlying: number;
};

function aggregateTickerFlows(
  stockFlows: Record<string, unknown>[],
  hotChains: Record<string, unknown>[],
  opts: {
    sweepBonus: number;
    minLiquidity: number;
    watchSet: Set<string> | null;
    /** Cross-source corroboration rows (UW top-net-impact) — audit: fetched but never used. */
    topNetImpact?: Record<string, unknown>[];
  }
): Map<string, TickerAggregate> {
  const { sweepBonus, minLiquidity, watchSet, topNetImpact } = opts;
  const byTicker = new Map<string, TickerAggregate>();

  const touch = (ticker: string): TickerAggregate => {
    const cur = byTicker.get(ticker);
    if (cur) return cur;
    const next: TickerAggregate = { ticker, rawPremium: 0, baseScore: 0, distinctPrints: new Set(), maxUnderlying: 0 };
    byTicker.set(ticker, next);
    return next;
  };

  for (const r of stockFlows) {
    const ticker = String(r.ticker ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    if (watchSet && !watchSet.has(ticker)) continue;

    const prem = safeFloat(r.total_premium ?? r.premium);
    if (prem < minLiquidity) continue;

    let bonus = r.has_sweep ? sweepBonus : 1;
    if (r.all_opening_trades) bonus *= 1.3;

    const agg = touch(ticker);
    agg.rawPremium += prem;
    agg.baseScore += prem * bonus;
    agg.maxUnderlying = Math.max(agg.maxUnderlying, safeFloat(r.underlying_price ?? r.stock_price));
    const key = flowPrintKey(r);
    if (key !== "0|") agg.distinctPrints.add(key);
  }

  for (const r of hotChains) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    if (watchSet && !watchSet.has(ticker)) continue;

    const prem = safeFloat(r.total_premium ?? r.premium);
    if (prem < minLiquidity) continue;

    const agg = touch(ticker);
    agg.rawPremium += prem;
    agg.baseScore += prem * 0.5;
  }

  // Cross-source corroboration (audit HIGH: mono-source discovery): UW's top-net-impact
  // screen ("names driving net premium") was fetched by market-wide but never reached
  // discovery. Weighted 0.75 — independent-screen corroboration, below first-class flow
  // rows but above the hot-chains re-aggregation of the same tape.
  for (const r of topNetImpact ?? []) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    if (watchSet && !watchSet.has(ticker)) continue;

    const prem = Math.abs(safeFloat(r.net_premium ?? r.total_premium ?? r.premium));
    if (prem < minLiquidity) continue;

    const agg = touch(ticker);
    agg.rawPremium += prem;
    agg.baseScore += prem * 0.75;
  }

  if (watchSet && byTicker.size === 0) {
    for (const ticker of Array.from(watchSet)) {
      if (!isExcludedInstrument(ticker)) {
        byTicker.set(ticker, { ticker, rawPremium: 0, baseScore: 1, distinctPrints: new Set(), maxUnderlying: 0 });
      }
    }
  }

  // Penny/garbage-runner floor: only applied when a row actually carried the
  // underlying price — absence of the field must not evict legitimate names.
  for (const [ticker, agg] of Array.from(byTicker.entries())) {
    if (agg.maxUnderlying > 0 && agg.maxUnderlying < CANDIDATE_MIN_UNDERLYING_PRICE) {
      byTicker.delete(ticker);
    }
  }

  return byTicker;
}

export type CandidateSelectionRow = {
  ticker: string;
  raw_premium: number;
  base_score: number;
  unusualness: number;
  weighted_score: number;
  streak_days: number;
  distinct_prints: number;
};

function mergeCandidateSlots(
  premiumRanked: CandidateSelectionRow[],
  unusualRanked: CandidateSelectionRow[],
  maxTickers: number
): string[] {
  const premiumSlots = Math.min(CANDIDATE_PREMIUM_SLOTS, maxTickers);
  const unusualSlots = Math.min(CANDIDATE_UNUSUAL_SLOTS, Math.max(0, maxTickers - premiumSlots));
  const picked = new Set<string>();
  const out: string[] = [];

  for (const row of premiumRanked) {
    if (out.length >= premiumSlots) break;
    if (picked.has(row.ticker)) continue;
    picked.add(row.ticker);
    out.push(row.ticker);
  }

  for (const row of unusualRanked) {
    if (out.length >= premiumSlots + unusualSlots || out.length >= maxTickers) break;
    if (picked.has(row.ticker)) continue;
    picked.add(row.ticker);
    out.push(row.ticker);
  }

  const allRanked = [...premiumRanked].sort((a, b) => b.weighted_score - a.weighted_score);
  for (const row of allRanked) {
    if (out.length >= maxTickers) break;
    if (picked.has(row.ticker)) continue;
    picked.add(row.ticker);
    out.push(row.ticker);
  }

  return out;
}

/** Premium-relative candidate gate — surfaces unusual mid-cap flow over routine mega-cap tape. */
export async function extractCandidateTickers(
  stockFlows: Record<string, unknown>[],
  hotChains: Record<string, unknown>[],
  maxTickers = 20,
  opts?: {
    sweepBonus?: number;
    minLiquidity?: number;
    watchlist?: string[];
    /** UW top-net-impact rows for cross-source corroboration (see aggregateTickerFlows). */
    topNetImpact?: Record<string, unknown>[];
  }
): Promise<string[]> {
  const sweepBonus = opts?.sweepBonus ?? 1.5;
  const minLiquidity = opts?.minLiquidity ?? 0;
  const watchSet =
    opts?.watchlist && opts.watchlist.length
      ? new Set(opts.watchlist.map((t) => t.toUpperCase()))
      : null;

  const aggregates = aggregateTickerFlows(stockFlows, hotChains, {
    sweepBonus,
    minLiquidity,
    watchSet,
    topNetImpact: opts?.topNetImpact,
  });
  if (!aggregates.size) return [];

  const tickers = Array.from(aggregates.keys());
  let avgPremiums: Record<string, number> = {};
  let streaks: Record<string, { streak_days: number }> = {};

  if (dbConfigured()) {
    [avgPremiums, streaks] = await Promise.all([
      fetchTickersAvgDailyPremium(tickers, CANDIDATE_UNUSUALNESS_LOOKBACK_DAYS),
      fetchTickersFlowStreaks(tickers),
    ]);
  }

  const rows: CandidateSelectionRow[] = [];

  for (const agg of Array.from(aggregates.values())) {
    const baseline = Math.max(
      avgPremiums[agg.ticker] ?? 0,
      CANDIDATE_MIN_BASELINE_PREMIUM
    );
    const unusualness = agg.rawPremium > 0 ? agg.rawPremium / baseline : 0;
    const spreadMult = spreadMultiplier(agg.distinctPrints.size);
    const streakMult = streakMultiplier(streaks[agg.ticker]?.streak_days ?? 0);
    const baseScore = agg.baseScore * spreadMult * streakMult;
    const weightedScore = baseScore * unusualnessMultiplier(unusualness);

    rows.push({
      ticker: agg.ticker,
      raw_premium: agg.rawPremium,
      base_score: baseScore,
      unusualness,
      weighted_score: weightedScore,
      streak_days: streaks[agg.ticker]?.streak_days ?? 0,
      distinct_prints: agg.distinctPrints.size,
    });
  }

  const premiumRanked = [...rows].sort((a, b) => b.weighted_score - a.weighted_score);
  const unusualRanked = [...rows].sort((a, b) => b.unusualness - a.unusualness);

  return mergeCandidateSlots(premiumRanked, unusualRanked, maxTickers);
}

// ── Multi-source candidate engine ──────────────────────────────────────────────
// Six independent lanes each produce a normalized 0–max_pts score per ticker.
// Tickers appearing in multiple lanes get a corroboration bonus. The top N by
// composite score become candidates. This replaces the flow-only path for the
// edition pipeline while keeping the old function for hunt-builder.

const LANE_MAX_FLOW = 40;
const LANE_MAX_OI = 15;
const LANE_MAX_UNUSUAL = 12;
const LANE_MAX_CATALYST = 10;
const LANE_MAX_PREDICTIONS = 8;
const LANE_MAX_MOVERS = 8;

type LaneEntry = { ticker: string; rawScore: number };

function normalizeToMax(entries: LaneEntry[], maxPts: number): Map<string, number> {
  const top = entries.reduce((m, e) => Math.max(m, e.rawScore), 0);
  if (top <= 0) return new Map();
  const out = new Map<string, number>();
  for (const e of entries) {
    const prev = out.get(e.ticker) ?? 0;
    out.set(e.ticker, Math.max(prev, (e.rawScore / top) * maxPts));
  }
  return out;
}

function laneFlow(ctx: MarketWideContext): Map<string, number> {
  const entries: LaneEntry[] = [];
  const seen = new Map<string, number>();

  for (const r of ctx.stock_flows) {
    const ticker = String(r.ticker ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    const prem = safeFloat(r.total_premium ?? r.premium);
    if (prem <= 0) continue;
    const underlying = safeFloat(r.underlying_price ?? r.stock_price);
    if (underlying > 0 && underlying < CANDIDATE_MIN_UNDERLYING_PRICE) continue;
    let bonus = r.has_sweep ? 1.5 : 1;
    if (r.all_opening_trades) bonus *= 1.3;
    seen.set(ticker, (seen.get(ticker) ?? 0) + prem * bonus);
  }

  for (const r of ctx.hot_chains) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    const prem = safeFloat(r.total_premium ?? r.premium);
    if (prem <= 0) continue;
    seen.set(ticker, (seen.get(ticker) ?? 0) + prem * 0.5);
  }

  for (const r of ctx.top_net_impact) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    const prem = Math.abs(safeFloat(r.net_premium ?? r.total_premium ?? r.premium));
    if (prem <= 0) continue;
    seen.set(ticker, (seen.get(ticker) ?? 0) + prem * 0.75);
  }

  for (const [ticker, score] of seen) entries.push({ ticker, rawScore: score });
  return normalizeToMax(entries, LANE_MAX_FLOW);
}

function laneOiChange(ctx: MarketWideContext): Map<string, number> {
  const entries: LaneEntry[] = [];
  for (const r of ctx.market_oi_change) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    const oiChange = Math.abs(safeFloat(r.oi_change ?? r.change ?? r.net_oi_change));
    const prem = Math.abs(safeFloat(r.total_premium ?? r.premium ?? 0));
    if (oiChange <= 0 && prem <= 0) continue;
    entries.push({ ticker, rawScore: oiChange + prem * 0.001 });
  }
  return normalizeToMax(entries, LANE_MAX_OI);
}

function laneUnusualTrades(ctx: MarketWideContext): Map<string, number> {
  const entries: LaneEntry[] = [];
  const byTicker = new Map<string, number>();
  for (const r of ctx.unusual_trades) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    const prem = safeFloat(r.premium ?? r.total_premium ?? r.ask ?? 0);
    const vol = safeFloat(r.volume ?? 0);
    byTicker.set(ticker, (byTicker.get(ticker) ?? 0) + Math.max(prem, vol * 0.1));
  }
  for (const [ticker, score] of byTicker) {
    if (score > 0) entries.push({ ticker, rawScore: score });
  }
  return normalizeToMax(entries, LANE_MAX_UNUSUAL);
}

function laneCatalyst(ctx: MarketWideContext): Map<string, number> {
  const entries: LaneEntry[] = [];
  const tickerRe = /\b([A-Z]{1,5})\b/g;

  for (const c of ctx.after_hours_catalysts) {
    const matches = c.title.match(tickerRe) ?? [];
    const binaryBoost = c.type === "binary" || c.type === "m&a" ? 1.5 : 1;
    for (const t of matches) {
      if (t.length < 2 || isExcludedInstrument(t) || INDEX_SET.has(t)) continue;
      if (["THE", "FOR", "AND", "CEO", "CFO", "FDA", "SEC", "IPO", "ETF", "NYSE", "EPS", "BUY", "NEW", "TOP", "LOW", "ALL", "BIG", "GET", "PUT", "SET", "NOT", "CAN", "MAY", "HAS", "ITS", "NOW", "SAY", "RUN", "CUT", "HIT", "KEY"].includes(t)) continue;
      entries.push({ ticker: t, rawScore: 6 * binaryBoost });
    }
  }

  for (const r of ctx.tomorrow_earnings) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    entries.push({ ticker, rawScore: 4 });
  }

  return normalizeToMax(entries, LANE_MAX_CATALYST);
}

function lanePredictions(predictions: PredictionConsensusSignal[]): Map<string, number> {
  const entries: LaneEntry[] = [];
  for (const p of predictions) {
    const ticker = p.ticker.toUpperCase();
    if (isExcludedInstrument(ticker)) continue;
    if (p.direction === "neutral") continue;
    entries.push({ ticker, rawScore: p.confidence_pct * p.sources.length });
  }
  return normalizeToMax(entries, LANE_MAX_PREDICTIONS);
}

function laneMovers(ctx: MarketWideContext): Map<string, number> {
  const entries: LaneEntry[] = [];
  for (const m of ctx.market_movers) {
    const ticker = m.ticker.toUpperCase();
    if (isExcludedInstrument(ticker)) continue;
    if (m.price < CANDIDATE_MIN_UNDERLYING_PRICE) continue;
    entries.push({ ticker, rawScore: Math.abs(m.change_pct) });
  }
  return normalizeToMax(entries, LANE_MAX_MOVERS);
}

export type MultiSourceCandidateRow = {
  ticker: string;
  composite_score: number;
  source_count: number;
  sources: string[];
  lane_scores: Record<string, number>;
};

/**
 * Multi-source candidate discovery — replaces the flow-only extractCandidateTickers
 * for the edition pipeline. Runs 6 independent scoring lanes over MarketWideContext,
 * applies corroboration bonuses for tickers seen in multiple lanes, enriches with DB
 * streak/unusualness data when available, and returns top-N tickers by composite score.
 */
export async function extractMultiSourceCandidates(
  ctx: MarketWideContext,
  maxTickers: number
): Promise<string[]> {
  const lanes: [string, Map<string, number>][] = [
    ["flow", laneFlow(ctx)],
    ["oi_change", laneOiChange(ctx)],
    ["unusual_trades", laneUnusualTrades(ctx)],
    ["catalyst", laneCatalyst(ctx)],
    ["predictions", lanePredictions(ctx.predictions_consensus)],
    ["movers", laneMovers(ctx)],
  ];

  const composite = new Map<string, { score: number; sources: string[]; laneScores: Record<string, number> }>();
  for (const [name, scores] of lanes) {
    for (const [ticker, pts] of scores) {
      const cur = composite.get(ticker) ?? { score: 0, sources: [], laneScores: {} };
      cur.score += pts;
      cur.sources.push(name);
      cur.laneScores[name] = pts;
      composite.set(ticker, cur);
    }
  }

  // Corroboration bonus: multi-source tickers are more reliable signals.
  for (const [, entry] of composite) {
    if (entry.sources.length >= 3) entry.score *= 1.3;
    else if (entry.sources.length >= 2) entry.score *= 1.15;
  }

  const tickers = Array.from(composite.keys());
  if (!tickers.length) return [];

  // DB enrichment: streak multiplier + unusualness ratio (same as legacy path).
  let avgPremiums: Record<string, number> = {};
  let streaks: Record<string, { streak_days: number }> = {};
  if (dbConfigured()) {
    [avgPremiums, streaks] = await Promise.all([
      fetchTickersAvgDailyPremium(tickers, CANDIDATE_UNUSUALNESS_LOOKBACK_DAYS),
      fetchTickersFlowStreaks(tickers),
    ]);
  }

  const rows: MultiSourceCandidateRow[] = [];
  for (const [ticker, entry] of composite) {
    let score = entry.score;

    // Streak bonus (flow lane already captured the premium; this adds temporal conviction).
    const streakDays = streaks[ticker]?.streak_days ?? 0;
    score *= streakMultiplier(streakDays);

    // Unusualness ratio from flow lane raw premium vs 30-day avg.
    const flowLane = lanes.find(([n]) => n === "flow");
    if (flowLane) {
      const flowRaw = flowLane[1].get(ticker);
      if (flowRaw && flowRaw > 0) {
        const baseline = Math.max(avgPremiums[ticker] ?? 0, CANDIDATE_MIN_BASELINE_PREMIUM);
        score *= unusualnessMultiplier(flowRaw / baseline);
      }
    }

    rows.push({
      ticker,
      composite_score: score,
      source_count: entry.sources.length,
      sources: entry.sources,
      lane_scores: entry.laneScores,
    });
  }

  rows.sort((a, b) => b.composite_score - a.composite_score);

  const selected = rows.slice(0, maxTickers).map((r) => r.ticker);
  const multiSourceCount = rows.filter((r) => r.source_count >= 2).length;
  console.info(
    `[nighthawk/candidates] multi-source: ${composite.size} unique tickers from ${lanes.length} lanes, ` +
    `${multiSourceCount} corroborated, selected top ${selected.length}`
  );

  return selected;
}
