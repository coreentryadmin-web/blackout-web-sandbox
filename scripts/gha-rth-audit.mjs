#!/usr/bin/env node
/**
 * GitHub Actions RTH audit — no Railway CLI required.
 *
 * Env (GitHub Actions secrets):
 *   CRON_SECRET          — required (premium API + cron routes)
 *   POLYGON_API_KEY      — optional (SPX oracle in full-site audit)
 *   DATABASE_PUBLIC_URL  — optional (Postgres writer/cron freshness checks)
 *   SENTRY_AUTH_TOKEN    — optional (Sentry token smoke)
 *   CRON_TARGET_BASE_URL — optional (default https://blackouttrades.com)
 *
 * Usage:
 *   node scripts/gha-rth-audit.mjs
 *   node scripts/gha-rth-audit.mjs --smoke-only
 *   node scripts/gha-rth-audit.mjs --force   # Postgres RTH checks even off-hours
 */
import { spawnSync } from "node:child_process";
import { etParts, inRthOpenWindow, isTradingDayEt, todayEtYmd } from "./gha-et-window.mjs";
import { auditPgSsl, resolveAuditDbUrl } from "./pg-audit.mjs";

const smokeOnly = process.argv.includes("--smoke-only");
const force = process.argv.includes("--force");
const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const CRON = process.env.CRON_SECRET?.trim() ?? "";

if (!CRON) {
  console.error("[gha-rth-audit] CRON_SECRET is required");
  process.exit(1);
}

const failures = [];
const { label: etLabel } = etParts();
const rthOpen = inRthOpenWindow();

function run(label, cmd, args, extraEnv = {}) {
  console.log(`\n── ${label} ──`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, CRON_TARGET_BASE_URL: BASE, ...extraEnv },
  });
  if (r.status !== 0) failures.push(label);
  return r.status === 0;
}

async function postgresRthChecks() {
  const dbUrl = resolveAuditDbUrl();
  if (!dbUrl) {
    console.log("\n── Postgres RTH checks ──");
    console.log("  ⚠ DATABASE_PUBLIC_URL not set — skipping");
    return;
  }

  console.log(`\n── Postgres RTH checks (${etLabel}) ──`);
  if (!force && !inRthOpenWindow()) {
    console.log("  ⚠ Off-hours / weekend — skipping market-hours Postgres checks (use --force to override)");
    return;
  }

  const tradingDay = isTradingDayEt(todayEtYmd());
  if (!tradingDay) {
    console.log(
      `  ⚠ ${todayEtYmd()} is not a US equity trading session (market holiday) — skipping writer/regime freshness checks`
    );
  }

  try {
    const pg = await import("pg");
    const c = new pg.default.Client({
      connectionString: dbUrl,
      ssl: auditPgSsl(dbUrl),
    });
    await c.connect();

    const q = async (sql) => (await c.query(sql)).rows;
    const ok = (m) => console.log(`  ✓ ${m}`);
    const fail = (m) => {
      failures.push(`postgres: ${m}`);
      console.log(`  ✗ ${m}`);
    };

    if (tradingDay) {
      const eval20 = (await q(
        `SELECT COUNT(*)::int AS n FROM cron_job_runs
         WHERE job_key = 'spx-evaluate' AND started_at > NOW() - INTERVAL '20 minutes' AND status = 'ok'`
      ))[0].n;
      if (eval20 > 0) ok(`spx-evaluate ok in last 20m (${eval20})`);
      else fail("spx-evaluate: no ok run in last 20m");

      const regime20 = (await q(
        `SELECT COUNT(*)::int AS n FROM market_regime WHERE captured_at > NOW() - INTERVAL '20 minutes'`
      ))[0].n;
      if (regime20 > 0) ok(`market_regime writes last 20m: ${regime20}`);
      else fail("market_regime: no writes in last 20m");

      const stale = await q(
        `SELECT job_key, status, started_at FROM cron_job_runs
         WHERE job_key IN ('heatmap-warm','flow-ingest','nights-watch-warm')
         AND started_at > NOW() - INTERVAL '30 minutes'
         AND status = 'ok'`
      );
      if (stale.length >= 2) ok(`Writer crons active (${stale.map((r) => r.job_key).join(", ")})`);
      else fail(`Writer crons thin in last 30m — only ${stale.length} ok runs`);
    }

    const dc = await q(
      `SELECT status, message FROM cron_job_runs WHERE job_key = 'data-correctness' ORDER BY started_at DESC LIMIT 1`
    );
    const latest = dc[0];
    if (latest?.status === "ok") ok("data-correctness latest run ok");
    else fail(`data-correctness latest: ${latest?.status ?? "?"} — ${latest?.message ?? ""}`);

    await c.end();
  } catch (e) {
    failures.push(`postgres: ${e.message}`);
    console.log(`  ✗ Postgres: ${e.message}`);
  }
}

