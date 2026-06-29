#!/usr/bin/env node
/**
 * Collect prod ops action items for autonomous agent dispatch.
 * Outputs JSON to stdout: { generated_at, fingerprint, items[] }
 *
 * Env:
 *   DATABASE_PUBLIC_URL / DATABASE_URL — Postgres (cron + error_events)
 *   CRON_SECRET — optional; enables live watchdog + data-correctness probe
 *   CRON_TARGET_BASE_URL — optional (default https://blackouttrades.com)
 *
 * Usage:
 *   node scripts/ops-collect-action-items.mjs
 *   node scripts/ops-collect-action-items.mjs --pretty
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const pretty = process.argv.includes("--pretty");
const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const CRON = process.env.CRON_SECRET?.trim() ?? "";
const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;

/** @typedef {{ id: string, priority: 'P0'|'P1'|'P2', source: string, title: string, detail: string }} ActionItem */

/** @type {ActionItem[]} */
const items = [];

function add(priority, source, id, title, detail) {
  items.push({ id, priority, source, title, detail: String(detail).slice(0, 500) });
}

async function postgresItems() {
  if (!dbUrl) return;
  const c = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await c.connect();
  const q = async (sql, params) => (await c.query(sql, params)).rows;

  const JOB_KEYS = [
    "flow-ingest", "spx-evaluate", "largo-cleanup", "nighthawk-outcomes", "nighthawk-playbook",
    "uw-cache-refresh", "nights-watch-warm", "heatmap-warm", "grid-warm", "gex-eod-snapshot",
    "gex-alerts", "db-cleanup", "membership-reconcile", "data-integrity", "data-correctness",
    "cron-staleness-watchdog", "spx-signal-observe", "spx-signal-weight-optimize",
    "nighthawk-morning-confirm", "market-regime-detector", "positions-expiry",
  ];

  const valuesClause = JOB_KEYS.map((_, i) => `($${i + 1})`).join(", ");
  const zeroRuns = (
    await q(
      `SELECT j.key AS job_key FROM (VALUES ${valuesClause}) AS j(key)
       LEFT JOIN (SELECT job_key, COUNT(*)::int AS cnt FROM cron_job_runs GROUP BY job_key) c
         ON c.job_key = j.key WHERE COALESCE(c.cnt, 0) = 0 ORDER BY j.key`,
      JOB_KEYS
    )
  ).map((r) => r.job_key);
  for (const key of zeroRuns) {
    add("P0", "cron", `cron:${key}:never-fired`, `Cron never fired: ${key}`, "Zero rows in cron_job_runs — Railway service or config-as-code likely missing.");
  }

  const failedRecent = await q(
    `SELECT DISTINCT ON (job_key) job_key, status, message, started_at
     FROM cron_job_runs
     WHERE status = 'failed' AND started_at > NOW() - INTERVAL '4 hours'
     ORDER BY job_key, started_at DESC`
  );
  for (const r of failedRecent) {
    add("P0", "cron", `cron:${r.job_key}:failed`, `Cron failed: ${r.job_key}`, `${r.message ?? "failed"} @ ${String(r.started_at).slice(0, 19)}Z`);
  }

  const badLatest = await q(
    `SELECT job_key, status, message, started_at FROM cron_job_runs
     WHERE (job_key, started_at) IN (SELECT job_key, MAX(started_at) FROM cron_job_runs GROUP BY job_key)
       AND status NOT IN ('ok', 'skipped')`
  );
  for (const r of badLatest) {
    if (failedRecent.some((f) => f.job_key === r.job_key)) continue;
    add("P1", "cron", `cron:${r.job_key}:bad-latest`, `Cron latest not ok: ${r.job_key}`, `${r.status}: ${r.message ?? ""}`);
  }

  const err15 = (await q("SELECT COUNT(*)::int AS n FROM error_events WHERE created_at > NOW() - INTERVAL '15 minutes'"))[0].n;
  if (err15 >= 75) {
    add("P0", "errors", "errors:spike-critical", `Error spike: ${err15} in 15m`, "error_events count exceeds critical threshold (75/15m).");
  } else if (err15 >= 25) {
    add("P1", "errors", "errors:spike-warn", `Error spike: ${err15} in 15m`, "error_events count exceeds warning threshold (25/15m).");
  }

  const topErr = await q(
    `SELECT source, scope, COUNT(*)::int AS n FROM error_events
     WHERE created_at > NOW() - INTERVAL '15 minutes'
     GROUP BY source, scope ORDER BY n DESC LIMIT 3`
  );
  if (err15 >= 25 && topErr.length) {
    const detail = topErr.map((g) => `${g.source}${g.scope ? `/${g.scope}` : ""} ×${g.n}`).join("; ");
    items[items.length - 1].detail += ` Top: ${detail}`;
  }

  await c.end();
}

async function httpItems() {
  if (!CRON) return;
  const H = { Authorization: `Bearer ${CRON}` };

  try {
    const w = await fetch(`${BASE}/api/cron/cron-staleness-watchdog`, { headers: H });
    const wj = await w.json().catch(() => ({}));
    if (w.status !== 200) {
      add("P0", "watchdog", "watchdog:http", "Cron watchdog HTTP error", `HTTP ${w.status}`);
    } else {
      for (const key of wj.rth_stale_keys ?? []) {
        add("P0", "watchdog", `watchdog:rth-stale:${key}`, `RTH stale cron: ${key}`, "market_hours_stale during RTH — live data warmer may be down.");
      }
      for (const key of wj.problem_keys ?? []) {
        if ((wj.rth_stale_keys ?? []).includes(key)) continue;
        add("P1", "watchdog", `watchdog:problem:${key}`, `Cron health problem: ${key}`, "stale or failed per cron-staleness-watchdog.");
      }
      if (wj.error_spike === "critical") {
        add("P0", "watchdog", "watchdog:error-spike", `Prod error spike (${wj.error_spike})`, `${wj.error_count} errors in ${wj.error_window_min}m`);
      } else if (wj.error_spike === "warning") {
        add("P1", "watchdog", "watchdog:error-spike", `Prod error spike (${wj.error_spike})`, `${wj.error_count} errors in ${wj.error_window_min}m`);
      }
    }
  } catch (e) {
    add("P1", "watchdog", "watchdog:fetch", "Cron watchdog fetch failed", e.message);
  }

  try {
    const dc = await fetch(`${BASE}/api/cron/data-correctness?force=1`, { headers: H });
    const dj = await dc.json().catch(() => ({}));
    if (dc.status === 200 && (dj.flags?.length ?? 0) > 0) {
      const top = dj.flags.slice(0, 5).map((f) => `[${f.layer}/${f.metric}] ${f.detail}`).join("; ");
      add("P0", "correctness", "correctness:flags", `${dj.flags.length} data-correctness FLAG(s)`, top);
    }
  } catch {
    /* optional probe */
  }
}

await postgresItems();
await httpItems();

// Dedupe by id (watchdog + postgres may overlap)
const seen = new Set();
const unique = items.filter((it) => {
  if (seen.has(it.id)) return false;
  seen.add(it.id);
  return true;
});

unique.sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id));

const fingerprint = createHash("sha256")
  .update(unique.map((i) => i.id).sort().join("|"))
  .digest("hex")
  .slice(0, 12);

const payload = {
  generated_at: new Date().toISOString(),
  fingerprint,
  count: unique.length,
  items: unique,
};

if (pretty) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(JSON.stringify(payload));
}

process.exit(unique.length ? 1 : 0);
