#!/usr/bin/env node
/**
 * 0DTE Command + Market Grid — all-day RTH audit orchestrator.
 *
 * Usage:
 *   npm run validate:grid-rth
 *   node scripts/grid-rth-all-day-audit.mjs [--force] [--phase=verify|post-close]
 *
 * Requires: CRON_SECRET (grid panel probes + zerodte board + crons)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inRthOpenWindow, isTradingDayEt, todayEtYmd, etParts } from "./gha-et-window.mjs";

const force = process.argv.includes("--force");
const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const PHASE = phaseArg ? phaseArg.slice("--phase=".length) : "verify";
const BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice("--base=".length) ??
  process.env.AUDIT_APP_URL ??
  "https://blackouttrades.com"
).replace(/\/$/, "");
const CRON = process.env.CRON_SECRET || "";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const GRID_PANELS = [
  "bootstrap",
  "analysts",
  "catalysts",
  "congress",
  "dark-pool",
  "earnings",
  "economy",
  "movers",
  "sectors",
];

const checks = [];
const rec = (name, status, detail) => {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
};

function run(cmd, label) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", env: process.env });
  if (r.status !== 0) {
    rec(label, "FAIL", (r.stderr || r.stdout || "").trim().slice(0, 400));
    return false;
  }
  rec(label, "PASS");
  return true;
}

async function fetchJson(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${CRON}`,
      Accept: "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.json();
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

function ageSec(asOf) {
  if (!asOf) return null;
  return Math.round((Date.now() - new Date(asOf).getTime()) / 1000);
}

async function auditGridPanels() {
  if (!CRON) {
    rec("grid:panels", "SKIP", "CRON_SECRET not set");
    return;
  }
  let fails = 0;
  for (const panel of GRID_PANELS) {
    try {
      const json = await fetchJson(`/api/grid/${panel}`);
      if (json.error === "coming_soon") {
        rec(`grid:${panel}`, "WARN", "launch gate locked for member path — cron should bypass after fix");
        continue;
      }
      const bad = scanFinite(json).slice(0, 3);
      if (bad.length) {
        rec(`grid:${panel}`, "FAIL", bad.join("; "));
        fails++;
        continue;
      }
      const asOf = json.as_of ?? json.panels?.analysts?.as_of;
      const age = ageSec(asOf);
      rec(`grid:${panel}`, "PASS", age != null ? `as_of ${age}s` : "finite");
    } catch (e) {
      rec(`grid:${panel}`, "FAIL", e.message);
      fails++;
    }
  }
  if (fails === 0 && GRID_PANELS.length) rec("grid:all-panels", "PASS");
}

async function auditZeroDteBoard() {
  if (!CRON) return;
  try {
    const zb = await fetchJson("/api/market/zerodte/board");
    if (!zb.available) {
      rec("zerodte:board", "FAIL", "available=false");
      return;
    }
    if (zb.upstream_ok === false) {
      rec("zerodte:upstream", "WARN", "tape fetch degraded this cycle");
    } else {
      rec("zerodte:upstream", "PASS");
    }
    const heat = zb.session?.heat?.state ?? "?";
    rec("zerodte:session", "PASS", `heat=${heat} setups=${zb.setups?.length ?? 0} ledger=${zb.ledger?.length ?? 0}`);

    for (const row of zb.ledger ?? []) {
      if (row.entry_premium != null && row.last_mark != null && row.live_pnl_pct != null) {
        const expected =
          Math.round(((row.last_mark - row.entry_premium) / row.entry_premium) * 10000) / 100;
        if (Math.abs(expected - row.live_pnl_pct) > 0.05) {
          rec("zerodte:ledger-pnl", "FAIL", `${row.ticker} expected ${expected}% got ${row.live_pnl_pct}%`);
          return;
        }
      }
    }
    rec("zerodte:ledger-pnl", "PASS", `${zb.ledger?.length ?? 0} rows checked`);
  } catch (e) {
    rec("zerodte:board", "FAIL", e.message);
  }
}

async function auditCrossTool() {
  if (!CRON) return;
  try {
    const [bootstrap, gex, zb] = await Promise.all([
      fetchJson("/api/grid/bootstrap"),
      fetchJson("/api/market/gex-positioning?ticker=SPX"),
      fetchJson("/api/market/zerodte/board"),
    ]);
    const bootSpot = bootstrap?.market?.pulse?.spx?.price ?? bootstrap?.market?.gexSpx?.spot;
    const gexSpot = gex?.spot;
    if (Number.isFinite(bootSpot) && Number.isFinite(gexSpot) && Math.abs(bootSpot - gexSpot) > 0.2) {
      rec("integration:grid-gex-spot", "FAIL", `bootstrap ${bootSpot} vs gex ${gexSpot}`);
    } else if (Number.isFinite(gexSpot)) {
      rec("integration:grid-gex-spot", "PASS", `spot ${gexSpot}`);
    }
    const flows = await fetchJson("/api/market/flows?limit=20");
    const count = flows?.flows?.length ?? flows?.alerts?.length ?? 0;
    rec("integration:helix-flows", count > 0 ? "PASS" : "WARN", `${count} prints`);
    if (zb.covered_elsewhere?.length) {
      rec("integration:nighthawk-dedupe", "PASS", `${zb.covered_elsewhere.length} tickers covered elsewhere`);
    }
  } catch (e) {
    rec("integration:cross-tool", "FAIL", e.message);
  }
}

async function auditGridWarmCron() {
  if (!CRON) return;
  try {
    const r = await fetch(`${BASE}/api/cron/grid-warm`, {
      headers: { Authorization: `Bearer ${CRON}` },
    });
    const json = await r.json().catch(() => ({}));
    if (r.ok || json.skipped) rec("cron:grid-warm", "PASS", json.skipped ? "skipped off-hours" : "ok");
    else rec("cron:grid-warm", "WARN", `HTTP ${r.status}`);
  } catch (e) {
    rec("cron:grid-warm", "FAIL", e.message);
  }
}

async function main() {
  const now = new Date();
  const et = etParts(now);
  const ymd = todayEtYmd(now);

  console.log(`\n=== 0DTE Grid all-day RTH audit ===`);
  console.log(`Time: ${now.toISOString()} (${et.label})`);
  console.log(`Phase: ${PHASE}\n`);

  if (!force && !inRthOpenWindow(now) && PHASE === "verify") {
    console.log("Outside RTH — skipping (use --force).\n");
    process.exit(0);
  }
  if (!isTradingDayEt(ymd) && !force) {
    console.log(`${ymd} not a trading day — skipping.\n`);
    process.exit(0);
  }

  if (!CRON) rec("env:CRON_SECRET", "FAIL", "required");
  else rec("env:CRON_SECRET", "PASS");

  if (force || inRthOpenWindow(now)) run("npm run validate:rth-open", "infra:validate:rth-open");

  await auditGridPanels();
  await auditZeroDteBoard();
  await auditCrossTool();
  await auditGridWarmCron();

  run("npm run validate:zerodte-logic", "zerodte:logic-audit");
  run("npm run validate:zerodte-integration", "zerodte:cross-tool-integration");

  if (CRON) {
    try {
      const dc = await fetchJson("/api/cron/data-correctness?force=1");
      const zFlags = (dc.flags ?? []).filter((f) => /zerodte|grid/i.test(`${f.layer}/${f.metric}`));
      if (zFlags.length) {
        rec("grid:data-correctness", "FAIL", `${zFlags.length} grid/zerodte flag(s)`);
        zFlags.slice(0, 3).forEach((f) => console.log(`    · [${f.layer}/${f.metric}] ${f.detail}`));
      } else rec("grid:data-correctness", "PASS", `flags=${dc.totals?.flags ?? 0}`);
    } catch (e) {
      rec("grid:data-correctness", "FAIL", e.message);
    }
  }

  if (process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    run("npm run validate:grid-e2e", "grid:dashboard-e2e");
  } else {
    rec("grid:dashboard-e2e", "SKIP", "Clerk keys not set");
  }

  run("npm run ops:collect", "ops:collect");

  const fails = checks.filter((c) => c.status === "FAIL");
  const reportPath = join(OUT, `grid-rth-${ymd}-${PHASE}-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ ts: now.toISOString(), phase: PHASE, checks }, null, 2));

  console.log(`\n=== Summary (${PHASE}) ===`);
  console.log(`  FAIL: ${fails.length} / ${checks.length}`);
  console.log(`  Report: ${reportPath}\n`);

  if (fails.length) {
    fails.forEach((f) => console.log(`  · ${f.name}: ${f.detail ?? ""}`));
    process.exit(1);
  }
  console.log("GREEN — Grid/0DTE audit passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