async function cronHttpChecks() {
  console.log("\n── Cron HTTP checks ──");
  const H = { Authorization: `Bearer ${CRON}` };
  const routes = [
    { path: "/api/cron/data-correctness?force=1", label: "data-correctness" },
    { path: "/api/cron/data-integrity?force=1", label: "data-integrity" },
    { path: "/api/cron/provider-health-reconcile?force=1", label: "provider-health" },
    { path: "/api/cron/cron-staleness-watchdog", label: "cron-watchdog" },
    { path: "/api/cron/socket-health", label: "socket-health" },
  ];

  for (const { path, label } of routes) {
    try {
      const res = await fetch(`${BASE}${path}`, { headers: H });
      const json = await res.json().catch(() => ({}));
      if (res.status !== 200) {
        failures.push(`${label}: HTTP ${res.status}`);
        console.log(`  ✗ ${label} → HTTP ${res.status}`);
        continue;
      }
      if (label === "data-correctness" && (json.flags?.length ?? 0) > 0) {
        failures.push(`${label}: ${json.flags.length} flags`);
        console.log(`  ✗ ${label} → ${json.flags.length} flags`);
        for (const f of json.flags.slice(0, 5)) console.log(`      [${f.layer}/${f.metric}] ${f.detail}`);
      } else if (label === "data-integrity" && (json.discrepancies ?? json.issues?.length ?? 0) > 0) {
        failures.push(`${label}: discrepancies`);
        console.log(`  ✗ ${label} → discrepancies`);
      } else if (label === "cron-watchdog" && (json.problems ?? 0) > 0) {
        failures.push(`${label}: ${(json.problem_keys ?? []).join(", ")}`);
        console.log(`  ✗ ${label} → stale: ${(json.problem_keys ?? []).join(", ")}`);
      } else if (label === "socket-health" && json.ok === false) {
        const opt = json.websockets?.options?.detail ?? "options unhealthy";
        const luld = json.websockets?.stocks_luld?.detail ?? "";
        failures.push(`${label}: ${opt}${luld ? `; LULD: ${luld}` : ""}`);
        console.log(`  ✗ ${label} → ${opt}`);
      } else {
        console.log(`  ✓ ${label} → ok`);
      }
    } catch (e) {
      failures.push(`${label}: ${e.message}`);
      console.log(`  ✗ ${label} → ${e.message}`);
    }
  }
}

console.log(`\n=== GitHub Actions RTH audit ===`);
console.log(`Target: ${BASE}`);
console.log(`Time:   ${new Date().toISOString()} (${etLabel})`);
console.log(`RTH:    ${rthOpen ? "open" : "closed/off-hours"}${force ? " (--force)" : ""}\n`);

// Public HTTP smoke (always)
run("Public HTTP smoke", "node", ["scripts/gha-http-smoke.mjs"]);

// Optional Sentry token smoke (never fails the run when token absent)
run("Sentry smoke", "node", ["scripts/gha-sentry-smoke.mjs"]);

if (!smokeOnly) {
  run("Full-site deep audit", "node", ["scripts/full-site-deep-audit.mjs"]);
  await cronHttpChecks();
  await postgresRthChecks();
}

console.log("\n=== Summary ===");
if (failures.length) {
  console.error(`FAILED (${failures.length}):`);
  failures.forEach((f) => console.error(`  · ${f}`));
  process.exit(1);
}
console.log("GREEN — GHA RTH audit passed.\n");
