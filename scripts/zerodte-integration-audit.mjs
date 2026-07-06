#!/usr/bin/env node
/**
 * 0DTE Command cross-tool integration audit — Grid, HELIX, Night Hawk, SPX,
 * Largo/BIE, Thermal/GEX, and ecosystem-context wiring.
 *
 * Usage:
 *   npm run validate:zerodte-integration
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice("--base=".length) ??
  process.env.AUDIT_APP_URL ??
  "https://blackouttrades.com"
).replace(/\/$/, "");
const CRON = process.env.CRON_SECRET || "";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail) => {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
};

async function fetchJson(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${CRON}`, Accept: "application/json" },
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

function spotDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b);
}

async function auditCrossToolLive() {
  if (!CRON) {
    rec("integration:live", "SKIP", "CRON_SECRET not set");
    return;
  }

  const [zb, boot, gex, flows, nh, mergedWrap] = await Promise.all([
    fetchJson("/api/market/zerodte/board"),
    fetchJson("/api/grid/bootstrap"),
    fetchJson("/api/market/gex-positioning?ticker=SPX"),
    fetchJson("/api/market/flows?limit=30"),
    fetchJson("/api/market/nighthawk/edition"),
    fetchJson("/api/market/spx/merged"),
  ]);
  const mergedDesk = mergedWrap.json?.merged ?? mergedWrap.json;

  if (zb.status !== 200 || !zb.json.available) {
    rec("integration:zerodte-board", "FAIL", `HTTP ${zb.status}`);
    return;
  }
  rec("integration:zerodte-board", "PASS", `setups=${zb.json.setups?.length ?? 0} ledger=${zb.json.ledger?.length ?? 0}`);

  if (boot.status === 200 && boot.json.error !== "coming_soon") {
    rec("integration:grid-bootstrap", "PASS");
    const bootSpot = boot.json.market?.pulse?.spx?.price ?? boot.json.market?.gexSpx?.spot;
    const gexSpot = gex.json?.spot;
    if (Number.isFinite(bootSpot) && Number.isFinite(gexSpot) && spotDelta(bootSpot, gexSpot) > 0.25) {
      rec("integration:grid-gex-spot", "FAIL", `bootstrap ${bootSpot} vs gex ${gexSpot}`);
    } else if (Number.isFinite(gexSpot)) {
      rec("integration:grid-gex-spot", "PASS", `spot ${gexSpot}`);
    }
  } else if (boot.json?.error === "coming_soon") {
    rec("integration:grid-bootstrap", "FAIL", "403 coming_soon — cron bypass missing or not deployed");
  } else {
    rec("integration:grid-bootstrap", "WARN", `HTTP ${boot.status}`);
  }

  const liveSpot = Number(mergedDesk?.price ?? mergedDesk?.spot);
  const gexSpot = Number(gex.json?.spot);
  if (Number.isFinite(liveSpot) && Number.isFinite(gexSpot) && spotDelta(liveSpot, gexSpot) > 0.2) {
    rec("integration:spx-desk-gex", "FAIL", `merged ${liveSpot} vs gex ${gexSpot}`);
  } else if (Number.isFinite(gexSpot)) {
    rec("integration:spx-desk-gex", "PASS", `spot ${gexSpot}`);
  }

  const flowCount = flows.json?.flows?.length ?? flows.json?.alerts?.length ?? 0;
  rec("integration:helix-flows", flowCount > 0 ? "PASS" : "WARN", `${flowCount} prints`);

  const nhPlays = nh.json?.plays ?? nh.json?.edition?.plays ?? [];
  const covered = new Set((zb.json.covered_elsewhere ?? []).map((t) => String(t).toUpperCase()));
  const nhTickers = nhPlays.map((p) => String(p.ticker ?? "").toUpperCase()).filter(Boolean);
  const missing = nhTickers.filter((t) => !covered.has(t));
  if (nhTickers.length && missing.length) {
    rec("integration:nighthawk-dedupe", "FAIL", `${missing.length} NH tickers not in covered_elsewhere: ${missing.slice(0, 3).join(", ")}`);
  } else if (nhTickers.length) {
    rec("integration:nighthawk-dedupe", "PASS", `${nhTickers.length} tickers withheld from scanner`);
  } else {
    rec("integration:nighthawk-dedupe", "PASS", "no edition plays");
  }

  for (const row of zb.json.ledger ?? []) {
    if (row.entry_premium != null && row.last_mark != null && row.live_pnl_pct != null) {
      const expected = Math.round(((row.last_mark - row.entry_premium) / row.entry_premium) * 10000) / 100;
      if (Math.abs(expected - row.live_pnl_pct) > 0.05) {
        rec("integration:ledger-pnl", "FAIL", `${row.ticker} expected ${expected}% got ${row.live_pnl_pct}%`);
        return;
      }
    }
  }
  rec("integration:ledger-pnl", "PASS", `${zb.json.ledger?.length ?? 0} rows`);

  for (const panel of ["movers", "sectors", "earnings"]) {
    const p = await fetchJson(`/api/grid/${panel}`);
    if (p.status === 200 && p.json.error !== "coming_soon") rec(`integration:grid-${panel}`, "PASS");
    else if (p.json?.error === "coming_soon") rec(`integration:grid-${panel}`, "FAIL", "cron bypass");
    else rec(`integration:grid-${panel}`, "WARN", `HTTP ${p.status}`);
  }
}

async function main() {
  console.log("\n=== 0DTE cross-tool integration audit ===\n");

  const staticOk = spawnSync("node scripts/audit/zerodte-bie-consistency-validator.mjs", {
    shell: true,
    encoding: "utf8",
    env: process.env,
  });
  if (staticOk.status !== 0) {
    rec("integration:bie-consistency", "FAIL", (staticOk.stderr || staticOk.stdout || "").trim().slice(0, 300));
  } else {
    rec("integration:bie-consistency", "PASS");
  }

  run("npm run validate:zerodte-logic", "integration:zerodte-logic");

  await auditCrossToolLive();

  const fails = checks.filter((c) => c.status === "FAIL");
  const reportPath = join(OUT, `zerodte-integration-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ ts: new Date().toISOString(), checks }, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`  FAIL: ${fails.length} / ${checks.length}`);
  console.log(`  Report: ${reportPath}\n`);

  if (fails.length) {
    fails.forEach((f) => console.log(`  · ${f.name}: ${f.detail ?? ""}`));
    process.exit(1);
  }
  console.log("GREEN — 0DTE integration audit passed.\n");
}

function run(cmd, label) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", env: process.env });
  if (r.status !== 0) {
    rec(label, "FAIL", (r.stderr || r.stdout || "").trim().slice(0, 300));
    return false;
  }
  rec(label, "PASS");
  return true;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
