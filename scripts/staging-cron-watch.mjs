#!/usr/bin/env node
/**
 * Staging cron watchdog — continuous RTH monitoring via staleness snapshot + periodic full audit.
 *
 * Usage:
 *   node scripts/staging-cron-watch.mjs
 *   node scripts/staging-cron-watch.mjs --once
 *   node scripts/staging-cron-watch.mjs --interval=180
 */
import { execSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { etParts } from "./gha-et-window.mjs";

const args = process.argv.slice(2);
const once = args.includes("--once");
const intervalArg = args.find((a) => a.startsWith("--interval="));
const INTERVAL_MS = intervalArg
  ? Math.max(60_000, parseInt(intervalArg.slice("--interval=".length), 10) * 1000)
  : 3 * 60_000;

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, "staging-cron-watch.log");

let cycle = 0;

function log(entry) {
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() });
  appendFileSync(LOG, line + "\n");
  const icon = entry.ok ? "✓" : "✗";
  console.log(`${icon} [cron-watch ${entry.cycle}] ${entry.msg}`);
}

function loadCron() {
  const raw = execSync(
    'aws secretsmanager get-secret-value --secret-id blackout-staging/app/env --query SecretString --output text',
    { encoding: "utf8" }
  );
  return JSON.parse(raw).CRON_SECRET?.trim();
}

async function stalenessProbe(cron) {
  const res = await fetchRetry(
    `${BASE}/api/cron/cron-staleness-watchdog`,
    { headers: { Authorization: `Bearer ${cron}` } },
    { retries: 3, timeoutMs: 120_000 }
  );
  const body = await res.json();
  return {
    ok: res.status === 200 && body.ok && (body.problems ?? 0) === 0 && (body.rth_stale ?? 0) === 0,
    status: res.status,
    body,
  };
}

async function adminCronHealth(cookieHeader) {
  if (!cookieHeader) return null;
  const res = await fetchRetry(
    `${BASE}/api/admin/health`,
    { headers: { Cookie: cookieHeader } },
    { retries: 2, timeoutMs: 60_000 }
  );
  if (res.status !== 200) return null;
  const body = await res.json();
  return body.cron_health ?? body.crons ?? null;
}

function fullAudit() {
  const infra = join(process.cwd(), "..", "blackout-infra");
  const script = join(infra, "scripts", "audit-staging-crons.mjs");
  try {
    const r = spawnSync("node", [script], { encoding: "utf8", cwd: infra, timeout: 10 * 60_000 });
    const passed = (r.stdout || "").match(/(\d+)\/(\d+) passed/);
    return {
      ok: r.status === 0,
      summary: passed ? `${passed[1]}/${passed[2]} passed` : (r.stdout || r.stderr || "").slice(-200),
    };
  } catch (e) {
    return { ok: false, summary: e.message };
  }
}

async function cycleOnce() {
  cycle++;
  const et = etParts();
  const cron = loadCron();
  if (!cron) {
    log({ cycle, ok: false, msg: "CRON_SECRET missing" });
    return false;
  }

  const sw = await stalenessProbe(cron);
  const problems = sw.body?.problem_keys ?? [];
  const rthStale = sw.body?.rth_stale_keys ?? [];
  const errors = sw.body?.error_count ?? 0;

  if (sw.ok) {
    log({
      cycle,
      ok: true,
      msg: `staleness GREEN — 27 jobs checked, errors=${errors}, self_healed=${(sw.body?.self_healed ?? []).length}`,
    });
  } else {
    log({
      cycle,
      ok: false,
      msg: `staleness RED — problems=${problems.join(",") || "none"} rth_stale=${rthStale.join(",") || "none"} errors=${errors}`,
    });
  }

  // Full Lambda audit every 10 cycles (~30 min) during RTH
  if (cycle % 10 === 0 && et.mins >= 9 * 60 + 30 && et.mins <= 16 * 60 + 15) {
    const audit = fullAudit();
    log({ cycle, ok: audit.ok, msg: `full audit: ${audit.summary}` });
    if (!audit.ok) return false;
  }

  return sw.ok;
}

async function main() {
  console.log(`Staging cron watch — every ${INTERVAL_MS / 1000}s → ${LOG}\n`);
  do {
    await cycleOnce();
    if (once) process.exit(0);
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  } while (true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
