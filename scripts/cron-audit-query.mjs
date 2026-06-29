#!/usr/bin/env node
/**
 * Prod audit: latest cron_job_runs per registered job + zero-run detection.
 * Env: DATABASE_PUBLIC_URL or DATABASE_URL (required)
 *
 * Usage: npm run validate:cron
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const JOB_KEYS = [
  "flow-ingest",
  "spx-evaluate",
  "largo-cleanup",
  "nighthawk-outcomes",
  "nighthawk-playbook",
  "uw-cache-refresh",
  "nights-watch-warm",
  "heatmap-warm",
  "grid-warm",
  "gex-eod-snapshot",
  "gex-alerts",
  "db-cleanup",
  "membership-reconcile",
  "data-integrity",
  "provider-health-reconcile",
  "data-correctness",
  "cron-staleness-watchdog",
  "spx-signal-observe",
  "spx-signal-weight-optimize",
  "nighthawk-morning-confirm",
  "market-regime-detector",
  "positions-expiry",
];

/** Registered in code + TOML but Railway trigger service not yet provisioned — warn, don't fail CI. */
const PROVISION_PENDING = new Set([]);

const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("[cron-audit] DATABASE_PUBLIC_URL not set");
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrl,
  ssl: dbUrl.includes("localhost") ? false : { rejectUnauthorized: false },
});
await client.connect();

const q = async (sql, params) => (await client.query(sql, params)).rows;

console.log("\n=== CRON AUDIT: latest run per job_key ===\n");
const latest = await q(
  `SELECT job_key, status, started_at, LEFT(COALESCE(message,''),80) AS msg
   FROM cron_job_runs
   WHERE (job_key, started_at) IN (
     SELECT job_key, MAX(started_at) FROM cron_job_runs GROUP BY job_key
   )
   ORDER BY job_key`
);
for (const r of latest) {
  console.log(`${r.job_key}\t${r.status}\t${String(r.started_at).slice(0, 19)}\t${r.msg ?? ""}`);
}

const valuesClause = JOB_KEYS.map((_, i) => `($${i + 1})`).join(", ");
console.log("\n=== CRON AUDIT: total runs (all 21 keys) ===\n");
const totals = await q(
  `SELECT j.key AS job_key, COALESCE(c.cnt,0)::int AS total_runs
   FROM (VALUES ${valuesClause}) AS j(key)
   LEFT JOIN (SELECT job_key, COUNT(*)::int AS cnt FROM cron_job_runs GROUP BY job_key) c
     ON c.job_key = j.key
   ORDER BY total_runs ASC, job_key`,
  JOB_KEYS
);
for (const r of totals) {
  console.log(`${r.job_key}\t${r.total_runs}`);
}

const zeroRuns = totals.filter((r) => r.total_runs === 0).map((r) => r.job_key);
const pendingZero = zeroRuns.filter((k) => PROVISION_PENDING.has(k));
const fatalZero = zeroRuns.filter((k) => !PROVISION_PENDING.has(k));
const badLatest = latest.filter((r) => r.status !== "ok" && r.status !== "skipped");

console.log("\n=== CRON AUDIT: summary ===\n");
console.log(`Jobs with zero runs ever: ${zeroRuns.length ? zeroRuns.join(", ") : "(none)"}`);
if (pendingZero.length) {
  console.log(`Provision pending (expected zero until Railway wired): ${pendingZero.join(", ")}`);
}
console.log(`Jobs with latest status != ok/skipped: ${badLatest.length ? badLatest.map((r) => r.job_key).join(", ") : "(none)"}`);

await client.end();
process.exit(fatalZero.length || badLatest.length ? 1 : 0);
