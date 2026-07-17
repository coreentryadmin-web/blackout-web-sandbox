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
import { ALL_CRON_KEYS } from "./cron-jobs.mjs";
import { createAuditClient, resolveAuditDbUrl } from "./pg-audit.mjs";

const pretty = process.argv.includes("--pretty");
const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const CRON = process.env.CRON_SECRET?.trim() ?? "";
const dbUrl = resolveAuditDbUrl();

/** @typedef {{ id: string, priority: 'P0'|'P1'|'P2', source: string, title: string, detail: string }} ActionItem */

/** @type {ActionItem[]} */
const items = [];

function add(priority, source, id, title, detail) {
  items.push({ id, priority, source, title, detail: String(detail).slice(0, 500) });
}

async function postgresItems() {
  if (!dbUrl) return;
  const c = createAuditClient(dbUrl);
  await c.connect();
  const q = async (sql, params) => (await c.query(sql, params)).rows;

  const JOB_KEYS = [...ALL_CRON_KEYS];

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
    `SELECT DISTINCT ON (f.job_key) f.job_key, f.status, f.message, f.started_at
     FROM cron_job_runs f
     WHERE f.status = 'failed'
       AND f.started_at > NOW() - INTERVAL '4 hours'
       AND NOT EXISTS (
         SELECT 1
         FROM cron_job_runs newer
         WHERE newer.job_key = f.job_key
           AND newer.started_at > f.started_at
           AND newer.status IN ('ok', 'skipped')
       )
     ORDER BY f.job_key, f.started_at DESC`
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

  // Night Hawk: after the edition window, tomorrow's row should be published (plays or recap-only).
  // Older stuck/failed rows are superseded once a later edition publishes; don't keep paging on them.
  const staleJobs = await q(
    `SELECT edition_for::text, status, current_stage, updated_at
     FROM nighthawk_jobs j
     WHERE j.status NOT IN ('published', 'failed')
       AND j.updated_at < NOW() - INTERVAL '4 hours'
       AND NOT EXISTS (
         SELECT 1 FROM nighthawk_jobs newer
         WHERE newer.edition_for > j.edition_for
           AND newer.status = 'published'
       )`
  );
  for (const r of staleJobs) {
    add(
      "P1",
      "nighthawk",
      `nighthawk:stale-job:${r.edition_for}`,
      `Night Hawk job stuck: ${r.edition_for}`,
      `status=${r.status} stage=${r.current_stage ?? "?"} updated=${String(r.updated_at).slice(0, 19)}Z`
    );
  }

  const failedJobs = await q(
    `SELECT j.edition_for::text, j.error, j.updated_at FROM nighthawk_jobs j
     WHERE j.status = 'failed'
       AND j.updated_at > NOW() - INTERVAL '36 hours'
       AND NOT EXISTS (
         SELECT 1 FROM nighthawk_jobs newer
         WHERE newer.edition_for > j.edition_for
           AND newer.status = 'published'
       )
     ORDER BY j.updated_at DESC LIMIT 3`
  );
  for (const r of failedJobs) {
    add(
      "P1",
      "nighthawk",
      `nighthawk:failed-job:${r.edition_for}`,
      `Night Hawk build failed: ${r.edition_for}`,
      String(r.error ?? "failed").slice(0, 200)
    );
  }

  await c.end();
}

async function fetchWithTimeout(url, headers, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: ac.signal });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* HTML 524 page */
    }
    return { status: r.status, json };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 0, json: null, err: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function httpItems() {
  if (!CRON) return;
  const H = { Authorization: `Bearer ${CRON}` };

  try {
    // Cloudflare origin timeout is ~100s; self-heal used to block the watchdog past that.
    // 90s cap + one retry avoids a transient 524 becoming a standing P0.
    const WATCHDOG_TIMEOUT_MS = 90_000;
    let w = await fetchWithTimeout(`${BASE}/api/cron/cron-staleness-watchdog`, H, WATCHDOG_TIMEOUT_MS);
    if (w.status === 524 || w.status === 0) {
      await new Promise((r) => setTimeout(r, 2000));
      w = await fetchWithTimeout(`${BASE}/api/cron/cron-staleness-watchdog`, H, WATCHDOG_TIMEOUT_MS);
    }
    const wj = w.json ?? {};
    if (w.status !== 200) {
      add("P0", "watchdog", "watchdog:http", "Cron watchdog HTTP error", `HTTP ${w.status}${w.err ? ` (${w.err})` : ""}`);
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
    const dc = await fetchWithTimeout(`${BASE}/api/cron/data-correctness?force=1`, H, 90_000);
    const dj = dc.json ?? {};
    if (dc.status === 200 && (dj.flags?.length ?? 0) > 0) {
      const top = dj.flags.slice(0, 5).map((f) => `[${f.layer}/${f.metric}] ${f.detail}`).join("; ");
      add("P0", "correctness", "correctness:flags", `${dj.flags.length} data-correctness FLAG(s)`, top);
    }
  } catch {
    /* optional probe */
  }

  try {
    const nh = await fetch(`${BASE}/api/cron/nighthawk-edition?status=1`, { headers: H });
    const nj = await nh.json().catch(() => ({}));
    if (nh.status === 200 && nj.edition_for) {
      const ed = await fetch(`${BASE}/api/market/nighthawk/edition?date=${nj.edition_for}`, { headers: H });
      const ej = await ed.json().catch(() => ({}));
      const playCount = Array.isArray(ej.plays) ? ej.plays.length : 0;
      const inWindow = inEtEditionCatchup();
      if (inWindow && nj.job_status !== "published") {
        add(
          "P0",
          "nighthawk",
          `nighthawk:unpublished:${nj.edition_for}`,
          `Night Hawk edition not published: ${nj.edition_for}`,
          `job_status=${nj.job_status ?? "?"} stage=${nj.current_stage ?? "?"} error=${nj.error ?? "none"}`
        );
      } else if (inWindow && nj.job_status === "published" && playCount === 0 && !ej.recap_only) {
        add(
          "P1",
          "nighthawk",
          `nighthawk:zero-plays:${nj.edition_for}`,
          `Night Hawk published with zero plays: ${nj.edition_for}`,
          "Edition row exists but plays=[] without recap_only — investigate funnel collapse."
        );
      } else if (inWindow && nj.job_status === "published" && playCount > 0 && playCount < 3) {
        const funnel = ej.meta?.funnel ?? {};
        const synthesized = Number(funnel.synthesized ?? 0);
        const candidates = Number(ej.meta?.candidates ?? 0);
        // Only page when the pipeline had depth but over-pruned — not when Claude genuinely
        // returned few plays (synthesized < 3) or backfill already topped up to the ops floor.
        const overPruned =
          candidates >= 20 &&
          (synthesized === 0
            ? true // legacy rows without funnel meta but a deep candidate pool
            : synthesized >= 5 || (synthesized >= 3 && synthesized - playCount >= 2));
        if (overPruned) {
          add(
            "P2",
            "nighthawk",
            `nighthawk:thin-edition:${nj.edition_for}`,
            `Night Hawk thin edition (${playCount} plays): ${nj.edition_for}`,
            `Critic/grounding may be over-pruning — funnel synthesized=${synthesized || "?"} candidates=${candidates || "?"}.`
          );
        }
      }
    }
  } catch (e) {
    add("P2", "nighthawk", "nighthawk:probe", "Night Hawk health probe failed", e.message);
  }
}

/** True during 5:30–7:30 PM ET catchup on weekdays (edition should land). */
function inEtEditionCatchup(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const mins = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  const target = 17 * 60 + 30;
  return mins >= target + 60 && mins <= target + 120;
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
