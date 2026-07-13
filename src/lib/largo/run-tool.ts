import { serverCache, TTL } from "@/lib/server-cache";
import { sanitizeFeedText } from "@/lib/largo/sanitize-feed-text";
import { getLargoSpxLiveDesk } from "@/lib/largo/spx-desk-cache";
import { computeSpxConfluence } from "@/features/spx/lib/spx-signals";
import { loadLottoRecord } from "@/features/spx/lib/spx-lotto-store";
import { loadPowerHourRecord } from "@/features/spx/lib/spx-power-hour-store";
import { fetchPositioningSummary } from "@/features/nighthawk/lib/positioning";
import { fetchPlayOutcomeStatsForWindow } from "@/features/spx/lib/spx-play-outcomes";
import {
  fetchNighthawkOutcomeAnalytics,
  fetchNighthawkScoringHistory,
  fetchPendingNighthawkOutcomes,
  fetchRecentFlows,
  fetchStagedDossiers,
  fetchStagedDossierTickers,
} from "@/lib/db";
import { summarizeGroupGreekFlow } from "@/lib/group-greek-flow-summary";
import {
  computeFlowStrikeStacks,
  normalizeFlowAlertForStack,
  withStrikeStacks,
  type FlowAlertForStack,
} from "@/lib/largo/flow-strike-stacks";
import { isSpxTicker } from "@/features/spx/lib/spx-desk-live";
import { getPlatformSnapshot, marketPlatform } from "@/lib/platform";
import { summarizeSpxDesk } from "@/features/spx/lib/spx-service";
import { zeroDteRejectionsForLargo } from "@/lib/zerodte/rejections";
import { gexRegimeEventsForLargo } from "@/lib/providers/gex-regime-events";
import { flowAnomalyNearMissesForLargo } from "@/lib/platform/flow-anomaly-near-misses";
import {
  buildPeerRelativeStrength,
  buildQqqRelativeStrength,
  buildSeasonality,
  largoSymbol,
} from "@/lib/largo/technicals";
import { fetchUpcomingMacroEventsLive } from "@/lib/providers/macro-events";
import {
  computeMaxPainFromChain,
  fetchPolygonIvTermStructure,
  fetchPolygonOdteGexRows,
  fetchPolygonOiByExpiry,
  fetchPolygonOptionsChain,
  fetchPolygonRealizedVol,
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
  fetchPolygonTickerSearch,
  fetchPolygonOptionBars,
  fetchPolygonDividends,
  fetchPolygonSplits,
  fetchPolygonIpoCalendar,
} from "@/lib/providers/polygon-largo";
import {
  fetchBenzingaNews,
  fetchBenzingaEarnings,
  fetchBenzingaAnalystRatings,
  fetchBenzingaCatalysts,
  fetchBenzingaPriceTarget,
  fetchBenzingaAfterHoursMovers,
  fetchBreadthUniverseSnapshots,
  computeMarketBreadthFromSummary,
  fetchDailyMarketSummary,
  fetchIndexSnapshots,
  fetchMarketMovers,
  fetchMarketStatusNow,
  fetchSectorPerformance,
  fetchShortInterest,
  fetchShortVolume,
  fetchStockSnapshot,
  fetchStockSnapshots,
  fetchVixIvRankPercentile,
  computeVixTermStructure,
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
  fetchUwPredictionsConsensus,
  fetchUwGroupGreekFlow,
  fetchUwEconomyIndicator,
  fetchUwMacroIndicators,
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
  formatUwOptionContracts,
  uwOptionsMeta,
} from "@/lib/providers/unusual-whales";
import { fetchWebSearch } from "@/lib/providers/web-search";

/** Validate a raw ticker symbol supplied from a tool call.
 *  Returns null if valid, or an error object to return immediately if invalid. */
