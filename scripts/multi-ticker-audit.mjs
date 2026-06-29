#!/usr/bin/env node
/**
 * Multi-ticker deep audit — 20 names × quote + GEX positioning + heatmap matrix,
 * cross-checked against Polygon oracle. Runs multiple passes for stability.
 *
 * Usage:
 *   node scripts/multi-ticker-audit.mjs [--passes=3] [--base=https://blackouttrades.com]
 *
 * Requires: CRON_SECRET, POLYGON_API_KEY (or MASSIVE_API_KEY)
 */
const baseArg = process.argv.find((a) => a.startsWith("--base="));
const passesArg = process.argv.find((a) => a.startsWith("--passes="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(/\/$/, "");
const PASSES = Math.max(1, Number(passesArg?.slice("--passes=".length) ?? 3) || 3);
const CRON = process.env.CRON_SECRET;
const POLY_KEY = process.env.POLYGON_API_KEY ?? process.env.MASSIVE_API_KEY ?? "";
const POLY_BASE = (process.env.POLYGON_API_BASE ?? "https://api.polygon.io").replace(/\/$/, "");

/** 20 liquid names — indices + mega-cap + sector ETFs + metals */
const TICKERS = [
  "SPX", "SPY", "QQQ", "IWM", "VIX",
  "NVDA", "AAPL", "TSLA", "AMD", "MSFT",
  "META", "AMZN", "GOOGL", "NFLX", "AVGO",
  "MU", "SMH", "GLD", "SLV", "COIN",
];

const INDEX_MAP = { SPX: "I:SPX", VIX: "I:VIX", NDX: "I:NDX", RUT: "I:RUT" };

if (!CRON) {
  console.error("CRON_SECRET required");
  process.exit(1);
}

const H = { Authorization: `Bearer ${CRON}`, Accept: "application/json" };

const issues = [];
const passResults = [];

function fail(ticker, check, detail, severity = "P1") {
  issues.push({ ticker, check, detail, severity });
}

function pctDiff(a, b) {
  const mid = (Math.abs(a) + Math.abs(b)) / 2;
  if (!(mid > 0)) return 0;
  return (Math.abs(a - b) / mid) * 100;
}

function scanJson(obj, path = "") {
  const bad = [];
  if (obj === null || obj === undefined) return bad;
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) bad.push(`${path}: non-finite`);
    return bad;
  }
  if (typeof obj === "string" && /\b(NaN|undefined|\[object Object\])\b/.test(obj)) {
    bad.push(`${path}: malformed string`);
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => bad.push(...scanJson(v, `${path}[${i}]`)));
  } else if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) bad.push(...scanJson(v, path ? `${path}.${k}` : k));
  }
  return bad;
}

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: H });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { status: res.status, data: null, error: "invalid JSON" };
  }
  return { status: res.status, data };
}

