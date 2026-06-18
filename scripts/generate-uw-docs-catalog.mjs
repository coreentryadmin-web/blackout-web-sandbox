/**
 * Generates src/lib/uw-docs-catalog.ts from official UW docs index.
 * Run: node scripts/generate-uw-docs-catalog.mjs
 */
import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_URL = "https://api.unusualwhales.com/docs";

/** Paths used in src/lib/providers/unusual-whales.ts (normalized) */
const BLACKOUT_PATHS = new Set([
  "/api/stock/{ticker}/spot-exposures/expiry-strike",
  "/api/stock/{ticker}/max-pain",
  "/api/market/market-tide",
  "/api/stock/{ticker}/nope",
  "/api/stock/{ticker}/volatility/stats",
  "/api/stock/{ticker}/flow-per-strike-intraday",
  "/api/option-trades/flow-alerts",
  "/api/darkpool/{ticker}",
  "/api/stock/{ticker}/spot-exposures/strike",
  "/api/stock/{ticker}/flow-alerts",
  "/api/stock/{ticker}/net-prem-ticks",
  "/api/stock/{ticker}/oi-change",
  "/api/stock/{ticker}/volatility/term-structure",
  "/api/stock/{ticker}/flow-per-strike-intraday",
  "/api/stock/{ticker}/oi-per-strike",
  "/api/stock/{ticker}/greeks",
  "/api/market/{sector}/sector-tide",
  "/api/stock/{ticker}/insider-buy-sells",
  "/api/congress/recent-trades",
  "/api/shorts/{ticker}/interest-float/v2",
  "/api/shorts/screener",
  "/api/stock/{ticker}/flow-per-expiry",
  "/api/stock/{ticker}/info",
  "/api/earnings/{ticker}",
  "/api/screener/stocks",
  "/api/unusual-trades/recent",
  "/api/news/headlines",
  "/api/market/movers",
  "/api/market/top-net-impact",
  "/api/market/oi-change",
  "/api/stock/{ticker}/atm-chains",
  "/api/stock/{ticker}/oi-per-expiry",
  "/api/stock/{ticker}/options-volume",
  "/api/etfs/{ticker}/in-outflow",
  "/api/market/{ticker}/etf-tide",
  "/api/lit-flow/{ticker}",
  "/api/screener/option-contracts",
  "/api/seasonality/{ticker}/monthly",
  "/api/congress/late-reports",
  "/api/shorts/{ticker}/volume-and-ratio",
  "/api/shorts/{ticker}/ftds",
  "/api/stock/{ticker}/volatility/anomaly",
  "/api/stock/{ticker}/volatility/character",
  "/api/stock/{ticker}/volatility/realized",
  "/api/volatility/anomaly/top",
  "/api/insider/transactions",
  "/api/market/fda-calendar",
  "/api/companies/{ticker}/earnings-estimates",
  "/api/option-contract/{id}/flow",
  "/api/stock/{ticker}/option-contracts",
  "/api/stock/{ticker}/flow-recent",
  "/api/stock/{ticker}/interpolated-iv",
  "/api/stock/{ticker}/greek-exposure/strike",
  "/api/darkpool/recent",
  "/api/screener/option-contracts",
  "/api/stock/{ticker}/financials",
  "/api/stock/{ticker}/income-statements",
  "/api/stock/{ticker}/balance-sheets",
  "/api/stock/{ticker}/cash-flows",
  "/api/stock/{ticker}/technical-indicator/{function}",
  "/api/stock/{ticker}/iv-rank",
  "/api/stock/{ticker}/gex-levels",
  "/api/stock/{ticker}/greek-flow",
  "/api/stock/{ticker}/greek-flow/{expiry}",
  "/api/stock/{ticker}/spot-exposures/{expiry}/strike",
  "/api/stock/{ticker}/greek-exposure/expiry",
  "/api/stock/{ticker}/stock-state",
  "/api/stock/{ticker}/flow-per-strike",
  "/api/lit-flow/recent",
  "/api/market/total-options-volume",
  "/api/market/correlations",
  "/api/market/economic-calendar",
  "/api/volatility/vix-term-structure",
  "/api/volatility/character/top",
  "/api/stock/{ticker}/volatility/variance-risk-premium",
  "/api/earnings/premarket",
  "/api/earnings/afterhours",
  "/api/stock/{ticker}/option-chains",
  "/api/stock/{ticker}/ownership",
  "/api/stock/{ticker}/ohlc/{candle_size}",
  "/api/option-contract/{id}/intraday",
  "/api/option-contract/{id}/volume-profile",
  "/api/insider/{ticker}",
  "/api/insider/{sector}/sector-flow",
  "/api/congress/unusual-trades",
  "/api/congress/politicians",
  "/api/etfs/{ticker}/holdings",
  "/api/etfs/{ticker}/exposure",
  "/api/etfs/{ticker}/info",
  "/api/etfs/{ticker}/weights",
  "/api/institution/{name}/activity",
  "/api/institution/{name}/holdings",
  "/api/institutions/latest_filings",
  "/api/institution/{ticker}/ownership",
  "/api/net-flow/expiry",
  "/api/companies/{ticker}/dividends",
  "/api/companies/{ticker}/splits",
  "/api/companies/{ticker}/profile",
  "/api/seasonality/market",
  "/api/market/sector-etfs",
  "/api/screener/analysts",
  "/api/shorts/{ticker}/data",
  "/api/shorts/{ticker}/volumes-by-exchange",
  "/api/stock/{ticker}/fundamental-breakdown",
  "/api/stock/{ticker}/expiry-breakdown",
  "/api/stock/{ticker}/option/volume-oi-expiry",
]);

