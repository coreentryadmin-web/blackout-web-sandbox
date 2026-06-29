#!/usr/bin/env node
/**
 * Pull prod env from Railway CLI and audit Postgres + Redis layers.
 * Requires: railway CLI linked to BlackoutTrades.com project.
 * Usage: node scripts/railway-layer-audit.mjs
 */
import { execSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const Redis = require("ioredis");

function railwayJson(service) {
  const raw = execSync(`railway variable list --service ${service} --json`, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(raw);
}

const issues = [];
function fail(id, detail) {
  issues.push({ id, detail });
  console.log(`[FAIL] ${id}: ${detail}`);
}

console.log("\n=== Railway Layer Audit ===\n");

const pg = railwayJson("Postgres");
const redisVars = railwayJson("Redis");

const pgClient = new Client({
  connectionString: pg.DATABASE_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});
await pgClient.connect();

const q = async (sql) => (await pgClient.query(sql)).rows;
const playClosed = (await q("SELECT COUNT(*)::int AS n FROM spx_play_outcomes WHERE outcome != 'open'"))[0].n;
const sigTotal = (
  await q(
    `SELECT COUNT(*) FILTER (WHERE so.direction_correct IS NOT NULL)::int AS n
     FROM signal_outcomes so JOIN signal_events se ON se.id = so.signal_event_id
     WHERE se.signal_source = 'SPX_SLAYER' AND so.checkpoint = 'T+30'`
  )
)[0].n;

console.log(`Postgres: spx_play_outcomes closed=${playClosed}, signal_outcomes SPX T+30=${sigTotal}`);
if (playClosed > 0 && sigTotal === 0) {
  fail("P1-TR-SPLIT", `Ledger has ${playClosed} closed plays; signal_outcomes has 0`);
}

const nhCrons = await q(
  `SELECT job_key, status, started_at FROM cron_job_runs
   WHERE job_key IN ('nighthawk-playbook','nighthawk-outcomes')
   ORDER BY started_at DESC LIMIT 5`
);
console.log("\nRecent NH crons:");
for (const r of nhCrons) {
  console.log(`  ${r.job_key} ${r.status} ${String(r.started_at).slice(0, 19)}`);
}

await pgClient.end();

const r = new Redis(redisVars.REDIS_PUBLIC_URL, { family: 0, maxRetriesPerRequest: 2 });
await r.ping();
const gexKeys = await r.keys("gex-heatmap:*");
const gridKeys = await r.keys("grid:*");
console.log(`\nRedis: gex-heatmap:*=${gexKeys.length}, grid:*=${gridKeys.length}`);
await r.quit();

console.log(`\nIssues: ${issues.length}`);
process.exit(issues.length ? 1 : 0);