async function polygonOracle(ticker) {
  if (!POLY_KEY) return null;
  const idx = INDEX_MAP[ticker];
  if (idx) {
    const url = `${POLY_BASE}/v3/snapshot/indices?ticker.any_of=${encodeURIComponent(idx)}&apiKey=${POLY_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const row = j.results?.[0];
    const price = Number(row?.value ?? row?.session?.close ?? 0);
    return price > 0 ? price : null;
  }
  const url = `${POLY_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLY_KEY}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  const price = Number(j.ticker?.lastTrade?.p ?? j.ticker?.day?.c ?? j.ticker?.prevDay?.c ?? 0);
  return price > 0 ? price : null;
}

function validateGex(ticker, gex, quote, oracle, heatmap) {
  const rows = [];
  if (!gex?.available && gex?.spot == null && !gex?.ticker) {
    if (gex?.available === false) {
      rows.push({ check: "gex-available", ok: true, note: "honest unavailable" });
      return rows;
    }
  }

  const spot = Number(gex?.spot ?? gex?.spot_price ?? 0);
  const quotePrice = quote?.available ? Number(quote.price) : null;
  const hmSpot = heatmap?.spot != null ? Number(heatmap.spot) : null;

  if (!(spot > 0) || !Number.isFinite(spot)) {
    fail(ticker, "gex-spot", `invalid spot ${gex?.spot}`, "P0");
    rows.push({ check: "gex-spot", ok: false });
    return rows;
  }
  rows.push({ check: "gex-spot", ok: true, value: spot });

  if (oracle && oracle > 0) {
    const d = pctDiff(spot, oracle);
    const tol = ticker === "SPX" || ticker === "VIX" ? 0.15 : 1.0;
    if (d > tol) fail(ticker, "oracle-spot", `GEX spot ${spot} vs Polygon ${oracle.toFixed(2)} — ${d.toFixed(2)}%`, "P0");
    rows.push({ check: "oracle", ok: d <= tol, gex: spot, oracle, deltaPct: d.toFixed(3) });
  }

  if (quotePrice && quotePrice > 0) {
    const d = pctDiff(spot, quotePrice);
    if (d > 1.5) fail(ticker, "quote-vs-gex", `quote ${quotePrice} vs gex ${spot} — ${d.toFixed(2)}%`, "P1");
    rows.push({ check: "quote-vs-gex", ok: d <= 1.5, quote: quotePrice, gex: spot, deltaPct: d.toFixed(3) });
  }

  if (hmSpot && hmSpot > 0) {
    const d = pctDiff(spot, hmSpot);
    if (d > 0.5) fail(ticker, "heatmap-vs-gex", `heatmap spot ${hmSpot} vs gex ${spot} — ${d.toFixed(2)}%`, "P1");
    rows.push({ check: "heatmap-vs-gex", ok: d <= 0.5, heatmap: hmSpot, gex: spot, deltaPct: d.toFixed(3) });
  }

  const netGex = Number(gex?.net_gex ?? gex?.netGex ?? NaN);
  if (!Number.isFinite(netGex)) fail(ticker, "net-gex", `non-finite net_gex`, "P0");
  else rows.push({ check: "net-gex", ok: true, value: netGex });

  for (const [label, v] of [
    ["flip", gex?.flip ?? gex?.gamma_flip],
    ["call_wall", gex?.call_wall ?? gex?.callWall],
    ["put_wall", gex?.put_wall ?? gex?.putWall],
  ]) {
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) fail(ticker, label, `non-finite ${label}`, "P0");
    else if (n <= 0) fail(ticker, label, `${label}=${n} not positive`, "P2");
    else {
      const dist = Math.abs(n - spot) / spot;
      if (dist > 0.5 && ticker !== "SPX") {
        fail(ticker, label, `${label}=${n} >50% from spot ${spot}`, "P2");
      }
      rows.push({ check: label, ok: true, value: n });
    }
  }

  const pct = Number(gex?.change_pct ?? quote?.change_pct ?? 0);
  if (Number.isFinite(pct) && Math.abs(pct) > 40) {
    fail(ticker, "change-pct", `change_pct ${pct}% out of day bounds`, "P2");
  }

  return rows;
}

