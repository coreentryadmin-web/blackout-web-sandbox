#!/usr/bin/env node
/**
 * Full-site numeric deep audit — every tool surface, not just Heat Maps.
 * Uses CRON_SECRET for premium APIs + optional Polygon oracle.
 *
 * Usage: node scripts/full-site-deep-audit.mjs [--base=https://blackouttrades.com]
 */
import { isTradingDayEt, todayEtYmd } from "./gha-et-window.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(/\/$/, "");
const CRON = process.env.CRON_SECRET ?? "";
const POLY_KEY = process.env.POLYGON_API_KEY ?? process.env.MASSIVE_API_KEY ?? "";
const POLY_BASE = (process.env.POLYGON_API_BASE ?? "https://api.polygon.io").replace(/\/$/, "");

const issues = [];
const passes = [];

function fail(section, id, detail, severity = "P1") {
  issues.push({ section, id, detail, severity });
}
function ok(section, id, detail = "") {
  passes.push({ section, id, detail });
}

const H = CRON ? { Authorization: `Bearer ${CRON}` } : {};

async function getJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { ...H, ...(opts.headers ?? {}) } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 200), _status: res.status };
  }
  return { status: res.status, json };
}

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}
function fracDiff(a, b) {
  const mid = (Math.abs(a) + Math.abs(b)) / 2;
  return mid > 0 ? Math.abs(a - b) / mid : 0;
}
function scanFinite(obj, path = "", out = []) {
  if (obj == null) return out;
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) out.push(`${path}: ${obj}`);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => scanFinite(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) scanFinite(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

// ── 1. Cron plane + automated validators ─────────────────────────────────────
async function auditCrons() {
  if (!CRON) {
    fail("crons", "ENV", "CRON_SECRET unset — premium API probes skipped", "P0");
    return;
  }
  const [wd, dc, di] = await Promise.all([
    getJson("/api/cron/cron-staleness-watchdog"),
    getJson("/api/cron/data-correctness?force=1"),
    getJson("/api/cron/data-integrity?force=1"),
  ]);

  if (wd.status === 200) {
    const keys = wd.json.problem_keys ?? [];
    if (keys.length) for (const k of keys) fail("crons", `STALE-${k}`, `Cron watchdog flagged stale/missing: ${k}`);
    else ok("crons", "watchdog", `${wd.json.checked ?? "?"} jobs OK`);
  }

  if (dc.status === 200) {
    const flags = dc.json.flags ?? [];
    for (const f of flags.slice(0, 20)) fail("correctness", f.metric ?? "flag", `[${f.layer}] ${f.detail}`, "P0");
    ok("correctness", "scorecard", `${flags.length} flags, ${dc.json.totals?.independentlyConfirmed ?? 0} oracle-confirmed, ${dc.json.totals?.consistencyOnly ?? 0} consistency-only`);
  }

  if (di.status === 200) {
    const n = di.json.discrepancies ?? di.json.issues?.length ?? 0;
    if (n > 0) for (const i of (di.json.issues ?? []).slice(0, 10)) fail("integrity", "cross-tool", i.detail ?? i.title, "P0");
    else ok("integrity", "cross-tool", di.json.market_open ? `${di.json.checked ?? 0} checks, 0 discrepancies` : "market closed — checks skipped (by design)");
  }
}

// ── 2. Track record (both APIs + math) ───────────────────────────────────────
async function auditTrackRecord() {
  const [pub, page, outcomes] = await Promise.all([
    getJson("/api/public/track-record"),
    getJson("/api/track-record"),
    CRON ? getJson("/api/market/spx/outcomes") : { status: 0, json: {} },
  ]);
  // Both ledger APIs are admin-gated (requireAdminApi) — CRON bearer alone returns 401 by design.
  if (pub.status === 401 && page.status === 401) {
    ok("track-record", "admin-gated", "public + page APIs require admin session (401 without Clerk cookie)");
    return;
  }
  if (pub.status !== 200 || page.status !== 200) {
    fail("track-record", "HTTP", `public=${pub.status} page=${page.status}`);
    return;
  }
  const p = pub.json;
  const t = page.json;
  if (p.available && p.total_closed > 0) {
    const w = p.wins ?? 0,
      l = p.losses ?? 0,
      b = p.breakeven ?? 0,
      tc = p.total_closed;
    if (w + l + b !== tc) fail("track-record", "MATH-PUBLIC", `wins+losses+breakeven=${w + l + b} != total_closed=${tc}`, "P0");
    else ok("track-record", "math-public", `${tc} closed (${w}W/${l}L/${b}BE)`);

    const pageTotal = (t.spxSlayer?.total ?? 0) + (t.nightHawk?.total ?? 0);
    if (pageTotal === 0) {
      fail(
        "track-record",
        "SPLIT-BRAIN",
        `/api/public/track-record has ${tc} closed plays; /api/track-record page API shows 0 — /track-record empty, embed shows stats`,
        "P0"
      );
    } else ok("track-record", "page-sync", `public=${tc} page=${pageTotal}`);

    // Dashboard panel reads /api/market/spx/outcomes — must agree with public ledger
    if (outcomes.status === 200 && outcomes.json?.stats) {
      const s = outcomes.json.stats;
      const ow = s.overall?.wins ?? 0,
        ol = s.overall?.losses ?? 0,
        ob = s.overall?.breakeven ?? 0;
      if (s.total_closed !== tc) {
        fail("track-record", "OUTCOMES-VS-PUBLIC", `spx/outcomes closed=${s.total_closed} vs public=${tc}`, "P0");
      } else if (ow !== w || ol !== l) {
        fail("track-record", "OUTCOMES-VS-PUBLIC", `outcomes ${ow}W/${ol}L vs public ${w}W/${l}L`, "P0");
      } else ok("track-record", "outcomes-sync", `dashboard spx/outcomes matches public ledger (${ow}W/${ol}L)`);
    }
  } else ok("track-record", "public", "building or empty ledger");
}

// ── 3. SPX Desk deep math ────────────────────────────────────────────────────
async function auditSpxDesk() {
  if (!CRON) return;
  const { status, json: d } = await getJson("/api/market/spx/desk");
  if (status !== 200) {
    fail("spx-desk", "HTTP", `HTTP ${status}`);
    return;
  }
  const bad = scanFinite(d).slice(0, 5);
  if (bad.length) fail("spx-desk", "FINITE", bad.join("; "), "P0");

  const spot = d.price ?? d.spx_price;
  if (!(spot > 0)) fail("spx-desk", "SPOT", `spot missing or invalid: ${spot}`, "P0");
  else ok("spx-desk", "spot", String(spot));

  const low = d.lod ?? d.day_low;
  const high = d.hod ?? d.day_high;
  if (finite(low) && finite(high) && finite(spot) && (spot < low - 0.01 || spot > high + 0.01)) {
    fail("spx-desk", "RANGE", `spot ${spot} outside [${low}, ${high}]`, "P0");
  } else if (finite(low) && finite(high)) ok("spx-desk", "range", `spot ∈ [${low}, ${high}]`);

  const iv = d.uw_iv_rank ?? d.iv_rank;
  if (iv != null && (!finite(iv) || iv < 0 || iv > 100)) fail("spx-desk", "IV-RANK", `iv_rank=${iv}`, "P1");

  const vix = d.vix;
  if (vix != null && (!finite(vix) || vix <= 0)) fail("spx-desk", "VIX", `vix=${vix}`, "P1");
  else if (finite(vix)) ok("spx-desk", "vix", String(vix));

  // change% vs price/prior if available
  const prev = d.prior_close ?? d.prev_close;
  const chg = d.change_pct;
  if (finite(spot) && finite(prev) && prev > 0 && finite(chg)) {
    const derived = ((spot - prev) / prev) * 100;
    if (Math.abs(derived - chg) > 0.15) fail("spx-desk", "CHANGE-PCT", `reported ${chg.toFixed(2)}% vs derived ${derived.toFixed(2)}%`, "P1");
    else ok("spx-desk", "change-pct", `${chg.toFixed(2)}%`);
  }
}

// ── 4. Platform snapshot cross-service ───────────────────────────────────────
async function auditPlatformSnapshot() {
  if (!CRON) return;
  const { status, json: snap } = await getJson("/api/market/platform/snapshot");
  if (status !== 200) {
    fail("snapshot", "HTTP", `HTTP ${status}`);
    return;
  }
  const spx = snap.spx;
  const flows = snap.flows;
  const nh = snap.nighthawk;
  if (spx?.price > 0) ok("snapshot", "spx", `SPX ${spx.price} VIX ${spx.vix ?? "—"}`);
  else fail("snapshot", "SPX", "missing SPX price in snapshot");

  // Desk vs snapshot
  const desk = await getJson("/api/market/spx/desk");
  if (desk.status === 200 && spx?.price > 0) {
    const dp = desk.json.price ?? desk.json.spx_price;
    if (finite(dp) && fracDiff(dp, spx.price) > 0.005) {
      fail("snapshot", "DESK-VS-SNAP", `desk ${dp} vs snapshot ${spx.price}`, "P0");
    } else if (finite(dp)) ok("snapshot", "desk-align", `desk=${dp} snap=${spx.price}`);
  }

  if (flows) {
    if (finite(flows.total_premium) && flows.total_premium < 0) fail("flows", "TOTAL-PREM", `negative total_premium ${flows.total_premium}`, "P0");
    else ok("snapshot", "flows", `${flows.count ?? 0} alerts, $${((flows.total_premium ?? 0) / 1e6).toFixed(1)}M`);
  }
  if (nh) ok("snapshot", "nighthawk", `${nh.play_count ?? 0} plays, available=${nh.available}`);
}

// ── 5. HELIX flows tape ──────────────────────────────────────────────────────
async function auditFlows() {
  if (!CRON) return;
  const { status, json } = await getJson("/api/market/flows?limit=200&since_hours=24&order=recent");
  if (status !== 200) {
    fail("flows", "HTTP", `HTTP ${status}`);
    return;
  }
  const rows = json.flows ?? [];
  if (!rows.length) {
    ok("flows", "empty", "no rows in 24h window (off-hours ok)");
    return;
  }
  let callPrem = 0,
    putPrem = 0,
    totalPrem = 0,
    badPrem = 0;
  for (const r of rows) {
    const p = Number(r.premium ?? 0);
    if (!finite(p) || p < 0) badPrem++;
    totalPrem += p;
    const side = String(r.put_call ?? r.side ?? "").toLowerCase();
    if (side.startsWith("c")) callPrem += p;
    else if (side.startsWith("p")) putPrem += p;
  }
  if (badPrem) fail("flows", "PREMIUM", `${badPrem} rows with bad premium`, "P0");
  else ok("flows", "premium-finite", `${rows.length} rows, Σ $${(totalPrem / 1e6).toFixed(2)}M`);

  // Recency: first row should be >= last row time
  const ts = rows.map((r) => Date.parse(r.ts ?? r.executed_at ?? r.time ?? "")).filter((t) => t > 0);
  if (ts.length >= 2 && ts[0] < ts[ts.length - 1]) {
    fail("flows", "RECENCY", "rows not time-descending (recent tape order)", "P1");
  } else if (ts.length >= 2) ok("flows", "recency", "time-descending ✓");
}

// ── 6. Heat Maps matrix (inline invariants, 10 tickers) ──────────────────────
function sumTotals(st) {
  let t = 0;
  for (const v of Object.values(st ?? {})) {
    const n = Number(v);
    if (finite(n)) t += n;
  }
  return t;
}
function deriveWalls(st) {
  let callWall = null,
    putWall = null;
  let maxPos = 0,
    maxNeg = 0;
  for (const [s, gRaw] of Object.entries(st ?? {})) {
    const strike = Number(s),
      g = Number(gRaw);
    if (!finite(strike) || !finite(g)) continue;
    if (g > maxPos) {
      maxPos = g;
      callWall = strike;
    }
    if (g < maxNeg) {
      maxNeg = g;
      putWall = strike;
    }
  }
  return { callWall, putWall };
}

async function auditHeatmapMatrix() {
  if (!CRON) return;
  const tickers = ["SPX", "SPY", "QQQ", "NVDA", "AAPL", "TSLA", "AMD", "MSFT", "META", "IWM"];
  const tradingDay = isTradingDayEt(todayEtYmd());
  let flags = 0;
  for (const ticker of tickers) {
    const { status, json: hm } = await getJson(`/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`);
    if (status !== 200 || !(hm?.spot > 0)) {
      if (!tradingDay && ticker !== "SPX") {
        ok("heatmap", ticker, "empty on market holiday (expected)");
        continue;
      }
      fail("heatmap", ticker, "unavailable or empty");
      flags++;
      continue;
    }
    for (const [name, block] of [
      ["gex", hm.gex],
      ["vex", hm.vex],
      ["dex", hm.dex],
      ["charm", hm.charm],
    ]) {
      if (!block?.strike_totals) continue;
      const sum = sumTotals(block.strike_totals);
      const total = Number(block.total);
      if (fracDiff(sum, total) > 1e-6) {
        fail("heatmap", `${ticker}.${name}.sum`, `Σ != total`, "P0");
        flags++;
      }
      if (name === "gex") {
        const { callWall, putWall } = deriveWalls(block.strike_totals);
        if (callWall != null && block.call_wall != null && Math.abs(callWall - block.call_wall) > 0.01) {
          fail("heatmap", `${ticker}.call_wall`, `reported ${block.call_wall} != ${callWall}`, "P0");
          flags++;
        }
        if (putWall != null && block.put_wall != null && Math.abs(putWall - block.put_wall) > 0.01) {
          fail("heatmap", `${ticker}.put_wall`, `reported ${block.put_wall} != ${putWall}`, "P0");
          flags++;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!flags) ok("heatmap", "matrix", `${tickers.length} tickers × 4 lenses — all invariants passed`);
}

// ── 7. 0DTE Command board ────────────────────────────────────────────────────
async function auditZeroDteBoard() {
  if (!CRON) return;
  const { status, json } = await getJson("/api/market/zerodte/board");
  if (status === 403) {
    ok("zerodte", "board", "tier/launch gated");
    return;
  }
  if (status !== 200) {
    fail("zerodte", "board", `HTTP ${status}`);
    return;
  }
  if (!json.available) {
    ok("zerodte", "board", "unavailable this cycle");
    return;
  }
  const bad = scanFinite(json).slice(0, 3);
  if (bad.length) fail("zerodte", "board", bad.join("; "), "P1");
  else ok("zerodte", "board", `setups=${json.setups?.length ?? 0} ledger=${json.ledger?.length ?? 0}`);
}

// ── 8. Night Hawk edition ────────────────────────────────────────────────────
async function auditNightHawk() {
  if (!CRON) return;
  const { status, json: ed } = await getJson("/api/market/nighthawk/edition");
  if (status === 403) {
    ok("nighthawk", "edition", "tier/launch gated");
    return;
  }
  if (status !== 200) {
    fail("nighthawk", "HTTP", `HTTP ${status}`);
    return;
  }
  if (!ed.available) {
    ok("nighthawk", "edition", "awaiting close / no edition");
    return;
  }
  const plays = ed.plays ?? [];
  ok("nighthawk", "edition", `${plays.length} plays for ${ed.edition_for}`);
  const ranks = new Set();
  for (const p of plays) {
    if (p.rank != null) ranks.add(p.rank);
    const ep = Number(String(p.entry_premium ?? p.entry ?? "").replace(/[^0-9.]/g, ""));
    if (finite(ep) && ep > 20) fail("nighthawk", "PREMIUM-CAP", `${p.ticker} entry $${ep} > $20 cap`, "P1");
    if (p.score != null && !finite(Number(p.score))) fail("nighthawk", "SCORE", `${p.ticker} bad score`, "P1");
  }
  if (ranks.size !== plays.length) fail("nighthawk", "RANKS", "duplicate or missing ranks", "P1");
  else ok("nighthawk", "ranks", "unique 1..N ✓");
}

// ── 9. Public market APIs + oracle ───────────────────────────────────────────
async function auditPublicMarket() {
  const routes = [
    "/api/market/regime",
    "/api/market/indices",
    "/api/market/quote?ticker=SPY",
    "/api/market/quote?ticker=SPX",
    "/api/market/gex-positioning?ticker=SPX",
    "/api/market/anomalies",
    "/api/market/lotto/today",
    "/api/market/spx/pulse",
    "/api/market/spx/merged",
    "/api/market/spx/signals",
    "/api/market/spx/outcomes",
  ];
  for (const path of routes) {
    const { status, json } = await getJson(path);
    if (status === 401 || status === 403) {
      ok("public", path, `HTTP ${status} (gated)`);
      continue;
    }
    if (status !== 200) {
      fail("public", path, `HTTP ${status}`);
      continue;
    }
    const bad = scanFinite(json).slice(0, 3);
    if (bad.length) fail("public", path, bad.join("; "), "P1");
    else ok("public", path, "finite ✓");
  }

  // Polygon oracle for SPX
  if (POLY_KEY && CRON) {
    const snap = await getJson("/api/market/platform/snapshot");
    const deskSpx = snap.json?.spx?.price;
    const polyRes = await fetch(`${POLY_BASE}/v3/snapshot/indices?ticker.any_of=I:SPX,I:VIX&apiKey=${POLY_KEY}`);
    if (polyRes.ok && deskSpx > 0) {
      const poly = await polyRes.json();
      const row = (poly.results ?? []).find((r) => r.ticker === "I:SPX");
      const oracle = row?.value ?? row?.session?.close;
      if (oracle > 0) {
        const d = Math.abs(oracle - deskSpx);
        if (d > 5) fail("oracle", "SPX", `desk ${deskSpx} vs Polygon ${oracle} (Δ ${d.toFixed(2)})`, "P0");
        else ok("oracle", "SPX", `desk ${deskSpx} vs Polygon ${oracle} (Δ ${d.toFixed(2)})`);
      }
    }
  }
}

// ── 10. Auth gates (unauthenticated must 401) ────────────────────────────────
async function auditAuthGates() {
  const gated = [
    "/api/market/spx/desk",
    "/api/market/flows",
    "/api/market/gex-heatmap?ticker=SPY",
    "/api/admin/me",
    "/api/coaching/alerts",
  ];
  for (const path of gated) {
    const res = await fetch(`${BASE}${path}`);
    if (res.status !== 401 && res.status !== 403) fail("auth", path, `HTTP ${res.status} without session`, "P0");
    else ok("auth", path, `HTTP ${res.status}`);
  }
}

// ── 11. Public pages malformed scan ──────────────────────────────────────────
const PAGES = [
  "/",
  "/track-record",
  "/embed/track-record",
  "/learn",
  "/upgrade",
  "/sign-in",
  "/sign-up",
];
const BAD = [/\bNaN\b/g, /\bundefined\b/g, /\[object Object\]/g, /\$NaN/g, /null%/g];

async function auditPages() {
  for (const path of PAGES) {
    const res = await fetch(`${BASE}${path}`, { headers: { Accept: "text/html" } });
    const html = res.text ? await res.text() : "";
    const visible = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
    let hit = false;
    for (const re of BAD) {
      re.lastIndex = 0;
      if (re.test(visible)) {
        fail("pages", path, `malformed: ${re.source}`, "P1");
        hit = true;
        break;
      }
    }
    if (!hit) ok("pages", path, `HTTP ${res.status}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`\n=== FULL-SITE DEEP AUDIT ===`);
console.log(`Target: ${BASE}`);
console.log(`CRON: ${CRON ? "yes" : "NO"}`);
console.log(`Polygon oracle: ${POLY_KEY ? "yes" : "no"}\n`);

await auditCrons();
await auditTrackRecord();
await auditSpxDesk();
await auditPlatformSnapshot();
await auditFlows();
await auditHeatmapMatrix();
await auditZeroDteBoard();
await auditNightHawk();
await auditPublicMarket();
await auditAuthGates();
await auditPages();

console.log(`\n--- PASSES (${passes.length}) ---`);
for (const p of passes) console.log(`  ✓ [${p.section}] ${p.id}${p.detail ? `: ${p.detail}` : ""}`);

console.log(`\n--- ISSUES (${issues.length}) ---`);
if (!issues.length) console.log("  None — all surfaces passed.");
else {
  const bySev = { P0: [], P1: [], P2: [] };
  for (const i of issues) (bySev[i.severity] ?? bySev.P1).push(i);
  for (const [sev, list] of Object.entries(bySev)) {
    if (!list.length) continue;
    console.log(`\n  ${sev}:`);
    for (const i of list) console.log(`    [${i.section}] ${i.id}: ${i.detail}`);
  }
}

console.log(`\nSummary: ${passes.length} pass, ${issues.length} issues\n`);
process.exit(issues.some((i) => i.severity === "P0") ? 1 : 0);
