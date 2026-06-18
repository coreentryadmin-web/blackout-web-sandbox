/** Auto-generated from https://api.unusualwhales.com/docs — run: node scripts/generate-uw-docs-catalog.mjs */

export type UwEndpoint = {
  name: string;
  method: "GET";
  path: string;
  operationId: string;
  deprecated?: boolean;
  blackout?: boolean;
  docUrl: string;
};

export type UwEndpointSection = {
  id: string;
  title: string;
  categoryKey: string;
  endpoints: UwEndpoint[];
};

export const UW_DOCS_BASE = "https://api.unusualwhales.com";
export const UW_DOCS_URL = "https://api.unusualwhales.com/docs";
export const UW_OPENAPI_URL = "https://api.unusualwhales.com/api/openapi";

export const UW_REST_SECTIONS: UwEndpointSection[] = [
  {
    "id": "gex-greeks",
    "title": "GEX / Greeks",
    "categoryKey": "Gex/Greeks",
    "endpoints": [
      {
        "name": "GEX Levels",
        "method": "GET",
        "path": "/api/stock/{ticker}/gex-levels",
        "operationId": "PublicApi.TickerController.gex_levels",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.gex_levels"
      },
      {
        "name": "Greek Exposure",
        "method": "GET",
        "path": "/api/stock/{ticker}/greek-exposure",
        "operationId": "PublicApi.TickerController.greek_exposure",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.greek_exposure"
      },
      {
        "name": "Greek Exposure By Expiry",
        "method": "GET",
        "path": "/api/stock/{ticker}/greek-exposure/expiry",
        "operationId": "PublicApi.TickerController.greek_exposure_by_expiry",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.greek_exposure_by_expiry"
      },
      {
        "name": "Greek Exposure By Strike",
        "method": "GET",
        "path": "/api/stock/{ticker}/greek-exposure/strike",
        "operationId": "PublicApi.TickerController.greek_exposure_by_strike",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.greek_exposure_by_strike"
      },
      {
        "name": "Greek Exposure By Strike And Expiry",
        "method": "GET",
        "path": "/api/stock/{ticker}/greek-exposure/strike-expiry",
        "operationId": "PublicApi.TickerController.greek_exposure_by_strike_expiry",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.greek_exposure_by_strike_expiry"
      },
      {
        "name": "Greek flow",
        "method": "GET",
        "path": "/api/stock/{ticker}/greek-flow",
        "operationId": "PublicApi.TickerController.greek_flow",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.greek_flow"
      },
      {
        "name": "Greek flow by expiry",
        "method": "GET",
        "path": "/api/stock/{ticker}/greek-flow/{expiry}",
        "operationId": "PublicApi.TickerController.greek_flow_expiry",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.greek_flow_expiry"
      },
      {
        "name": "Spot GEX exposures per 1min",
        "method": "GET",
        "path": "/api/stock/{ticker}/spot-exposures",
        "operationId": "PublicApi.TickerController.spot_exposures_one_minute",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.spot_exposures_one_minute"
      },
      {
        "name": "Spot GEX exposures by strike & expiry",
        "method": "GET",
        "path": "/api/stock/{ticker}/spot-exposures/expiry-strike",
        "operationId": "PublicApi.TickerController.spot_exposures_by_strike_expiry_v2",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.spot_exposures_by_strike_expiry_v2"
      },
      {
        "name": "Spot GEX exposures by strike",
        "method": "GET",
        "path": "/api/stock/{ticker}/spot-exposures/strike",
        "operationId": "PublicApi.TickerController.spot_exposures_by_strike",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.spot_exposures_by_strike"
      },
      {
        "name": "Spot GEX exposures by strike & expiry (Deprecated)",
        "method": "GET",
        "path": "/api/stock/{ticker}/spot-exposures/{expiry}/strike",
        "operationId": "PublicApi.TickerController.spot_exposures_by_strike_expiry",
        "deprecated": true,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.spot_exposures_by_strike_expiry"
      }
    ]
  },
  {
    "id": "alerts",
    "title": "Alerts",
    "categoryKey": "alerts",
    "endpoints": [
      {
        "name": "Alerts",
        "method": "GET",
        "path": "/api/alerts",
        "operationId": "PublicApi.AlertsController.alerts",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.AlertsController.alerts"
      },
      {
        "name": "Alert configurations",
        "method": "GET",
        "path": "/api/alerts/configuration",
        "operationId": "PublicApi.AlertsController.configs",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.AlertsController.configs"
      }
    ]
  },
  {
    "id": "commodities",
    "title": "Commodities",
    "categoryKey": "commodities",
    "endpoints": [
      {
        "name": "Commodity Series",
        "method": "GET",
        "path": "/api/commodities/{name}",
        "operationId": "PublicApi.CommoditiesController.show",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CommoditiesController.show"
      }
    ]
  },
  {
    "id": "companies",
    "title": "Companies",
    "categoryKey": "companies",
    "endpoints": [
      {
        "name": "Company Dividends",
        "method": "GET",
        "path": "/api/companies/{ticker}/dividends",
        "operationId": "PublicApi.CompaniesController.dividends",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CompaniesController.dividends"
      },
      {
        "name": "Forward Earnings Estimates",
        "method": "GET",
        "path": "/api/companies/{ticker}/earnings-estimates",
        "operationId": "PublicApi.CompaniesController.earnings_estimates",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CompaniesController.earnings_estimates"
      },
      {
        "name": "Company Profile",
        "method": "GET",
        "path": "/api/companies/{ticker}/profile",
        "operationId": "PublicApi.CompaniesController.profile",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CompaniesController.profile"
      },
      {
        "name": "Company Stock Splits",
        "method": "GET",
        "path": "/api/companies/{ticker}/splits",
        "operationId": "PublicApi.CompaniesController.splits",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CompaniesController.splits"
      },
      {
        "name": "Earnings Call Transcript",
        "method": "GET",
        "path": "/api/companies/{ticker}/transcripts/{quarter}",
        "operationId": "PublicApi.CompaniesController.transcript",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CompaniesController.transcript"
      }
    ]
  },
  {
    "id": "congress",
    "title": "Congress",
    "categoryKey": "congress",
    "endpoints": [
      {
        "name": "Recent Reports By Trader",
        "method": "GET",
        "path": "/api/congress/congress-trader",
        "operationId": "PublicApi.CongressController.congress_trader",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CongressController.congress_trader"
      },
      {
        "name": "Recent Late Reports",
        "method": "GET",
        "path": "/api/congress/late-reports",
        "operationId": "PublicApi.CongressController.congress_late_reports",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CongressController.congress_late_reports"
      },
      {
        "name": "List of Politicians with Trade Data",
        "method": "GET",
        "path": "/api/congress/politicians",
        "operationId": "PublicApi.CongressController.congress_politicians",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CongressController.congress_politicians"
      },
      {
        "name": "Recent Congress Trades",
        "method": "GET",
        "path": "/api/congress/recent-trades",
        "operationId": "PublicApi.CongressController.congress_recent_trades",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CongressController.congress_recent_trades"
      }
    ]
  },
  {
    "id": "crypto",
    "title": "Crypto",
    "categoryKey": "crypto",
    "endpoints": [
      {
        "name": "Crypto Whale Transactions",
        "method": "GET",
        "path": "/api/crypto/whale-transactions",
        "operationId": "PublicApi.CryptoController.whale_transactions",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CryptoController.whale_transactions"
      },
      {
        "name": "Recent Crypto Whale Trades",
        "method": "GET",
        "path": "/api/crypto/whales/recent",
        "operationId": "PublicApi.CryptoController.whales_recent",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CryptoController.whales_recent"
      },
      {
        "name": "Crypto OHLC Candles",
        "method": "GET",
        "path": "/api/crypto/{pair}/ohlc/{candle_size}",
        "operationId": "PublicApi.CryptoController.ohlc",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CryptoController.ohlc"
      },
      {
        "name": "Crypto Pair State",
        "method": "GET",
        "path": "/api/crypto/{pair}/state",
        "operationId": "PublicApi.CryptoController.state",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.CryptoController.state"
      }
    ]
  },
  {
    "id": "darkpool",
    "title": "Darkpool",
    "categoryKey": "darkpool",
    "endpoints": [
      {
        "name": "Recent Darkpool Trades",
        "method": "GET",
        "path": "/api/darkpool/recent",
        "operationId": "PublicApi.DarkpoolController.darkpool_recent",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.DarkpoolController.darkpool_recent"
      },
      {
        "name": "Ticker Darkpool Trades",
        "method": "GET",
        "path": "/api/darkpool/{ticker}",
        "operationId": "PublicApi.DarkpoolController.darkpool_ticker",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.DarkpoolController.darkpool_ticker"
      }
    ]
  },
  {
    "id": "digital-currencies",
    "title": "Digital Currencies",
    "categoryKey": "digital_currencies",
    "endpoints": [
      {
        "name": "Digital Currency Historical Series",
        "method": "GET",
        "path": "/api/digital-currencies/history",
        "operationId": "PublicApi.DigitalCurrenciesController.history",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.DigitalCurrenciesController.history"
      },
      {
        "name": "Digital Currency Intraday Series",
        "method": "GET",
        "path": "/api/digital-currencies/intraday",
        "operationId": "PublicApi.DigitalCurrenciesController.intraday",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.DigitalCurrenciesController.intraday"
      }
    ]
  },
  {
    "id": "earnings",
    "title": "Earnings",
    "categoryKey": "earnings",
    "endpoints": [
      {
        "name": "Afterhours",
        "method": "GET",
        "path": "/api/earnings/afterhours",
        "operationId": "PublicApi.EarningsController.afterhours",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.EarningsController.afterhours"
      },
      {
        "name": "Premarket",
        "method": "GET",
        "path": "/api/earnings/premarket",
        "operationId": "PublicApi.EarningsController.premarket",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.EarningsController.premarket"
      },
      {
        "name": "Historical Ticker Earnings",
        "method": "GET",
        "path": "/api/earnings/{ticker}",
        "operationId": "PublicApi.EarningsController.ticker",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.EarningsController.ticker"
      }
    ]
  },
  {
    "id": "economy",
    "title": "Economy",
    "categoryKey": "economy",
    "endpoints": [
      {
        "name": "Economic Indicator",
        "method": "GET",
        "path": "/api/economy/{indicator}",
        "operationId": "PublicApi.EconomyController.show",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.EconomyController.show"
      }
    ]
  },
  {
    "id": "etfs",
    "title": "Etfs",
    "categoryKey": "etfs",
    "endpoints": [
      {
        "name": "Exposure",
        "method": "GET",
        "path": "/api/etfs/{ticker}/exposure",
        "operationId": "PublicApi.EtfController.exposure",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.EtfController.exposure"
      },
      {
        "name": "Holdings",
        "method": "GET",
        "path": "/api/etfs/{ticker}/holdings",
        "operationId": "PublicApi.EtfController.holdings",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.EtfController.holdings"
      },
      {
        "name": "Inflow & Outflow",
        "method": "GET",
        "path": "/api/etfs/{ticker}/in-outflow",
        "operationId": "PublicApi.EtfController.in_outflow",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.EtfController.in_outflow"
      },
      {
        "name": "Information",
        "method": "GET",
        "path": "/api/etfs/{ticker}/info",
        "operationId": "PublicApi.EtfController.info",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.EtfController.info"
      },
      {
        "name": "Sector & Country weights",
        "method": "GET",
        "path": "/api/etfs/{ticker}/weights",
        "operationId": "PublicApi.EtfController.weights",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.EtfController.weights"
      }
    ]
  },
  {
    "id": "forex",
    "title": "Forex",
    "categoryKey": "forex",
    "endpoints": [
      {
        "name": "FX Historical Series",
        "method": "GET",
        "path": "/api/forex/history",
        "operationId": "PublicApi.ForexController.history",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ForexController.history"
      },
      {
        "name": "FX Intraday Series",
        "method": "GET",
        "path": "/api/forex/intraday",
        "operationId": "PublicApi.ForexController.intraday",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ForexController.intraday"
      },
      {
        "name": "FX Spot Rate",
        "method": "GET",
        "path": "/api/forex/rate",
        "operationId": "PublicApi.ForexController.rate",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ForexController.rate"
      }
    ]
  },
  {
    "id": "group-flow",
    "title": "Group Flow",
    "categoryKey": "group_flow",
    "endpoints": [
      {
        "name": "Greek flow",
        "method": "GET",
        "path": "/api/group-flow/{flow_group}/greek-flow",
        "operationId": "PublicApi.GroupFlowController.greek_flow",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.GroupFlowController.greek_flow"
      },
      {
        "name": "Greek flow by expiry",
        "method": "GET",
        "path": "/api/group-flow/{flow_group}/greek-flow/{expiry}",
        "operationId": "PublicApi.GroupFlowController.greek_flow_expiry",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.GroupFlowController.greek_flow_expiry"
      }
    ]
  },
  {
    "id": "insiders",
    "title": "Insiders",
    "categoryKey": "insiders",
    "endpoints": [
      {
        "name": "Transactions",
        "method": "GET",
        "path": "/api/insider/transactions",
        "operationId": "PublicApi.InsiderController.transactions",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.InsiderController.transactions"
      },
      {
        "name": "Sector Flow",
        "method": "GET",
        "path": "/api/insider/{sector}/sector-flow",
        "operationId": "PublicApi.InsiderController.sector_flow",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.InsiderController.sector_flow"
      },
      {
        "name": "Insiders",
        "method": "GET",
        "path": "/api/insider/{ticker}",
        "operationId": "PublicApi.InsiderController.insiders",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.InsiderController.insiders"
      },
      {
        "name": "Ticker Flow",
        "method": "GET",
        "path": "/api/insider/{ticker}/ticker-flow",
        "operationId": "PublicApi.InsiderController.ticker_flow",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.InsiderController.ticker_flow"
      }
    ]
  },
  {
    "id": "institution",
    "title": "Institution",
    "categoryKey": "institution",
    "endpoints": [
      {
        "name": "Institutional Activity (Deprecated)",
        "method": "GET",
        "path": "/api/institution/{name}/activity",
        "operationId": "PublicApi.InstitutionController.activity",
        "deprecated": true,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.InstitutionController.activity"
      },
      {
        "name": "Institutional Activity",
        "method": "GET",
        "path": "/api/institution/{name}/activity/v2",
        "operationId": "PublicApi.InstitutionController.activity_v2",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.InstitutionController.activity_v2"
      },
      {
        "name": "Institutional Holdings",
        "method": "GET",
        "path": "/api/institution/{name}/holdings",
        "operationId": "PublicApi.InstitutionController.holdings",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.InstitutionController.holdings"
      },
      {
        "name": "Sector Exposure",
        "method": "GET",
        "path": "/api/institution/{name}/sectors",
        "operationId": "PublicApi.InstitutionController.sectors",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.InstitutionController.sectors"
      },
      {
        "name": "Institutional Ownership",
        "method": "GET",
        "path": "/api/institution/{ticker}/ownership",
        "operationId": "PublicApi.InstitutionController.ownership",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.InstitutionController.ownership"
      },
      {
        "name": "List of Institutions",
        "method": "GET",
        "path": "/api/institutions",
        "operationId": "PublicApi.InstitutionController.list",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.InstitutionController.list"
      },
      {
        "name": "Latest Filings",
        "method": "GET",
        "path": "/api/institutions/latest_filings",
        "operationId": "PublicApi.InstitutionController.latest_filings",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.InstitutionController.latest_filings"
      }
    ]
  },
  {
    "id": "intel",
    "title": "Intel",
    "categoryKey": "intel",
    "endpoints": [
      {
        "name": "Sliding-Window Analytics",
        "method": "GET",
        "path": "/api/analytics/sliding",
        "operationId": "PublicApi.IntelController.analytics_sliding",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.IntelController.analytics_sliding"
      },
      {
        "name": "Fixed-Window Analytics",
        "method": "GET",
        "path": "/api/analytics/window",
        "operationId": "PublicApi.IntelController.analytics_window",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.IntelController.analytics_window"
      },
      {
        "name": "IPO Calendar",
        "method": "GET",
        "path": "/api/calendar/ipo",
        "operationId": "PublicApi.IntelController.ipo_calendar",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.IntelController.ipo_calendar"
      },
      {
        "name": "Active or Delisted Securities",
        "method": "GET",
        "path": "/api/companies/listings",
        "operationId": "PublicApi.IntelController.listings",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.IntelController.listings"
      },
      {
        "name": "Top Movers",
        "method": "GET",
        "path": "/api/market/movers",
        "operationId": "PublicApi.IntelController.movers",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.IntelController.movers"
      }
    ]
  },
  {
    "id": "lit-flow",
    "title": "Lit-flow",
    "categoryKey": "lit-flow",
    "endpoints": [
      {
        "name": "Recent Lit Flow Trades",
        "method": "GET",
        "path": "/api/lit-flow/recent",
        "operationId": "PublicApi.LitFlowController.lit_flow_recent",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.LitFlowController.lit_flow_recent"
      },
      {
        "name": "Ticker Lit Flow Trades",
        "method": "GET",
        "path": "/api/lit-flow/{ticker}",
        "operationId": "PublicApi.LitFlowController.lit_flow_ticker",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.LitFlowController.lit_flow_ticker"
      }
    ]
  },
  {
    "id": "market",
    "title": "Market",
    "categoryKey": "market",
    "endpoints": [
      {
        "name": "Correlations",
        "method": "GET",
        "path": "/api/market/correlations",
        "operationId": "PublicApi.MarketController.correlations",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.MarketController.correlations"
      },
      {
        "name": "Economic calendar",
        "method": "GET",
        "path": "/api/market/economic-calendar",
        "operationId": "PublicApi.MarketController.events",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.MarketController.events"
      },
      {
        "name": "FDA Calendar",
        "method": "GET",
        "path": "/api/market/fda-calendar",
        "operationId": "PublicApi.MarketController.fda_calendar",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.MarketController.fda_calendar"
      },
      {
        "name": "Total Insider Buy & Sells",
        "method": "GET",
        "path": "/api/market/insider-buy-sells",
        "operationId": "PublicApi.MarketController.insider_buy_sells",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.MarketController.insider_buy_sells"
      },
      {
        "name": "Market Tide",
        "method": "GET",
        "path": "/api/market/market-tide",
        "operationId": "PublicApi.MarketController.market_tide",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.MarketController.market_tide"
      },
      {
        "name": "OI Change",
        "method": "GET",
        "path": "/api/market/oi-change",
        "operationId": "PublicApi.MarketController.oi_change",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.MarketController.oi_change"
      },
      {
        "name": "Sector Etfs",
        "method": "GET",
        "path": "/api/market/sector-etfs",
        "operationId": "PublicApi.MarketController.sector_etfs",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.MarketController.sector_etfs"
      },
      {
        "name": "Top Net Impact",
        "method": "GET",
        "path": "/api/market/top-net-impact",
        "operationId": "PublicApi.MarketController.top_net_impact",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.MarketController.top_net_impact"
      },
      {
        "name": "Total Options Volume",
        "method": "GET",
        "path": "/api/market/total-options-volume",
        "operationId": "PublicApi.MarketController.total_options_volume",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.MarketController.total_options_volume"
      },
      {
        "name": "Sector Tide",
        "method": "GET",
        "path": "/api/market/{sector}/sector-tide",
        "operationId": "PublicApi.MarketController.sec_indst",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.MarketController.sec_indst"
      },
      {
        "name": "ETF Tide",
        "method": "GET",
        "path": "/api/market/{ticker}/etf-tide",
        "operationId": "PublicApi.MarketController.etf_tide",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.MarketController.etf_tide"
      },
      {
        "name": "Net Flow Expiry",
        "method": "GET",
        "path": "/api/net-flow/expiry",
        "operationId": "PublicApi.NetFlowController.expiry",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.NetFlowController.expiry"
      }
    ]
  },
  {
    "id": "news",
    "title": "News",
    "categoryKey": "news",
    "endpoints": [
      {
        "name": "News Headlines",
        "method": "GET",
        "path": "/api/news/headlines",
        "operationId": "PublicApi.NewsController.headlines",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.NewsController.headlines"
      }
    ]
  },
  {
    "id": "option-contract",
    "title": "Option-contract",
    "categoryKey": "option-contract",
    "endpoints": [
      {
        "name": "Flow Data",
        "method": "GET",
        "path": "/api/option-contract/{id}/flow",
        "operationId": "PublicApi.OptionContractController.flow",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.OptionContractController.flow"
      },
      {
        "name": "Historic Data",
        "method": "GET",
        "path": "/api/option-contract/{id}/historic",
        "operationId": "PublicApi.OptionContractController.history",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.OptionContractController.history"
      },
      {
        "name": "Intraday Data",
        "method": "GET",
        "path": "/api/option-contract/{id}/intraday",
        "operationId": "PublicApi.OptionContractController.intraday",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.OptionContractController.intraday"
      },
      {
        "name": "Volume Profile",
        "method": "GET",
        "path": "/api/option-contract/{id}/volume-profile",
        "operationId": "PublicApi.OptionContractController.volume_profile",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.OptionContractController.volume_profile"
      },
      {
        "name": "Expiry Breakdown",
        "method": "GET",
        "path": "/api/stock/{ticker}/expiry-breakdown",
        "operationId": "PublicApi.OptionContractController.expiry_breakdown",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.OptionContractController.expiry_breakdown"
      },
      {
        "name": "Option contracts",
        "method": "GET",
        "path": "/api/stock/{ticker}/option-contracts",
        "operationId": "PublicApi.OptionContractController.option_contracts",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.OptionContractController.option_contracts"
      }
    ]
  },
  {
    "id": "option-trade",
    "title": "Option-trade",
    "categoryKey": "option-trade",
    "endpoints": [
      {
        "name": "Exchange & Trade Code Breakdown",
        "method": "GET",
        "path": "/api/option-trades/exchange-breakdown/{date}",
        "operationId": "PublicApi.OptionTradeController.exchange_breakdown",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.OptionTradeController.exchange_breakdown"
      },
      {
        "name": "Flow Alerts",
        "method": "GET",
        "path": "/api/option-trades/flow-alerts",
        "operationId": "PublicApi.OptionTradeController.flow_alerts",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.OptionTradeController.flow_alerts"
      },
      {
        "name": "Flow Alert by ID",
        "method": "GET",
        "path": "/api/option-trades/flow-alerts/{id}",
        "operationId": "PublicApi.OptionTradeController.flow_alert",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.OptionTradeController.flow_alert"
      },
      {
        "name": "Full Tape",
        "method": "GET",
        "path": "/api/option-trades/full-tape/{date}",
        "operationId": "PublicApi.OptionTradeController.full_tape",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.OptionTradeController.full_tape"
      },
      {
        "name": "Optionable Tickers",
        "method": "GET",
        "path": "/api/option-trades/optionable-tickers",
        "operationId": "PublicApi.OptionTradeController.optionable_tickers",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.OptionTradeController.optionable_tickers"
      }
    ]
  },
  {
    "id": "politician-portfolios",
    "title": "Politician Portfolios",
    "categoryKey": "politician_portfolios",
    "endpoints": [
      {
        "name": "Annual Disclosures List",
        "method": "GET",
        "path": "/api/politician-portfolios/disclosures",
        "operationId": "PublicApi.PoliticianPortfoliosController.disclosures",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PoliticianPortfoliosController.disclosures"
      },
      {
        "name": "Politician Portfolio Holders by Ticker",
        "method": "GET",
        "path": "/api/politician-portfolios/holders/{ticker}",
        "operationId": "PublicApi.PoliticianPortfoliosController.holds_ticker",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PoliticianPortfoliosController.holds_ticker"
      },
      {
        "name": "Politicians List",
        "method": "GET",
        "path": "/api/politician-portfolios/people",
        "operationId": "PublicApi.PoliticianPortfoliosController.people",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PoliticianPortfoliosController.people"
      },
      {
        "name": "Politician Trades",
        "method": "GET",
        "path": "/api/politician-portfolios/recent_trades",
        "operationId": "PublicApi.PoliticianPortfoliosController.recent_trades",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PoliticianPortfoliosController.recent_trades"
      },
      {
        "name": "Politician Portfolios",
        "method": "GET",
        "path": "/api/politician-portfolios/{politician_id}",
        "operationId": "PublicApi.PoliticianPortfoliosController.portfolios",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PoliticianPortfoliosController.portfolios"
      }
    ]
  },
  {
    "id": "predictions",
    "title": "Predictions",
    "categoryKey": "predictions",
    "endpoints": [
      {
        "name": "Prediction Market Insiders",
        "method": "GET",
        "path": "/api/predictions/insiders",
        "operationId": "PublicApi.PredictionController.insiders",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PredictionController.insiders"
      },
      {
        "name": "Prediction Market Details",
        "method": "GET",
        "path": "/api/predictions/market/{asset_id}",
        "operationId": "PublicApi.PredictionController.market",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PredictionController.market"
      },
      {
        "name": "Prediction Market Liquidity",
        "method": "GET",
        "path": "/api/predictions/market/{asset_id}/liquidity",
        "operationId": "PublicApi.PredictionController.liquidity",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PredictionController.liquidity"
      },
      {
        "name": "Prediction Market Positions",
        "method": "GET",
        "path": "/api/predictions/market/{asset_id}/positions",
        "operationId": "PublicApi.PredictionController.positions",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PredictionController.positions"
      },
      {
        "name": "Search Prediction Market Users",
        "method": "GET",
        "path": "/api/predictions/search-users",
        "operationId": "PublicApi.PredictionController.search_users",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PredictionController.search_users"
      },
      {
        "name": "Prediction Smart Money",
        "method": "GET",
        "path": "/api/predictions/smart-money",
        "operationId": "PublicApi.PredictionController.smart_money",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PredictionController.smart_money"
      },
      {
        "name": "Unusual Prediction Markets",
        "method": "GET",
        "path": "/api/predictions/unusual",
        "operationId": "PublicApi.PredictionController.unusual",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PredictionController.unusual"
      },
      {
        "name": "Prediction Market User",
        "method": "GET",
        "path": "/api/predictions/user/{user_id}",
        "operationId": "PublicApi.PredictionController.user",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PredictionController.user"
      },
      {
        "name": "Prediction Market Whales",
        "method": "GET",
        "path": "/api/predictions/whales",
        "operationId": "PublicApi.PredictionController.whales",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PredictionController.whales"
      }
    ]
  },
  {
    "id": "private-markets",
    "title": "Private Markets",
    "categoryKey": "private_markets",
    "endpoints": [
      {
        "name": "List Private Markets Companies",
        "method": "GET",
        "path": "/api/private-markets/companies",
        "operationId": "PublicApi.PrivateMarketsController.companies",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PrivateMarketsController.companies"
      },
      {
        "name": "Private Markets Company Profile",
        "method": "GET",
        "path": "/api/private-markets/companies/{npm_ticker}",
        "operationId": "PublicApi.PrivateMarketsController.company_profile",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PrivateMarketsController.company_profile"
      },
      {
        "name": "Private Markets Funding Rounds",
        "method": "GET",
        "path": "/api/private-markets/companies/{npm_ticker}/funding",
        "operationId": "PublicApi.PrivateMarketsController.funding",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PrivateMarketsController.funding"
      },
      {
        "name": "Private Markets Investors for Company",
        "method": "GET",
        "path": "/api/private-markets/companies/{npm_ticker}/investors",
        "operationId": "PublicApi.PrivateMarketsController.investors",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PrivateMarketsController.investors"
      },
      {
        "name": "Private Markets Management",
        "method": "GET",
        "path": "/api/private-markets/companies/{npm_ticker}/management",
        "operationId": "PublicApi.PrivateMarketsController.management",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PrivateMarketsController.management"
      },
      {
        "name": "Private Markets Pricing History",
        "method": "GET",
        "path": "/api/private-markets/companies/{npm_ticker}/pricing",
        "operationId": "PublicApi.PrivateMarketsController.pricing",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PrivateMarketsController.pricing"
      },
      {
        "name": "Top Private Markets Investors",
        "method": "GET",
        "path": "/api/private-markets/investors",
        "operationId": "PublicApi.PrivateMarketsController.top_investors",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PrivateMarketsController.top_investors"
      },
      {
        "name": "Private Markets Investor Profile",
        "method": "GET",
        "path": "/api/private-markets/investors/{name}",
        "operationId": "PublicApi.PrivateMarketsController.investor_profile",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PrivateMarketsController.investor_profile"
      },
      {
        "name": "Search Private Markets",
        "method": "GET",
        "path": "/api/private-markets/search",
        "operationId": "PublicApi.PrivateMarketsController.search",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.PrivateMarketsController.search"
      }
    ]
  },
  {
    "id": "screener",
    "title": "Screener",
    "categoryKey": "screener",
    "endpoints": [
      {
        "name": "Analyst Rating",
        "method": "GET",
        "path": "/api/screener/analysts",
        "operationId": "PublicApi.ScreenerController.analyst_ratings",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ScreenerController.analyst_ratings"
      },
      {
        "name": "Hottest Chains",
        "method": "GET",
        "path": "/api/screener/option-contracts",
        "operationId": "PublicApi.ScreenerController.contract_screener",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ScreenerController.contract_screener"
      },
      {
        "name": "Stock Screener",
        "method": "GET",
        "path": "/api/screener/stocks",
        "operationId": "PublicApi.ScreenerController.stock_screener",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ScreenerController.stock_screener"
      }
    ]
  },
  {
    "id": "seasonality",
    "title": "Seasonality",
    "categoryKey": "seasonality",
    "endpoints": [
      {
        "name": "Market Seasonality",
        "method": "GET",
        "path": "/api/seasonality/market",
        "operationId": "PublicApi.SeasonalityController.market_seasonality",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SeasonalityController.market_seasonality"
      },
      {
        "name": "Month Performers",
        "method": "GET",
        "path": "/api/seasonality/{month}/performers",
        "operationId": "PublicApi.SeasonalityController.month_performers",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SeasonalityController.month_performers"
      },
      {
        "name": "Average return per month",
        "method": "GET",
        "path": "/api/seasonality/{ticker}/monthly",
        "operationId": "PublicApi.SeasonalityController.monthly",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SeasonalityController.monthly"
      },
      {
        "name": "Price change per month per year",
        "method": "GET",
        "path": "/api/seasonality/{ticker}/year-month",
        "operationId": "PublicApi.SeasonalityController.year_month",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SeasonalityController.year_month"
      }
    ]
  },
  {
    "id": "short",
    "title": "Short",
    "categoryKey": "short",
    "endpoints": [
      {
        "name": "Short Screener",
        "method": "GET",
        "path": "/api/short_screener",
        "operationId": "PublicApi.ShortController.short_screener",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ShortController.short_screener"
      },
      {
        "name": "Short Data",
        "method": "GET",
        "path": "/api/shorts/{ticker}/data",
        "operationId": "PublicApi.ShortController.short_data",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ShortController.short_data"
      },
      {
        "name": "Failures to Deliver",
        "method": "GET",
        "path": "/api/shorts/{ticker}/ftds",
        "operationId": "PublicApi.ShortController.failures_to_deliver",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ShortController.failures_to_deliver"
      },
      {
        "name": "V1 Short Interest and Float (Deprecated)",
        "method": "GET",
        "path": "/api/shorts/{ticker}/interest-float",
        "operationId": "PublicApi.ShortController.short_interest_and_float",
        "deprecated": true,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ShortController.short_interest_and_float"
      },
      {
        "name": "V2 Short Interest and Float",
        "method": "GET",
        "path": "/api/shorts/{ticker}/interest-float/v2",
        "operationId": "PublicApi.ShortController.short_interest_and_float_v2",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ShortController.short_interest_and_float_v2"
      },
      {
        "name": "Short Volume and Ratio",
        "method": "GET",
        "path": "/api/shorts/{ticker}/volume-and-ratio",
        "operationId": "PublicApi.ShortController.short_volume_and_ratio",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ShortController.short_volume_and_ratio"
      },
      {
        "name": "Short Volume By Exchange",
        "method": "GET",
        "path": "/api/shorts/{ticker}/volumes-by-exchange",
        "operationId": "PublicApi.ShortController.short_volume_by_exchange",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.ShortController.short_volume_by_exchange"
      }
    ]
  },
  {
    "id": "stock",
    "title": "Stock",
    "categoryKey": "stock",
    "endpoints": [
      {
        "name": "Companies in Sector",
        "method": "GET",
        "path": "/api/stock/{sector}/tickers",
        "operationId": "PublicApi.TickerController.companies_in_sector",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.companies_in_sector"
      },
      {
        "name": "ATM Chains",
        "method": "GET",
        "path": "/api/stock/{ticker}/atm-chains",
        "operationId": "PublicApi.TickerController.atm_chains",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.atm_chains"
      },
      {
        "name": "Balance Sheets",
        "method": "GET",
        "path": "/api/stock/{ticker}/balance-sheets",
        "operationId": "PublicApi.AvFundamentalController.balance_sheets",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.AvFundamentalController.balance_sheets"
      },
      {
        "name": "Cash Flow Statements",
        "method": "GET",
        "path": "/api/stock/{ticker}/cash-flows",
        "operationId": "PublicApi.AvFundamentalController.cash_flows",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.AvFundamentalController.cash_flows"
      },
      {
        "name": "Earnings History",
        "method": "GET",
        "path": "/api/stock/{ticker}/earnings",
        "operationId": "PublicApi.AvFundamentalController.earnings",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.AvFundamentalController.earnings"
      },
      {
        "name": "Full Financials",
        "method": "GET",
        "path": "/api/stock/{ticker}/financials",
        "operationId": "PublicApi.AvFundamentalController.financials",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.AvFundamentalController.financials"
      },
      {
        "name": "Flow Alerts",
        "method": "GET",
        "path": "/api/stock/{ticker}/flow-alerts",
        "operationId": "PublicApi.TickerController.flow_alerts",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.flow_alerts"
      },
      {
        "name": "Flow per expiry",
        "method": "GET",
        "path": "/api/stock/{ticker}/flow-per-expiry",
        "operationId": "PublicApi.TickerController.flow_per_expiry",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.flow_per_expiry"
      },
      {
        "name": "Flow per strike",
        "method": "GET",
        "path": "/api/stock/{ticker}/flow-per-strike",
        "operationId": "PublicApi.TickerController.flow_per_strike",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.flow_per_strike"
      },
      {
        "name": "Flow per strike intraday",
        "method": "GET",
        "path": "/api/stock/{ticker}/flow-per-strike-intraday",
        "operationId": "PublicApi.TickerController.flow_per_strike_intraday",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.flow_per_strike_intraday"
      },
      {
        "name": "Recent flows",
        "method": "GET",
        "path": "/api/stock/{ticker}/flow-recent",
        "operationId": "PublicApi.TickerController.flow_recent",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.flow_recent"
      },
      {
        "name": "Fundamental Breakdown",
        "method": "GET",
        "path": "/api/stock/{ticker}/fundamental-breakdown",
        "operationId": "PublicApi.FundamentalController.show",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.FundamentalController.show"
      },
      {
        "name": "Greeks",
        "method": "GET",
        "path": "/api/stock/{ticker}/greeks",
        "operationId": "PublicApi.TickerController.greeks",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.greeks"
      },
      {
        "name": "Historical Risk Reversal Skew",
        "method": "GET",
        "path": "/api/stock/{ticker}/historical-risk-reversal-skew",
        "operationId": "PublicApi.TickerController.historical_risk_reversal_skew",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.historical_risk_reversal_skew"
      },
      {
        "name": "Income Statements",
        "method": "GET",
        "path": "/api/stock/{ticker}/income-statements",
        "operationId": "PublicApi.AvFundamentalController.income_statements",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.AvFundamentalController.income_statements"
      },
      {
        "name": "Information",
        "method": "GET",
        "path": "/api/stock/{ticker}/info",
        "operationId": "PublicApi.TickerController.info",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.info"
      },
      {
        "name": "Insider buy & sells",
        "method": "GET",
        "path": "/api/stock/{ticker}/insider-buy-sells",
        "operationId": "PublicApi.TickerController.insider_buy_sell",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.insider_buy_sell"
      },
      {
        "name": "Interpolated IV",
        "method": "GET",
        "path": "/api/stock/{ticker}/interpolated-iv",
        "operationId": "PublicApi.TickerController.interpolated_iv",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.interpolated_iv"
      },
      {
        "name": "IV Rank",
        "method": "GET",
        "path": "/api/stock/{ticker}/iv-rank",
        "operationId": "PublicApi.TickerController.iv_rank",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.iv_rank"
      },
      {
        "name": "Max Pain",
        "method": "GET",
        "path": "/api/stock/{ticker}/max-pain",
        "operationId": "PublicApi.TickerController.max_pain",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.max_pain"
      },
      {
        "name": "Call/Put Net/Vol Ticks",
        "method": "GET",
        "path": "/api/stock/{ticker}/net-prem-ticks",
        "operationId": "PublicApi.TickerController.net_prem_ticks",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.net_prem_ticks"
      },
      {
        "name": "Nope",
        "method": "GET",
        "path": "/api/stock/{ticker}/nope",
        "operationId": "PublicApi.TickerController.nope",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.nope"
      },
      {
        "name": "OHLC",
        "method": "GET",
        "path": "/api/stock/{ticker}/ohlc/{candle_size}",
        "operationId": "PublicApi.TickerController.ohlc",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.ohlc"
      },
      {
        "name": "OI Change",
        "method": "GET",
        "path": "/api/stock/{ticker}/oi-change",
        "operationId": "PublicApi.TickerController.oi_change",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.oi_change"
      },
      {
        "name": "OI per Expiry",
        "method": "GET",
        "path": "/api/stock/{ticker}/oi-per-expiry",
        "operationId": "PublicApi.TickerController.oi_per_expiry",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.oi_per_expiry"
      },
      {
        "name": "OI per Strike",
        "method": "GET",
        "path": "/api/stock/{ticker}/oi-per-strike",
        "operationId": "PublicApi.TickerController.oi_per_strike",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.oi_per_strike"
      },
      {
        "name": "Option Chains",
        "method": "GET",
        "path": "/api/stock/{ticker}/option-chains",
        "operationId": "PublicApi.TickerController.option_chains",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.option_chains"
      },
      {
        "name": "Option Price Levels",
        "method": "GET",
        "path": "/api/stock/{ticker}/option/stock-price-levels",
        "operationId": "PublicApi.TickerController.option_price_level",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.option_price_level"
      },
      {
        "name": "Volume & OI per Expiry",
        "method": "GET",
        "path": "/api/stock/{ticker}/option/volume-oi-expiry",
        "operationId": "PublicApi.TickerController.vol_oi_per_expiry",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.vol_oi_per_expiry"
      },
      {
        "name": "Options Volume",
        "method": "GET",
        "path": "/api/stock/{ticker}/options-volume",
        "operationId": "PublicApi.TickerController.options_volume",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.options_volume"
      },
      {
        "name": "Ownership",
        "method": "GET",
        "path": "/api/stock/{ticker}/ownership",
        "operationId": "PublicApi.TickerController.ownership",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.ownership"
      },
      {
        "name": "Stock State",
        "method": "GET",
        "path": "/api/stock/{ticker}/stock-state",
        "operationId": "PublicApi.TickerController.last_stock_state",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.last_stock_state"
      },
      {
        "name": "Off/Lit Price Levels",
        "method": "GET",
        "path": "/api/stock/{ticker}/stock-volume-price-levels",
        "operationId": "PublicApi.TickerController.stock_volume_price_level",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.stock_volume_price_level"
      },
      {
        "name": "Technical Indicator",
        "method": "GET",
        "path": "/api/stock/{ticker}/technical-indicator/{function}",
        "operationId": "PublicApi.AvFundamentalController.technical_indicator",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.AvFundamentalController.technical_indicator"
      },
      {
        "name": "Realized Volatility",
        "method": "GET",
        "path": "/api/stock/{ticker}/volatility/realized",
        "operationId": "PublicApi.TickerController.realized_volatility",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.realized_volatility"
      },
      {
        "name": "Volatility Statistics",
        "method": "GET",
        "path": "/api/stock/{ticker}/volatility/stats",
        "operationId": "PublicApi.TickerController.volatility_stats",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.volatility_stats"
      },
      {
        "name": "Implied Volatility Term Structure",
        "method": "GET",
        "path": "/api/stock/{ticker}/volatility/term-structure",
        "operationId": "PublicApi.TickerController.implied_volatility_term_structure",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.TickerController.implied_volatility_term_structure"
      }
    ]
  },
  {
    "id": "stock-directory",
    "title": "Stock-directory",
    "categoryKey": "stock-directory",
    "endpoints": [
      {
        "name": "Ticker Exchange Mapping",
        "method": "GET",
        "path": "/api/stock-directory/ticker-exchanges",
        "operationId": "PublicApi.StockDirectoryController.ticker_exchanges",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.StockDirectoryController.ticker_exchanges"
      }
    ]
  },
  {
    "id": "unusual-trades",
    "title": "Unusual Trades",
    "categoryKey": "unusual_trades",
    "endpoints": [
      {
        "name": "Unusual Congressional Trades",
        "method": "GET",
        "path": "/api/congress/unusual-trades",
        "operationId": "PublicApi.UnusualTradesController.recent",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.UnusualTradesController.recent"
      },
      {
        "name": "Unusual Trades by Ticker",
        "method": "GET",
        "path": "/api/congress/unusual-trades/by-tickers",
        "operationId": "PublicApi.UnusualTradesController.by_tickers",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.UnusualTradesController.by_tickers"
      },
      {
        "name": "Unusual Trades Chart Data",
        "method": "GET",
        "path": "/api/congress/unusual-trades/chart-data",
        "operationId": "PublicApi.UnusualTradesController.chart_data",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.UnusualTradesController.chart_data"
      },
      {
        "name": "Unusual Trades Aggregate Stats",
        "method": "GET",
        "path": "/api/congress/unusual-trades/stats",
        "operationId": "PublicApi.UnusualTradesController.stats",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.UnusualTradesController.stats"
      }
    ]
  },
  {
    "id": "volatility",
    "title": "Volatility",
    "categoryKey": "volatility",
    "endpoints": [
      {
        "name": "Volatility Anomaly Score",
        "method": "GET",
        "path": "/api/stock/{ticker}/volatility/anomaly",
        "operationId": "PublicApi.VolatilityController.anomaly",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.VolatilityController.anomaly"
      },
      {
        "name": "Volatility Character",
        "method": "GET",
        "path": "/api/stock/{ticker}/volatility/character",
        "operationId": "PublicApi.VolatilityController.character",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.VolatilityController.character"
      },
      {
        "name": "Variance Risk Premium",
        "method": "GET",
        "path": "/api/stock/{ticker}/volatility/variance-risk-premium",
        "operationId": "PublicApi.VolatilityController.variance_risk_premium",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.VolatilityController.variance_risk_premium"
      },
      {
        "name": "Top Volatility Anomalies",
        "method": "GET",
        "path": "/api/volatility/anomaly/top",
        "operationId": "PublicApi.VolatilityController.anomaly_top",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.VolatilityController.anomaly_top"
      },
      {
        "name": "Top Volatility Character",
        "method": "GET",
        "path": "/api/volatility/character/top",
        "operationId": "PublicApi.VolatilityController.character_top",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.VolatilityController.character_top"
      },
      {
        "name": "VIX Term Structure",
        "method": "GET",
        "path": "/api/volatility/vix-term-structure",
        "operationId": "PublicApi.VolatilityController.vix_term_structure",
        "deprecated": false,
        "blackout": true,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.VolatilityController.vix_term_structure"
      }
    ]
  },
  {
    "id": "websocket",
    "title": "Websocket",
    "categoryKey": "websocket",
    "endpoints": [
      {
        "name": "WebSocket channels",
        "method": "GET",
        "path": "/api/socket",
        "operationId": "PublicApi.SocketController.channels",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.channels"
      },
      {
        "name": "Contract screener",
        "method": "GET",
        "path": "/api/socket/contract_screener",
        "operationId": "PublicApi.SocketController.contract_screener",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.contract_screener"
      },
      {
        "name": "Custom alerts",
        "method": "GET",
        "path": "/api/socket/custom_alerts",
        "operationId": "PublicApi.SocketController.custom_alerts",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.custom_alerts"
      },
      {
        "name": "Flow alerts",
        "method": "GET",
        "path": "/api/socket/flow_alerts",
        "operationId": "PublicApi.SocketController.flow_alerts",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.flow_alerts"
      },
      {
        "name": "GEX",
        "method": "GET",
        "path": "/api/socket/gex",
        "operationId": "PublicApi.SocketController.gex",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.gex"
      },
      {
        "name": "Ticker Interval flow",
        "method": "GET",
        "path": "/api/socket/interval_flow",
        "operationId": "PublicApi.SocketController.interval_flow",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.interval_flow"
      },
      {
        "name": "Lit trades",
        "method": "GET",
        "path": "/api/socket/lit_trades",
        "operationId": "PublicApi.SocketController.lit_trades",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.lit_trades"
      },
      {
        "name": "Market tide",
        "method": "GET",
        "path": "/api/socket/market_tide",
        "operationId": "PublicApi.SocketController.market_tide",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.market_tide"
      },
      {
        "name": "Net flow",
        "method": "GET",
        "path": "/api/socket/net_flow",
        "operationId": "PublicApi.SocketController.net_flow",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.net_flow"
      },
      {
        "name": "News",
        "method": "GET",
        "path": "/api/socket/news",
        "operationId": "PublicApi.SocketController.news",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.news"
      },
      {
        "name": "Off-lit trades",
        "method": "GET",
        "path": "/api/socket/off_lit_trades",
        "operationId": "PublicApi.SocketController.off_lit_trades",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.off_lit_trades"
      },
      {
        "name": "Option trades",
        "method": "GET",
        "path": "/api/socket/option_trades",
        "operationId": "PublicApi.SocketController.option_trades",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.option_trades"
      },
      {
        "name": "Price",
        "method": "GET",
        "path": "/api/socket/price",
        "operationId": "PublicApi.SocketController.price",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.price"
      },
      {
        "name": "Trading halts",
        "method": "GET",
        "path": "/api/socket/trading_halts",
        "operationId": "PublicApi.SocketController.trading_halts",
        "deprecated": false,
        "blackout": false,
        "docUrl": "https://api.unusualwhales.com/docs/operations/PublicApi.SocketController.trading_halts"
      }
    ]
  }
];

export const UW_REST_TOC = UW_REST_SECTIONS.map((s) => ({
  id: s.id,
  title: s.title,
  count: s.endpoints.length,
}));

export const UW_ENDPOINT_TOTAL = 186;
export const UW_BLACKOUT_ENDPOINT_COUNT = 103;
