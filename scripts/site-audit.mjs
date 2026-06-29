#!/usr/bin/env node
/**
 * Full-site audit: pages, public APIs, numeric sanity, malformed UI markers.
 * Usage: node scripts/site-audit.mjs [--base=https://blackouttrades.com]
 */
const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "http://127.0.0.1:3000").replace(/\/$/, "");

const PAGES = [
  "/",
  "/sign-in",
  "/sign-up",
  "/track-record",
  "/learn",
  "/learn/getting-started",
  "/learn/glossary",
  "/learn/blackout-grid",
  "/learn/heat-maps",
  "/learn/helix-flows",
  "/learn/largo-ai",
  "/learn/night-hawk",
  "/learn/nights-watch",
  "/learn/spx-slayer",
  "/offline",
  "/embed/track-record",
  "/upgrade",
];

const PUBLIC_APIS = [
  "/api/health",
  "/api/ready",
  "/api/public/track-record",
  "/api/track-record",
  "/api/market/health",
  "/api/market/regime",
  "/api/market/anomalies",
  "/api/market/indices",
  "/api/market/quote?ticker=SPY",
  "/api/market/gex-positioning?ticker=SPX",
  "/api/market/heatmap?ticker=SPY",
  "/api/market/platform/snapshot",
  "/api/market/ticker-search?q=SPY",
  "/api/market/earnings-calendar",
  "/api/market/news",
  "/api/market/dark-pool",
  "/api/market/flow-brief",
  "/api/market/lotto/today",
  "/api/coaching/alerts",
  "/api/brief/premarket",
  "/api/platform/intel",
  "/api/market/spx/desk",
  "/api/market/spx/pulse",
  "/api/market/spx/merged",
  "/api/market/spx/signals",
  "/api/market/spx/flow",
  "/api/market/spx/outcomes",
  "/api/market/spx/play",
  "/api/market/spx/commentary",
  "/api/market/spx/journal",
  "/api/market/gex-heatmap?ticker=SPY",
  "/api/grid/sectors",
  "/api/grid/movers",
  "/api/grid/economy",
  "/api/grid/earnings",
  "/api/grid/catalysts",
  "/api/grid/analysts",
  "/api/grid/congress",
  "/api/grid/dark-pool",
];

const MALFORMED_PATTERNS = [
  { re: /\bNaN\b/g, label: "NaN" },
  { re: /\bundefined\b/g, label: "undefined" },
  { re: /\[object Object\]/g, label: "[object Object]" },
  { re: /\$NaN/g, label: "$NaN" },
  { re: /\$Infinity/g, label: "$Infinity" },
  { re: /null%/g, label: "null%" },
  { re: /Invalid Date/g, label: "Invalid Date" },
  { re: /\$\s*—\s*—/g, label: "double em-dash price" },
];

const issues = [];
const passes = [];

function fail(category, path, detail) {
  issues.push({ category, path, detail });
}

function pass(category, path, detail = "") {
  passes.push({ category, path, detail });
}

/** Strip scripts/styles so bundle source does not false-positive visible-text checks. */
function visibleHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function scanText(text, path, category) {
  const probe = category === "page" ? visibleHtml(text) : text;
  for (const { re, label } of MALFORMED_PATTERNS) {
    re.lastIndex = 0;
    const matches = probe.match(re);
    if (matches && matches.length > 0) {
      fail(category, path, `Found ${label} (${matches.length}×)`);
      return;
    }
  }
}

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function auditNumbers(obj, path = "", findings = []) {
  if (obj === null || obj === undefined) return findings;
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) findings.push(`${path}: non-finite number ${obj}`);
    return findings;
  }
  if (typeof obj === "string") {
    if (/^\$?-?\d/.test(obj) && /\bNaN\b/.test(obj)) findings.push(`${path}: string contains NaN`);
    return findings;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => auditNumbers(v, `${path}[${i}]`, findings));
    return findings;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      auditNumbers(v, path ? `${path}.${k}` : k, findings);
    }
  }
  return findings;
}

