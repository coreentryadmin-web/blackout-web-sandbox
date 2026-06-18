#!/usr/bin/env node
/**
 * Live Polygon/Massive API probe — uses POLYGON_API_KEY from .env.local only.
 * Run: node scripts/probe-polygon.mjs
 * Never prints the API key.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");

function loadEnvFile(filename) {
  try {
    const raw = readFileSync(join(root, filename), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

function loadEnvLocal() {
  for (const f of [".env.local", ".env", ".env.development.local"]) {
    loadEnvFile(f);
  }
}

loadEnvLocal();

const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const KEY = (process.env.POLYGON_API_KEY ?? process.env.MASSIVE_API_KEY ?? "").trim();

if (!KEY) {
  console.error("POLYGON_API_KEY not found.");
  console.error("Add to blackout-web/.env.local (do NOT paste in chat):");
  console.error("  POLYGON_API_KEY=your_key_here   # or MASSIVE_API_KEY");
  console.error("  POLYGON_API_BASE=https://api.massive.com   # optional");
  console.error("Then run: node scripts/probe-polygon.mjs");
  process.exit(1);
}

function etYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function priorYmd(days = 5) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function probe(plan, name, path, params = {}) {
  const qs = new URLSearchParams({ ...params, apiKey: KEY });
  const url = `${BASE}${path}?${qs}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const ms = Date.now() - started;
    let body = null;
    let text = "";
    try {
      text = await res.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    const status = res.status;
    let note = "";
    if (body?.status === "ERROR" || body?.error) {
      note = String(body.error ?? body.message ?? "API error").slice(0, 120);
    } else if (Array.isArray(body?.results)) {
      note = `${body.results.length} results`;
      const first = body.results[0];
      if (first?.ticker) note += ` · e.g. ${first.ticker}`;
      if (first?.title) note += ` · "${String(first.title).slice(0, 40)}…"`;
      if (first?.details?.strike_price) note += ` · strike ${first.details.strike_price}`;
    } else if (Array.isArray(body?.tickers)) {
      note = `${body.tickers.length} tickers`;
    } else if (body?.ticker?.ticker) {
      note = `${body.ticker.ticker} $${body.ticker.day?.c ?? body.ticker.lastTrade?.p ?? "?"}`;
    } else if (body?.results && typeof body.results === "object" && !Array.isArray(body.results)) {
      note = "object results";
    } else if (body?.market != null) {
      note = `market=${body.market}`;
    } else if (status === 200) {
      note = "OK";
    }

    const ok = status >= 200 && status < 300 && body?.status !== "ERROR" && !body?.error;
    return { plan, name, path, status, ok, ms, note, blocked: status === 403 || status === 401 };
  } catch (err) {
    return {
      plan,
      name,
      path,
      status: 0,
      ok: false,
      ms: Date.now() - started,
      note: err instanceof Error ? err.message : "fetch failed",
      blocked: false,
    };
  }
}

const today = etYmd();
const from = priorYmd(7);

const probes = [
  // ── Stocks Advanced ──
  ["stocks", "Stock snapshot (NVDA)", "/v2/snapshot/locale/us/markets/stocks/tickers/NVDA", {}],
  ["stocks", "Stock snapshot batch", "/v2/snapshot/locale/us/markets/stocks/tickers", { "ticker.any_of": "NVDA,AAPL" }],
  ["stocks", "Daily aggs (NVDA)", `/v2/aggs/ticker/NVDA/range/1/day/${from}/${today}`, { limit: "5", sort: "desc" }],
  ["stocks", "Minute aggs (NVDA)", `/v2/aggs/ticker/NVDA/range/1/minute/${today}/${today}`, { limit: "10", sort: "desc" }],
  ["stocks", "Previous day bar", "/v2/aggs/ticker/NVDA/prev", {}],
  ["stocks", "Last NBBO", "/v2/last/nbbo/NVDA", {}],
  ["stocks", "Last trade", "/v2/last/trade/NVDA", {}],
  ["stocks", "Open/close daily", `/v1/open-close/NVDA/${priorYmd(1)}`, {}],
  ["stocks", "Gainers snapshot", "/v2/snapshot/locale/us/markets/stocks/gainers", {}],
  ["stocks", "Losers snapshot", "/v2/snapshot/locale/us/markets/stocks/losers", {}],
  ["stocks", "Ticker details v3", "/v3/reference/tickers/NVDA", {}],
  ["stocks", "Related tickers", "/v3/reference/tickers/NVDA/related", {}],
  ["stocks", "Short interest v1", "/stocks/v1/short-interest", { ticker: "NVDA", limit: "5" }],
  ["stocks", "Short volume v1", "/stocks/v1/short-volume", { ticker: "NVDA", limit: "5" }],
  ["stocks", "Float v1", "/stocks/v1/float", { ticker: "NVDA" }],
  ["stocks", "RSI indicator", "/v1/indicators/rsi/NVDA", { timespan: "day", window: "14", series_type: "close" }],
  ["stocks", "MACD indicator", "/v1/indicators/macd/NVDA", { timespan: "day", short_window: "12", long_window: "26", signal_window: "9", series_type: "close" }],
  ["stocks", "EMA indicator", "/v1/indicators/ema/NVDA", { timespan: "day", window: "20", series_type: "close" }],

  // ── Indices Advanced ──
  ["indices", "Index snapshot batch", "/v3/snapshot/indices", { "ticker.any_of": "I:SPX,I:VIX,I:VIX9D,I:VIX3M" }],
  ["indices", "SPX daily aggs", `/v2/aggs/ticker/I:SPX/range/1/day/${from}/${today}`, { limit: "5", sort: "desc" }],
  ["indices", "VIX daily aggs", `/v2/aggs/ticker/I:VIX/range/1/day/${from}/${today}`, { limit: "5", sort: "desc" }],
  ["indices", "SPX minute aggs", `/v2/aggs/ticker/I:SPX/range/1/minute/${today}/${today}`, { limit: "10", sort: "desc" }],
  ["indices", "SPX EMA indicator", "/v1/indicators/ema/I:SPX", { timespan: "day", window: "20", series_type: "close" }],

  // ── Options Advanced ──
  ["options", "Options chain snapshot (NVDA)", "/v3/snapshot/options/NVDA", {
    expiration_date: today,
    limit: "50",
  }],
  ["options", "SPX 0DTE snapshot", "/v3/snapshot/options/SPX", {
    expiration_date: today,
    limit: "50",
  }],
  ["options", "SPXW 0DTE snapshot", "/v3/snapshot/options/SPXW", {
    expiration_date: today,
    limit: "50",
  }],
  ["options", "Options contracts ref", "/v3/reference/options/contracts", {
    underlying_ticker: "NVDA",
    expired: "false",
    limit: "50",
    sort: "expiration_date",
    order: "asc",
  }],
  ["options", "Options trades (recent)", "/v3/trades/options/NVDA", { limit: "5", order: "desc" }],
  ["options", "Options quotes (recent)", "/v3/quotes/options/NVDA", { limit: "5", order: "desc" }],

  // ── Benzinga ──
  ["benzinga", "Benzinga news (market)", "/benzinga/v2/news", { limit: "5", sort: "published.desc" }],
  ["benzinga", "Benzinga news (NVDA)", "/benzinga/v2/news", {
    limit: "5",
    sort: "published.desc",
    "tickers.any_of": "NVDA",
  }],

  // ── Market / shared ──
  ["market", "Market status now", "/v1/marketstatus/now", {}],
  ["market", "Market status upcoming", "/v1/marketstatus/upcoming", {}],
  ["market", "Polygon news v2", "/v2/reference/news", { limit: "5", ticker: "NVDA" }],
];

console.log(`\nPolygon/Massive live probe`);
console.log(`Base: ${BASE}`);
console.log(`Date (ET): ${today}\n`);

const results = [];
for (const [plan, name, path, params] of probes) {
  const r = await probe(plan, name, path, params);
  results.push(r);
  const icon = r.ok ? "✓" : r.blocked ? "✗" : "⚠";
  console.log(`${icon} [${r.plan.padEnd(8)}] ${r.status} ${String(r.ms).padStart(4)}ms  ${name}`);
  if (!r.ok && r.note) console.log(`         └─ ${r.note}`);
  await new Promise((res) => setTimeout(res, 120));
}

const byPlan = {};
for (const r of results) {
  byPlan[r.plan] ??= { ok: 0, fail: 0, blocked: 0 };
  if (r.ok) byPlan[r.plan].ok += 1;
  else if (r.blocked) byPlan[r.plan].blocked += 1;
  else byPlan[r.plan].fail += 1;
}

console.log("\n── Summary by plan ──");
for (const [plan, s] of Object.entries(byPlan)) {
  console.log(`  ${plan}: ${s.ok} ok · ${s.fail} fail · ${s.blocked} auth/plan blocked`);
}

const blocked = results.filter((r) => r.blocked);
const failed = results.filter((r) => !r.ok && !r.blocked);

if (blocked.length) {
  console.log("\n── Plan / auth blocked (403/401) ──");
  for (const r of blocked) console.log(`  ${r.name} → ${r.path}`);
}

if (failed.length) {
  console.log("\n── Other failures ──");
  for (const r of failed) console.log(`  ${r.status} ${r.name}: ${r.note}`);
}

console.log("\n── Already wired in blackout-web vs probe-only ──");
const wired = new Set([
  "/v2/snapshot/locale/us/markets/stocks/tickers/",
  "/v2/aggs/ticker/",
  "/v3/snapshot/indices",
  "/v3/snapshot/options/",
  "/v3/reference/options/contracts",
  "/benzinga/v2/news",
  "/v2/reference/news",
  "/v1/marketstatus/",
  "/v1/indicators/",
  "/stocks/v1/short",
  "/stocks/v1/float",
  "/v2/last/",
  "/v3/reference/tickers/",
]);

const notWired = results.filter(
  (r) => r.ok && !wired.has(r.path) && ![...wired].some((w) => r.path.startsWith(w.replace(/\/$/, "")))
);
if (notWired.length) {
  for (const r of notWired) console.log(`  NEW: ${r.name} (${r.path})`);
} else {
  console.log("  All successful probes map to existing provider usage or subpaths.");
}

process.exit(failed.length + blocked.length > 0 ? 0 : 0);
