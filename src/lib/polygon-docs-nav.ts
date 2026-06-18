/** Internal reference nav — extend as official Polygon/Massive docs are added. */

export type PolygonDocLink = {
  href: string;
  label: string;
  description?: string;
};

export type PolygonDocSection = {
  id: string;
  title: string;
  links: PolygonDocLink[];
};

export const POLYGON_DOCS_SECTIONS: PolygonDocSection[] = [
  {
    id: "overview",
    title: "Overview",
    links: [
      { href: "/docs/polygon", label: "Introduction", description: "Plans, base URLs, BlackOut usage" },
      { href: "/docs/claude-api-analysis", label: "Full API Catalog", description: "All external endpoints across every provider — Polygon, UW, Finnhub, Anthropic" },
      { href: "/docs/api-probe", label: "Live Probe Results", description: "End-to-end HTTP probe of every endpoint — 403/422 failures, usage gaps, opportunities" },
      { href: "/docs/system-analysis", label: "System Analysis", description: "Full architecture audit — rate limits, WebSocket strategy, improvement roadmap" },
    ],
  },
  {
    id: "websocket",
    title: "WebSocket",
    links: [
      {
        href: "/docs/polygon/websocket/stocks",
        label: "Stocks",
        description: "AM · A · T · Q · LULD · NOI · FMV",
      },
      {
        href: "/docs/polygon/websocket/options",
        label: "Options",
        description: "AM · A · T · Q · FMV",
      },
      {
        href: "/docs/polygon/websocket/indices",
        label: "Indices",
        description: "AM · A · V",
      },
      // Future: forex, crypto
    ],
  },
  {
    id: "rest",
    title: "REST API",
    links: [
      {
        href: "/docs/polygon/rest/stocks",
        label: "Stocks",
        description: "Tickers · Aggs · Snapshots · Filings",
      },
      {
        href: "/docs/polygon/rest/options",
        label: "Options",
        description: "Contracts · Chains · Greeks · Aggs",
      },
      {
        href: "/docs/polygon/rest/indices",
        label: "Indices",
        description: "SPX · VIX · Aggs · Snapshots",
      },
      {
        href: "/docs/polygon/rest/benzinga",
        label: "Benzinga",
        description: "Real-time news",
      },
    ],
  },
];

export const MASSIVE_DOCS_BASE = "https://massive.com/docs";
export const MASSIVE_WS_STOCKS = "wss://socket.massive.com/stocks";
export const MASSIVE_WS_OPTIONS = "wss://socket.massive.com/options";
export const MASSIVE_WS_INDICES = "wss://socket.massive.com/indices";
export const MASSIVE_REST_BASE = "https://api.massive.com";
