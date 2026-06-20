import { fetchBenzingaNews, fetchPolygonFinancialRatios, fetchShortInterest, fetchVixIvRankPercentile, type PolygonFinancialRatios } from "@/lib/providers/polygon";
import { fetchPolygonNews, fetchPolygonTickerDetails } from "@/lib/providers/polygon-largo";
import { uwConfigured } from "@/lib/providers/config";
import {
  fetchMarketFlowAlertRows,
  fetchUwCongressUnusualTrades,
  fetchUwDarkPool,
  fetchUwFlowPerExpiry,
  fetchUwInsiderTransactions,
  fetchUwInstitutionOwnership,
  fetchUwIvRank,
  fetchUwIvTermStructure,
  fetchUwNewsHeadlines,
  fetchUwOiChange,
  fetchUwPredictionsConsensus,
  fetchUwRealizedVol,
  fetchUwRiskReversalSkew,
  fetchUwScreenerStocks,
  type PredictionConsensusSignal,
} from "@/lib/providers/unusual-whales";
import { computeFlowStrikeStacks, type FlowStrikeStack } from "@/lib/largo/flow-strike-stacks";
import { fetchTickerFlowStreak, type FlowStreak } from "./flow-streak";
import { fetchPositioningSummary, type PositioningSummary } from "./positioning";
import { buildTechnicalCard, type TechnicalCard } from "./technicals";
import type { ScoredCandidate, NightHawkRegimeContext } from "./scorer";
import { scoreCandidate } from "./scorer";
import { shouldBlockForTradingHalt } from "@/lib/ws/uw-socket";
import { DOSSIER_BATCH_SIZE, DOSSIER_FETCH_TIMEOUT_MS, DOSSIER_INTER_BATCH_MS } from "./constants";
import { dossierFetch } from "./fetch-timeout";
import { parseLatestRealizedVol, parseLatestRiskReversalSkew } from "./vol-metrics";

export type TickerDossier = {
  ticker: string;
  flows: Record<string, unknown>[];
  flow_streak: FlowStreak;
  strike_stacks: FlowStrikeStack[];
  dark_pool: Awaited<ReturnType<typeof fetchUwDarkPool>> | null;
  oi_change: Awaited<ReturnType<typeof fetchUwOiChange>>;
  iv_rank: number | null;
  iv_term: Array<{ expiry: string; iv: number }>;
  realized_vol: number | null;
  risk_reversal_skew: number | null;
  flow_by_expiry: Record<string, unknown>[];
  positioning: PositioningSummary;
  congress_trades: Record<string, unknown>[];
  congress_unusual: Record<string, unknown>[];
  institutional_activity: Record<string, unknown>[];
  predictions_signal: PredictionConsensusSignal | null;
  screener_confirmed: boolean;
  tech: TechnicalCard | null;
  news_headlines: string[];
  polygon_sentiment: string[];
  analyst_summary: string | null;
  price_target: string | null;
  insider_buys: number;
  sector: string | null;
  short_days_to_cover: number | null;
  fundamental_ratios: PolygonFinancialRatios | null;
  trading_halt: boolean;
  scored?: ScoredCandidate;
};

let editionCongressCache: Record<string, unknown>[] | null = null;
let editionPredictionsCache: Awaited<ReturnType<typeof fetchUwPredictionsConsensus>> | null = null;
let editionScreenerCache: Record<string, unknown>[] | null = null;

const RECENT_SIGNAL_DAYS = 30;