function checkPriceSanity(data, apiPath) {
  const priceFields = ["price", "spot", "spxPrice", "last", "mark", "entry", "exit", "strike"];
  for (const field of priceFields) {
    const v = data?.[field];
    if (v != null && typeof v === "number") {
      if (v < 0 && !["change", "change_pct", "pnl", "realized", "netGex"].includes(field)) {
        fail("numeric", apiPath, `${field}=${v} (unexpected negative)`);
      }
      if (field.includes("price") || field === "spot" || field === "mark" || field === "strike") {
        if (v > 0 && v < 0.001) fail("numeric", apiPath, `${field}=${v} (suspiciously tiny)`);
        if (v > 1_000_000) fail("numeric", apiPath, `${field}=${v} (suspiciously huge)`);
      }
    }
  }
}

async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function auditPage(path) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "text/html" } });
    if (res.status >= 500) {
      fail("page", path, `HTTP ${res.status}`);
      return;
    }
    const html = await res.text();
    scanText(html, path, "page");
    if (!issues.some((i) => i.path === path && i.category === "page")) {
      pass("page", path, `HTTP ${res.status}`);
    }
  } catch (e) {
    fail("page", path, e.message);
  }
}

async function auditApi(path) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    const ct = res.headers.get("content-type") ?? "";
    const body = await res.text();

    if (res.status === 401 || res.status === 403) {
      pass("api-auth", path, `HTTP ${res.status} (expected for tier-gated)`);
      return;
    }
    if (res.status >= 500) {
      fail("api", path, `HTTP ${res.status}: ${body.slice(0, 120)}`);
      return;
    }

    if (!ct.includes("json") && body.trim().startsWith("<")) {
      fail("api", path, `Returned HTML instead of JSON (HTTP ${res.status})`);
      return;
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      if (res.status === 200) fail("api", path, "Invalid JSON on 200");
      else pass("api", path, `HTTP ${res.status} (non-JSON)`);
      return;
    }

    scanText(body, path, "api-json");
    const numIssues = auditNumbers(data);
    for (const n of numIssues.slice(0, 5)) fail("numeric", path, n);
    if (numIssues.length > 5) fail("numeric", path, `+${numIssues.length - 5} more non-finite values`);

    if (res.status === 200 && typeof data === "object") {
      checkPriceSanity(data, path);
      // Nested spot checks
      if (data.desk) checkPriceSanity(data.desk, path);
      if (data.snapshot) checkPriceSanity(data.snapshot, path);
      if (data.stats) {
        const { wins, losses, total } = data.stats;
        if (wins != null && losses != null && total != null && wins + losses > total) {
          fail("numeric", path, `stats: wins(${wins})+losses(${losses}) > total(${total})`);
        }
      }
    }

    if (!issues.some((i) => i.path === path)) {
      pass("api", path, `HTTP ${res.status}`);
    }
  } catch (e) {
    fail("api", path, e.message);
  }
}

console.log(`\n=== BlackOut Site Audit ===`);
console.log(`Target: ${BASE}\n`);

for (const p of PAGES) await auditPage(p);
for (const a of PUBLIC_APIS) await auditApi(a);

console.log(`\n--- PASS (${passes.length}) ---`);
for (const p of passes.slice(0, 20)) console.log(`  ✓ [${p.category}] ${p.path}${p.detail ? ` — ${p.detail}` : ""}`);
if (passes.length > 20) console.log(`  … and ${passes.length - 20} more`);

console.log(`\n--- ISSUES (${issues.length}) ---`);
if (issues.length === 0) {
  console.log("  None — all checks passed.");
} else {
  for (const i of issues) console.log(`  ✗ [${i.category}] ${i.path}: ${i.detail}`);
}

console.log(`\nSummary: ${passes.length} pass, ${issues.length} issues\n`);
process.exit(issues.length > 0 ? 1 : 0);