/** Map legacy paths in codebase to official catalog paths */
const PATH_ALIASES = {
  "/api/etf/{ticker}/in-outflow": "/api/etfs/{ticker}/in-outflow",
  "/api/etf/{ticker}/tide": "/api/market/{ticker}/etf-tide",
  "/api/shorts/screener": "/api/short_screener",
  "/api/unusual-trades/recent": "/api/congress/unusual-trades",
  "/api/stock/{ticker}/implied-volatility-term-structure": "/api/stock/{ticker}/volatility/term-structure",
};

function slugify(category) {
  return category
    .toLowerCase()
    .replace(/\//g, "-")
    .replace(/_/g, "-");
}

function titleCase(category) {
  if (category === "Gex/Greeks") return "GEX / Greeks";
  return category
    .split(/[/_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const localPath = join(__dirname, "uw-docs-index.md");
let text = readFileSync(localPath, "utf8").replace(/\r\n/g, "\n");
// Refresh index: curl.exe -sL "https://api.unusualwhales.com/docs" -o scripts/uw-docs-index.md

function parseDocs(raw) {
  const sections = [];
  const parts = raw.split("\n### ").slice(1);

  for (const part of parts) {
    const nl = part.indexOf("\n");
    const category = nl === -1 ? part.trim() : part.slice(0, nl).trim();
    const body = nl === -1 ? "" : part.slice(nl + 1);
    const endpoints = [];

    for (const line of body.split("\n")) {
      if (!line.includes("| `GET` |")) continue;
      const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cols.length < 4) continue;
      const path = cols[1].replace(/^`|`$/g, "");
      const name = cols[2];
      const operationId = cols[3].replace(/^`|`$/g, "");
      const deprecated = /deprecated/i.test(name);
      endpoints.push({
        name,
        method: "GET",
        path,
        operationId,
        deprecated,
        blackout: BLACKOUT_PATHS.has(path),
        docUrl: `https://api.unusualwhales.com/docs/operations/${operationId}`,
      });
    }

    if (endpoints.length) {
      sections.push({
        id: slugify(category),
        title: titleCase(category),
        categoryKey: category,
        endpoints,
      });
    }
  }

  return sections;
}

const sections = parseDocs(text);

// Mark aliases used in codebase
for (const s of sections) {
  for (const ep of s.endpoints) {
    for (const [legacy, official] of Object.entries(PATH_ALIASES)) {
      if (ep.path === official) ep.blackout = ep.blackout || BLACKOUT_PATHS.has(legacy);
    }
  }
}

const total = sections.reduce((n, s) => n + s.endpoints.length, 0);
const blackoutCount = sections.reduce(
  (n, s) => n + s.endpoints.filter((e) => e.blackout).length,
  0
);

const out = `/** Auto-generated from ${DOCS_URL} — run: node scripts/generate-uw-docs-catalog.mjs */

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

export const UW_REST_SECTIONS: UwEndpointSection[] = ${JSON.stringify(sections, null, 2)};

export const UW_REST_TOC = UW_REST_SECTIONS.map((s) => ({
  id: s.id,
  title: s.title,
  count: s.endpoints.length,
}));

export const UW_ENDPOINT_TOTAL = ${total};
export const UW_BLACKOUT_ENDPOINT_COUNT = ${blackoutCount};
`;

const target = join(__dirname, "..", "src", "lib", "uw-docs-catalog.ts");
writeFileSync(target, out, "utf8");
console.log(`Wrote ${target} — ${sections.length} categories, ${total} endpoints (${blackoutCount} used in BlackOut)`);