async function auditTicker(ticker) {
  const [gexR, quoteR, hmR, flowsR, oracle] = await Promise.all([
    fetchJson(`/api/market/gex-positioning?ticker=${ticker}`),
    fetchJson(`/api/market/quote?ticker=${ticker}`),
    fetchJson(`/api/market/gex-heatmap?ticker=${ticker}&lens=gex`),
    fetchJson(`/api/market/flows?ticker=${ticker}&limit=50&since_hours=24`),
    polygonOracle(ticker),
  ]);

  if (gexR.status === 401) fail(ticker, "auth", "gex-positioning 401", "P0");
  if (quoteR.status === 401) fail(ticker, "auth", "quote 401", "P0");

  for (const [name, r] of [
    ["gex", gexR],
    ["quote", quoteR],
    ["heatmap", hmR],
    ["flows", flowsR],
  ]) {
    if (!r.data) continue;
    const bad = scanJson(r.data);
    if (bad.length) fail(ticker, `malformed-${name}`, bad.slice(0, 3).join("; "), "P0");
  }

  const gex = gexR.data;
  const quote = quoteR.data;
  const heatmap = hmR.data?.matrix ? hmR.data : hmR.data?.gex ? hmR.data : hmR.data;

  const checks = validateGex(ticker, gex, quote, oracle, heatmap);

  // Flows partition sanity
  const flows = flowsR.data?.flows ?? [];
  if (Array.isArray(flows) && flows.length > 0) {
    let badPrem = 0;
    for (const f of flows) {
      const p = Number(f.premium ?? f.total_premium ?? 0);
      if (!Number.isFinite(p) || p < 0) badPrem++;
    }
    if (badPrem) fail(ticker, "flows-premium", `${badPrem} rows with bad premium`, "P1");
    checks.push({ check: "flows-count", ok: true, count: flows.length });
  }

  return {
    ticker,
    spot: gex?.spot ?? quote?.price ?? null,
    oracle,
    checks,
    available: gex?.available !== false && (gex?.spot > 0 || quote?.available),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

console.log(`\n=== Multi-Ticker Deep Audit ===`);
console.log(`Target: ${BASE}`);
console.log(`Tickers: ${TICKERS.length} | Passes: ${PASSES}\n`);

const spotHistory = new Map();

for (let pass = 1; pass <= PASSES; pass++) {
  console.log(`--- Pass ${pass}/${PASSES} ---`);
  const passRow = { pass, tickers: [] };

  for (const ticker of TICKERS) {
    try {
      const result = await auditTicker(ticker);
      passRow.tickers.push(result);
      const ok = result.checks.filter((c) => c.ok !== false).length;
      const total = result.checks.length;
      const spotStr = result.spot != null ? Number(result.spot).toFixed(2) : "—";
      const oracleStr = result.oracle != null ? Number(result.oracle).toFixed(2) : "—";
      console.log(`  ${ticker.padEnd(5)} spot=${spotStr.padStart(10)} oracle=${oracleStr.padStart(10)} checks=${ok}/${total} flows=${result.checks.find(c=>c.check==='flows-count')?.count ?? '—'}`);

      if (result.spot != null) {
        const hist = spotHistory.get(ticker) ?? [];
        hist.push(result.spot);
        spotHistory.set(ticker, hist);
        if (hist.length >= 2) {
          const prev = hist[hist.length - 2];
          const d = pctDiff(result.spot, prev);
          if (d > 3) fail(ticker, "pass-drift", `spot drift ${d.toFixed(2)}% between passes (${prev}→${result.spot})`, "P2");
        }
      }
    } catch (e) {
      fail(ticker, "fetch", e.message, "P0");
      console.log(`  ${ticker.padEnd(5)} ERROR ${e.message}`);
    }
    await sleep(250);
  }
  passResults.push(passRow);
  if (pass < PASSES) await sleep(2000);
}

// SPY/SPX tracking band (last pass)
const last = passResults[passResults.length - 1]?.tickers ?? [];
const spx = last.find((t) => t.ticker === "SPX");
const spy = last.find((t) => t.ticker === "SPY");
if (spx?.spot && spy?.spot) {
  const offset = ((spy.spot * 10 - spx.spot) / spx.spot) * 100;
  console.log(`\nSPY×10 vs SPX tracking: ${offset.toFixed(2)}% (normal ≈ -0.4%)`);
  if (Math.abs(offset) > 1.5) fail("CROSS", "spy-spx-tracking", `SPY×10 vs SPX ${offset.toFixed(2)}% out of band`, "P1");
}

console.log(`\n=== SUMMARY ===`);
console.log(`Tickers audited: ${TICKERS.length} × ${PASSES} passes = ${TICKERS.length * PASSES} probe sets`);
console.log(`Issues found: ${issues.length}`);

const byTicker = new Map();
for (const i of issues) {
  const k = i.ticker;
  if (!byTicker.has(k)) byTicker.set(k, []);
  byTicker.get(k).push(i);
}

if (issues.length === 0) {
  console.log("✅ All tickers passed cross-service validation");
} else {
  for (const [ticker, list] of [...byTicker.entries()].sort()) {
    console.log(`\n${ticker}:`);
    for (const i of list) console.log(`  [${i.severity}] ${i.check}: ${i.detail}`);
  }
}

console.log("");
process.exit(issues.length ? 1 : 0);
