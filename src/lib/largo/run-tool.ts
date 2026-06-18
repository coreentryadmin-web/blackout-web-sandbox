import {
  fetchClosedPlayOutcomes,
  fetchLottoPlaysForDate,
  fetchOpenSpxPlay,
  fetchRecentFlows,
  fetchRecentSpxSignalLogs,
  fetchSpxAdminRollups,
} from "@/lib/db";
import { getLargoSpxLiveDesk } from "@/lib/largo/spx-desk-cache";
import { computeFlowStrikeStacks, withStrikeStacks } from "@/lib/largo/flow-strike-stacks";
import { isSpxTicker } from "@/lib/spx-desk-live";
import { evaluateSpxPlay } from "@/lib/spx-play-engine";
import { buildPlayTechnicals } from "@/lib/spx-play-technicals";
import {
  buildPeerRelativeStrength,
  buildQqqRelativeStrength,
  buildSeasonality,
  largoSymbol,
} from "@/lib/largo/technicals";
import {
  fetchFinnhubBasicMetrics,
  fetchFinnhubCompanyNews,
  fetchFinnhubCompanyProfile,
  fetchFinnhubEarningsCalendar,
  fetchFinnhubEconomicCalendarRange,
  fetchFinnhubInsiderTransactions,
  fetchFinnhubIpoCalendar,
  fetchFinnhubPriceTarget,
  fetchFinnhubRecommendations,
} from "@/lib/providers/finnhub";
import { fetchUpcomingMacroEvents } from "@/lib/providers/macro-events";
import {
  computeMaxPainFromChain,
  fetchPolygonOdteGexRows,
  fetchPolygonOptionsChain,
  formatChainContracts,
  polygonOptionsMeta,
  summarizeGexFromChain,
  summarizeOiByStrike,
} from "@/lib/providers/polygon-options-gex";
import {
  fetchAggBars,
  fetchPolygonMtfTechnicals,
  fetchPolygonNews,
  fetchPolygonTickerDetails,
  fetchRelatedTickers,
  fetchStockFloat,
  fetchStockLastNbbo,
  fetchStockLastTrade,
  fetchOpenClose,
  fetchMarketUpcomingStatus,
} from "@/lib/providers/polygon-largo";
import {
  fetchBenzingaNews,
  fetchBreadthUniverseSnapshots,
  fetchIndexSnapshots,
  fetchMarketMovers,
  fetchMarketStatusNow,
  fetchSectorPerformance,
  fetchShortInterest,
  fetchShortVolume,
  fetchStockSnapshot,
  fetchVixIvRankPercentile,
} from "@/lib/providers/polygon";
import { priorEtYmd, todayEtYmd } from "@/lib/providers/spx-session";
import {
  fetchUwAtmChains,
  fetchUwCongressLateReports,
  fetchUwCongressPoliticians,
  fetchUwCongressTrades,
  fetchUwCongressUnusualTrades,
  fetchUwDarkPool,
  fetchUwDarkPoolRecent,
  fetchUwCompaniesDividends,
  fetchUwCompaniesProfile,
  fetchUwCompaniesSplits,
  fetchUwEarnings,
  fetchUwEarningsAfterhours,
  fetchUwEarningsEstimates,
  fetchUwEarningsPremarket,
  fetchUwEtfExposure,
  fetchUwEtfHoldings,
  fetchUwEtfInfo,
  fetchUwEtfInOutflow,
  fetchUwEtfTide,
  fetchUwEtfWeights,
  fetchUwExpiryBreakdown,
  fetchUwFdaCalendar,
  fetchUwFlow0dte,
  fetchUwFlowPerExpiry,
  fetchUwFlowPerStrikeRows,
  fetchUwFlowRecent,
  fetchUwFundamentalBreakdown,
  fetchUwFtds,
  fetchUwGexLevels,
  fetchUwGreekExposureExpiry,
  fetchUwGreekExposureStrike,
  fetchUwGreekFlow,
  fetchUwGlobalFlowAlerts,
  fetchUwGreeksByStrike,
  fetchUwFinancials,
  fetchUwIncomeStatements,
  fetchUwBalanceSheets,
  fetchUwCashFlows,
  fetchUwInsiderTicker,
  fetchUwInstitutionActivity,
  fetchUwInstitutionHoldings,
  fetchUwInstitutionOwnership,
  fetchUwInstitutionsLatestFilings,
  fetchUwInterpolatedIv,
  fetchUwInsiderFlow,
  fetchUwInsiderTransactions,
  fetchUwIvRank,
  fetchUwIvRankSeries,
  fetchUwIvTermStructure,
  fetchUwLitFlow,
  fetchUwLitFlowRecent,
  fetchUwMarketCorrelations,
  fetchUwMarketOiChange,
  fetchUwMarketSectorEtfs,
  fetchUwMarketTide,
  fetchUwMarketTopNetImpact,
  fetchUwMarketTotalOptionsVolume,
  fetchUwMaxPain,
  fetchUwNetFlowExpiry,
  fetchUwNetPremTicks,
  fetchUwNewsHeadlines,
  fetchUwNope,
  fetchUwOhlc,
  fetchUwOiChange,
  fetchUwOiPerExpiry,
  fetchUwOiPerStrike,
  fetchUwOptionContractFlow,
  fetchUwOptionContractIntraday,
  fetchUwOptionContractVolumeProfile,
  fetchUwOptionContracts,
  fetchUwOptionVolumeOiExpiry,
  fetchUwOptionsVolume,
  fetchUwOwnership,
  fetchUwRealizedVol,
  fetchUwRiskReversalSkew,
  fetchUwScreenerAnalysts,
  fetchUwScreenerContracts,
  fetchUwScreenerOptionContracts,
  fetchUwScreenerStocks,
  fetchUwSeasonality,
  fetchUwSeasonalityMarket,
  fetchUwSectorTide,
  fetchUwShortFloat,
  fetchUwShortsData,
  fetchUwShortScreener,
  fetchUwShortVolume,
  fetchUwShortVolumesByExchange,
  fetchUwSpotExposuresByStrike,
  fetchUwSpotExposuresExpiryStrike,
  fetchUwStockInfo,
  fetchUwStockState,
  fetchUwTechnicalIndicator,
  fetchUwTickerFlowAlerts,
  fetchUwUnusualTrades,
  fetchUwVarianceRiskPremium,
  fetchUwVolAnomalyTop,
  fetchUwVolatilityAnomaly,
  fetchUwVolatilityCharacter,
  fetchUwVolatilityCharacterTop,
  fetchUwVixTermStructure,
  formatUwOptionContracts,
  uwOptionsMeta,
} from "@/lib/providers/unusual-whales";
import { fetchWebSearch } from "@/lib/providers/web-search";

