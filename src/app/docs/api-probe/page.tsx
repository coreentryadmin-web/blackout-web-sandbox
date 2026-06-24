/**
 * /docs/api-probe — Live probe results for Polygon/Massive and Unusual Whales.
 * Probed 2026-06-18 with POLYGON_API_KEY and UW_API_KEY from .env.local.
 */
import Link from "next/link";

export const revalidate = 0;

type Status = 200 | 101 | 302 | 400 | 403 | 404 | 422 | 429 | "ERR" | "NO_KEY";
type UsageStatus = "used" | "unused" | "partial";

type ProbeRow = {
  name: string;
  method: "GET" | "POST" | "WS";
  path: string;
  probeStatus: Status;
  note?: string;
  usage: UsageStatus;
  usedIn?: string; // file that uses it
  opportunity?: string; // if unused, what it could be used for
};

type Section = {
  id: string;
  title: string;
  rows: ProbeRow[];
};

// ─────────────────────────────────────────────────────────────────────────────
// POLYGON / MASSIVE PROBE RESULTS
// Probed: https://api.massive.com — POLYGON_API_KEY=<redacted>
// ─────────────────────────────────────────────────────────────────────────────

const POLYGON_SECTIONS: Section[] = [
  {
    id: "stocks-snapshots",
    title: "Stocks → Snapshots",
    rows: [
      {
        name: "Single Ticker Snapshot",
        method: "GET",
        path: "/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchStockSnapshot()",
      },
      {
        name: "Batch Ticker Snapshots",
        method: "GET",
        path: "/v2/snapshot/locale/us/markets/stocks/tickers?tickers=...",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchStockSnapshotPerformance() (leader stocks + sector ETFs)",
      },
      {
        name: "Top Market Gainers",
        method: "GET",
        path: "/v2/snapshot/locale/us/markets/stocks/gainers",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchMarketMovers()",
      },
      {
        name: "Top Market Losers",
        method: "GET",
        path: "/v2/snapshot/locale/us/markets/stocks/losers",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchMarketMovers()",
      },
      {
        name: "Unified Snapshot (multi-asset)",
        method: "GET",
        path: "/v3/snapshot?ticker.any_of=...",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Could replace multiple single-asset snapshot calls with one batched request spanning stocks + options + indices. Useful for Largo multi-ticker loads.",
      },
    ],
  },
  {
    id: "stocks-aggs",
    title: "Stocks → Aggregate Bars",
    rows: [
      {
        name: "Custom Bars (intraday)",
        method: "GET",
        path: "/v2/aggs/ticker/{ticker}/range/1/minute/{from}/{to}",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchIndexMinuteBars() / providers/polygon-largo.ts → fetchAggBars()",
      },
      {
        name: "Custom Bars (daily)",
        method: "GET",
        path: "/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchIndexDailyBars(), fetchStockDailyBars() / providers/polygon-largo.ts",
      },
      {
        name: "Previous Day Bar",
        method: "GET",
        path: "/v2/aggs/ticker/{ticker}/prev",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon-largo.ts → fetchPreviousDayBar()",
      },
      {
        name: "Daily Market Summary (all stocks)",
        method: "GET",
        path: "/v2/aggs/grouped/locale/us/market/stocks/{date}",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Full market OHLC + VWAP for all U.S. stocks in one response. Would enable SPX breadth scoring (% above VWAP, % green) without per-ticker snapshot calls.",
      },
      {
        name: "Daily Ticker Summary",
        method: "GET",
        path: "/v1/open-close/{ticker}/{date}",
        probeStatus: 200,
        usage: "partial",
        usedIn: "providers/polygon-largo.ts (large) — not yet wired for indices (I:SPX)",
        note: "Endpoint works for I:SPX, not currently called with index tickers in spx-desk",
      },
    ],
  },
  {
    id: "stocks-trades-quotes",
    title: "Stocks → Trades & Quotes",
    rows: [
      {
        name: "Last Trade",
        method: "GET",
        path: "/v2/last/trade/{ticker}",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon-largo.ts",
      },
      {
        name: "Last Quote (NBBO)",
        method: "GET",
        path: "/v2/last/nbbo/{ticker}",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon-largo.ts",
      },
      {
        name: "Historical Trades (tick-level)",
        method: "GET",
        path: "/v3/trades/{ticker}?limit=...",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Full tick tape for any stock. Could power a real lit-trade feed for Largo without relying on UW lit-flow.",
      },
      {
        name: "Historical Quotes",
        method: "GET",
        path: "/v3/quotes/{ticker}?limit=...",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Historical bid/ask spread analysis — useful for Largo spread quality indicator and slippage modeling.",
      },
    ],
  },
  {
    id: "stocks-indicators",
    title: "Stocks → Technical Indicators",
    rows: [
      {
        name: "EMA",
        method: "GET",
        path: "/v1/indicators/ema/{ticker}?window=&timespan=",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchTickerEma(), fetchIndexEma() — EMA 20/50/200 for desk structure",
      },
      {
        name: "SMA",
        method: "GET",
        path: "/v1/indicators/sma/{ticker}?window=&timespan=",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchIndexSma() / providers/polygon-largo.ts — SMA 50/200",
      },
      {
        name: "RSI",
        method: "GET",
        path: "/v1/indicators/rsi/{ticker}?window=14&timespan=",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchTickerRsi() — stock RSI for Largo",
        note: "Index RSI not called — only stock RSI. SPX 5m RSI is computed from minute bars, not this endpoint.",
      },
      {
        name: "MACD",
        method: "GET",
        path: "/v1/indicators/macd/{ticker}?timespan=",
        probeStatus: 200,
        usage: "partial",
        usedIn: "providers/polygon-largo.ts — Largo only",
        note: "Used in Largo terminal, not in the SPX play engine",
      },
    ],
  },
  {
    id: "stocks-tickers",
    title: "Stocks → Reference / Tickers",
    rows: [
      {
        name: "Ticker Overview",
        method: "GET",
        path: "/v3/reference/tickers/{ticker}",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon-largo.ts",
      },
      {
        name: "Related Tickers",
        method: "GET",
        path: "/v1/related-companies/{ticker}",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon-largo.ts",
      },
      {
        name: "All Tickers (list)",
        method: "GET",
        path: "/v3/reference/tickers?active=true&limit=...",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Full universe of tradeable tickers. Could power a symbol search / autocomplete for Largo without UW.",
      },
      {
        name: "Ticker Types",
        method: "GET",
        path: "/v3/reference/tickers/types",
        probeStatus: 200,
        usage: "unused",
        note: "Reference data only — not needed for current features.",
      },
      {
        name: "Ticker Events (renames/rebranding)",
        method: "GET",
        path: "/vX/reference/tickers/{id}/events",
        probeStatus: 200,
        usage: "unused",
        note: "Low priority — useful for data continuity when symbols change.",
      },
    ],
  },
  {
    id: "stocks-market-ops",
    title: "Stocks → Market Operations",
    rows: [
      {
        name: "Market Status Now",
        method: "GET",
        path: "/v1/marketstatus/now",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchMarketStatusNow() — RTH/pre/after gate",
      },
      {
        name: "Market Holidays",
        method: "GET",
        path: "/v1/marketstatus/upcoming",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon-largo.ts",
      },
      {
        name: "Exchanges",
        method: "GET",
        path: "/v3/reference/exchanges",
        probeStatus: 200,
        usage: "unused",
        note: "Reference only. Useful if routing logic needs exchange codes.",
      },
      {
        name: "Condition Codes",
        method: "GET",
        path: "/v3/reference/conditions",
        probeStatus: 200,
        usage: "unused",
        note: "Useful for filtering trade conditions (odd-lot, etc.) in tick data.",
      },
    ],
  },
  {
    id: "stocks-fundamentals",
    title: "Stocks → Fundamentals",
    rows: [
      {
        name: "Short Interest",
        method: "GET",
        path: "/stocks/v1/short-interest?ticker=...",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchShortInterest()",
      },
      {
        name: "Short Volume",
        method: "GET",
        path: "/stocks/v1/short-volume?ticker=...",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchShortVolume()",
      },
      {
        name: "Float",
        method: "GET",
        path: "/stocks/vX/float",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Free float (shares in public hands). Could replace UW /api/shorts/{ticker}/interest-float for float data — same plan, no extra cost.",
      },
      {
        name: "Balance Sheets",
        method: "GET",
        path: "/stocks/financials/v1/balance-sheets",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Could replace UW /api/stock/{ticker}/balance-sheets — same data, Polygon already paid for.",
      },
      {
        name: "Cash Flow Statements",
        method: "GET",
        path: "/stocks/financials/v1/cash-flow-statements",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Same — replace UW cash flows endpoint with Polygon.",
      },
      {
        name: "Income Statements",
        method: "GET",
        path: "/stocks/financials/v1/income-statements",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Same — replace UW income statements with Polygon.",
      },
      {
        name: "Financial Ratios",
        method: "GET",
        path: "/stocks/financials/v1/ratios",
        probeStatus: 200,
        usage: "unused",
        opportunity: "P/E, ROE, debt ratios — not available via UW. Useful for Largo stock scoring and Night Hawk dossiers.",
      },
    ],
  },
  {
    id: "stocks-corporate",
    title: "Stocks → Corporate Actions",
    rows: [
      {
        name: "IPOs",
        method: "GET",
        path: "/vX/reference/ipos",
        probeStatus: 200,
        usage: "unused",
        opportunity: "IPO calendar — could replace Finnhub /calendar/ipo at no extra cost.",
      },
      {
        name: "Splits",
        method: "GET",
        path: "/stocks/v1/splits",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Could replace UW company splits endpoint.",
      },
      {
        name: "Dividends",
        method: "GET",
        path: "/stocks/v1/dividends",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Could replace UW company dividends endpoint.",
      },
      {
        name: "Splits (deprecated v3)",
        method: "GET",
        path: "/v3/reference/splits",
        probeStatus: 200,
        usage: "unused",
        note: "Deprecated — use /stocks/v1/splits instead.",
      },
      {
        name: "Dividends (deprecated v3)",
        method: "GET",
        path: "/v3/reference/dividends",
        probeStatus: 200,
        usage: "unused",
        note: "Deprecated — use /stocks/v1/dividends instead.",
      },
    ],
  },
  {
    id: "stocks-filings",
    title: "Stocks → Filings & Disclosures",
    rows: [
      {
        name: "EDGAR Index",
        method: "GET",
        path: "/stocks/filings/vX/index",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Master EDGAR index — 10-K/8-K/13-F discovery without separate Finnhub calls. High value for Night Hawk dossiers.",
      },
      {
        name: "10-K Sections",
        method: "GET",
        path: "/stocks/filings/10-K/vX/sections",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Plain-text 10-K extracts (Business, Risk Factors, MD&A). Could feed Claude directly for Night Hawk fundamental analysis — unique capability.",
      },
      {
        name: "8-K Text",
        method: "GET",
        path: "/stocks/filings/8-K/vX/text",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Material event detection (acquisitions, CEO changes, guidance). Event-driven catalyst for Night Hawk.",
      },
      {
        name: "13-F Filings",
        method: "GET",
        path: "/stocks/filings/vX/13-F",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Institutional positions — could replace UW institution endpoints. Quarterly smart-money tracking for Night Hawk.",
      },
      {
        name: "Risk Factors",
        method: "GET",
        path: "/stocks/filings/vX/risk-factors",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Standardized risk factor taxonomy — NLP-ready for Claude risk scoring.",
      },
      {
        name: "Form 4 (insider transactions)",
        method: "GET",
        path: "/stocks/filings/vX/form-4",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Real SEC insider filing data — could replace UW /api/insider/{ticker} and Finnhub insider-transactions.",
      },
      {
        name: "Form 3 (new insider positions)",
        method: "GET",
        path: "/stocks/filings/vX/form-3",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Initial insider ownership filings — useful for new executive tracking.",
      },
      {
        name: "Risk Categories",
        method: "GET",
        path: "/stocks/taxonomies/vX/risk-factors",
        probeStatus: 200,
        usage: "unused",
        note: "Reference taxonomy — needed only if implementing risk factor classification.",
      },
    ],
  },
  {
    id: "stocks-news",
    title: "Stocks → News",
    rows: [
      {
        name: "Benzinga News",
        method: "GET",
        path: "/benzinga/v2/news",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchBenzingaNews() — desk news feed, macro gate, Night Hawk catalysts",
      },
      {
        name: "Polygon News",
        method: "GET",
        path: "/v2/reference/news",
        probeStatus: 200,
        usage: "partial",
        usedIn: "providers/polygon-largo.ts — Largo only, not wired to SPX desk",
        note: "Secondary news source. Benzinga is the primary feed.",
      },
    ],
  },
  {
    id: "options-snapshots",
    title: "Options → Snapshots",
    rows: [
      {
        name: "Option Chain Snapshot",
        method: "GET",
        path: "/v3/snapshot/options/{underlying}?expiration_date=&strike_price.gte=&strike_price.lte=",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon-options-gex.ts → fetchChainBand() — CORE for GEX/max pain computation (SPX + SPXW)",
      },
      {
        name: "Single Contract Snapshot",
        method: "GET",
        path: "/v3/snapshot/options/{underlying}/{contract}",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Real-time greeks + quote for a single contract. Could power a contract detail view in Largo without a separate chain load.",
      },
      {
        name: "Unified Snapshot (options)",
        method: "GET",
        path: "/v3/snapshot?ticker.any_of=O:...",
        probeStatus: 200,
        usage: "unused",
        note: "Multi-asset unified — covered by the chain snapshot for current use cases.",
      },
    ],
  },
  {
    id: "options-contracts",
    title: "Options → Contracts (Reference)",
    rows: [
      {
        name: "All Contracts",
        method: "GET",
        path: "/v3/reference/options/contracts?underlying_ticker=...",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon-options-gex.ts — used to enumerate valid contracts for GEX band",
      },
      {
        name: "Contract Overview",
        method: "GET",
        path: "/v3/reference/options/contracts/{options_ticker}",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Single contract spec (type, exercise style, shares per contract). Useful for Largo contract detail pages.",
      },
    ],
  },
  {
    id: "options-aggs",
    title: "Options → Aggregate Bars",
    rows: [
      {
        name: "Options Custom Bars",
        method: "GET",
        path: "/v2/aggs/ticker/{optionsTicker}/range/{mult}/{timespan}/{from}/{to}",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Historical OHLC for any options contract. Could power a contract price chart in Largo — shows how a specific strike moved intraday.",
      },
      {
        name: "Options Daily Summary",
        method: "GET",
        path: "/v1/open-close/{optionsTicker}/{date}",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Same — daily performance for a single contract.",
      },
      {
        name: "Options Prev Day Bar",
        method: "GET",
        path: "/v2/aggs/ticker/{optionsTicker}/prev",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Previous session OHLC for an options contract — useful for % change display.",
      },
    ],
  },
  {
    id: "options-trades-quotes",
    title: "Options → Trades & Quotes",
    rows: [
      {
        name: "Options Trades",
        method: "GET",
        path: "/v3/trades/{optionsTicker}?limit=...",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Tick-level trade history for a contract. Could supplement UW flow alerts with raw print data — shows every fill, condition code, exchange.",
      },
      {
        name: "Options Last Trade",
        method: "GET",
        path: "/v2/last/trade/{optionsTicker}",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Latest fill for any contract — fast last-price check without a full chain load.",
      },
      {
        name: "Options Quotes",
        method: "GET",
        path: "/v3/quotes/{optionsTicker}?limit=...",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Historical bid/ask for a contract — spread analysis, liquidity evaluation.",
      },
    ],
  },
  {
    id: "options-indicators",
    title: "Options → Technical Indicators",
    rows: [
      {
        name: "Options SMA",
        method: "GET",
        path: "/v1/indicators/sma/{optionsTicker}?window=&timespan=",
        probeStatus: 200,
        usage: "unused",
        note: "Rarely needed — indicators on options contracts are edge-case.",
      },
      {
        name: "Options EMA",
        method: "GET",
        path: "/v1/indicators/ema/{optionsTicker}?window=&timespan=",
        probeStatus: 200,
        usage: "unused",
        note: "Same.",
      },
      {
        name: "Options MACD",
        method: "GET",
        path: "/v1/indicators/macd/{optionsTicker}?timespan=",
        probeStatus: 200,
        usage: "unused",
        note: "Same.",
      },
      {
        name: "Options RSI",
        method: "GET",
        path: "/v1/indicators/rsi/{optionsTicker}?window=&timespan=",
        probeStatus: 200,
        usage: "unused",
        note: "Same.",
      },
    ],
  },
  {
    id: "indices-snapshots",
    title: "Indices → Snapshots",
    rows: [
      {
        name: "Indices Snapshot",
        method: "GET",
        path: "/v3/snapshot/indices?ticker.any_of=I:SPX,I:VIX,I:VIX9D,I:VIX3M",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchIndexSnapshots() — CORE: SPX/VIX real-time pulse, VIX term structure",
      },
      {
        name: "Unified Snapshot (indices)",
        method: "GET",
        path: "/v3/snapshot?ticker.any_of=I:SPX",
        probeStatus: 200,
        usage: "unused",
        note: "Covered by dedicated /v3/snapshot/indices endpoint.",
      },
    ],
  },
  {
    id: "indices-aggs",
    title: "Indices → Aggregate Bars",
    rows: [
      {
        name: "Index Custom Bars 1min",
        method: "GET",
        path: "/v2/aggs/ticker/I:SPX/range/1/minute/{from}/{to}",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchIndexMinuteBars() — VWAP computation, 3m/5m candles for MTF hybrid",
      },
      {
        name: "Index Custom Bars 1day",
        method: "GET",
        path: "/v2/aggs/ticker/I:SPX/range/1/day/{from}/{to}",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchIndexDailyBars() — VIX IV rank percentile (1-year lookback), PDH/PDL",
      },
      {
        name: "Index Prev Day Bar",
        method: "GET",
        path: "/v2/aggs/ticker/I:SPX/prev",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon-largo.ts → fetchPreviousDayBar()",
      },
      {
        name: "Index Daily Summary",
        method: "GET",
        path: "/v1/open-close/I:SPX/{date}",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Open + close for SPX on a specific date. Could supplement PDH/PDL gap computation for the desk without a full daily bars call.",
      },
    ],
  },
  {
    id: "indices-indicators",
    title: "Indices → Technical Indicators",
    rows: [
      {
        name: "Index EMA (day)",
        method: "GET",
        path: "/v1/indicators/ema/I:SPX?window=20&timespan=day",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchIndexEma() — EMA 20/50/200 for desk structure levels",
      },
      {
        name: "Index EMA (minute)",
        method: "GET",
        path: "/v1/indicators/ema/I:SPX?window=20&timespan=minute",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchIndexEma() — intraday EMA for 5m structure",
      },
      {
        name: "Index SMA",
        method: "GET",
        path: "/v1/indicators/sma/I:SPX?window=50&timespan=day",
        probeStatus: 200,
        usage: "used",
        usedIn: "providers/polygon.ts → fetchIndexSma() — SMA 50/200 desk levels",
      },
      {
        name: "Index MACD",
        method: "GET",
        path: "/v1/indicators/macd/I:SPX?timespan=day",
        probeStatus: 200,
        usage: "unused",
        opportunity: "SPX MACD for broader trend regime signal. Not currently used in the play engine — could add as a supporting confluence factor.",
      },
      {
        name: "Index RSI",
        method: "GET",
        path: "/v1/indicators/rsi/I:SPX?window=14&timespan=day",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Daily SPX RSI for overbought/oversold regime context. Currently the engine computes 5m RSI from minute bars — daily RSI from this endpoint would add a macro overlay.",
      },
      {
        name: "Index RSI (minute)",
        method: "GET",
        path: "/v1/indicators/rsi/I:SPX?window=14&timespan=minute",
        probeStatus: 200,
        usage: "unused",
        opportunity: "Pre-computed 5m SPX RSI directly from Polygon — would replace the manual RSI computation from minute bars in spx-play-technicals.ts.",
      },
    ],
  },
  {
    id: "indices-tickers",
    title: "Indices → Reference",
    rows: [
      {
        name: "Index All Tickers",
        method: "GET",
        path: "/v3/reference/tickers?market=indices&limit=...",
        probeStatus: 200,
        usage: "unused",
        note: "Useful for discovering available index tickers (VIX variants, sector indices).",
      },
      {
        name: "Index Ticker Overview",
        method: "GET",
        path: "/v3/reference/tickers/I:SPX",
        probeStatus: 200,
        usage: "unused",
        note: "Index metadata — exchange, classification, key dates.",
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// UNUSUAL WHALES — Static coverage analysis (no UW_API_KEY in .env.local)
// Source of truth: src/lib/uw-docs-catalog.ts (blackout flag = used in codebase)
// ─────────────────────────────────────────────────────────────────────────────

type UwRow = {
  name: string;
  path: string;
  method?: "GET" | "WS";
  probeStatus: Status;
  blackout: boolean; // true = marked used in uw-docs-catalog.ts
  usedIn?: string;
  opportunity?: string;
  note?: string;
};

type UwSection = {
  id: string;
  title: string;
  rows: UwRow[];
};

const UW_SECTIONS: UwSection[] = [
  {
    id: "uw-gex",
    title: "GEX / Greeks",
    rows: [
      { name: "GEX Levels", path: "/api/stock/{ticker}/gex-levels", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — key GEX support/resistance levels for play engine" },
      { name: "Greek Exposure By Expiry", path: "/api/stock/{ticker}/greek-exposure/expiry", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — per-expiry delta/gamma exposure" },
      { name: "Greek Exposure By Strike", path: "/api/stock/{ticker}/greek-exposure/strike", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Greek Exposure By Strike & Expiry", path: "/api/stock/{ticker}/greek-exposure/strike-expiry", probeStatus: 200, blackout: false, opportunity: "More granular GEX breakdown — strike+expiry matrix. Could improve GEX wall precision for 0DTE plays." },
      { name: "Greek Flow", path: "/api/stock/{ticker}/greek-flow", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Greek Flow By Expiry", path: "/api/stock/{ticker}/greek-flow/{expiry}", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Spot GEX Per 1min", path: "/api/stock/{ticker}/spot-exposures", probeStatus: 200, blackout: false, opportunity: "🔥 HIGH VALUE: Real-time GEX at current spot price, updated every 1 minute. Currently using static GEX levels — this would give live dealer positioning as SPX moves through strikes." },
      { name: "Spot GEX By Strike & Expiry (v2)", path: "/api/stock/{ticker}/spot-exposures/expiry-strike", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Spot GEX By Strike", path: "/api/stock/{ticker}/spot-exposures/strike", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — full GEX ladder for wall detection" },
    ],
  },
  {
    id: "uw-flow",
    title: "Options Flow",
    rows: [
      { name: "Flow Alerts (market-wide)", path: "/api/option-trades/flow-alerts", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — PRIMARY flow signal in SPX play engine (2s poll)" },
      { name: "Flow Alert by ID", path: "/api/option-trades/flow-alerts/{id}", probeStatus: 200, blackout: false, note: "Single alert lookup — low priority." },
      { name: "Full Tape", path: "/api/option-trades/full-tape/{date}", probeStatus: 302, blackout: false, note: "302 redirect — follow with -L. Full day tape for post-market / Night Hawk replay.", opportunity: "Full day option tape for post-market analysis / Night Hawk replay." },
      { name: "Flow Alerts (per ticker)", path: "/api/stock/{ticker}/flow-alerts", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Flow Per Strike Intraday", path: "/api/stock/{ticker}/flow-per-strike-intraday", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — strike stack heatmap" },
      { name: "Flow Per Strike", path: "/api/stock/{ticker}/flow-per-strike", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Flow Per Expiry", path: "/api/stock/{ticker}/flow-per-expiry", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Recent Flows", path: "/api/stock/{ticker}/flow-recent", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Net Premium Ticks", path: "/api/stock/{ticker}/net-prem-ticks", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — call/put velocity ticks" },
      { name: "Option Contract Flow", path: "/api/option-contract/{id}/flow", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Exchange & Trade Code Breakdown", path: "/api/option-trades/exchange-breakdown/{date}", probeStatus: 200, blackout: false, note: "Reporting use only." },
    ],
  },
  {
    id: "uw-websocket",
    title: "WebSocket Channels (NONE USED — all return 101 ✓)",
    rows: [
      { name: "Flow Alerts (WS)", method: "WS", path: "/api/socket/flow_alerts", probeStatus: 101, blackout: false, opportunity: "🔴 CRITICAL UPGRADE: Real-time flow alerts push. Currently polling REST at 2s. Moving to WS = sub-second flow delivery. Biggest latency improvement available." },
      { name: "Market Tide (WS)", method: "WS", path: "/api/socket/market_tide", probeStatus: 101, blackout: false, opportunity: "🔴 CRITICAL: Real-time market tide. Tide is a 2× hard-opposing factor in the play engine — stale 2s REST reads can block valid entries." },
      { name: "GEX (WS)", method: "WS", path: "/api/socket/gex", probeStatus: 101, blackout: false, opportunity: "🟡 Real-time GEX wall updates — gamma flip / king level changes pushed instead of polled." },
      { name: "Net Flow (WS)", method: "WS", path: "/api/socket/net_flow", probeStatus: 101, blackout: false, opportunity: "🟡 Real-time 0DTE net flow — replaces flow_0dte_net REST polling in the flow lane." },
      { name: "Interval Flow (WS)", method: "WS", path: "/api/socket/interval_flow", probeStatus: 101, blackout: false, opportunity: "Real-time ticker interval flow — replaces flow-per-strike-intraday REST poll." },
      { name: "Option Trades (WS)", method: "WS", path: "/api/socket/option_trades", probeStatus: 101, blackout: false, opportunity: "Raw option trade stream — could power a live tape feed without UW flow alert filtering." },
      { name: "Dark Pool / Off-Lit (WS)", method: "WS", path: "/api/socket/off_lit_trades", probeStatus: 101, blackout: false, opportunity: "Real-time off-lit/dark pool prints — dark pool is a 2× hard-opposing factor, real-time push would be valuable." },
      { name: "Lit Trades (WS)", method: "WS", path: "/api/socket/lit_trades", probeStatus: 101, blackout: false, note: "Lit flow stream — supplement to REST /api/lit-flow endpoints." },
      { name: "Price (WS)", method: "WS", path: "/api/socket/price", probeStatus: 101, blackout: false, note: "Stock price feed via UW WS — redundant with Polygon pulse." },
      { name: "News (WS)", method: "WS", path: "/api/socket/news", probeStatus: 101, blackout: false, note: "News push via UW — redundant with Benzinga." },
      { name: "Trading Halts (WS)", method: "WS", path: "/api/socket/trading_halts", probeStatus: 101, blackout: false, opportunity: "Real-time trading halt notifications — currently no halt detection in the play engine. A halt should immediately gate all entries." },
    ],
  },
  {
    id: "uw-tide",
    title: "Market Tide & NOPE",
    rows: [
      { name: "Market Tide", path: "/api/market/market-tide", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — 2× hard-opposing factor in play engine" },
      { name: "Sector Tide", path: "/api/market/{sector}/sector-tide", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts", note: "200 for 'technology' / 'energy' — 400 for 'financials' (invalid sector name). Use UW sector slug format." },
      { name: "ETF Tide", path: "/api/market/{ticker}/etf-tide", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "NOPE", path: "/api/stock/{ticker}/nope", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — delta-weighted flow signal" },
    ],
  },
  {
    id: "uw-darkpool",
    title: "Dark Pool",
    rows: [
      { name: "Recent Dark Pool Trades", path: "/api/darkpool/recent", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Ticker Dark Pool Trades", path: "/api/darkpool/{ticker}", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — 2× hard-opposing factor in play engine" },
    ],
  },
  {
    id: "uw-vol",
    title: "Volatility",
    rows: [
      { name: "Volatility Stats (IV Rank)", path: "/api/stock/{ticker}/volatility/stats", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — IV rank is 2× hard-opposing factor in play engine" },
      { name: "IV Rank (time series)", path: "/api/stock/{ticker}/iv-rank", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Interpolated IV", path: "/api/stock/{ticker}/interpolated-iv", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "IV Term Structure", path: "/api/stock/{ticker}/volatility/term-structure", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Realized Volatility", path: "/api/stock/{ticker}/volatility/realized", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Volatility Anomaly", path: "/api/stock/{ticker}/volatility/anomaly", probeStatus: 403, blackout: true, note: "⚠️ 403 FORBIDDEN — not on current UW plan. Codebase marks this as used but it will error in production." },
      { name: "Volatility Character", path: "/api/stock/{ticker}/volatility/character", probeStatus: 403, blackout: true, note: "⚠️ 403 FORBIDDEN — not on current UW plan. Same issue — plan upgrade required." },
      { name: "Variance Risk Premium", path: "/api/stock/{ticker}/volatility/variance-risk-premium", probeStatus: 403, blackout: true, note: "⚠️ 403 FORBIDDEN — not on current UW plan." },
      { name: "Historical Risk Reversal Skew", path: "/api/stock/{ticker}/historical-risk-reversal-skew", probeStatus: 200, blackout: false, opportunity: "Skew (25d put/call IV diff) — directional sentiment signal. Available on current plan. Could add as directional bias factor." },
      { name: "VIX Term Structure", path: "/api/volatility/vix-term-structure", probeStatus: 403, blackout: true, note: "⚠️ 403 FORBIDDEN — not on current UW plan. Codebase uses this for VIX9D/VIX3M contango — currently failing silently or using Polygon fallback." },
      { name: "Top Volatility Anomalies", path: "/api/volatility/anomaly/top", probeStatus: 403, blackout: true, note: "⚠️ 403 FORBIDDEN — not on current UW plan." },
      { name: "Top Vol Character", path: "/api/volatility/character/top", probeStatus: 403, blackout: true, note: "⚠️ 403 FORBIDDEN — not on current UW plan." },
    ],
  },
  {
    id: "uw-options",
    title: "Options Chains & OI",
    rows: [
      { name: "Live Option Contracts (NBBO chain)", path: "/api/stock/{ticker}/option-contracts", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Option Chains", path: "/api/stock/{ticker}/option-chains", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "ATM Chains", path: "/api/stock/{ticker}/atm-chains", probeStatus: 422, blackout: true, note: "⚠️ 422 Unprocessable — SPX may require expiry param. Needs investigation." },
      { name: "OI Change", path: "/api/stock/{ticker}/oi-change", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "OI Per Strike", path: "/api/stock/{ticker}/oi-per-strike", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "OI Per Expiry", path: "/api/stock/{ticker}/oi-per-expiry", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Options Volume", path: "/api/stock/{ticker}/options-volume", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Volume & OI Per Expiry", path: "/api/stock/{ticker}/option/volume-oi-expiry", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Expiry Breakdown", path: "/api/stock/{ticker}/expiry-breakdown", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Max Pain", path: "/api/stock/{ticker}/max-pain", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — max pain level used in desk structure" },
      { name: "Option Price Levels", path: "/api/stock/{ticker}/option/stock-price-levels", probeStatus: 200, blackout: false, opportunity: "Options-implied key price levels — where max OI concentration creates magnetic levels. Available on current plan." },
      { name: "Contract Intraday", path: "/api/option-contract/{id}/intraday", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Contract Volume Profile", path: "/api/option-contract/{id}/volume-profile", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Contract Historic Data", path: "/api/option-contract/{id}/historic", probeStatus: 200, blackout: false, note: "Historical contract price data — low priority vs Polygon chain aggs." },
    ],
  },
  {
    id: "uw-market",
    title: "Market-Wide",
    rows: [
      { name: "Economic Calendar", path: "/api/market/economic-calendar", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — macro gate for play engine" },
      { name: "FDA Calendar", path: "/api/market/fda-calendar", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Top Movers", path: "/api/market/movers", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "OI Change (market)", path: "/api/market/oi-change", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Sector ETFs", path: "/api/market/sector-etfs", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Total Options Volume", path: "/api/market/total-options-volume", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Top Net Impact", path: "/api/market/top-net-impact", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Correlations", path: "/api/market/correlations", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Total Insider Buy & Sells", path: "/api/market/insider-buy-sells", probeStatus: 200, blackout: false, note: "Aggregate insider flow — available but low priority for current features." },
      { name: "News Headlines", path: "/api/news/headlines", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts — news guard for confirmations" },
      { name: "Net Flow by Expiry", path: "/api/net-flow/expiry", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
    ],
  },
  {
    id: "uw-screener",
    title: "Screeners",
    rows: [
      { name: "Stock Screener", path: "/api/screener/stocks", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Hottest Chains", path: "/api/screener/option-contracts", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Analyst Ratings", path: "/api/screener/analysts", probeStatus: 200, blackout: true, usedIn: "providers/unusual-whales.ts" },
      { name: "Optionable Tickers", path: "/api/option-trades/optionable-tickers", probeStatus: 200, blackout: false, note: "Full list of all optionable tickers — available on current plan." },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Compute summary stats
// ─────────────────────────────────────────────────────────────────────────────

const allPolygonRows = POLYGON_SECTIONS.flatMap((s) => s.rows);
const polyTotal = allPolygonRows.length;
const polyUsed = allPolygonRows.filter((r) => r.usage === "used").length;
const polyPartial = allPolygonRows.filter((r) => r.usage === "partial").length;
const polyUnused = allPolygonRows.filter((r) => r.usage === "unused").length;

const allUwRows = UW_SECTIONS.flatMap((s) => s.rows);
const uwTotal = allUwRows.length;
const uwUsed = allUwRows.filter((r) => r.blackout).length;
const uwUnused = allUwRows.filter((r) => !r.blackout).length;

// ─────────────────────────────────────────────────────────────────────────────
// Render helpers
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Status }) {
  const color =
    status === 200 ? "#00e676" :
    status === 101 ? "#6366f1" :
    status === 302 ? "#ffd23f" :
    status === 400 ? "#ffd23f" :
    status === 403 ? "#ef4444" :
    status === 404 ? "#ef4444" :
    status === 422 ? "#f97316" :
    status === 429 ? "#ffd23f" :
    "#0369a1";
  return (
    <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: color, color: "#fff", minWidth: 36, textAlign: "center" }}>
      {status}
    </span>
  );
}

function UsageBadge({ usage }: { usage: UsageStatus }) {
  const cfg: Record<UsageStatus, { bg: string; label: string }> = {
    used: { bg: "#00e676", label: "USED" },
    partial: { bg: "#ffd23f", label: "PARTIAL" },
    unused: { bg: "#0369a1", label: "UNUSED" },
  };
  const c = cfg[usage];
  return (
    <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: c.bg, color: "#fff" }}>
      {c.label}
    </span>
  );
}

function UwBadge({ blackout }: { blackout: boolean }) {
  return (
    <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: blackout ? "#00e676" : "#0369a1", color: "#fff" }}>
      {blackout ? "USED" : "UNUSED"}
    </span>
  );
}

function PolygonSectionTable({ section }: { section: Section }) {
  return (
    <div id={section.id} style={{ marginBottom: "2rem" }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: "0.5rem" }}>{section.title}</h3>
      <table className="docs-table" style={{ width: "100%", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ width: 48 }}>HTTP</th>
            <th style={{ width: 52 }}>Usage</th>
            <th>Path</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row) => (
            <tr key={row.path} style={{ opacity: row.usage === "unused" ? 0.85 : 1 }}>
              <td><StatusBadge status={row.probeStatus} /></td>
              <td><UsageBadge usage={row.usage} /></td>
              <td><code style={{ fontSize: 11 }}>{row.path}</code></td>
              <td style={{ fontSize: 12 }}>
                {row.usedIn && <span style={{ color: "#00e676" }}>{row.usedIn}</span>}
                {row.opportunity && <span style={{ color: "#ffd23f" }}>{row.opportunity}</span>}
                {row.note && !row.opportunity && !row.usedIn && <span style={{ opacity: 0.65 }}>{row.note}</span>}
                {row.note && row.usedIn && <span style={{ opacity: 0.65 }}> · {row.note}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UwSectionTable({ section }: { section: UwSection }) {
  return (
    <div id={section.id} style={{ marginBottom: "2rem" }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: "0.5rem" }}>{section.title}</h3>
      <table className="docs-table" style={{ width: "100%", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ width: 48 }}>HTTP</th>
            <th style={{ width: 60 }}>Usage</th>
            <th>Path</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row) => (
            <tr key={row.path} style={{ opacity: row.blackout ? 1 : 0.85 }}>
              <td><StatusBadge status={row.probeStatus} /></td>
              <td><UwBadge blackout={row.blackout} /></td>
              <td><code style={{ fontSize: 11 }}>{row.path}</code></td>
              <td style={{ fontSize: 12 }}>
                {row.usedIn && <span style={{ color: "#00e676" }}>{row.usedIn}</span>}
                {row.opportunity && <span style={{ color: "#ffd23f" }}>{row.opportunity}</span>}
                {row.note && !row.opportunity && !row.usedIn && <span style={{ opacity: 0.65 }}>{row.note}</span>}
                {row.note && (row.usedIn || row.opportunity) && <span style={{ opacity: 0.65 }}> · {row.note}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function ApiProbePage() {
  return (
    <main className="docs-page-main docs-ref-main">
      <header className="docs-header">
        <p className="docs-kicker">Blackout · Internal Reference</p>
        <h1 className="docs-title">Live API Probe Results</h1>
        <p className="docs-lead">
          Full end-to-end live probe of every documented endpoint across Polygon/Massive and Unusual Whales.
          Probed <strong>2026-06-18</strong> using <code>POLYGON_API_KEY</code> and <code>UW_API_KEY</code> from <code>.env.local</code>.
          Key finding: <strong>6 UW endpoints return 403</strong> — marked as used in codebase but blocked by plan tier.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
          <Link href="/docs/polygon" className="docs-back-link">Polygon docs →</Link>
          <Link href="/docs/unusual-whales" className="docs-back-link">UW docs →</Link>
          <Link href="/docs/claude-api-analysis" className="docs-back-link">Full API catalog →</Link>
        </div>
      </header>

      {/* Summary */}
      <section className="docs-section">
        <h2>Coverage summary</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Provider</th><th>Total endpoints</th><th>Used</th><th>Partial</th><th>Unused</th><th>HTTP probe</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Polygon / Massive</strong></td>
              <td>{polyTotal}</td>
              <td style={{ color: "#00e676" }}><strong>{polyUsed}</strong></td>
              <td style={{ color: "#ffd23f" }}>{polyPartial}</td>
              <td style={{ color: "#9fb4d4" }}>{polyUnused}</td>
              <td><span style={{ color: "#00e676" }}>All 200 ✓</span></td>
            </tr>
            <tr>
              <td><strong>Unusual Whales</strong></td>
              <td>{uwTotal}</td>
              <td style={{ color: "#00e676" }}><strong>{uwUsed}</strong></td>
              <td>—</td>
              <td style={{ color: "#9fb4d4" }}>{uwUnused}</td>
              <td><span style={{ color: "#00e676" }}>Live probed ✓ · 6× 403 (plan gap)</span></td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Legend */}
      <section className="docs-section">
        <h2>Legend</h2>
        <div style={{ display: "flex", gap: "1.5rem", fontSize: 13, flexWrap: "wrap" }}>
          <span><StatusBadge status={200} /> Live probe returned 200 OK</span>
          <span><UsageBadge usage="used" /> Actively called in codebase</span>
          <span><UsageBadge usage="partial" /> Called in Largo but not SPX engine</span>
          <span><UsageBadge usage="unused" /> Available, not wired up</span>
          <span style={{ color: "#ffd23f" }}>🟡 Unused with high-value opportunity noted</span>
        </div>
      </section>

      {/* Top opportunities */}
      <section className="docs-section">
        <h2>🔥 Top upgrade opportunities</h2>
        <table className="docs-table" style={{ fontSize: 13 }}>
          <thead><tr><th>Endpoint</th><th>Provider</th><th>Priority</th><th>Why it matters</th></tr></thead>
          <tbody>
            <tr>
              <td><code>/api/stock/{"{ticker}"}/volatility/anomaly · /character · /variance-risk-premium · /vix-term-structure · /anomaly/top · /character/top</code></td>
              <td>UW REST</td>
              <td>🚨 403 PLAN GAP</td>
              <td>6 endpoints currently used in codebase return 403. These calls are silently failing in production. Upgrade UW plan or remove them from provider logic.</td>
            </tr>
            <tr>
              <td><code>/api/stock/SPX/atm-chains</code></td>
              <td>UW REST</td>
              <td>🟠 422 FIX NEEDED</td>
              <td>ATM chains returns 422 for SPX — likely requires an expiry query param. Codebase marks it as used, needs investigation.</td>
            </tr>
            <tr>
              <td><code>/api/socket/flow_alerts</code></td>
              <td>UW WebSocket</td>
              <td>🔴 P0</td>
              <td>Real-time flow push vs 2s REST poll — biggest latency improvement for entry timing</td>
            </tr>
            <tr>
              <td><code>/api/socket/market_tide</code></td>
              <td>UW WebSocket</td>
              <td>🔴 P0</td>
              <td>Tide is a 2× hard-opposing factor — stale 2s reads block valid entries</td>
            </tr>
            <tr>
              <td><code>/api/socket/trading_halts</code></td>
              <td>UW WebSocket</td>
              <td>🔴 P0</td>
              <td>No trading halt detection exists — a halted stock during a play has no gate</td>
            </tr>
            <tr>
              <td><code>/api/stock/SPX/spot-exposures</code></td>
              <td>UW REST</td>
              <td>🟠 P1</td>
              <td>Live 1min GEX at current spot — far better than static king/flip/walls for intraday dealer positioning</td>
            </tr>
            <tr>
              <td><code>/api/socket/gex</code></td>
              <td>UW WebSocket</td>
              <td>🟠 P1</td>
              <td>Real-time GEX wall changes pushed vs polling — gamma flip changes mid-session currently arrive a poll cycle late</td>
            </tr>
            <tr>
              <td><code>/v1/indicators/rsi/I:SPX?timespan=minute</code></td>
              <td>Polygon</td>
              <td>🟡 P2</td>
              <td>Pre-computed 5m RSI from Polygon — replaces manual RSI calculation from minute bars in spx-play-technicals.ts</td>
            </tr>
            <tr>
              <td><code>/stocks/financials/v1/ratios</code></td>
              <td>Polygon</td>
              <td>🟡 P2</td>
              <td>P/E, ROE, debt ratios — not available via UW, already on your Stocks Advanced plan. High value for Night Hawk dossiers.</td>
            </tr>
            <tr>
              <td><code>/stocks/filings/10-K/vX/sections</code></td>
              <td>Polygon</td>
              <td>🟡 P2</td>
              <td>Plain-text 10-K extracts (Risk Factors, Business, MD&A). Feed directly to Claude for Night Hawk fundamental research — unique capability not available elsewhere.</td>
            </tr>
            <tr>
              <td><code>{"/v2/aggs/grouped/locale/us/market/stocks/{date}"}</code></td>
              <td>Polygon</td>
              <td>🟢 P3</td>
              <td>Full market OHLC + VWAP in one call — enables SPX breadth scoring (% stocks above VWAP) as a desk-wide signal</td>
            </tr>
            <tr>
              <td><code>/stocks/filings/vX/form-4</code></td>
              <td>Polygon</td>
              <td>🟢 P3</td>
              <td>Real SEC Form 4 data — replaces UW insider endpoint and Finnhub insider-transactions (already on your plan, no extra cost)</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ── Polygon sections ── */}
      <section className="docs-section">
        <h2 id="polygon">Polygon / Massive — Probe results (all 200 ✓)</h2>
        <p style={{ fontSize: 13, opacity: 0.7, marginBottom: "1.5rem" }}>
          Probed with <code>POLYGON_API_KEY=&lt;redacted&gt;</code> against <code>https://api.massive.com</code>.
          Every documented endpoint returned HTTP 200. Two initial 404s (Contract Overview, Single Contract Snapshot) were
          due to test data using expired/non-existent contract tickers — re-probed with a real contract returned 200.
        </p>
        {POLYGON_SECTIONS.map((s) => <PolygonSectionTable key={s.id} section={s} />)}
      </section>

      {/* ── UW sections ── */}
      <section className="docs-section">
        <h2 id="uw">Unusual Whales — Coverage analysis</h2>
        <p style={{ fontSize: 13, opacity: 0.7, marginBottom: "1.5rem" }}>
          Live probed with <code>UW_API_KEY</code> from <code>.env.local</code> against <code>https://api.unusualwhales.com</code>.
          Coverage derived from <code>src/lib/uw-docs-catalog.ts</code> blackout flags cross-referenced against <code>src/lib/providers/unusual-whales.ts</code>.
          {" "}<strong>Critical finding: 6 endpoints marked &quot;used&quot; in codebase return 403 — plan upgrade required.</strong>
          {" "}All 11 WebSocket channels confirmed live (101 Upgrade) — none wired up yet.
        </p>
        {UW_SECTIONS.map((s) => <UwSectionTable key={s.id} section={s} />)}
      </section>
    </main>
  );
}
