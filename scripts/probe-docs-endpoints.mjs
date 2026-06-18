#!/usr/bin/env node
/**
 * Live probe of ALL endpoints documented in /docs/polygon and /docs/unusual-whales.
 * Compares against codebase usage from cursor-api-analysis-data.ts.
 *
 * Run: node scripts/probe-docs-endpoints.mjs
 *       node scripts/probe-docs-endpoints.mjs --uw-only   # re-probe UW only (merges prior Polygon)
 * Keys: POLYGON_API_KEY (or MASSIVE_API_KEY), UW_API_KEY from .env.local only.
 * Pace: UW_PROBE_DELAY_MS (default 650) — stay under UW 120 req/min.
 */
import { readFileSync, writeFileSync } from "fs";
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

for (const f of [".env.local", ".env", ".env.development.local"]) loadEnvFile(f);

const POLYGON_BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const POLYGON_KEY = (process.env.POLYGON_API_KEY ?? process.env.MASSIVE_API_KEY ?? "").trim();
const UW_BASE = (process.env.UW_API_BASE ?? "https://api.unusualwhales.com").replace(/\/$/, "");
const UW_KEY = (process.env.UW_API_KEY ?? "").trim();
const UW_ONLY = process.argv.includes("--uw-only");
const POLYGON_DELAY_MS = Number(process.env.POLYGON_PROBE_DELAY_MS ?? 130);
const UW_DELAY_MS = Number(process.env.UW_PROBE_DELAY_MS ?? 650);
const UW_RETRY_ON_429 = Number(process.env.UW_PROBE_429_RETRIES ?? 2);

function etYmd(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function extractDocEndpoints(tsFile, provider, docSection) {
  const content = readFileSync(join(root, tsFile), "utf8");
  const endpoints = [];
  const sectionRe = /id:\s*"([^"]+)"[\s\S]*?title:\s*"([^"]+)"[\s\S]*?endpoints:\s*\[([\s\S]*?)\n\s*\],/g;
  let sm;
  while ((sm = sectionRe.exec(content)) !== null) {
    const sectionId = sm[1];
    const sectionTitle = sm[2];
    const block = sm[3];
    const epRe = /name:\s*"([^"]+)"[\s\S]*?path:\s*"([^"]+)"/g;
    let em;
    while ((em = epRe.exec(block)) !== null) {
      endpoints.push({
        provider,
        docSection: docSection ?? sectionTitle,
        sectionId,
        name: em[1],
        pathTemplate: em[2],
        source: tsFile.replace(/\\/g, "/"),
      });
    }
  }
  // Benzinga single-path file
  if (!endpoints.length && content.includes("BENZINGA_NEWS_PATH")) {
    const m = content.match(/BENZINGA_NEWS_PATH\s*=\s*"([^"]+)"/);
    if (m) {
      endpoints.push({
        provider: "polygon-benzinga",
        docSection: "Benzinga",
        sectionId: "news",
        name: "Real-time Benzinga News",
        pathTemplate: m[1],
        source: tsFile.replace(/\\/g, "/"),
      });
    }
  }
  return endpoints;
}