function uwTicker(ticker: string): string {
  const t = ticker.toUpperCase();
  if (t === "I:SPX" || t === "SPX") return "SPX";
  return t.replace(/^I:/, "");
}

function polySymbol(ticker: string): string {
  const t = ticker.toUpperCase();
  if (t === "SPX") return "I:SPX";
  if (t === "VIX") return "I:VIX";
  return t;
}

function optionsUnderlying(ticker: string): string {
  return uwTicker(ticker);
}

async function resolveSpot(ticker: string): Promise<number> {
  const sym = largoSymbol(ticker);
  if (sym.startsWith("I:")) {
    const snap = await fetchIndexSnapshots([sym]);
    return snap[sym]?.price ?? 0;
  }
  return (await fetchStockSnapshot(sym))?.price ?? 0;
}

async function polygonChainBundle(ticker: string, expiry: string) {
  const spot = await resolveSpot(ticker);
  if (spot <= 0) return { spot, chain: [] as Awaited<ReturnType<typeof fetchPolygonOptionsChain>> };
  const chain = await fetchPolygonOptionsChain(optionsUnderlying(ticker), spot, expiry);
  return { spot, chain };
}

const UW_EXCLUSIVE_NOTE = "UW only — no Polygon equivalent (rate-limited; use sparingly)";

function spxDeskSummary(merged: Awaited<ReturnType<typeof getLargoSpxLiveDesk>>) {
  const spx_flows = merged.spx_flows;
  return {
    as_of: merged.as_of,
    market_open: merged.market_open,
    market_label: merged.market_label,
    price: merged.price,
    change_pct: merged.spx_change_pct,
    vix: merged.vix,
    vwap: merged.vwap,
    above_vwap: merged.above_vwap,
    hod: merged.hod,
    lod: merged.lod,
    pdh: merged.pdh,
    pdl: merged.pdl,
    ema20: merged.ema20,
    ema50: merged.ema50,
    gamma_flip: merged.gamma_flip,
    gex_net: merged.gex_net,
    gex_king: merged.gex_king,
    max_pain: merged.max_pain,
    gamma_regime: merged.gamma_regime,
    gex_walls: merged.gex_walls,
    flow_0dte_net: merged.flow_0dte_net,
    tide_bias: merged.tide_bias,
    tide_net: merged.tide_net,
    nope: merged.nope,
    uw_iv_rank: merged.uw_iv_rank,
    regime: merged.regime,
    levels: merged.levels,
    dark_pool: merged.dark_pool,
    spx_flows,
    unified_tape: merged.unified_tape,
    net_prem_ticks: merged.net_prem_ticks,
    news_headlines: merged.news_headlines,
    macro_events: merged.macro_events,
    sector_heat: merged.sector_heat,
    leader_stocks: merged.leader_stocks,
    oi_changes: merged.oi_changes,
    iv_term_structure: merged.iv_term_structure,
    vix_term: merged.vix_term,
    strike_stacks: computeFlowStrikeStacks(spx_flows ?? []),
  };
}

async function toolQuote(ticker: string) {
  const sym = largoSymbol(ticker);
  if (sym.startsWith("I:")) {
    const snap = await fetchIndexSnapshots([sym]);
    const row = snap[sym];
    if (!row) return { error: `No quote for ${sym}` };
    return { ticker: sym, price: row.price, change_pct: row.change_pct, source: "polygon" };
  }
  const snap = await fetchStockSnapshot(sym);
  return snap ? { ...snap, source: "polygon" } : { error: `No quote for ${sym}` };
}

