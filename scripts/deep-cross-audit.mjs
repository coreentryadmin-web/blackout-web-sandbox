#!/usr/bin/env node
/**
 * Deep cross-service audit — uses CRON_SECRET + Polygon oracle.
 * Usage: node scripts/deep-cross-audit.mjs [--base=https://blackouttrades.com]
 */
const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(/\/$/, "");
const CRON = process.env.CRON_SECRET;
const POLY_KEY = process.env.POLYGON_API_KEY ?? process.env.MASSIVE_API_KEY ?? "";
const POLY_BASE = (process.env.POLYGON_API_BASE ?? "https://api.polygon.io").replace(/\/$/, "");

if (!CRON) {
  console.error("CRON_SECRET required");
  process.exit(1);
}

const issues = [];

function fail(id, severity, detail) {
  issues.push({ id, severity, detail });
}

async function cronGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${CRON}` },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function polygonIndices() {
  if (!POLY_KEY) return null;
  const url = `${POLY_BASE}/v3/snapshot/indices?ticker.any_of=I:SPX,I:VIX&apiKey=${POLY_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const out = {};
  for (const r of json.results ?? []) out[r.ticker] = r.value ?? r.session?.close;
  return out;
}

console.log(`\n=== Deep Cross-Service Audit ===\nTarget: ${BASE}\n`);

const [snap, pubTr, pageTr, regime, watchdog, correctness, poly] = await Promise.all([
  cronGet("/api/market/platform/snapshot"),
  cronGet("/api/public/track-record"),
  cronGet("/api/track-record"),
  cronGet("/api/market/regime"),
  cronGet("/api/cron/cron-staleness-watchdog"),
  cronGet("/api/cron/data-correctness?force=1"),
  polygonIndices(),
]);

const spx = snap.data?.spx?.price;
const vwap = snap.data?.spx?.vwap;
const flip = snap.data?.spx?.gamma_flip;
const vix = snap.data?.spx?.vix;

console.log("Desk snapshot:");
console.log(`  SPX ${spx}  VWAP ${vwap?.toFixed?.(2)}  flip ${flip}  VIX ${vix}`);
console.log(`  Flows: ${snap.data?.flows?.count} alerts, $${((snap.data?.flows?.total_premium ?? 0) / 1e6).toFixed(1)}M total`);
console.log(`  Night Hawk: ${snap.data?.nighthawk?.play_count ?? 0} plays`);

if (poly?.["I:SPX"] && spx) {
  const d = Math.abs(poly["I:SPX"] - spx);
  console.log(`\nOracle: Polygon SPX ${poly["I:SPX"]} vs desk ${spx} (Δ ${d.toFixed(2)})`);
  if (d > 5) fail("P0-SPX-ORACLE", "P0", `Desk SPX ${spx} vs Polygon ${poly["I:SPX"]} — Δ ${d.toFixed(2)} pts`);
}

if (pubTr.data?.total_closed > 0) {
  const pageTotal = (pageTr.data?.spxSlayer?.total ?? 0) + (pageTr.data?.nightHawk?.total ?? 0);
  if (pageTotal === 0) {
    fail(
      "P1-TR-SPLIT",
      "P1",
      `Public track-record has ${pubTr.data.total_closed} closed; page API has 0`
    );
  }
  const w = pubTr.data.wins,
    l = pubTr.data.losses,
    b = pubTr.data.breakeven,
    tc = pubTr.data.total_closed;
  if (w + l + b !== tc) fail("P0-TR-MATH", "P0", `W+L+B=${w + l + b} != ${tc}`);
}

for (const k of watchdog.data?.problem_keys ?? []) {
  fail(`P1-CRON-${k}`, "P1", `Cron watchdog: ${k} stale or failed`);
}

for (const f of correctness.data?.flags ?? []) {
  fail("P0-CORRECTNESS", "P0", `[${f.layer}/${f.metric}] ${f.detail}`);
}

console.log(`\nCorrectness: flags=${correctness.data?.totals?.flags ?? "?"}, confirmed=${correctness.data?.totals?.independentlyConfirmed ?? "?"}`);

console.log(`\n--- ISSUES (${issues.length}) ---`);
if (!issues.length) console.log("  None — all cross-checks passed.");
else for (const i of issues) console.log(`  [${i.severity}] ${i.id}: ${i.detail}`);

console.log("");
process.exit(issues.length ? 1 : 0);
