/**
 * Scans src/ for API routes and external endpoint usage.
 * Run: node scripts/analyze-api-usage.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "src");

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const SKIP_PREFIXES = [
  "src/app/docs/",
  "src/components/docs/",
  "src/lib/polygon-docs-",
  "src/lib/uw-docs-",
  "src/lib/cursor-api-analysis-data.ts",
];

function shouldScan(r) {
  return !SKIP_PREFIXES.some((p) => r.startsWith(p) || r.includes(p));
}

function rel(p) {
  return relative(join(__dirname, ".."), p).replace(/\\/g, "/");
}

function scanFile(r) {
  return shouldScan(r);
}

function add(map, key, file) {
  if (!scanFile(file)) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(file);
}

const files = walk(ROOT);
const internalRoutes = [];
const polygon = new Map();
const uw = new Map();
const finnhub = new Map();
const anthropic = new Map();
const engine = new Map();
const webSearch = new Map();
const clientCalls = new Map();
const largoTools = [];

for (const f of files) {
  const t = readFileSync(f, "utf8");
  const r = rel(f);

  if (r.match(/^src\/app\/api\/.*\/route\.ts$/)) {
    const path = r.replace("src/app", "").replace("/route.ts", "");
    const methods = [...t.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)/g)].map(
      (m) => m[1]
    );
    if (!methods.length) methods.push("GET");
    for (const method of [...new Set(methods)]) {
      internalRoutes.push({ method, path, file: r });
    }
  }

  for (const m of t.matchAll(/polygonGet\b[\s\S]*?\(\s*["'`]([^"'`]+)["'`]/g)) {
    add(polygon, m[1], r);
  }
  for (const m of t.matchAll(/uwGetSafe\b[\s\S]*?\(\s*["'`]([^"'`]+)["'`]/g)) {
    add(uw, m[1], r);
  }
  for (const m of t.matchAll(/uwGet\b[\s\S]*?\(\s*["'`]([^"'`]+)["'`]/g)) {
    if (m[0].includes("uwGetSafe")) continue;
    add(uw, m[1], r);
  }
  for (const m of t.matchAll(/template\s*`([^`]+)`/g)) {
    if (r.includes("unusual-whales")) {
      const paths = m[1].match(/\/api\/[^\s`$]+/g) ?? [];
      for (const p of paths) add(uw, p.replace(/\$\{[^}]+\}/g, "{param}"), r);
    }
  }
  for (const m of t.matchAll(/["'`](\/v[0-9][^"'`]+)["'`]/g)) {
    if (/polygon|gap-proxy|spx-play|spx-lotto|options-gex/.test(r)) {
      add(polygon, m[1], r);
    }
  }
  for (const m of t.matchAll(/["'`](\/benzinga[^"'`]+)["'`]/g)) add(polygon, m[1], r);
  for (const m of t.matchAll(/["'`](\/stocks\/[^"'`]+)["'`]/g)) {
    if (/polygon/.test(r)) add(polygon, m[1], r);
  }
  for (const m of t.matchAll(/finnhubGet(?:<[^>]*>)?\(\s*["'`]([^"'`]+)["'`]/g)) {
    add(finnhub, "/api/v1" + m[1], r);
  }
  for (const m of t.matchAll(/["'`](\/calendar\/[^"'`]+)["'`]/g)) {
    if (r.includes("finnhub")) add(finnhub, "/api/v1" + m[1], r);
  }
  for (const m of t.matchAll(/["'`](\/quote)["'`]/g)) {
    if (r.includes("finnhub") || r.includes("admin-api-dashboard")) add(finnhub, "/api/v1" + m[1], r);
  }
  for (const m of t.matchAll(/api\.anthropic\.com(\/v1\/messages)/g)) add(anthropic, m[1], r);
  for (const m of t.matchAll(/fetchEngine\(\s*["'`]([^"'`]+)["'`]/g)) add(engine, m[1], r);
  for (const m of t.matchAll(/api\.tavily\.com\/search/g)) add(webSearch, "POST https://api.tavily.com/search", r);
  for (const m of t.matchAll(/google\.serper\.dev\/search/g)) add(webSearch, "POST https://google.serper.dev/search", r);
  for (const m of t.matchAll(/api\.search\.brave\.com\/res\/v1\/web\/search/g)) {
    add(webSearch, "GET https://api.search.brave.com/res/v1/web/search", r);
  }
  for (const m of t.matchAll(/marketFetch(?:<[^>]*>)?\(\s*["'`]([^"'`]+)["'`]/g)) {
    add(clientCalls, "/api/market" + m[1], r);
  }
  for (const m of t.matchAll(/intelFetch(?:<[^>]*>)?\(\s*["'`]([^"'`]+)["'`]/g)) {
    add(clientCalls, "/api/engine" + m[1], r);
  }
  for (const m of t.matchAll(/fetch\(\s*["'`](\/api\/[^"'`]+)["'`]/g)) {
    if (scanFile(r)) add(clientCalls, m[1], r);
  }
  for (const m of t.matchAll(/createFlowEventSource\(\)/g)) {
    if (scanFile(r)) add(clientCalls, "/api/market/flows/stream (SSE)", r);
  }
  if (r.includes("run-tool.ts") && scanFile(r)) {
    for (const m of t.matchAll(/case\s+"([^"]+)":/g)) largoTools.push(m[1]);
  }
}

function mapToArr(m) {
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([path, filesSet]) => ({ path, files: [...filesSet].sort() }));
}

const analysis = {
  generatedAt: new Date().toISOString(),
  summary: {
    internalRoutes: internalRoutes.length,
    polygonEndpoints: polygon.size,
    uwEndpoints: uw.size,
    finnhubEndpoints: finnhub.size,
    anthropicEndpoints: anthropic.size,
    engineEndpoints: engine.size,
    webSearchEndpoints: webSearch.size,
    clientCalls: clientCalls.size,
    largoTools: [...new Set(largoTools)].length,
  },
  internalRoutes: internalRoutes.sort((a, b) => a.path.localeCompare(b.path)),
  external: {
    polygon: mapToArr(polygon),
    unusual_whales: mapToArr(uw),
    finnhub: mapToArr(finnhub),
    anthropic: mapToArr(anthropic),
    engine: mapToArr(engine),
    web_search: mapToArr(webSearch),
  },
  clientCalls: mapToArr(clientCalls),
  largoTools: [...new Set(largoTools)].sort(),
};

const outPath = join(__dirname, "..", "src", "lib", "cursor-api-analysis-data.ts");
const body = `/** Auto-generated — run: node scripts/analyze-api-usage.mjs */
export const CURSOR_API_ANALYSIS = ${JSON.stringify(analysis, null, 2)} as const;
export type CursorApiAnalysis = typeof CURSOR_API_ANALYSIS;
`;
writeFileSync(outPath, body, "utf8");
console.log("Wrote", outPath);
console.log(JSON.stringify(analysis.summary, null, 2));