async function toolNews(ticker: string, channels: string) {
  const sym = ticker.toUpperCase();
  const channel = channels.trim();
  const benzinga = await fetchBenzingaNews(30, {
    ticker: sym || undefined,
    channels: channel || undefined,
  });
  const polygonNews = sym ? await fetchPolygonNews(sym, 12) : [];
  const finnhub = sym ? await fetchFinnhubCompanyNews(sym, 7) : null;

  let articles: Array<{
    title: string;
    teaser: string;
    published: string;
    tickers: string[];
    source: string;
    channels?: string[];
    sentiment?: Array<{ ticker: string; sentiment: string; reasoning: string }>;
  }> = [
    ...benzinga.map((a) => ({
      title: a.title,
      teaser: a.teaser || a.body.slice(0, 280),
      published: a.published,
      tickers: a.tickers,
      channels: a.channels,
      source: "benzinga",
    })),
    ...(polygonNews ?? []).map((a) => ({
      title: a.title,
      teaser: a.description,
      published: a.published,
      tickers: a.tickers,
      sentiment: a.insights,
      source: "polygon",
    })),
    ...((finnhub ?? []) as Array<Record<string, unknown>>).map((a) => ({
      title: String(a.headline ?? ""),
      teaser: String(a.summary ?? "").slice(0, 280),
      published: String(a.datetime ?? ""),
      tickers: sym ? [sym] : [],
      source: "finnhub",
    })),
  ];

  if (sym) {
    const filtered = articles.filter(
      (a) =>
        a.tickers.some((t) => t.toUpperCase() === sym) ||
        a.title.toUpperCase().includes(sym) ||
        a.teaser.toUpperCase().includes(sym)
    );
    if (filtered.length) articles = filtered;
  }
  if (channel && !sym) {
    articles = articles.filter(
      (a) =>
        a.title.toLowerCase().includes(channel.toLowerCase()) ||
        a.teaser.toLowerCase().includes(channel.toLowerCase()) ||
        (a.channels ?? []).some((c) => c.toLowerCase().includes(channel.toLowerCase()))
    );
  }

  const seen = new Set<string>();
  let deduped = articles.filter((a) => {
    const key = a.title.slice(0, 60).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (deduped.length < 6 && sym) {
    const uw = await fetchUwNewsHeadlines(sym, 8);
    deduped = [
      ...deduped,
      ...uw.map((r) => ({
        title: String(r.headline ?? r.title ?? ""),
        teaser: String(r.body ?? r.description ?? "").slice(0, 280),
        published: String(r.created_at ?? r.published ?? ""),
        tickers: [sym],
        source: "unusual_whales",
      })),
    ].filter((a) => {
      const key = a.title.slice(0, 60).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return { articles: deduped.slice(0, 12), priority: "benzinga → polygon → finnhub → uw (fallback)" };
}

async function toolEconomicCalendar(daysAhead: number) {
  const staticEvents = fetchUpcomingMacroEvents(daysAhead);
  const from = todayEtYmd();
  const to = new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
  const finnhub = await fetchFinnhubEconomicCalendarRange(from, to);
  const fhRows = (finnhub?.economicCalendar ?? []).map((r) => ({
    time: String(r.date ?? r.time ?? ""),
    event: String(r.event ?? ""),
    country: String(r.country ?? "US"),
    impact: String(r.impact ?? "medium"),
  }));
  return { static_schedule: staticEvents, finnhub: fhRows.slice(0, 20) };
}

export async function runLargoTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const ticker = String(input.ticker ?? "SPX");

  switch (name) {
    case "get_quote":
      return toolQuote(ticker);
    case "get_technicals":
      return fetchPolygonMtfTechnicals(polySymbol(ticker));
    case "get_peer_rs":
      return buildPeerRelativeStrength(ticker);
    case "get_seasonality": {
      const polygonSeason = await buildSeasonality();
      const sym = String(input.ticker ?? "").trim();
      if (!sym) return { ...polygonSeason, source: "polygon" };
      const uw = await fetchUwSeasonality(uwTicker(sym));
      return { polygon: polygonSeason, ticker: uwTicker(sym), unusual_whales: uw.length ? uw : undefined };
    }
    case "get_qqq_relative_strength":
      return buildQqqRelativeStrength();

    case "get_oi_per_strike": {
      const sym = uwTicker(ticker);
      const exp = input.expiry ? String(input.expiry) : todayEtYmd();
      const { spot, chain } = await polygonChainBundle(ticker, exp);
      const polygonOi = summarizeOiByStrike(chain, 25);
      const polygonGex = chain.length ? summarizeGexFromChain(chain, spot).slice(0, 20) : [];
      let uwOi: unknown = null;
      let uwGex: unknown = null;
      if (!polygonOi.length) uwOi = await fetchUwOiPerStrike(sym, 40);
      if (!polygonGex.length) uwGex = (await fetchUwGreekExposureStrike(sym, 200)).slice(0, 20);
      return {
        ticker: sym,
        expiry: exp,
        source: polygonOi.length ? "polygon" : "unusual_whales",
        ...polygonOptionsMeta(),
        oi_by_strike: polygonOi.length ? polygonOi : uwOi,
        gex_by_strike: polygonGex.length ? polygonGex : uwGex,
      };
    }
    case "get_oi_per_expiry":
      return { ticker: uwTicker(ticker), expiries: await fetchUwOiPerExpiry(uwTicker(ticker)) };
    case "get_max_pain": {
      const sym = uwTicker(ticker);
      const exp = input.expiry ? String(input.expiry) : todayEtYmd();
      const { chain } = await polygonChainBundle(ticker, exp);
      const maxPainPolygon = computeMaxPainFromChain(chain);
      const maxPainUw = maxPainPolygon == null ? await fetchUwMaxPain(sym) : null;
      return {
        ticker: sym,
        expiry: exp,
        source: maxPainPolygon != null ? "polygon" : maxPainUw != null ? "unusual_whales" : "none",
        ...polygonOptionsMeta(),
        max_pain: maxPainPolygon ?? maxPainUw,
      };
    }
    case "get_greeks": {
      const sym = uwTicker(ticker);
      const exp = input.expiry ? String(input.expiry) : todayEtYmd();
      const { spot, chain } = await polygonChainBundle(ticker, exp);
      const polygonContracts = formatChainContracts(chain, spot, undefined, 24);
      let uwContracts: unknown = null;
      if (!polygonContracts.length) {
        const [uwChain, uw] = await Promise.all([
          fetchUwOptionContracts(sym, { expiry: exp, limit: 300 }),
          fetchUwGreeksByStrike(sym, exp, 25),
        ]);
        const formatted = formatUwOptionContracts(uwChain, spot, undefined, 24);
        uwContracts = formatted.length ? formatted : uw;
      }
      return {
        ticker: sym,
        expiry: exp,
        source: polygonContracts.length ? "polygon" : "unusual_whales",
        ...(polygonContracts.length ? polygonOptionsMeta() : uwOptionsMeta()),
        contracts: polygonContracts.length ? polygonContracts : uwContracts,
      };
    }
    case "get_atm_chains": {
      const sym = uwTicker(ticker);
      const exp = input.expiry ? String(input.expiry) : todayEtYmd();
      const { spot, chain } = await polygonChainBundle(ticker, exp);
      const band = Math.max(spot * 0.015, 1);
      const atmPolygon = formatChainContracts(chain, spot, undefined, 40).filter(
        (c) => Math.abs(Number(c.strike) - spot) <= band
      );
      if (atmPolygon.length) {
        return { ticker: sym, expiry: exp, source: "polygon", ...polygonOptionsMeta(), chains: atmPolygon };
      }
      return {
        ticker: sym,
        source: "unusual_whales",
        chains: await fetchUwAtmChains(sym, exp),
        note: UW_EXCLUSIVE_NOTE,
      };
    }
    case "get_options_chain": {
      const sym = uwTicker(ticker);
      const exp = String(input.expiry ?? todayEtYmd());
      const optType = String(input.option_type ?? "call") as "call" | "put";
      const { spot, chain } = await polygonChainBundle(ticker, exp);
      const polygonContracts = formatChainContracts(chain, spot, optType, 28);
      if (polygonContracts.length) {
        return { ticker: sym, expiry: exp, spot, source: "polygon", ...polygonOptionsMeta(), contracts: polygonContracts };
      }
      const uwChain = await fetchUwOptionContracts(sym, { expiry: exp, option_type: optType, limit: 300 });
      return {
        ticker: sym,
        expiry: exp,
        spot,
        source: "unusual_whales",
        ...uwOptionsMeta(),
        contracts: formatUwOptionContracts(uwChain, spot, optType, 28),
        note: UW_EXCLUSIVE_NOTE,
      };
    }
    case "get_options_volume": {
      const sym = uwTicker(ticker);
      const exp = todayEtYmd();
      const { chain } = await polygonChainBundle(ticker, exp);
      if (chain.length) {
        let callVol = 0;
        let putVol = 0;
        for (const c of chain) {
          const vol = Number((c as { day?: { volume?: number } }).day?.volume ?? 0);
          const type = String(c.details?.contract_type ?? "").toLowerCase();
          if (type === "call") callVol += vol;
          else if (type === "put") putVol += vol;
        }
        if (callVol + putVol > 0) {
          return { ticker: sym, source: "polygon", call_volume: callVol, put_volume: putVol, total: callVol + putVol };
        }
      }
      return { ticker: sym, source: "unusual_whales", volume: await fetchUwOptionsVolume(sym), note: UW_EXCLUSIVE_NOTE };
    }

    case "get_options_flow": {
      const sym = uwTicker(ticker);
      if (isSpxTicker(sym)) {
        const desk = await getLargoSpxLiveDesk();
        const deskFlows = desk.spx_flows ?? [];
        const deskTape = desk.unified_tape ?? [];
        if (deskFlows.length || deskTape.length || desk.flow_0dte_net != null) {
          return withStrikeStacks(
            {
              ticker: sym,
              source: "spx_sniper_desk",
              flow_alerts: deskFlows,
              unified_tape: deskTape.slice(0, 20),
              intraday_0dte: {
                call_premium: desk.flow_0dte_call_premium,
                put_premium: desk.flow_0dte_put_premium,
                net: desk.flow_0dte_net,
              },
              bias:
                desk.flow_0dte_net != null
                  ? desk.flow_0dte_net > 0
                    ? "bullish"
                    : desk.flow_0dte_net < 0
                      ? "bearish"
                      : "neutral"
                  : desk.tide_bias,
              note: "Live SPX Sniper desk tape — same feed as dashboard",
            },
            [deskFlows]
          );
        }
      }
      const [alerts, flow0dte, recent] = await Promise.all([
        fetchUwTickerFlowAlerts(sym, 40),
        fetchUwFlow0dte(sym),
        fetchUwFlowRecent(sym, 40),
      ]);
      const callPrem = alerts.filter((a) => a.option_type === "CALL").reduce((s, a) => s + a.premium, 0);
      const putPrem = alerts.filter((a) => a.option_type === "PUT").reduce((s, a) => s + a.premium, 0);
      return withStrikeStacks(
        {
          ticker: sym,
          source: "unusual_whales",
          note: UW_EXCLUSIVE_NOTE,
          flow_alerts: alerts,
          flow_recent: recent,
          intraday_0dte: flow0dte,
          alert_premium: { calls: callPrem, puts: putPrem, net: callPrem - putPrem },
          bias: callPrem > putPrem ? "bullish" : putPrem > callPrem ? "bearish" : "neutral",
        },
        [alerts, recent]
      );
    }
    case "get_net_prem_ticks":
      return toolNetPremTicks(ticker);
    case "get_nope": {
      const sym = uwTicker(ticker);
      if (isSpxTicker(sym)) {
        const desk = await getLargoSpxLiveDesk();
        if (desk.nope != null) {
          return {
            ticker: sym,
            source: "spx_sniper_desk",
            nope: desk.nope,
            net_delta: desk.nope_net_delta,
          };
        }
      }
      return fetchUwNope(sym);
    }
    case "get_flow_per_strike":
      return { ticker: uwTicker(ticker), strikes: await fetchUwFlowPerStrikeRows(uwTicker(ticker), 30) };
    case "get_flow_expiry_breakdown":
      return { ticker: uwTicker(ticker), expiries: await fetchUwFlowPerExpiry(uwTicker(ticker)) };
    case "get_dark_pool": {
      const sym = uwTicker(ticker);
      const pool = await fetchUwDarkPool(sym);
      return pool
        ? { ...pool, source: "unusual_whales", note: UW_EXCLUSIVE_NOTE }
        : { error: "No dark pool data", ticker: sym };
    }
    case "get_lit_flow":
      return { ticker: uwTicker(ticker), prints: await fetchUwLitFlow(uwTicker(ticker)) };
    case "get_unusual_trades":
      return fetchUwUnusualTrades(input.ticker ? uwTicker(String(input.ticker)) : undefined, 25);
    case "get_market_oi_change":
      return fetchUwMarketOiChange(30);
    case "get_top_net_impact":
      return fetchUwMarketTopNetImpact(20);

    case "get_iv_stats": {
      const sym = uwTicker(ticker);
      const [ivRank, oiChange, volChar, ivSeries, interpolated] = await Promise.all([
        fetchUwIvRank(sym),
        fetchUwOiChange(sym),
        fetchUwVolatilityCharacter(sym),
        fetchUwIvRankSeries(sym),
        fetchUwInterpolatedIv(sym),
      ]);
      return {
        ticker: sym,
        ...uwOptionsMeta(),
        iv_rank: ivRank,
        oi_changes: oiChange?.slice(0, 8),
        vol_character: volChar,
        iv_rank_series: ivSeries,
        interpolated_iv: interpolated,
      };
    }
    case "get_iv_term_structure":
      return { ticker: uwTicker(ticker), curve: await fetchUwIvTermStructure(uwTicker(ticker)) };
    case "get_volatility_regime": {
      const sym = input.ticker ? uwTicker(String(input.ticker)) : "SPX";
      const desk = isSpxTicker(sym) ? await getLargoSpxLiveDesk() : null;
      const indices = await fetchIndexSnapshots(["I:VIX", "I:SPX", "I:VIX3M"]);
      const ivRank = desk?.uw_iv_rank ?? (await fetchVixIvRankPercentile());
      let ivTerm = null as Awaited<ReturnType<typeof fetchUwIvTermStructure>> | null;
      if (ivRank == null) ivTerm = await fetchUwIvTermStructure(sym);
      return {
        ticker: sym,
        vix: indices["I:VIX"],
        vix_term_desk: desk?.vix_term ?? null,
        iv_rank: ivRank,
        iv_term: ivTerm,
        source: desk ? "spx_sniper_desk" : ivRank != null ? "polygon" : "unusual_whales",
      };
    }
    case "get_realized_vol":
      return { ticker: uwTicker(ticker), realized: await fetchUwRealizedVol(uwTicker(ticker)) };
    case "get_risk_reversal_skew":
      return { ticker: uwTicker(ticker), skew: await fetchUwRiskReversalSkew(uwTicker(ticker)) };
    case "get_vol_anomaly":
      return input.ticker
        ? fetchUwVolatilityAnomaly(uwTicker(String(input.ticker)))
        : fetchUwVolAnomalyTop(String(input.direction ?? "long_vol"), 25);

    case "get_market_context": {
      const [indices, tide, status, upcoming, desk] = await Promise.all([
        fetchIndexSnapshots(["I:SPX", "I:VIX", "SPY", "QQQ", "IWM", "SOXX"]),
        fetchUwMarketTide(),
        fetchMarketStatusNow(),
        fetchMarketUpcomingStatus(),
        getLargoSpxLiveDesk().catch(() => null),
      ]);
      return {
        indices,
        market_tide: tide,
        market_status: status,
        upcoming_sessions: upcoming,
        spx_desk: desk ? spxDeskSummary(desk) : null,
      };
    }
    case "get_market_breadth":
      return fetchBreadthUniverseSnapshots();
    case "get_sector_flow": {
      const sector = String(input.sector ?? "technology").toLowerCase();
      const [tide, etfs] = await Promise.all([fetchUwSectorTide(sector), fetchSectorPerformance()]);
      return { sector, sector_tide: tide, sector_etfs: etfs };
    }
    case "get_market_movers":
      return { source: "polygon", movers: await fetchMarketMovers(15) };
    case "get_economic_calendar":
      return toolEconomicCalendar(Number(input.days_ahead ?? 14));
    case "get_etf_flow": {
      const etf = String(input.etf ?? "QQQ").toUpperCase();
      const [quote, inOut, tide] = await Promise.all([
        fetchStockSnapshot(etf),
        fetchUwEtfInOutflow(etf),
        fetchUwEtfTide(etf),
      ]);
      return { etf, quote, in_outflow: inOut, etf_tide: tide };
    }

    case "get_company_profile": {
      const sym = uwTicker(ticker);
      const [polygon, finnhub, related] = await Promise.all([
        fetchPolygonTickerDetails(sym),
        fetchFinnhubCompanyProfile(sym),
        fetchRelatedTickers(sym),
      ]);
      const uw = !polygon && !finnhub ? await fetchUwStockInfo(sym) : null;
      return { ticker: sym, polygon, finnhub, related_tickers: related, unusual_whales: uw };
    }
    case "get_financials": {
      const sym = uwTicker(ticker);
      const finnhub = await fetchFinnhubBasicMetrics(sym);
      if (finnhub && Object.keys(finnhub).length > 2) {
        return { ticker: sym, source: "finnhub", finnhub };
      }
      const [uwFin, income, balance, cashflow] = await Promise.all([
        fetchUwFinancials(sym),
        fetchUwIncomeStatements(sym),
        fetchUwBalanceSheets(sym),
        fetchUwCashFlows(sym),
      ]);
      return { ticker: sym, source: "unusual_whales", finnhub, unusual_whales: { summary: uwFin, income, balance, cashflow } };
    }
    case "get_earnings": {
      const sym = uwTicker(ticker);
      const finnhub = await fetchFinnhubEarningsCalendar(sym);
      const fhRows = finnhub?.earningsCalendar ?? [];
      if (fhRows.length) {
        return { ticker: sym, source: "finnhub", finnhub: fhRows };
      }
      const [uw, estimates] = await Promise.all([fetchUwEarnings(sym), fetchUwEarningsEstimates(sym)]);
      return { ticker: sym, source: "unusual_whales", unusual_whales: uw, estimates };
    }
    case "get_earnings_history":
      return fetchFinnhubBasicMetrics(uwTicker(ticker));
    case "get_analyst_ratings": {
      const sym = uwTicker(ticker);
      const [recs, target] = await Promise.all([
        fetchFinnhubRecommendations(sym),
        fetchFinnhubPriceTarget(sym),
      ]);
      return { recommendations: recs, price_target: target };
    }
    case "get_news":
      return toolNews(String(input.ticker ?? ""), String(input.channels ?? ""));
    case "get_web_search":
      return { query: String(input.query ?? ""), results: await fetchWebSearch(String(input.query ?? ""), 8) };
    case "get_fda_calendar":
      return fetchUwFdaCalendar(uwTicker(ticker));
    case "get_ipo_calendar":
      return fetchFinnhubIpoCalendar();

    case "get_short_interest": {
      const sym = uwTicker(ticker);
      const polygon = await fetchShortInterest(sym);
      const uw = polygon ? null : await fetchUwShortFloat(sym);
      return {
        ticker: sym,
        source: polygon ? "polygon" : uw ? "unusual_whales" : "none",
        polygon,
        unusual_whales: uw,
      };
    }
    case "get_short_data": {
      if (!input.ticker) return { screener: await fetchUwShortScreener(20), note: UW_EXCLUSIVE_NOTE };
      const sym = uwTicker(String(input.ticker));
      const polygonSi = await fetchShortInterest(sym);
      const polygonSv = await fetchShortVolume(sym, 5);
      const [uw, uwVol, ftds] = await Promise.all([
        polygonSi ? Promise.resolve(null) : fetchUwShortFloat(sym),
        polygonSv.length ? Promise.resolve([]) : fetchUwShortVolume(sym),
        fetchUwFtds(sym),
      ]);
      return {
        ticker: sym,
        polygon: { short_interest: polygonSi, short_volume: polygonSv },
        unusual_whales: uw,
        short_volume_uw: uwVol,
        ftds,
        note: uw || uwVol ? UW_EXCLUSIVE_NOTE : undefined,
      };
    }
    case "get_insider_flow": {
      const sym = uwTicker(ticker);
      const finnhub = await fetchFinnhubInsiderTransactions(sym);
      const fhRows = Array.isArray(finnhub) ? finnhub : [];
      if (fhRows.length >= 3) {
        return { ticker: sym, source: "finnhub", finnhub: fhRows };
      }
      const [uw, uwTx] = await Promise.all([fetchUwInsiderFlow(sym), fetchUwInsiderTransactions(sym)]);
      return { ticker: sym, finnhub: fhRows, aggregate: uw, transactions: uwTx };
    }
    case "get_congress_trades": {
      const [trades, late] = await Promise.all([
        fetchUwCongressTrades(input.ticker ? uwTicker(String(input.ticker)) : undefined),
        fetchUwCongressLateReports(15),
      ]);
      return { trades, late_reports: late };
    }

    case "get_screener": {
      const type = String(input.type ?? "stocks");
      if (type === "short_squeeze") return fetchUwShortScreener(25);
      if (type === "contracts") return fetchUwScreenerContracts(25);
      if (type === "option_flow") return fetchUwScreenerOptionContracts(25);
      if (type === "vol_anomaly") return fetchUwVolAnomalyTop("long_vol", 25);
      if (type === "dark_pool") return fetchUwDarkPoolRecent(25);
      if (type === "analysts") return fetchUwScreenerAnalysts(25);
      return fetchUwScreenerStocks(25);
    }

    case "get_spx_structure": {
      const merged = await getLargoSpxLiveDesk();
      return spxDeskSummary(merged);
    }
    case "get_spx_play": {
      const merged = await getLargoSpxLiveDesk();
      const technicals = await buildPlayTechnicals(merged.price, {
        vwap: merged.vwap,
        pdh: merged.pdh,
        pdl: merged.pdl,
        hod: merged.hod,
        lod: merged.lod,
      });
      return evaluateSpxPlay(merged, technicals);
    }
    case "get_open_plays":
      return { open_play: await fetchOpenSpxPlay(todayEtYmd()) };
    case "get_trade_history": {
      const days = Number(input.days ?? 30);
      const cutoff = Date.now() - days * 86400000;
      let rows = await fetchClosedPlayOutcomes(300);
      if (input.ticker) {
        const sym = uwTicker(String(input.ticker));
        rows = rows.filter((r) => r.headline.toUpperCase().includes(sym));
      }
      return rows.filter((r) => new Date(r.closed_at ?? r.opened_at).getTime() >= cutoff).slice(0, 50);
    }
    case "get_setup_stats":
      return fetchSpxAdminRollups();
    case "get_postgres_flows":
      return fetchRecentFlows({
        limit: Number(input.limit ?? 25),
        ticker: input.ticker ? uwTicker(String(input.ticker)) : undefined,
      });
    case "get_signal_log":
      return fetchRecentSpxSignalLogs(Number(input.limit ?? 20));
    case "get_lotto_state":
      return fetchLottoPlaysForDate(todayEtYmd());

    case "get_gex": {
      const sym = uwTicker(ticker);
      const exp = String(input.expiry ?? todayEtYmd());
      if (isSpxTicker(sym) && exp === todayEtYmd()) {
        const desk = await getLargoSpxLiveDesk();
        if (desk.gex_walls?.length || desk.gex_net != null) {
          return {
            ticker: sym,
            expiry: exp,
            source: "spx_sniper_desk",
            gex_net: desk.gex_net,
            gex_king: desk.gex_king,
            gamma_flip: desk.gamma_flip,
            gamma_regime: desk.gamma_regime,
            gex_walls: desk.gex_walls,
            note: "Live merged SPX desk — same as SPX Sniper dashboard",
          };
        }
      }
      const spot = await resolveSpot(ticker);
      const polygonGex = spot > 0 ? await fetchPolygonOdteGexRows(spot, exp) : [];
      if (polygonGex.length) {
        return { ticker: sym, expiry: exp, source: "polygon", ...polygonOptionsMeta(), gex_rows: polygonGex };
      }
      const [spotStrike, staticGex, gexLevels, odte] = await Promise.all([
        fetchUwSpotExposuresByStrike(sym, 300),
        fetchUwGreekExposureStrike(sym, 300),
        fetchUwGexLevels(sym, 300),
        fetchUwSpotExposuresExpiryStrike(sym, exp, 300),
      ]);
      return {
        ticker: sym,
        expiry: exp,
        source: "unusual_whales",
        note: UW_EXCLUSIVE_NOTE,
        spot_exposures: spotStrike,
        odte_exposures: odte,
        static_gex: staticGex,
        gex_levels: gexLevels,
      };
    }
    case "get_greek_flow": {
      const sym = uwTicker(ticker);
      const exp = input.expiry ? String(input.expiry) : undefined;
      const [flow, byExpiry] = await Promise.all([
        fetchUwGreekFlow(sym, exp),
        fetchUwGreekExposureExpiry(sym),
      ]);
      return { ticker: sym, expiry: exp, source: "unusual_whales", note: UW_EXCLUSIVE_NOTE, greek_flow: flow, greek_exposure_by_expiry: byExpiry };
    }
    case "get_option_contract": {
      const cid = String(input.contract_id ?? "").toUpperCase();
      if (!cid) return { error: "contract_id required" };
      const [flow, intraday, profile] = await Promise.all([
        fetchUwOptionContractFlow(cid, 30),
        fetchUwOptionContractIntraday(cid, 30),
        fetchUwOptionContractVolumeProfile(cid),
      ]);
      return { contract_id: cid, flow, intraday, volume_profile: profile, ...uwOptionsMeta() };
    }
    case "get_stock_state": {
      const sym = uwTicker(ticker);
      const [state, breakdown, expiryBreakdown, volOi] = await Promise.all([
        fetchUwStockState(sym),
        fetchUwFundamentalBreakdown(sym),
        fetchUwExpiryBreakdown(sym),
        fetchUwOptionVolumeOiExpiry(sym),
      ]);
      return { ticker: sym, state, fundamental_breakdown: breakdown, expiry_breakdown: expiryBreakdown, volume_oi_by_expiry: volOi };
    }
    case "get_ownership": {
      const sym = uwTicker(ticker);
      const [ownership, insider, instOwn] = await Promise.all([
        fetchUwOwnership(sym),
        fetchUwInsiderTicker(sym),
        fetchUwInstitutionOwnership(sym),
      ]);
      return { ticker: sym, ownership, insider_transactions: insider, institutional_holders: instOwn };
    }
    case "get_institutional": {
      if (input.institution) {
        const name = String(input.institution);
        const [activity, holdings] = await Promise.all([
          fetchUwInstitutionActivity(name),
          fetchUwInstitutionHoldings(name),
        ]);
        return { institution: name, activity, holdings };
      }
      const sym = input.ticker ? uwTicker(String(input.ticker)) : undefined;
      const [filings, ownership] = await Promise.all([
        fetchUwInstitutionsLatestFilings(25),
        sym ? fetchUwInstitutionOwnership(sym) : Promise.resolve([]),
      ]);
      return { ticker: sym, latest_filings: filings, ownership };
    }
    case "get_etf_detail": {
      const etf = String(input.etf ?? "QQQ").toUpperCase();
      const [info, holdings, weights, exposure, inOut, tide, quote] = await Promise.all([
        fetchUwEtfInfo(etf),
        fetchUwEtfHoldings(etf, 30),
        fetchUwEtfWeights(etf, 30),
        fetchUwEtfExposure(etf),
        fetchUwEtfInOutflow(etf),
        fetchUwEtfTide(etf),
        fetchStockSnapshot(etf),
      ]);
      return { etf, info, holdings, weights, exposure, in_outflow: inOut, tide, quote };
    }
    case "get_market_stats": {
      const [totalVol, correlations, sectorEtfs, netFlow, tide, litRecent, seasonality] = await Promise.all([
        fetchUwMarketTotalOptionsVolume(),
        fetchUwMarketCorrelations(30),
        fetchUwMarketSectorEtfs(),
        fetchUwNetFlowExpiry(30),
        fetchUwMarketTide(),
        fetchUwLitFlowRecent(20),
        fetchUwSeasonalityMarket(),
      ]);
      return { total_options_volume: totalVol, correlations, sector_etfs: sectorEtfs, net_flow_by_expiry: netFlow, market_tide: tide, lit_flow_recent: litRecent, seasonality_market: seasonality };
    }
    case "get_nbbo": {
      const sym = polySymbol(ticker);
      const [nbbo, trade, openClose] = await Promise.all([
        fetchStockLastNbbo(sym),
        fetchStockLastTrade(sym),
        fetchOpenClose(sym),
      ]);
      return { ticker: sym, nbbo, last_trade: trade, prior_session: openClose, source: "polygon" };
    }
    case "get_uw_bars": {
      const sym = polySymbol(ticker);
      const size = String(input.candle_size ?? "1d");
      const spanMap: Record<string, { mult: number; span: "minute" | "hour" | "day" }> = {
        "1m": { mult: 1, span: "minute" },
        "5m": { mult: 5, span: "minute" },
        "15m": { mult: 15, span: "minute" },
        "30m": { mult: 30, span: "minute" },
        "1h": { mult: 1, span: "hour" },
        "4h": { mult: 4, span: "hour" },
        "1d": { mult: 1, span: "day" },
      };
      const cfg = spanMap[size] ?? spanMap["1d"];
      const to = todayEtYmd();
      const from = priorEtYmd(cfg.span === "day" ? 400 : 30);
      const polygonBars = await fetchAggBars(sym, cfg.mult, cfg.span, from, to, "500");
      if (polygonBars.length) {
        return { ticker: sym, candle_size: size, source: "polygon", bars: polygonBars.slice(-60) };
      }
      return {
        ticker: uwTicker(ticker),
        candle_size: size,
        source: "unusual_whales",
        bars: await fetchUwOhlc(uwTicker(ticker), size, 60),
        note: UW_EXCLUSIVE_NOTE,
      };
    }
    case "get_uw_technicals": {
      const sym = uwTicker(ticker);
      const ind = String(input.indicator ?? "rsi");
      const interval = String(input.interval ?? "daily");
      const polygonMtf = await fetchPolygonMtfTechnicals(polySymbol(ticker));
      if (polygonMtf) {
        return {
          ticker: sym,
          source: "polygon",
          note: "Prefer get_technicals for full MTF stack",
          polygon_mtf: polygonMtf,
        };
      }
      const series = await fetchUwTechnicalIndicator(sym, ind, { interval });
      return { ticker: sym, indicator: ind, interval, source: "unusual_whales", series, note: UW_EXCLUSIVE_NOTE };
    }
    case "get_earnings_market": {
      const [premarket, afterhours] = await Promise.all([
        fetchUwEarningsPremarket(30),
        fetchUwEarningsAfterhours(30),
      ]);
      return { premarket, afterhours };
    }
    case "get_congress_unusual": {
      const sym = input.ticker ? uwTicker(String(input.ticker)) : undefined;
      const [unusual, politicians] = await Promise.all([
        fetchUwCongressUnusualTrades(sym, 25),
        fetchUwCongressPoliticians(20),
      ]);
      return { ticker: sym, unusual_trades: unusual, politicians };
    }
    case "get_vix_term": {
      const sym = input.ticker ? uwTicker(String(input.ticker)) : "SPX";
      const indices = await fetchIndexSnapshots(["I:VIX", "I:VIX3M", "I:VIX9D", "I:SPX"]);
      const vix = indices["I:VIX"]?.price;
      const vix3m = indices["I:VIX3M"]?.price;
      const computedTerm = vix != null && vix3m != null ? { spot: vix, three_month: vix3m, spread: vix - vix3m } : null;
      let uwVixTerm: unknown = null;
      let vrp: unknown = null;
      if (!computedTerm) {
        uwVixTerm = await fetchUwVixTermStructure(20);
      }
      if (sym !== "SPX") vrp = await fetchUwVarianceRiskPremium(sym);
      return { ticker: sym, source: computedTerm ? "polygon" : "unusual_whales", indices, vix_term: computedTerm, uw_vix_term: uwVixTerm, variance_risk_premium: vrp };
    }
    case "get_dividends": {
      const sym = uwTicker(ticker);
      const [dividends, splits, profile, float] = await Promise.all([
        fetchUwCompaniesDividends(sym),
        fetchUwCompaniesSplits(sym),
        fetchUwCompaniesProfile(sym),
        fetchStockFloat(sym),
      ]);
      return { ticker: sym, dividends, splits, company_profile: profile, float: float };
    }
    case "get_global_flow": {
      const params: Record<string, string | number> = {};
      if (input.ticker) params.ticker_symbol = uwTicker(String(input.ticker));
      if (input.min_premium) params.min_premium = Number(input.min_premium);
      if (input.is_call === true) params.is_call = "true";
      if (input.is_put === true) params.is_put = "true";
      const alerts = await fetchUwGlobalFlowAlerts(40, params);
      return withStrikeStacks(
        { alerts, source: "unusual_whales", note: UW_EXCLUSIVE_NOTE },
        [alerts]
      );
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function toolNetPremTicks(ticker: string) {
  const sym = uwTicker(ticker);
  const proxy = sym === "SPX" ? "SPY" : sym;
  const ticks = await fetchUwNetPremTicks(proxy);
  const recent = ticks?.slice(-20) ?? [];
  let momentum = "insufficient data";
  if (recent.length >= 5) {
    const last5 = recent.map((x) => Number(x.net ?? 0));
    momentum = last5[last5.length - 1] > last5[0] ? "accelerating" : "decelerating";
  }
  return { ticker: sym, recent_ticks: recent, momentum, total_ticks: ticks?.length ?? 0 };
}