function parseTradeDate(row: Record<string, unknown>): Date | null {
  const raw =
    row.filed_at ??
    row.filed_date ??
    row.transaction_date ??
    row.transactionDate ??
    row.disclosure_date ??
    row.report_date ??
    row.date ??
    row.created_at;
  if (raw == null || raw === "") return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isWithinRecentSignalWindow(row: Record<string, unknown>, days = RECENT_SIGNAL_DAYS): boolean {
  const tradeDate = parseTradeDate(row);
  if (!tradeDate) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return tradeDate >= cutoff;
}

function isRecentInsiderBuy(row: Record<string, unknown>): boolean {
  if (!isWithinRecentSignalWindow(row)) return false;
  const tx = String(row.transactionCode ?? row.transaction_code ?? "").toUpperCase();
  const type = String(row.type ?? row.transaction_type ?? row.action ?? "").toUpperCase();
  const buySell = String(row.buy_sell ?? row.buySell ?? "").toUpperCase();
  return tx === "P" || type.includes("BUY") || type.includes("PURCHASE") || buySell.includes("BUY");
}

function sectorFromPolygonDetails(profile: Record<string, unknown> | null): string | null {
  if (!profile) return null;
  const results = (profile.results as Record<string, unknown> | undefined) ?? profile;
  const sector = results.sic_description ?? results.sector ?? results.industry;
  return sector != null ? String(sector) : null;
}

export function resetEditionCongressCache() {
  editionCongressCache = null;
  editionPredictionsCache = null;
  editionScreenerCache = null;
}

async function getEditionCongressTrades(ticker: string): Promise<Record<string, unknown>[]> {
  if (!uwConfigured()) return [];
  if (!editionCongressCache) {
    const { fetchUwCongressTrades } = await import("@/lib/providers/unusual-whales");
    editionCongressCache = (await fetchUwCongressTrades(undefined).catch(() => [])) as Record<string, unknown>[];
  }
  const sym = ticker.toUpperCase();
  return editionCongressCache
    .filter((t) => String(t.ticker ?? t.symbol ?? "").toUpperCase() === sym)
    .filter((t) => isWithinRecentSignalWindow(t))
    .slice(0, 5);
}

async function getEditionPredictionsSignal(ticker: string): Promise<PredictionConsensusSignal | null> {
  if (!uwConfigured()) return null;
  if (!editionPredictionsCache) {
    editionPredictionsCache = await fetchUwPredictionsConsensus(40).catch(() => null);
  }
  const sym = ticker.toUpperCase();
  return editionPredictionsCache?.top_signals?.find((s) => s.ticker === sym) ?? null;
}

async function isScreenerConfirmed(ticker: string): Promise<boolean> {
  if (!uwConfigured()) return false;
  if (!editionScreenerCache) {
    editionScreenerCache = (await fetchUwScreenerStocks(30).catch(() => [])) as Record<string, unknown>[];
  }
  const sym = ticker.toUpperCase();
  return editionScreenerCache.some((r) => String(r.ticker ?? r.symbol ?? "").toUpperCase() === sym);
}

const INDEX_IV_PROXY = new Set(["SPX", "SPY", "QQQ", "VIX", "IWM"]);

/** Polygon VIX IV rank for index proxies; UW only as fallback for single names. */
async function resolveIvRank(sym: string): Promise<number | null> {
  if (INDEX_IV_PROXY.has(sym)) {
    const rank = await fetchVixIvRankPercentile().catch(() => null);
    if (rank != null) return rank;
  }
  if (!uwConfigured()) return null;
  const raw = await fetchUwIvRank(sym).catch(() => null);
  return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

async function resolveTickerNews(
  sym: string,
  polyNews: Awaited<ReturnType<typeof fetchPolygonNews>>,
  bzNews: Awaited<ReturnType<typeof fetchBenzingaNews>>
): Promise<string[]> {
  const headlines = [
    ...bzNews.map((n) => String(n.title ?? "")),
    ...polyNews.map((n) => String(n.title ?? "")),
  ].filter(Boolean);

  if (headlines.length >= 4 || !uwConfigured()) return headlines;

  const uw = await fetchUwNewsHeadlines(sym, 8).catch(() => []);
  return [...headlines, ...uw.map((n) => String(n.title ?? n.headline ?? ""))].filter(Boolean);
}

export async function fetchTickerDossier(
  ticker: string,
  regime?: NightHawkRegimeContext | null
): Promise<TickerDossier> {
  const sym = ticker.toUpperCase();
  const t = DOSSIER_FETCH_TIMEOUT_MS;
  const uw = uwConfigured();

  const [
    flowRows,
    darkPool,
    oiChange,
    ivRankRaw,
    ivTermRaw,
    realizedVolRaw,
    skewRaw,
    flowExpiry,
    positioning,
    tech,
    polyNews,
    bzNews,
    insider,
    profile,
    shortSi,
    flowStreak,
    congress,
    congressUnusual,
    institutional,
    predictionsSignal,
    screenerConfirmed,
    fundamentalRatios,
  ] = await Promise.all([
    dossierFetch(() => fetchMarketFlowAlertRows({ ticker: sym, limit: 80, min_premium: 50_000 }), [], t),
    uw ? dossierFetch(() => fetchUwDarkPool(sym), null, t) : Promise.resolve(null),
    uw ? dossierFetch(() => fetchUwOiChange(sym), [], t) : Promise.resolve([]),
    dossierFetch(() => resolveIvRank(sym), null, t),
    uw ? dossierFetch(() => fetchUwIvTermStructure(sym), [], t) : Promise.resolve([]),
    uw ? dossierFetch(() => fetchUwRealizedVol(sym), [], t) : Promise.resolve([]),
    uw ? dossierFetch(() => fetchUwRiskReversalSkew(sym), [], t) : Promise.resolve([]),
    uw ? dossierFetch(() => fetchUwFlowPerExpiry(sym, 12), [], t) : Promise.resolve([]),
    dossierFetch(() => fetchPositioningSummary(sym), {
      net_gex: 0,
      gex_king_strike: null,
      negative_gamma: false,
      gamma_regime: "unknown",
      gamma_flip: null,
      net_vex: null,
      max_pain: null,
      wall_summary: "n/a",
    }, t),
    dossierFetch(() => buildTechnicalCard(sym), null, t),
    dossierFetch(() => fetchPolygonNews(sym, 8), [], t),
    dossierFetch(() => fetchBenzingaNews(5, { ticker: sym }), [], t),
    uw ? dossierFetch(() => fetchUwInsiderTransactions(sym, 20), [], t) : Promise.resolve([]),
    dossierFetch(() => fetchPolygonTickerDetails(sym), null, t),
    dossierFetch(() => fetchShortInterest(sym), null, t),
    dossierFetch(
      () => fetchTickerFlowStreak(sym),
      { streak_days: 0, net_3d: 0, net_5d: 0, direction: "mixed" as const },
      t
    ),
    dossierFetch(() => getEditionCongressTrades(sym), [], t),
    uw ? dossierFetch(() => fetchUwCongressUnusualTrades(sym, 5), [], t) : Promise.resolve([]),
    uw ? dossierFetch(() => fetchUwInstitutionOwnership(sym, 8), [], t) : Promise.resolve([]),
    dossierFetch(() => getEditionPredictionsSignal(sym), null, t),
    dossierFetch(() => isScreenerConfirmed(sym), false, t),
    dossierFetch(() => fetchPolygonFinancialRatios(sym), null, t),
  ]);

  const flows = flowRows.map((r) => r.raw);
  const strikeStacks = computeFlowStrikeStacks(flows, { minAlerts: 2, limit: 8 });

  const polygonSentiment: string[] = [];
  for (const article of polyNews) {
    const insights = (article as { insights?: Array<Record<string, unknown>> }).insights;
    if (!Array.isArray(insights)) continue;
    for (const ins of insights) {
      if (String(ins.ticker ?? "").toUpperCase() !== sym) continue;
      const sent = String(ins.sentiment ?? "").toLowerCase();
      const reason = String(ins.sentiment_reasoning ?? ins.reasoning ?? "").slice(0, 120);
      if (sent && reason) polygonSentiment.push(`${sent}: ${reason}`);
    }
  }

  const headlines = await resolveTickerNews(sym, polyNews, bzNews);

  const insiderRows = insider as Record<string, unknown>[];
  const insiderBuys = insiderRows.filter((row) => isRecentInsiderBuy(row)).length;

  const ivRank = ivRankRaw != null && Number.isFinite(ivRankRaw) ? Number(ivRankRaw) : null;
  const ivTerm = ivTermRaw ?? [];
  const realizedVol = parseLatestRealizedVol((realizedVolRaw ?? []) as Record<string, unknown>[]);
  const riskReversalSkew = parseLatestRiskReversalSkew((skewRaw ?? []) as Record<string, unknown>[]);
  const tradingHalt = shouldBlockForTradingHalt([sym]).block;

  const dossier: TickerDossier = {
    ticker: sym,
    flows,
    flow_streak: flowStreak,
    strike_stacks: strikeStacks,
    dark_pool: darkPool,
    oi_change: oiChange,
    iv_rank: ivRank,
    iv_term: ivTerm,
    realized_vol: realizedVol,
    risk_reversal_skew: riskReversalSkew,
    flow_by_expiry: flowExpiry,
    positioning,
    congress_trades: congress,
    congress_unusual: congressUnusual,
    institutional_activity: institutional,
    predictions_signal: predictionsSignal,
    screener_confirmed: screenerConfirmed,
    tech,
    news_headlines: headlines,
    polygon_sentiment: polygonSentiment,
    analyst_summary: null,
    price_target: null,
    insider_buys: insiderBuys,
    sector: sectorFromPolygonDetails(profile),
    short_days_to_cover: shortSi?.days_to_cover ?? null,
    fundamental_ratios: fundamentalRatios,
    trading_halt: tradingHalt,
  };

  dossier.scored = scoreCandidate(
    sym,
    flows,
    tech,
    {
      dark_pool: darkPool,
      oi_change: oiChange,
      positioning,
      strike_stacks: strikeStacks,
      news_headlines: [...headlines, ...polygonSentiment],
      insider_buys: insiderBuys,
      predictions_signal: predictionsSignal,
      congress_unusual: congressUnusual,
      congress_trades: congress,
      institutional_activity: institutional,
      fundamental_ratios: fundamentalRatios,
      trading_halt: tradingHalt,
      risk_reversal_skew: riskReversalSkew,
    },
    flowStreak,
    regime
  );

  return dossier;
}

export async function fetchAllDossiers(
  tickers: string[],
  batchSize = DOSSIER_BATCH_SIZE,
  regime?: NightHawkRegimeContext | null,
  onComplete?: (d: TickerDossier) => Promise<void>
): Promise<Record<string, TickerDossier>> {
  const out: Record<string, TickerDossier> = {};
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (ticker) => {
        try {
          return await fetchTickerDossier(ticker, regime);
        } catch (err) {
          console.error(`[nighthawk/dossier] ${ticker} failed:`, err);
          return null;
        }
      })
    );

    for (const d of results) {
      if (!d) continue;
      out[d.ticker] = d;
      if (onComplete) await onComplete(d);
    }

    if (i + batchSize < tickers.length) {
      await new Promise((r) => setTimeout(r, DOSSIER_INTER_BATCH_MS));
    }
  }
  return out;
}
