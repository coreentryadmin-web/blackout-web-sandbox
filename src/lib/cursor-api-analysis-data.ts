/** Auto-generated — run: node scripts/analyze-api-usage.mjs */
export const CURSOR_API_ANALYSIS = {
  "generatedAt": "2026-06-19T00:28:45.065Z",
  "summary": {
    "internalRoutes": 40,
    "polygonEndpoints": 43,
    "uwEndpoints": 203,
    "finnhubEndpoints": 4,
    "anthropicEndpoints": 1,
    "engineEndpoints": 1,
    "webSearchEndpoints": 3,
    "clientCalls": 27,
    "largoTools": 78
  },
  "internalRoutes": [
    {
      "method": "GET",
      "path": "/api/admin/analytics/spx",
      "file": "src/app/api/admin/analytics/spx/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/admin/apis/dashboard",
      "file": "src/app/api/admin/apis/dashboard/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/admin/apis/events/[id]",
      "file": "src/app/api/admin/apis/events/[id]/route.ts"
    },
    {
      "method": "POST",
      "path": "/api/admin/apis/rescan",
      "file": "src/app/api/admin/apis/rescan/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/admin/apis/stream",
      "file": "src/app/api/admin/apis/stream/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/admin/health",
      "file": "src/app/api/admin/health/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/admin/incidents",
      "file": "src/app/api/admin/incidents/route.ts"
    },
    {
      "method": "POST",
      "path": "/api/admin/incidents",
      "file": "src/app/api/admin/incidents/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/admin/me",
      "file": "src/app/api/admin/me/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/admin/spx/dashboard",
      "file": "src/app/api/admin/spx/dashboard/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/cron/flow-ingest",
      "file": "src/app/api/cron/flow-ingest/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/cron/largo-cleanup",
      "file": "src/app/api/cron/largo-cleanup/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/cron/nighthawk-edition",
      "file": "src/app/api/cron/nighthawk-edition/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/cron/spx-evaluate",
      "file": "src/app/api/cron/spx-evaluate/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/engine/[...path]",
      "file": "src/app/api/engine/[...path]/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/engine/health",
      "file": "src/app/api/engine/health/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/flows",
      "file": "src/app/api/market/flows/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/flows/stream",
      "file": "src/app/api/market/flows/stream/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/health",
      "file": "src/app/api/market/health/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/heatmap",
      "file": "src/app/api/market/heatmap/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/indices",
      "file": "src/app/api/market/indices/route.ts"
    },
    {
      "method": "POST",
      "path": "/api/market/largo/query",
      "file": "src/app/api/market/largo/query/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/largo/session",
      "file": "src/app/api/market/largo/session/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/lotto/today",
      "file": "src/app/api/market/lotto/today/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/news",
      "file": "src/app/api/market/news/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/nighthawk/edition",
      "file": "src/app/api/market/nighthawk/edition/route.ts"
    },
    {
      "method": "POST",
      "path": "/api/market/nighthawk/hunt",
      "file": "src/app/api/market/nighthawk/hunt/route.ts"
    },
    {
      "method": "POST",
      "path": "/api/market/nighthawk/play-explain",
      "file": "src/app/api/market/nighthawk/play-explain/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/platform/snapshot",
      "file": "src/app/api/market/platform/snapshot/route.ts"
    },
    {
      "method": "POST",
      "path": "/api/market/spx/commentary",
      "file": "src/app/api/market/spx/commentary/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/spx/desk",
      "file": "src/app/api/market/spx/desk/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/spx/flow",
      "file": "src/app/api/market/spx/flow/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/spx/merged",
      "file": "src/app/api/market/spx/merged/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/spx/outcomes",
      "file": "src/app/api/market/spx/outcomes/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/spx/play",
      "file": "src/app/api/market/spx/play/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/spx/pulse",
      "file": "src/app/api/market/spx/pulse/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/spx/pulse/stream",
      "file": "src/app/api/market/spx/pulse/stream/route.ts"
    },
    {
      "method": "GET",
      "path": "/api/market/spx/signals",
      "file": "src/app/api/market/spx/signals/route.ts"
    },
    {
      "method": "POST",
      "path": "/api/membership/sync",
      "file": "src/app/api/membership/sync/route.ts"
    },
    {
      "method": "POST",
      "path": "/api/webhook/whop",
      "file": "src/app/api/webhook/whop/route.ts"
    }
  ],
  "external": {
    "polygon": [
      {
        "path": "/benzinga/v2/news",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/docs-probe-report.ts",
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/stocks/financials/v1/ratios",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/stocks/v1/float",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/stocks/v1/short-interest",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/stocks/v1/short-volume",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v1/indicators/ema/{symbol}",
        "files": [
          "src/lib/api-provider-catalog.ts"
        ]
      },
      {
        "path": "/v1/indicators/ema/${sym}",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v1/indicators/ema/${symToPath(symbol)}",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v1/indicators/macd/${sym}",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v1/indicators/rsi/${sym}",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v1/indicators/rsi/${symToPath(symbol)}",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v1/indicators/sma/{symbol}",
        "files": [
          "src/lib/api-provider-catalog.ts"
        ]
      },
      {
        "path": "/v1/indicators/sma/${sym}",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v1/indicators/sma/${symToPath(symbol)}",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v1/indicators/vwap",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v1/marketstatus/now",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v1/marketstatus/upcoming",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v1/messages",
        "files": [
          "src/lib/api-provider-catalog.ts"
        ]
      },
      {
        "path": "/v1/open-close/${sym}/${d}",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v2/aggs/grouped/locale/us/market/stocks/${date}",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v2/aggs/ticker/{symbol}/range/1/day/{from}/{to}",
        "files": [
          "src/lib/api-provider-catalog.ts"
        ]
      },
      {
        "path": "/v2/aggs/ticker/{symbol}/range/1/minute/{from}/{to}",
        "files": [
          "src/lib/api-provider-catalog.ts"
        ]
      },
      {
        "path": "/v2/aggs/ticker/${sym}/prev",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v2/aggs/ticker/${sym}/range/${multiplier}/${timespan}/${from}/${to}",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v2/aggs/ticker/${sym}/range/1/day/${from}/${to}",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v2/aggs/ticker/${sym}/range/1/minute/${from}/${to}",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v2/last/nbbo/${sym}",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v2/last/trade/${sym}",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v2/reference/news",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v2/snapshot/locale/us/markets/stocks/gainers",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v2/snapshot/locale/us/markets/stocks/losers",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v2/snapshot/locale/us/markets/stocks/tickers",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/providers/gap-proxy.ts",
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v2/snapshot/locale/us/markets/stocks/tickers/${sym}",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v3/reference/options/contracts",
        "files": [
          "src/lib/providers/polygon-options-gex.ts"
        ]
      },
      {
        "path": "/v3/reference/options/contracts?${params}",
        "files": [
          "src/lib/providers/polygon-options-gex.ts"
        ]
      },
      {
        "path": "/v3/reference/tickers/${ticker.toUpperCase()}",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v3/reference/tickers/${ticker.toUpperCase()}/related",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "/v3/snapshot/indices",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/providers/polygon.ts"
        ]
      },
      {
        "path": "/v3/snapshot/options/{underlying}",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/providers/polygon-options-gex.ts"
        ]
      },
      {
        "path": "/v3/snapshot/options/${underlying}?${params}",
        "files": [
          "src/lib/providers/polygon-options-gex.ts"
        ]
      },
      {
        "path": "/v3/snapshot/options/SPXW?${params}",
        "files": [
          "src/lib/spx-lotto-options.ts",
          "src/lib/spx-play-options.ts"
        ]
      },
      {
        "path": "polygon",
        "files": [
          "src/lib/providers/polygon-largo.ts"
        ]
      },
      {
        "path": "POLYGON_API_KEY not set",
        "files": [
          "src/lib/providers/polygon.ts"
        ]
      }
    ],
    "unusual_whales": [
      {
        "path": "/api/companies/{param}/dividends",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/companies/{param}/earnings-estimates",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/companies/{param}/profile",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/companies/{param}/splits",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/companies/${sym(ticker)}/dividends",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/companies/${sym(ticker)}/profile",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/companies/${sym(ticker)}/splits",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/companies/${ticker.toUpperCase()}/earnings-estimates",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/congress/late-reports",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/congress/politicians",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/congress/recent-trades",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/congress/unusual-trades",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/darkpool/{param}",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/dossier.ts",
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/darkpool/{ticker}",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/darkpool/${ticker.toUpperCase()}",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/darkpool/recent",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/earnings/afterhours",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/earnings/premarket",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/economy/{indicator}",
        "files": [
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/economy/{param}",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/economy/${id}",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/dossier.ts",
          "src/lib/nighthawk/market-wide.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/etf/{param}/in-outflow",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/etf/{param}/tide",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/market-wide.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/etf/${etf.toUpperCase()}/in-outflow",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/etf/${etf.toUpperCase()}/tide",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/etfs/{param}/exposure",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/etfs/{param}/holdings",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/dossier.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/etfs/{param}/info",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/etfs/{param}/weights",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/etfs/${etf.toUpperCase()}/exposure",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/etfs/${etf.toUpperCase()}/holdings",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/etfs/${etf.toUpperCase()}/info",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/etfs/${etf.toUpperCase()}/weights",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/group-flow/{flow_group}/greek-flow",
        "files": [
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/insider/{param}",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/insider/{param}/sector-flow",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/insider/${sector.toLowerCase()}/sector-flow",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/insider/${sym(ticker)}",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/insider/transactions",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/institution/{param}/activity",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/institution/{param}/holdings",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/institution/{param}/ownership",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/institution/${encodeURIComponent(name)}/activity",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/institution/${encodeURIComponent(name)}/holdings",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/institution/${sym(ticker)}/ownership",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/dossier.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/institutions/latest_filings",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/lit-flow/recent",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/lit-flow/ticker",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/market/{param}/sector-tide",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/market-wide.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/market/${sector.toLowerCase()}/sector-tide",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/market/correlations",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/market/economic-calendar",
        "files": [
          "src/lib/live-api-integrations.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/market/fda-calendar",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/market/market-tide",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/market/movers",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/market/oi-change",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/market/sector-etfs",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/market/top-net-impact",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/market-wide.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/market/total-options-volume",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/net-flow/expiry",
        "files": [
          "src/lib/live-api-integrations.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/news/headlines",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/dossier.ts",
          "src/lib/nighthawk/market-wide.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/option-contract/{param}/flow",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/option-contract/{param}/intraday",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/option-contract/{param}/volume-profile",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/option-contract/${contractId.toUpperCase()}/flow",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/option-contract/${contractId.toUpperCase()}/intraday",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/option-contract/${contractId.toUpperCase()}/volume-profile",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/option-trades/flow-alerts",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/predictions/insiders",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/predictions/smart-money",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/predictions/unusual",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/predictions/whales",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/screener/analysts",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/screener/contracts",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/screener/option-contracts",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/screener/stocks",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/seasonality/{param}/monthly",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/seasonality/${ticker.toUpperCase()}/monthly",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/seasonality/market",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/shorts/{param}/data",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/shorts/{param}/ftds",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/shorts/{param}/interest-float/v2",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/dossier.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/shorts/{param}/volume-and-ratio",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/shorts/{param}/volumes-by-exchange",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/shorts/${sym(ticker)}/data",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/shorts/${sym(ticker)}/volumes-by-exchange",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/shorts/${ticker.toUpperCase()}/ftds",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/shorts/${ticker.toUpperCase()}/interest-float/v2",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/shorts/${ticker.toUpperCase()}/volume-and-ratio",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/shorts/screener",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/socket/flow_alerts",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts",
          "src/lib/ws/uw-socket.ts"
        ]
      },
      {
        "path": "/api/socket/gex",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts",
          "src/lib/ws/uw-socket.ts"
        ]
      },
      {
        "path": "/api/socket/interval_flow",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts",
          "src/lib/ws/uw-socket.ts"
        ]
      },
      {
        "path": "/api/socket/market_tide",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts",
          "src/lib/ws/uw-socket.ts"
        ]
      },
      {
        "path": "/api/socket/net_flow",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts",
          "src/lib/ws/uw-socket.ts"
        ]
      },
      {
        "path": "/api/socket/off_lit_trades",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts",
          "src/lib/ws/uw-socket.ts"
        ]
      },
      {
        "path": "/api/socket/trading_halts",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts",
          "src/lib/ws/uw-socket.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/atm-chains",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/balance-sheets",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/cash-flows",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/expiry-breakdown",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/financials",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/flow-alerts",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/market-wide.ts",
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/flow-per-expiry",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/flow-per-strike",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/flow-per-strike-intraday",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/flow-recent",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/fundamental-breakdown",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/gex-levels",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/greek-exposure/expiry",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/greek-exposure/strike",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/greek-flow/{param}",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/greeks",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/historical-risk-reversal-skew",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/income-statements",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/info",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/insider-buy-sells",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/interpolated-iv",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/iv-rank",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/max-pain",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/positioning.ts",
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/net-prem-ticks",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/nope",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/market-wide.ts",
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/ohlc/{param}",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/oi-change",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/dossier.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/oi-per-expiry",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/oi-per-strike",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/option-chains",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/option-contracts",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/option/stock-price-levels",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/option/volume-oi-expiry",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/options-volume",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/ownership",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/spot-exposures",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/spot-exposures/{param}/strike",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/spot-exposures/expiry-strike",
        "files": [
          "src/lib/nighthawk/market-wide.ts",
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/spot-exposures/strike",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/positioning.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/stock-state",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/technical-indicator/{param}",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/volatility/realized",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{param}/volatility/stats",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/dossier.ts",
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/flow-alerts",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/flow-per-expiry",
        "files": [
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/flow-per-strike-intraday",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/gex-levels",
        "files": [
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/greek-exposure/expiry",
        "files": [
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/greek-exposure/strike",
        "files": [
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/greek-flow",
        "files": [
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/implied-volatility-term-structure",
        "files": [
          "src/lib/api-provider-catalog.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/max-pain",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/net-prem-ticks",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/nope",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/oi-change",
        "files": [
          "src/lib/api-provider-catalog.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/spot-exposures",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/spot-exposures/expiry-strike",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/spot-exposures/strike",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/{ticker}/volatility/stats",
        "files": [
          "src/lib/api-provider-catalog.ts",
          "src/lib/live-api-integrations.ts"
        ]
      },
      {
        "path": "/api/stock/${sym(ticker)}/expiry-breakdown",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${sym(ticker)}/flow-per-strike",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${sym(ticker)}/fundamental-breakdown",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${sym(ticker)}/gex-levels",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${sym(ticker)}/greek-exposure/expiry",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${sym(ticker)}/ohlc/${candleSize}",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${sym(ticker)}/option-chains",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${sym(ticker)}/option/volume-oi-expiry",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${sym(ticker)}/ownership",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${sym(ticker)}/spot-exposures/${expiry}/strike",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${sym(ticker)}/spot-exposures/expiry-strike",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${sym(ticker)}/stock-state",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/atm-chains",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/balance-sheets",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/cash-flows",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/financials",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/flow-alerts",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/flow-per-expiry",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/nighthawk/dossier.ts",
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/flow-per-strike-intraday",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/flow-recent",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/greek-exposure/strike",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/greeks",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/historical-risk-reversal-skew",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/income-statements",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/info",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/insider-buy-sells",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/interpolated-iv",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/iv-rank",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/net-prem-ticks",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/oi-change",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/oi-per-expiry",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/oi-per-strike",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/option-contracts",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/option/stock-price-levels",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/options-volume",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/spot-exposures",
        "files": [
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/technical-indicator/${fn.toLowerCase()}",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker.toUpperCase()}/volatility/realized",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker}/flow-per-strike-intraday",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker}/max-pain",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker}/nope",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/spx-desk.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker}/spot-exposures/expiry-strike",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker}/spot-exposures/strike",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/stock/${ticker}/volatility/stats",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "/api/unusual-trades/recent",
        "files": [
          "src/lib/largo/run-tool.ts",
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "403",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      },
      {
        "path": "UW_API_KEY not set",
        "files": [
          "src/lib/providers/unusual-whales.ts"
        ]
      }
    ],
    "finnhub": [
      {
        "path": "/api/v1/calendar/earnings",
        "files": [
          "src/lib/providers/finnhub.ts"
        ]
      },
      {
        "path": "/api/v1/calendar/economic",
        "files": [
          "src/lib/providers/finnhub.ts"
        ]
      },
      {
        "path": "/api/v1/calendar/ipo",
        "files": [
          "src/lib/providers/finnhub.ts"
        ]
      },
      {
        "path": "/api/v1/quote",
        "files": [
          "src/lib/admin-api-dashboard.ts"
        ]
      }
    ],
    "anthropic": [
      {
        "path": "/v1/messages",
        "files": [
          "src/lib/providers/anthropic.ts"
        ]
      }
    ],
    "engine": [
      {
        "path": "/health",
        "files": [
          "src/app/api/engine/health/route.ts",
          "src/lib/admin-api-dashboard.ts"
        ]
      }
    ],
    "web_search": [
      {
        "path": "GET https://api.search.brave.com/res/v1/web/search",
        "files": [
          "src/lib/providers/web-search.ts"
        ]
      },
      {
        "path": "POST https://api.tavily.com/search",
        "files": [
          "src/lib/providers/web-search.ts"
        ]
      },
      {
        "path": "POST https://google.serper.dev/search",
        "files": [
          "src/lib/providers/web-search.ts"
        ]
      }
    ]
  },
  "clientCalls": [
    {
      "path": "/api/admin/apis/dashboard${qs}",
      "files": [
        "src/components/admin/AdminApiDashboard.tsx"
      ]
    },
    {
      "path": "/api/admin/apis/events/${encodeURIComponent(eventId)}",
      "files": [
        "src/components/admin/AdminApiEventDetail.tsx"
      ]
    },
    {
      "path": "/api/admin/apis/rescan",
      "files": [
        "src/components/admin/AdminApiDashboard.tsx"
      ]
    },
    {
      "path": "/api/admin/health",
      "files": [
        "src/components/admin/AdminHealthBanner.tsx"
      ]
    },
    {
      "path": "/api/admin/incidents",
      "files": [
        "src/components/admin/AdminSpxTerminal.tsx"
      ]
    },
    {
      "path": "/api/admin/me",
      "files": [
        "src/components/Nav.tsx"
      ]
    },
    {
      "path": "/api/admin/spx/dashboard${qs}",
      "files": [
        "src/components/admin/AdminSpxDashboard.tsx"
      ]
    },
    {
      "path": "/api/engine/health",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/engine/heatmap",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/engine/nighthawk/plays",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/flows${query ? ",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/health",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/heatmap",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/indices",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/largo/query",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/largo/session?session_id=${encodeURIComponent(sessionId)}",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/news",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/nighthawk/edition",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/nighthawk/hunt",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/nighthawk/play-explain",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/spx/commentary",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/spx/desk",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/spx/flow",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/spx/merged",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/spx/play",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/market/spx/pulse",
      "files": [
        "src/lib/api.ts"
      ]
    },
    {
      "path": "/api/membership/sync",
      "files": [
        "src/components/SyncMembershipButton.tsx"
      ]
    }
  ],
  "largoTools": [
    "get_analyst_ratings",
    "get_atm_chains",
    "get_company_profile",
    "get_congress_trades",
    "get_congress_unusual",
    "get_dark_pool",
    "get_dividends",
    "get_earnings",
    "get_earnings_history",
    "get_earnings_market",
    "get_economic_calendar",
    "get_etf_detail",
    "get_etf_flow",
    "get_fda_calendar",
    "get_financials",
    "get_flow_expiry_breakdown",
    "get_flow_per_strike",
    "get_flow_tape",
    "get_gex",
    "get_global_flow",
    "get_greek_flow",
    "get_greeks",
    "get_group_greek_flow",
    "get_insider_flow",
    "get_institutional",
    "get_ipo_calendar",
    "get_iv_stats",
    "get_iv_term_structure",
    "get_lit_flow",
    "get_lotto_state",
    "get_macro_indicator",
    "get_market_breadth",
    "get_market_context",
    "get_market_movers",
    "get_market_oi_change",
    "get_market_stats",
    "get_max_pain",
    "get_nbbo",
    "get_net_prem_ticks",
    "get_news",
    "get_nighthawk_edition",
    "get_nope",
    "get_oi_per_expiry",
    "get_oi_per_strike",
    "get_open_plays",
    "get_option_contract",
    "get_options_chain",
    "get_options_flow",
    "get_options_volume",
    "get_ownership",
    "get_peer_rs",
    "get_platform_snapshot",
    "get_postgres_flows",
    "get_predictions_consensus",
    "get_qqq_relative_strength",
    "get_quote",
    "get_realized_vol",
    "get_risk_reversal_skew",
    "get_screener",
    "get_seasonality",
    "get_sector_flow",
    "get_setup_stats",
    "get_short_data",
    "get_short_interest",
    "get_signal_log",
    "get_spx_play",
    "get_spx_structure",
    "get_stock_state",
    "get_technicals",
    "get_top_net_impact",
    "get_trade_history",
    "get_unusual_trades",
    "get_uw_bars",
    "get_uw_technicals",
    "get_vix_term",
    "get_vol_anomaly",
    "get_volatility_regime",
    "get_web_search"
  ]
} as const;
export type CursorApiAnalysis = typeof CURSOR_API_ANALYSIS;
