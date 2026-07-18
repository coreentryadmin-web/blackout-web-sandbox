#!/usr/bin/env node
/**
 * Staging ops action items — Postgres cron health + live HTTP probes.
 *
 * Usage:
 *   npm run ops:collect:staging
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createAuditClient } from "./pg-audit.mjs";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";

const pretty = process.argv.includes("--pretty");
const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";

/** @type {{ id: string, priority: 'P0'|'P1'|'P2', source: string, title: string, detail: string }[]} */
const items = [];

function add(priority, source, id, title, detail) {
  items.push({ id, priority, source, title, detail: String(detail).slice(0, 500) });
}

function loadSecret() {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`,
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

async function postgresItems(dbUrl) {
  const c = createAuditClient(dbUrl);
  await c.connect();
  const failedRecent = (
    await c.query(
      `SELECT DISTINCT ON (job_key) job_key, status, message, started_at
       FROM cron_job_runs
       WHERE status = 'failed' AND started_at > NOW() - INTERVAL '4 hours'
       ORDER BY job_key, started_at DESC`
    )
  ).rows;
  for (const r of failedRecent) {
    add("P0", "cron", `staging:cron:${r.job_key}:failed`, `Staging cron failed: ${r.job_key}`, r.message ?? "failed");
  }
  await c.end();
}

async function liveItems(cron) {
  try {
    const ready = await fetchRetry(`${BASE}/api/ready`, {}, { retries: 2, timeoutMs: 30_000 });
    const body = await ready.json().catch(() => ({}));
    if (ready.status !== 200 || !body.ok) {
      add("P0", "http", "staging:ready", "Staging /api/ready not ok", `HTTP ${ready.status}`);
    }
  } catch (e) {
    add("P0", "http", "staging:ready", "Staging /api/ready unreachable", e.message);
  }

  if (cron) {
    try {
      const sh = await fetchRetry(
        `${BASE}/api/cron/socket-health`,
        { headers: { Authorization: `Bearer ${cron}` } },
        { retries: 2, timeoutMs: 60_000 }
      );
      const body = await sh.json();
      if (sh.status !== 200 || body.ok === false) {
        add("P1", "socket", "staging:socket-health", "Staging socket-health degraded", JSON.stringify(body).slice(0, 200));
      }
    } catch (e) {
      add("P1", "socket", "staging:socket-health", "Staging socket-health failed", e.message);
    }
  }
}

async function main() {
  let secret;
  try {
    secret = loadSecret();
  } catch (e) {
    add("P0", "aws", "staging:secrets", "Cannot load staging secret", e.message);
    secret = {};
  }

  const dbUrl = secret.DATABASE_URL?.trim();
  const cron = secret.CRON_SECRET?.trim();
  if (dbUrl) {
    try {
      await postgresItems(dbUrl);
    } catch (e) {
      const msg = e.message ?? String(e);
      // Staging RDS is VPC-private — Cloud Agent / laptop psql hits ECONNRESET.
      if (/ECONNRESET|ENOTFOUND|timeout|closed the connection/i.test(msg)) {
        add(
          "P2",
          "postgres",
          "staging:db:vpc-private",
          "Staging Postgres not reachable off-VPC (expected)",
          `${msg.split("\n")[0]} — use blackout-infra/scripts/compare-staging-prod-postgres.mjs or cron health APIs`
        );
      } else {
        add("P0", "postgres", "staging:db", "Staging Postgres audit failed", msg);
      }
    }
  }
  await liveItems(cron);

  const payload = {
    generated_at: new Date().toISOString(),
    base: BASE,
    fingerprint: createHash("sha256").update(JSON.stringify(items.map((i) => i.id))).digest("hex").slice(0, 16),
    items,
  };
  const out = pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
  console.log(out);
  process.exit(items.some((i) => i.priority === "P0") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