function extractUwCatalog() {
  const content = readFileSync(join(root, "src/lib/uw-docs-catalog.ts"), "utf8");
  const endpoints = [];
  const sectionRe = /"id":\s*"([^"]+)"[\s\S]*?"title":\s*"([^"]+)"[\s\S]*?"endpoints":\s*\[([\s\S]*?)\n\s*\]/g;
  let sm;
  while ((sm = sectionRe.exec(content)) !== null) {
    const sectionId = sm[1];
    const sectionTitle = sm[2];
    const block = sm[3];
    const epRe = /"name":\s*"([^"]+)"[\s\S]*?"path":\s*"([^"]+)"/g;
    let em;
    while ((em = epRe.exec(block)) !== null) {
      endpoints.push({
        provider: "unusual_whales",
        docSection: sectionTitle,
        sectionId,
        name: em[1],
        pathTemplate: em[2],
        source: "src/lib/uw-docs-catalog.ts",
      });
    }
  }
  return endpoints;
}

function loadCodebaseUsage() {
  const content = readFileSync(join(root, "src/lib/cursor-api-analysis-data.ts"), "utf8");
  const json = content
    .replace(/^[\s\S]*?export const CURSOR_API_ANALYSIS = /, "")
    .replace(/ as const;\s*[\s\S]*$/, "");
  const data = JSON.parse(json);
  const polygon = new Set(data.external.polygon.map((e) => e.path));
  const uw = new Set(data.external.unusual_whales.map((e) => e.path));
  return { polygon: [...polygon], uw: [...uw], generatedAt: data.generatedAt };
}

function templateToRegex(template) {
  const escaped = template
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{[^}]+\\\}/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

function isUsedInCode(pathTemplate, usedPaths, provider) {
  const variants = expandPathVariants(pathTemplate);
  for (const used of usedPaths) {
    for (const v of variants) {
      if (templateToRegex(v).test(used)) return true;
      if (used === v) return true;
      // prefix: codebase may use subpath
      if (used.startsWith(pathTemplate.split("{")[0])) return true;
    }
  }
  // Special: aggs pattern
  if (pathTemplate.includes("/range/{") && usedPaths.some((u) => u.includes("/range/"))) return true;
  if (pathTemplate.includes("/snapshot/options/") && usedPaths.some((u) => u.includes("/snapshot/options"))) return true;
  if (pathTemplate.includes("/benzinga/") && usedPaths.some((u) => u.includes("/benzinga"))) return true;
  if (pathTemplate.includes("/marketstatus/") && usedPaths.some((u) => u.includes("/marketstatus"))) return true;
  if (pathTemplate.includes("/indicators/") && usedPaths.some((u) => u.includes("/indicators/"))) return true;
  if (pathTemplate.includes("/short") && usedPaths.some((u) => u.includes("/short"))) return true;
  return false;
}

function expandPathVariants(template) {
  const variants = [template];
  if (template.includes("/vX/")) {
    variants.push(template.replace(/\/vX\//g, "/v1/"));
    variants.push(template.replace(/\/vX\//g, "/v2/"));
    variants.push(template.replace(/\/vX\//g, "/v3/"));
  }
  if (template.includes("/stocks/vX/")) {
    variants.push(template.replace("/stocks/vX/", "/stocks/v1/"));
  }
  if (template.includes("/v1/related-companies/")) {
    variants.push(template.replace("/v1/related-companies/", "/v3/reference/tickers/") + "/related");
  }
  return variants;
}

function resolvePath(template, ctx) {
  let p = template;
  const map = {
    "{stocksTicker}": ctx.stock,
    "{stockTicker}": ctx.stock,
    "{optionsTicker}": ctx.optionContract,
    "{optionContract}": ctx.optionContract,
    "{options_ticker}": ctx.optionContract,
    "{indicesTicker}": ctx.index,
    "{ticker}": ctx.stock,
    "{underlyingAsset}": ctx.optionUnderlying,
    "{multiplier}": "1",
    "{timespan}": "day",
    "{from}": ctx.from,
    "{to}": ctx.to,
    "{date}": ctx.priorDay,
    "{direction}": "gainers",
    "{sector}": "technology",
    "{flow_group}": "mag7",
    "{name}": ctx.institution,
    "{id}": ctx.optionContract,
    "{options_ticker}": ctx.optionContract,
    "{contractId}": ctx.optionContract,
    "{politician_id}": "1",
    "{asset_id}": "1",
    "{user_id}": "1",
    "{npm_ticker}": "SPACE",
    "{indicator}": "GDP",
    "{quarter}": "2024Q1",
    "{candle_size}": "1d",
    "{candleSize}": "1d",
    "{function}": "sma",
    "{expiry}": ctx.expiry,
    "{etf}": "SPY",
    "{month}": "1",
  };
  for (const [k, v] of Object.entries(map)) {
    p = p.split(k).join(encodeURIComponent(v));
  }
  for (const v of expandPathVariants(template)) {
    if (v !== template) {
      const alt = resolvePath(v.replace(/\{[^}]+\}/g, (m) => map[m] ?? "X"), ctx);
      if (alt !== p) return alt;
    }
  }
  return p.replace(/\{[^}]+\}/g, "X");
}

function defaultParams(path, provider) {
  const p = {};
  if (provider.startsWith("polygon")) {
    p.limit = "5";
    if (path.includes("/aggs/") && path.includes("/range/")) {
      p.sort = "desc";
    }
    if (path.includes("/reference/tickers") && !path.includes("{")) {
      p.market = "stocks";
      p.active = "true";
      p.limit = "5";
    }
    if (path.includes("/reference/options/contracts") && !path.includes("options_ticker")) {
      p.underlying_ticker = "NVDA";
      p.expired = "false";
      p.limit = "10";
    }
    if (path.includes("/snapshot/options/") && !path.includes("O:")) {
      p.limit = "10";
      p.expiration_date = etYmd();
    }
    if (path.includes("/v3/snapshot") && !path.includes("options") && !path.includes("indices")) {
      p["ticker.any_of"] = "NVDA,SPY";
    }
    if (path.includes("/snapshot/indices")) {
      p["ticker.any_of"] = "I:SPX,I:VIX";
    }
    if (path.includes("/indicators/")) {
      p.timespan = "day";
      p.window = "14";
      p.series_type = "close";
    }
    if (path.includes("/trades/") || path.includes("/quotes/")) {
      p.limit = "5";
      p.order = "desc";
    }
    if (path.includes("/short-interest") || path.includes("/short-volume")) {
      p.ticker = "NVDA";
      p.limit = "5";
    }
    if (path.includes("/float")) {
      p.ticker = "NVDA";
    }
    if (path.includes("/financials/") || path.includes("/filings/")) {
      p.ticker = "NVDA";
      p.limit = "5";
    }
    if (path.includes("/benzinga/")) {
      p.limit = "5";
      p.sort = "published.desc";
    }
    if (path.includes("/reference/news")) {
      p.limit = "5";
      p.ticker = "NVDA";
    }
    if (path.includes("/grouped/")) {
      /* date in path */
    }
  }
  if (provider === "unusual_whales") {
    p.limit = "10";
    if (path.includes("market-tide")) p.interval_5m = "true";
    if (path.includes("flow-alerts")) p.limit = "5";
    if (path.includes("option-contracts")) p.limit = "20";
    if (path.includes("screener")) p.limit = "10";
  }
  return p;
}

async function probePolygon(path, params) {
  const qs = new URLSearchParams({ ...params, apiKey: POLYGON_KEY });
  const url = `${POLYGON_BASE}${path}?${qs}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const ms = Date.now() - started;
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const blocked = res.status === 401 || res.status === 403;
    const apiErr = body?.status === "ERROR" || body?.error;
    const ok = res.status >= 200 && res.status < 300 && !apiErr;
    let note = "";
    if (apiErr) note = String(body.error ?? body.message ?? "API error").slice(0, 100);
    else if (Array.isArray(body?.results)) note = `${body.results.length} results`;
    else if (Array.isArray(body?.tickers)) note = `${body.tickers.length} tickers`;
    else if (body?.market != null) note = `market=${body.market}`;
    else if (ok) note = "OK";
    else if (res.status === 404) note = "404 Not Found";
    else note = text.slice(0, 80);
    return { status: res.status, ok, blocked, ms, note };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      blocked: false,
      ms: Date.now() - started,
      note: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

async function probeUwOnce(path, params) {
  const qs = new URLSearchParams(params);
  const url = qs.toString() ? `${UW_BASE}${path}?${qs}` : `${UW_BASE}${path}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${UW_KEY}`, Accept: "application/json" },
      cache: "no-store",
    });
    const ms = Date.now() - started;
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const blocked = res.status === 401 || res.status === 403;
    const ok = res.status >= 200 && res.status < 300 && !body?.error;
    let note = "";
    if (body?.error) note = String(body.error).slice(0, 100);
    else if (body?.msg) note = String(body.msg).slice(0, 100);
    else if (Array.isArray(body?.data)) note = `${body.data.length} rows`;
    else if (ok) note = "OK";
    else if (res.status === 404) note = "404 Not Found";
    else if (res.status === 429) note = "429 rate limited";
    else note = text.slice(0, 80);
    return { status: res.status, ok, blocked, ms, note };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      blocked: false,
      ms: Date.now() - started,
      note: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

async function probeUw(path, params) {
  let last = await probeUwOnce(path, params);
  for (let attempt = 0; attempt < UW_RETRY_ON_429 && last.status === 429; attempt += 1) {
    const waitMs = 15_000 * (attempt + 1);
    console.log(`    ↻ 429 retry in ${waitMs / 1000}s…`);
    await new Promise((r) => setTimeout(r, waitMs));
    last = await probeUwOnce(path, params);
  }
  return last;
}

async function fetchOptionContract() {
  if (!POLYGON_KEY) return "O:NVDA250620C00100000";
  const qs = new URLSearchParams({
    underlying_ticker: "NVDA",
    expired: "false",
    limit: "1",
    apiKey: POLYGON_KEY,
  });
  try {
    const res = await fetch(`${POLYGON_BASE}/v3/reference/options/contracts?${qs}`);
    const body = await res.json();
    const sym = body?.results?.[0]?.ticker;
    return sym ?? "O:NVDA250620C00100000";
  } catch {
    return "O:NVDA250620C00100000";
  }
}

function loadPriorPolygonResults() {
  if (!UW_ONLY) return [];
  try {
    const prior = JSON.parse(readFileSync(join(root, "src/lib/docs-probe-report.json"), "utf8"));
    return prior.results.filter((r) => r.provider.startsWith("polygon"));
  } catch {
    return [];
  }
}

function providerSummary(rows) {
  return {
    total: rows.length,
    ok: rows.filter((r) => r.probe.ok).length,
    fail: rows.filter((r) => !r.probe.ok && !r.probe.blocked && r.probe.status !== 429).length,
    rateLimited: rows.filter((r) => r.probe.status === 429).length,
    blocked: rows.filter((r) => r.probe.blocked).length,
    usedInCode: rows.filter((r) => r.usedInCode).length,
    unusedInCode: rows.filter((r) => !r.usedInCode).length,
    unusedAndWorking: rows.filter((r) => !r.usedInCode && r.probe.ok).length,
    unusedAndBlocked: rows.filter((r) => !r.usedInCode && r.probe.blocked).length,
  };
}

async function main() {
  if (UW_ONLY) {
    if (!UW_KEY) {
      console.error("--uw-only requires UW_API_KEY in .env.local");
      process.exit(1);
    }
  } else if (!POLYGON_KEY && !UW_KEY) {
    console.error("Need POLYGON_API_KEY and/or UW_API_KEY in .env.local");
    process.exit(1);
  }

  const usage = loadCodebaseUsage();
  const priorPolygon = loadPriorPolygonResults();
  const ctx = {
    stock: "NVDA",
    index: "I:SPX",
    optionUnderlying: "NVDA",
    optionContract: await fetchOptionContract(),
    from: etYmd(-7),
    to: etYmd(0),
    priorDay: etYmd(-1),
    expiry: etYmd(0),
    institution: "BERKSHIRE%20HATHAWAY%20INC",
  };

  const documented = [
    ...extractDocEndpoints("src/lib/polygon-docs-stocks-rest.ts", "polygon-stocks"),
    ...extractDocEndpoints("src/lib/polygon-docs-options-rest.ts", "polygon-options"),
    ...extractDocEndpoints("src/lib/polygon-docs-indices-rest.ts", "polygon-indices"),
    ...extractDocEndpoints("src/lib/polygon-docs-benzinga-rest.ts", "polygon-benzinga"),
    ...extractUwCatalog(),
  ];

  console.log(`\nDocs endpoint live probe${UW_ONLY ? " (UW only)" : ""}`);
  console.log(`Documented: ${documented.length} (${documented.filter((d) => d.provider.startsWith("polygon")).length} Polygon · ${documented.filter((d) => d.provider === "unusual_whales").length} UW)`);
  console.log(`Codebase usage: ${usage.polygon.length} Polygon paths · ${usage.uw.length} UW paths`);
  console.log(`Polygon key: ${POLYGON_KEY ? "yes" : "no"} · UW key: ${UW_KEY ? "yes" : "no"}`);
  if (UW_ONLY && priorPolygon.length) {
    console.log(`Reusing ${priorPolygon.length} prior Polygon probe results`);
  }
  console.log(`Pacing: Polygon ${POLYGON_DELAY_MS}ms · UW ${UW_DELAY_MS}ms\n`);

  const results = [...priorPolygon];
  let i = priorPolygon.length;
  for (const ep of documented) {
    const isPolygon = ep.provider.startsWith("polygon");
    if (UW_ONLY && isPolygon) continue;
    if (isPolygon && !POLYGON_KEY) continue;
    if (!isPolygon && !UW_KEY) continue;

    i += 1;

    const resolvedPath = resolvePath(ep.pathTemplate, ctx);
    const params = defaultParams(resolvedPath, ep.provider);
    const usedPaths = isPolygon ? usage.polygon : usage.uw;
    const usedInCode = isUsedInCode(ep.pathTemplate, usedPaths, ep.provider);

    let probe;
    if (isPolygon) {
      probe = await probePolygon(resolvedPath, params);
      await new Promise((r) => setTimeout(r, POLYGON_DELAY_MS));
    } else {
      probe = await probeUw(resolvedPath, params);
      await new Promise((r) => setTimeout(r, UW_DELAY_MS));
    }

    const row = {
      ...ep,
      resolvedPath,
      usedInCode,
      unused: !usedInCode,
      probe,
    };
    results.push(row);

    const icon = probe.ok ? "✓" : probe.blocked ? "✗" : "⚠";
    const useTag = usedInCode ? "USED" : "UNUSED";
    console.log(
      `${icon} [${String(i).padStart(3)}/${documented.length}] ${useTag.padEnd(6)} ${probe.status} ${String(probe.ms).padStart(4)}ms  ${ep.name.slice(0, 40)}`
    );
  }

  const polygonResults = results.filter((r) => r.provider.startsWith("polygon"));
  const uwResults = results.filter((r) => r.provider === "unusual_whales");

  const summary = {
    probedAt: new Date().toISOString(),
    codebaseUsageGeneratedAt: usage.generatedAt,
    documentedTotal: documented.length,
    probedTotal: results.length,
    uwOnlyRun: UW_ONLY,
    polygonDelayMs: POLYGON_DELAY_MS,
    uwDelayMs: UW_DELAY_MS,
    polygon: providerSummary(polygonResults),
    unusual_whales: providerSummary(uwResults),
  };

  const report = { summary, results };

  const outJson = join(root, "src/lib/docs-probe-report.json");
  writeFileSync(outJson, JSON.stringify(report, null, 2), "utf8");

  const outTs = join(root, "src/lib/docs-probe-report.ts");
  writeFileSync(
    outTs,
    `/** Auto-generated — run: node scripts/probe-docs-endpoints.mjs */\nexport const DOCS_PROBE_REPORT = ${JSON.stringify(report, null, 2)} as const;\n`,
    "utf8"
  );

  console.log("\n── Summary ──");
  console.log(JSON.stringify(summary, null, 2));

  const unusedWorking = results.filter((r) => !r.usedInCode && r.probe.ok);
  console.log(`\n── Unused but API OK (${unusedWorking.length}) — integration candidates ──`);
  for (const r of unusedWorking.slice(0, 30)) {
    console.log(`  [${r.provider}] ${r.name}`);
    console.log(`    ${r.pathTemplate}`);
  }
  if (unusedWorking.length > 30) console.log(`  ... +${unusedWorking.length - 30} more (see report)`);

  console.log(`\nWrote ${outJson}`);
  console.log(`Wrote ${outTs}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