function validateTicker(raw: string): { error: string } | null {
  if (raw.length > 10) {
    return { error: `Invalid ticker "${raw}": exceeds maximum length of 10 characters.` };
  }
  if (!/^[A-Za-z0-9.\-]+$/.test(raw)) {
    return { error: `Invalid ticker "${raw}": only letters, digits, dots, and hyphens are allowed.` };
  }
  return null;
}

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
  return summarizeSpxDesk(merged);
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
      title: sanitizeFeedText(a.title),
      teaser: sanitizeFeedText(a.teaser || a.body.slice(0, 280)),
      published: a.published,
      tickers: a.tickers,
      channels: a.channels,
      source: "benzinga",
    })),
    ...(polygonNews ?? []).map((a) => ({
      title: sanitizeFeedText(a.title),
      teaser: sanitizeFeedText(a.description),
      published: a.published,
      tickers: a.tickers,
      sentiment: a.insights,
      source: "polygon",
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

  // Benzinga (paid) + Polygon cover news; UW news quota reserved for flow/tide/dark pool.

  return { articles: deduped.slice(0, 12), priority: "benzinga → polygon" };
}

async function toolEconomicCalendar(daysAhead: number) {
  const staticEvents = await fetchUpcomingMacroEventsLive(daysAhead);
  return { static_schedule: staticEvents };
}

export async function runLargoTool(name: string, input: Record<string, unknown>, userId = "default"): Promise<unknown> {
  const ticker = String(input.ticker ?? "SPX");

  // Validate user-supplied ticker before any external API call
  if (input.ticker != null) {
    const tickerErr = validateTicker(String(input.ticker));
    if (tickerErr) return tickerErr;
  }

  switch (name) {
    case "get_quote":
      return toolQuote(ticker);
    case "get_technicals": {
      const sym = polySymbol(ticker);
      const mtf = await fetchPolygonMtfTechnicals(sym);
      if (mtf) return mtf;
      const { buildLargoTechnicals } = await import("@/lib/largo/technicals");
      return buildLargoTechnicals(ticker);
    }
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
        ...polygonOptionsMeta(),
        source: polygonOi.length ? "polygon" : "unusual_whales",
        oi_by_strike: polygonOi.length ? polygonOi : uwOi,
        gex_by_strike: polygonGex.length ? polygonGex : uwGex,
      };
    }
    case "get_oi_per_expiry": {
      const sym = uwTicker(ticker);
      const spot = await resolveSpot(ticker);
      const polygonExpiries = spot > 0 ? await fetchPolygonOiByExpiry(sym, 12) : [];
      if (polygonExpiries.length) {
        return {
          ticker: sym,
          ...polygonOptionsMeta(),
          expiries: polygonExpiries,
        };
      }
      return {
        ticker: sym,
        source: "unusual_whales",
        expiries: await fetchUwOiPerExpiry(sym),
      };
    }
    case "get_max_pain": {
      const sym = uwTicker(ticker);
      const exp = input.expiry ? String(input.expiry) : todayEtYmd();
      const { chain } = await polygonChainBundle(ticker, exp);
      const maxPainPolygon = computeMaxPainFromChain(chain);
      const maxPainUw = maxPainPolygon == null ? await fetchUwMaxPain(sym) : null;
      return {
        ticker: sym,
        expiry: exp,
        ...polygonOptionsMeta(),
        source: maxPainPolygon != null ? "polygon" : maxPainUw != null ? "unusual_whales" : "none",
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
        ...(polygonContracts.length ? polygonOptionsMeta() : uwOptionsMeta()),
        source: polygonContracts.length ? "polygon" : "unusual_whales",
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
        return { ticker: sym, expiry: exp, ...polygonOptionsMeta(), chains: atmPolygon };
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
        return { ticker: sym, expiry: exp, spot, ...polygonOptionsMeta(), contracts: polygonContracts };
      }
      const uwChain = await fetchUwOptionContracts(sym, { expiry: exp, option_type: optType, limit: 300 });
      return {
        ticker: sym,
        expiry: exp,
        spot,
        ...uwOptionsMeta(),
        source: "unusual_whales",
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
        const desk = await getLargoSpxLiveDesk(userId);
        const deskFlows = desk.spx_flows ?? [];
        const deskTape = desk.unified_tape ?? [];
        if (deskFlows.length || deskTape.length || desk.flow_0dte_net != null) {
          return withStrikeStacks(
            {
              ticker: sym,
              source: "spx_sniper_desk",
              as_of: desk.as_of,
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
      // Per-ticker flow for a non-SPX name. The live UW per-stock pull is small
      // (server-capped at 50 alerts / 100 recent), so on a busy name like IBM it
      // misses most of the day's stacked prints. HELIX (fetchRecentFlows) already
      // ingests this ticker's full session flow (market-wide WS/cron capture,
      // >= UW_FLOW_MIN_PREMIUM) — so merge BOTH: the live pull contributes the
      // smaller/sub-floor recent alerts, HELIX contributes the whole day's big
      // prints the small window drops. Strike-stacks then see the complete picture.
      const [alerts, flow0dte, recent] = await Promise.all([
        fetchUwTickerFlowAlerts(sym, 50),
        fetchUwFlow0dte(sym),
        fetchUwFlowRecent(sym, 100),
      ]);
      let helix: Awaited<ReturnType<typeof fetchRecentFlows>> = [];
      try {
        helix = await fetchRecentFlows({ ticker: sym, since_hours: 48, limit: 500 });
      } catch {
        /* HELIX optional (no DB in dev) — the live UW pull still stands on its own */
      }

      const callPrem = alerts.filter((a) => a.option_type === "CALL").reduce((s, a) => s + a.premium, 0);
      const putPrem = alerts.filter((a) => a.option_type === "PUT").reduce((s, a) => s + a.premium, 0);

      // Dedup the union BEFORE stacking so an alert present in both the live pull
      // and HELIX is never premium-double-counted. Key on strike|type|expiry|
      // premium|epoch-minute — epoch-normalized so UW's ISO timestamps and HELIX's
      // pg Date strings collapse to the same key for the same print. Live-pull rows
      // first so they win the 500-row cap, then HELIX (premium-DESC) fills the tail.
      const seenFlow = new Set<string>();
      const mergedFlow: FlowAlertForStack[] = [];
      for (const raw of [...alerts, ...recent, ...helix]) {
        const n = normalizeFlowAlertForStack(raw);
        if (!n) continue;
        const t = new Date(n.alerted_at).getTime();
        const minute = Number.isFinite(t) ? Math.floor(t / 60_000) : 0;
        const key = `${n.strike}|${n.option_type}|${n.expiry}|${Math.round(n.premium)}|${minute}`;
        if (seenFlow.has(key)) continue;
        seenFlow.add(key);
        mergedFlow.push(n);
      }
      const strike_stacks = computeFlowStrikeStacks(mergedFlow, { limit: 24 });

      return {
        ticker: sym,
        source: helix.length ? "unusual_whales + helix" : "unusual_whales",
        note: UW_EXCLUSIVE_NOTE,
        flow_alerts: alerts,
        flow_recent: recent,
        helix_session_alerts: helix.length,
        intraday_0dte: flow0dte,
        alert_premium: { calls: callPrem, puts: putPrem, net: callPrem - putPrem },
        bias: callPrem > putPrem ? "bullish" : putPrem > callPrem ? "bearish" : "neutral",
        strike_stacks,
      };
    }
    case "get_net_prem_ticks":
      return toolNetPremTicks(ticker);
    case "get_nope": {
      const sym = uwTicker(ticker);
      if (isSpxTicker(sym)) {
        const desk = await getLargoSpxLiveDesk(userId);
        if (desk.nope != null) {
          return {
            ticker: sym,
            source: "spx_sniper_desk",
            as_of: desk.as_of,
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
      const indexProxy = ["SPX", "SPY", "QQQ", "VIX", "IWM"].includes(sym);
      let ivRank: number | null = null;
      if (indexProxy) {
        ivRank = await fetchVixIvRankPercentile();
      }
      const uwCalls =
        ivRank == null
          ? Promise.all([
              fetchUwIvRank(sym),
              fetchUwOiChange(sym),
              fetchUwIvRankSeries(sym),
              fetchUwInterpolatedIv(sym),
            ])
          : Promise.all([
              Promise.resolve(null),
              fetchUwOiChange(sym),
              Promise.resolve(null),
              fetchUwInterpolatedIv(sym),
            ]);
      const [uwIvRank, oiChange, ivSeries, interpolated] = await uwCalls;
      return {
        ticker: sym,
        ...(ivRank != null ? polygonOptionsMeta() : uwOptionsMeta()),
        source: ivRank != null ? "polygon" : "unusual_whales",
        iv_rank: ivRank ?? uwIvRank,
        oi_changes: oiChange?.slice(0, 8),
        iv_rank_series: ivSeries,
        interpolated_iv: interpolated,
      };
    }
    case "get_iv_term_structure": {
      const sym = uwTicker(ticker);
      const polygonCurve = await fetchPolygonIvTermStructure(sym);
      if (polygonCurve && polygonCurve.length > 0) {
        return { ticker: sym, ...polygonOptionsMeta(), curve: polygonCurve };
      }
      return { ticker: sym, source: "unusual_whales", curve: await fetchUwIvTermStructure(sym) };
    }
    case "get_volatility_regime": {
      const sym = input.ticker ? uwTicker(String(input.ticker)) : "SPX";
      const desk = isSpxTicker(sym) ? await getLargoSpxLiveDesk(userId) : null;
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
    case "get_realized_vol": {
      const sym = uwTicker(ticker);
      const polyVol = await fetchPolygonRealizedVol(sym);
      if (polyVol && (polyVol.realized_vol_30d > 0 || polyVol.realized_vol_10d > 0)) {
        return { ticker: sym, ...polygonOptionsMeta(), realized: polyVol };
      }
      return { ticker: sym, source: "unusual_whales", realized: await fetchUwRealizedVol(sym) };
    }
    case "get_risk_reversal_skew":
      return { ticker: uwTicker(ticker), skew: await fetchUwRiskReversalSkew(uwTicker(ticker)) };
    case "get_market_context": {
      // spx desk is per-user-session and must stay outside the shared cache
      const desk = await getLargoSpxLiveDesk(userId).catch(() => null);
      const shared = await serverCache("market_context", TTL.MARKET_SNAPSHOT, async () => {
        const [indices, etfs, tide, status, upcoming] = await Promise.all([
          fetchIndexSnapshots(["I:SPX", "I:VIX"]),
          fetchStockSnapshots(["SPY", "QQQ", "IWM", "SOXX"]),
          fetchUwMarketTide(),
          fetchMarketStatusNow(),
          fetchMarketUpcomingStatus(),
        ]);
        return { indices: { ...indices, ...etfs }, market_tide: tide, market_status: status, upcoming_sessions: upcoming };
      });
      return {
        ...shared,
        spx_desk: desk ? spxDeskSummary(desk) : null,
      };
    }
    case "get_market_breadth": {
      const today = todayEtYmd();
      const [etfUniverse, daily] = await Promise.all([
        fetchBreadthUniverseSnapshots(),
        fetchDailyMarketSummary(today).catch(() => null),
      ]);
      const fullMarket =
        daily?.results?.length ? computeMarketBreadthFromSummary(daily.results) : null;
      return { etf_universe: etfUniverse, full_market: fullMarket, date: today };
    }
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
      const [polygon, related] = await Promise.all([
        fetchPolygonTickerDetails(sym),
        fetchRelatedTickers(sym),
      ]);
      const uw = !polygon ? await fetchUwStockInfo(sym) : null;
      return { ticker: sym, polygon, related_tickers: related, unusual_whales: uw };
    }
    case "get_financials": {
      const sym = uwTicker(ticker);
      const [uwFin, income, balance, cashflow] = await Promise.all([
        fetchUwFinancials(sym),
        fetchUwIncomeStatements(sym),
        fetchUwBalanceSheets(sym),
        fetchUwCashFlows(sym),
      ]);
      return { ticker: sym, source: "unusual_whales", unusual_whales: { summary: uwFin, income, balance, cashflow } };
    }
    case "get_earnings": {
      const sym = uwTicker(ticker);
      return serverCache(`earnings:${sym}`, TTL.EARNINGS, async () => {
        // PRIMARY: Benzinga earnings news via Polygon (unlimited calls, no rate limit).
        // SUPPLEMENTAL: UW earnings history and estimates (rate-limited; used only when Benzinga lacks data).
        const benzinga = await fetchBenzingaEarnings(sym, 15);
        const [uw, estimates] = await Promise.all([
          fetchUwEarnings(sym),
          fetchUwEarningsEstimates(sym),
        ]);
        return {
          ticker: sym,
          source: benzinga.length ? "benzinga" : "unusual_whales",
          benzinga_news: benzinga,
          unusual_whales: uw,
          estimates,
        };
      });
    }
    case "get_earnings_history": {
      const sym = uwTicker(ticker);
      const [earnings, estimates] = await Promise.all([fetchUwEarnings(sym), fetchUwEarningsEstimates(sym)]);
      return { ticker: sym, source: "unusual_whales", earnings, estimates };
    }
    case "get_analyst_ratings": {
      const sym = uwTicker(ticker);
      return serverCache(`analysts:${sym}`, TTL.ANALYST, async () => {
        // PRIMARY: Benzinga analyst ratings via Polygon (unlimited calls, no rate limit).
        // FALLBACK: UW screener analysts — only included when Benzinga returns no results for this ticker.
        const benzinga = await fetchBenzingaAnalystRatings(sym, 20);
        const forTicker: unknown[] = [];
        if (!benzinga.length) {
          const rows = await fetchUwScreenerAnalysts(50);
          forTicker.push(...rows.filter((r) => String(r.ticker ?? r.symbol ?? "").toUpperCase() === sym));
        }
        return {
          ticker: sym,
          source: benzinga.length ? "benzinga" : forTicker.length ? "unusual_whales" : "none",
          benzinga_ratings: benzinga,
          analysts: forTicker,
        };
      });
    }
    case "get_news":
      return toolNews(String(input.ticker ?? ""), String(input.channels ?? ""));
    case "get_web_search": {
      const webResults = await fetchWebSearch(String(input.query ?? ""), 8);
      return {
        query: String(input.query ?? ""),
        results: webResults.map((r) => ({
          title: sanitizeFeedText(r.title),
          url: r.url,
          snippet: sanitizeFeedText(r.snippet),
        })),
      };
    }
    case "get_fda_calendar":
      return fetchUwFdaCalendar(uwTicker(ticker));
    case "get_ipo_calendar": {
      const today = todayEtYmd();
      const d = new Date(today + "T00:00:00Z");
      d.setDate(d.getDate() + 30);
      const toDate = d.toISOString().slice(0, 10);
      const fromDate = String(input.from ?? today);
      const toDateFinal = String(input.to ?? toDate);
      return serverCache(`ipo:${fromDate}:${toDateFinal}`, TTL.IPO_CALENDAR, async () => {
        const ipos = await fetchPolygonIpoCalendar(fromDate, toDateFinal);
        return {
          ipos,
          source: ipos.length ? "polygon" : "none",
          range: { from: fromDate, to: toDateFinal },
          note: ipos.length ? undefined : "No IPO data from Polygon — try get_web_search for upcoming listings.",
        };
      });
    }

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
      const [uw, uwTx] = await Promise.all([fetchUwInsiderFlow(sym), fetchUwInsiderTransactions(sym)]);
      return { ticker: sym, source: "unusual_whales", aggregate: uw, transactions: uwTx };
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
      if (type === "dark_pool") return fetchUwDarkPoolRecent(25);
      if (type === "analysts") return fetchUwScreenerAnalysts(25);
      return fetchUwScreenerStocks(25);
    }

    case "get_spx_structure": {
      return marketPlatform.spx.getSpxDeskSummary();
    }
    case "get_spx_play": {
      return marketPlatform.spx.getSpxPlayState();
    }
    case "get_open_plays":
      return marketPlatform.spx.getSpxOpenPlay();
    case "get_trade_history": {
      const days = Number(input.days ?? 30);
      return marketPlatform.spx.getSpxTradeHistory({
        ticker: input.ticker ? String(input.ticker) : undefined,
        days,
      });
    }
    case "get_setup_stats":
      return marketPlatform.spx.getSpxSetupStats();
    case "get_postgres_flows":
      return marketPlatform.flows.getFlowTape({
        limit: Number(input.limit ?? 25),
        ticker: input.ticker ? uwTicker(String(input.ticker)) : undefined,
      });
    case "get_signal_log":
      return marketPlatform.spx.getSpxSignalLog(Number(input.limit ?? 20));
    case "get_spx_engine_snapshots":
      return marketPlatform.spx.getSpxEngineSnapshots(Number(input.limit ?? 20));
    case "get_lotto_state":
      return marketPlatform.spx.getSpxLottoState();

    case "get_zerodte_plays":
      return marketPlatform.zerodte.zeroDtePlaysForLargo();
    case "get_zerodte_rejections":
      return zeroDteRejectionsForLargo(
        input.ticker ? String(input.ticker) : undefined,
        Number(input.limit ?? 20)
      );
    case "get_flow_anomaly_near_misses":
      return flowAnomalyNearMissesForLargo(
        input.ticker ? String(input.ticker) : undefined,
        Number(input.limit ?? 20)
      );

    case "get_nighthawk_edition": {
      const date = input.date ? String(input.date) : undefined;
      const edition = date
        ? await marketPlatform.nighthawk.getNightHawkEditionForDate(date)
        : await marketPlatform.nighthawk.getLatestNightHawkEdition();
      return edition ?? { available: false, plays: [] };
    }

    case "get_flow_tape":
      return marketPlatform.flows.getFlowTapeSummary({
        limit: Number(input.limit ?? 50),
        ticker: input.ticker ? uwTicker(String(input.ticker)) : undefined,
      });

    case "get_platform_snapshot":
      return getPlatformSnapshot({
        include: Array.isArray(input.include)
          ? (input.include as Array<"spx" | "flows" | "nighthawk" | "largo">)
          : undefined,
        flowLimit: Number(input.flow_limit ?? 50),
        fullEdition: Boolean(input.full_edition),
      });

    case "get_ecosystem_context": {
      const { fetchEcosystemContext } = await import("@/lib/bie/ecosystem-context");
      return fetchEcosystemContext(ticker);
    }

    case "call_internal_api": {
      const { callInternalApiRead } = await import("@/lib/bie/internal-api");
      const rawParams =
        input.params && typeof input.params === "object" && !Array.isArray(input.params)
          ? (input.params as Record<string, string | number | boolean | null | undefined>)
          : undefined;
      // Governed + read-only: callInternalApiRead hard-denies anything not a GET class:read route.
      return callInternalApiRead(String(input.path ?? ""), rawParams);
    }

    case "get_vector_full_state": {
      const [{ fetchVectorFullState }, { normalizeDteHorizon }] = await Promise.all([
        import("@/lib/bie/vector-full-state"),
        import("@/features/vector/lib/vector-dte-horizon"),
      ]);
      // fetchVectorFullState normalizes the ticker itself (normalizeVectorTicker); pass the raw
      // string. horizon is validated to one of 0dte/weekly/monthly/all, defaulting to "all".
      return fetchVectorFullState(ticker, normalizeDteHorizon(input.horizon));
    }

    case "get_hot_tickers": {
      const { fetchHotTickers } = await import("@/lib/bie/hot-tickers");
      return fetchHotTickers(8);
    }

    case "get_market_regime": {
      const { fetchPlatformIntelSnapshot } = await import("@/features/nighthawk/lib/platform-intel-snapshot");
      return fetchPlatformIntelSnapshot();
    }

    case "get_confluence_outcomes": {
      const { computeConfluenceOutcomeStats, computeSpxSlayerShadowFactorOutcomeStats } = await import(
        "@/lib/bie/confluence-outcomes"
      );
      // Two independent, additive analytics passes over the SAME tool surface —
      // see confluence-outcomes.ts's module doc above computeSpxSlayerShadowFactorOutcomeStats
      // for why the SPX Slayer half joins spx_confluence_shadow_observations against
      // spx_play_outcomes directly rather than through alert_audit_log. Each fails
      // open to its own null independently, so a problem on one product's side can
      // never blank out the other's numbers.
      const [zerodte_nighthawk_echo, spx_slayer_shadow_factors] = await Promise.all([
        computeConfluenceOutcomeStats(60),
        computeSpxSlayerShadowFactorOutcomeStats(60),
      ]);
      return { zerodte_nighthawk_echo, spx_slayer_shadow_factors };
    }

    case "get_similar_precedents": {
      const { findSimilarPrecedents } = await import("@/lib/bie/precedent-search");
      const query = String(input.query ?? "");
      const hits = await findSimilarPrecedents(query, 5);
      return {
        query,
        precedents: hits.map((h) => ({ description: h.chunk, similarity: Math.round(h.similarity * 1000) / 1000 })),
      };
    }

    case "get_gex": {
      const sym = uwTicker(ticker);
      const exp = String(input.expiry ?? todayEtYmd());
      if (isSpxTicker(sym) && exp === todayEtYmd()) {
        const desk = await getLargoSpxLiveDesk(userId);
        if (desk.gex_walls?.length || desk.gex_net != null) {
          return {
            ticker: sym,
            expiry: exp,
            source: "spx_sniper_desk",
            as_of: desk.as_of,
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
        return { ticker: sym, expiry: exp, ...polygonOptionsMeta(), gex_rows: polygonGex };
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
    case "get_predictions_consensus": {
      const limit = Number(input.limit ?? 20);
      const filterTicker = input.ticker ? String(input.ticker) : undefined;
      const consensus = await fetchUwPredictionsConsensus(limit, filterTicker);
      return { ...consensus, note: UW_EXCLUSIVE_NOTE };
    }
    case "get_group_greek_flow": {
      const group = String(input.group ?? "mag7").toLowerCase();
      const exp = input.expiry ? String(input.expiry) : undefined;
      const rows = await fetchUwGroupGreekFlow(group, exp);
      const summary = summarizeGroupGreekFlow(group, rows as Record<string, unknown>[]);
      return {
        group,
        expiry: exp,
        source: "unusual_whales",
        note: UW_EXCLUSIVE_NOTE,
        greek_flow: rows,
        summary,
      };
    }
    case "get_macro_indicator": {
      const indicator = String(input.indicator ?? "CPI").toUpperCase();
      const single = await fetchUwEconomyIndicator(indicator);
      return { ...single, note: UW_EXCLUSIVE_NOTE };
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
      const vix9d = indices["I:VIX9D"]?.price;
      const computedTerm =
        vix != null && vix3m != null
          ? { spot: vix, three_month: vix3m, spread: vix - vix3m, ...computeVixTermStructure(vix, vix9d ?? null, vix3m) }
          : null;
      return { ticker: sym, source: "polygon", indices, vix_term: computedTerm };
    }
    case "get_dividends": {
      const sym = uwTicker(ticker);
      return serverCache(`dividends:${sym}`, TTL.REFERENCE, async () => {
        const [polygonDivs, polygonSplits, uwDividends, uwSplits, profile, float] = await Promise.all([
          fetchPolygonDividends(sym),
          fetchPolygonSplits(sym),
          fetchUwCompaniesDividends(sym),
          fetchUwCompaniesSplits(sym),
          fetchUwCompaniesProfile(sym),
          fetchStockFloat(sym),
        ]);
        return {
          ticker: sym,
          source: polygonDivs.length ? "polygon" : "unusual_whales",
          dividends: polygonDivs.length ? polygonDivs : uwDividends,
          splits: polygonSplits.length ? polygonSplits : uwSplits,
          company_profile: profile,
          float: float,
        };
      });
    }
    case "search_ticker": {
      const q = String(input.query ?? ticker ?? "");
      if (!q) return { error: "query required" };
      // Bound the cache-key cardinality (mirrors the HTTP ticker-search route): cap length,
      // allow-list the charset, and clamp limit — so this path can't mint unbounded distinct
      // cache keys upstream of the server-cache layer.
      if (q.length > 32 || !/^[A-Za-z0-9.\-& ]+$/.test(q)) {
        return { error: "invalid query" };
      }
      const limit = Math.min(20, Math.max(1, Number(input.limit ?? 10) || 10));
      return serverCache(`search:${q.toLowerCase()}:${limit}`, TTL.TICKER_SEARCH, async () => {
        const results = await fetchPolygonTickerSearch(q, limit);
        return { query: q, results, source: "polygon" };
      });
    }
    case "get_option_price_history": {
      const contract = String(input.contract_id ?? "");
      if (!contract) return { error: "contract_id required (OCC symbol e.g. AAPL250117C00200000)" };
      const mult = Number(input.multiplier ?? 1);
      const span = String(input.timespan ?? "day") as "minute" | "hour" | "day";
      const from = String(input.from ?? priorEtYmd());
      const to = String(input.to ?? todayEtYmd());
      return serverCache(`optbars:${contract}:${from}:${to}`, TTL.OPTIONS_CHAIN, async () => {
        const bars = await fetchPolygonOptionBars(contract, mult, span, from, to);
        return { contract_id: contract, multiplier: mult, timespan: span, from, to, source: "polygon", bars };
      });
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

    case "get_spx_confluence": {
      // Pure compute on the already-cached per-user desk — no extra API calls.
      const desk = await getLargoSpxLiveDesk(userId);
      const confluence = computeSpxConfluence(desk);
      return (
        confluence ?? { error: "No confluence available — SPX desk not live yet." }
      );
    }
    case "get_positioning": {
      const sym = uwTicker(ticker);
      return { ticker: sym, ...(await fetchPositioningSummary(sym)) };
    }
    case "get_gex_regime_events":
      return gexRegimeEventsForLargo(
        input.ticker ? String(input.ticker) : undefined,
        Number(input.limit ?? 20)
      );
    case "get_nighthawk_outcomes": {
      // Clamp to a valid INTEGER window (mirrors the admin /nighthawk/analytics parseWindow:
      // 7–180). The model can emit a non-integer here — including echoing a raw fractional
      // value (e.g. days_of_data) it saw in the desk context — which would otherwise bind to
      // the fetchNighthawkOutcomeAnalytics $1::int day-param and crash Postgres with
      // "invalid input syntax for type integer". Number.isInteger never trusts LLM input.
      const rawWindow = Number(input.window_days ?? 30);
      const windowDays = Number.isFinite(rawWindow)
        ? Math.min(180, Math.max(7, Math.trunc(rawWindow)))
        : 30;
      const [analytics, pending] = await Promise.all([
        fetchNighthawkOutcomeAnalytics(windowDays),
        fetchPendingNighthawkOutcomes(7),
      ]);
      return { window_days: windowDays, analytics, pending };
    }
    case "get_spx_vs_nighthawk_comparison": {
      // WHY THIS TOOL EXISTS (don't delete without reading this): before this
      // tool, "how's SPX Slayer doing vs Night Hawk this week" forced Largo to
      // call get_setup_stats + get_nighthawk_outcomes separately and then
      // synthesize the comparison itself in free text (subtract two win rates,
      // eyeball which is "hotter"). The Layer-4 grounding verifier
      // (src/lib/bie/verifier.ts, via largo-verifier.ts) only checks that each
      // individual NUMBER an answer cites traces back to a real tool result —
      // it has no notion of a "derived" claim, so it cannot tell a correct
      // subtraction from a confidently wrong one. Every raw number in a bad
      // synthesized comparison could be genuine and it would still pass
      // grounding review. Computing the delta here, once, in code, removes
      // that blind spot entirely: the model only ever repeats a number the
      // platform already computed.
      //
      // `days` is a rolling day-count window, NOT a calendar week — neither
      // underlying source supports a real Mon-Sun boundary either (SPX plays
      // are windowed by days-ago cutoff, Night Hawk by window_days), so this
      // mirrors that existing honest-approximation convention instead of
      // pretending to a precision the data doesn't have. It's applied
      // IDENTICALLY to both products so the comparison itself is apples-to-
      // apples (a mismatched window — e.g. SPX all-time vs Night Hawk 7d —
      // would be exactly the kind of silently-wrong derived number this tool
      // exists to prevent).
      const rawDays = Number(input.days ?? 7);
      const days = Number.isFinite(rawDays) ? Math.min(180, Math.max(1, Math.trunc(rawDays))) : 7;

      const [spxStats, nighthawkAnalytics] = await Promise.all([
        // Reuses the existing SQL fetcher (fetchClosedPlayOutcomes) and the
        // existing pure aggregator (computePlayOutcomeStats) — see
        // fetchPlayOutcomeStatsForWindow's own doc comment in
        // spx-play-outcomes.ts for why this is a sibling of
        // fetchPlayOutcomeStats() rather than a change to it.
        fetchPlayOutcomeStatsForWindow(days),
        fetchNighthawkOutcomeAnalytics(days),
      ]);

      // Night Hawk has no single "win_rate" field on the raw analytics rows
      // (get_nighthawk_outcomes intentionally returns raw rows and leaves
      // interpretation to the model) — so derive it here the same way
      // src/lib/nighthawk/analytics.ts's winRate() does: target = win,
      // stop = loss, everything else (open/ambiguous/unfilled) excluded from
      // the rate denominator because it isn't a decided outcome yet.
      const nhRows = nighthawkAnalytics.rows;
      const nighthawk_wins = nhRows.filter((r) => r.outcome === "target").length;
      const nighthawk_losses = nhRows.filter((r) => r.outcome === "stop").length;
      const nighthawk_decided = nighthawk_wins + nighthawk_losses;
      const nighthawk_win_rate = nighthawk_decided > 0 ? nighthawk_wins / nighthawk_decided : 0;
      const nighthawk_signal_count = nhRows.length;

      const spx_win_rate = spxStats.overall.win_rate;
      const spx_signal_count = spxStats.total_closed;

      return {
        days,
        note: `Rolling ${days}-day window applied identically to both products — an honest approximation of "this ${days === 7 ? "week" : `${days}d`}," not a calendar boundary.`,
        spx_win_rate,
        spx_wins: spxStats.overall.wins,
        spx_losses: spxStats.overall.losses,
        spx_breakeven: spxStats.overall.breakeven,
        spx_signal_count,
        nighthawk_win_rate,
        nighthawk_wins,
        nighthawk_losses,
        nighthawk_pending_count: nighthawkAnalytics.pending_count,
        nighthawk_signal_count,
        // Pre-computed once, in code — the whole point of this tool. Positive
        // win_rate_delta means SPX Slayer's window win rate is hotter than
        // Night Hawk's over the SAME window; negative means Night Hawk is hotter.
        win_rate_delta: spx_win_rate - nighthawk_win_rate,
        signal_count_delta: spx_signal_count - nighthawk_signal_count,
      };
    }
    case "get_nighthawk_dossier": {
      let editionFor = input.date ? String(input.date) : null;
      if (!editionFor) {
        const latest = await marketPlatform.nighthawk.getLatestNightHawkEdition();
        editionFor = (latest as { edition_for?: string } | null)?.edition_for ?? todayEtYmd();
      }
      const tickerFilter = input.ticker ? uwTicker(String(input.ticker)) : null;
      if (tickerFilter) {
        const all = await fetchStagedDossiers(editionFor);
        const one = all.find((d) => d.ticker === tickerFilter);
        if (one) {
          return { edition_for: editionFor, ticker: tickerFilter, dossier: one, archived: false };
        }
        // Live staging is cleared the moment an edition publishes (task #129) — fall back to the
        // durable nighthawk_scoring_history archive so "why was ticker X scored" stays answerable
        // the morning after, not just while tonight's hunt run is still in flight.
        const history = await fetchNighthawkScoringHistory(editionFor, tickerFilter);
        const archivedRow = history[0];
        const dossier = archivedRow
          ? { ticker: archivedRow.ticker, dossier: archivedRow.dossier, scored: archivedRow.scored }
          : null;
        return { edition_for: editionFor, ticker: tickerFilter, dossier, archived: Boolean(archivedRow) };
      }
      const liveTickers = await fetchStagedDossierTickers(editionFor);
      if (liveTickers.length) {
        return { edition_for: editionFor, tickers: liveTickers, archived: false, note: "Pass a ticker to get its full dossier." };
      }
      // Same fallback as above, for the no-ticker "list what's available" call.
      const archivedHistory = await fetchNighthawkScoringHistory(editionFor);
      const archivedTickers = archivedHistory.map((h) => h.ticker);
      return {
        edition_for: editionFor,
        tickers: archivedTickers,
        archived: archivedTickers.length > 0,
        note: "Pass a ticker to get its full dossier.",
      };
    }
    case "get_lotto_live": {
      // Read-only current record — does NOT re-run the (mutating) lotto evaluator.
      const rec = await loadLottoRecord();
      return rec ?? { available: false, note: "No live lotto record for today yet." };
    }
    case "get_power_hour": {
      // Read-only current record — does NOT re-run the (mutating) power-hour evaluator.
      const rec = await loadPowerHourRecord();
      return rec ?? { available: false, note: "No power-hour record for today yet." };
    }

    case "get_catalysts": {
      const sym = uwTicker(ticker);
      const limit = Math.min(20, Math.max(1, Number(input.limit ?? 8) || 8));
      const catalysts = await fetchBenzingaCatalysts(sym, limit);
      return { ticker: sym, source: "benzinga", catalysts };
    }
    case "get_price_targets": {
      const sym = uwTicker(ticker);
      const pt = await fetchBenzingaPriceTarget(sym);
      return pt
        ? { ticker: sym, source: "benzinga", price_target: pt }
        : { ticker: sym, source: "benzinga", price_target: null, note: "No recent price target found for this ticker." };
    }
    case "get_ah_movers": {
      const limit = Math.min(30, Math.max(1, Number(input.limit ?? 15) || 15));
      const movers = await fetchBenzingaAfterHoursMovers(limit);
      return { source: "benzinga", movers };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/** Round a nullable number to `digits` places; null/non-finite passes through as null
 *  (never fabricates a 0 — a missing value stays missing). */
function round(v: number | null | undefined, digits: number): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
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
  // SPX has no UW net-prem-ticks tape, so we serve SPY ticks as the index proxy.
  // Surface that explicitly (proxy + source marker, mirroring the source-tagging in
  // get_options_flow/get_gex) so Largo caveats it as SPY-derived instead of presenting
  // SPY flow as if it were SPX. When sym === proxy the data is the real ticker — no marker.
  const proxied = proxy !== sym;
  return {
    ticker: sym,
    recent_ticks: recent,
    momentum,
    total_ticks: ticks?.length ?? 0,
    ...(proxied ? { proxy, source: `unusual_whales (${proxy} proxy)` } : {}),
  };
}
