#!/usr/bin/env node
/**
 * Post-deploy validation — run after every push to main (auto-deploy).
 *
 * Usage:
 *   node scripts/validate-deploy.mjs
 *   CRON_TARGET_BASE_URL=https://blackouttrades.com node scripts/validate-deploy.mjs
 *
 * Env (optional):
 *   DATABASE_PUBLIC_URL or DATABASE_URL — Postgres smoke (errors, cron, API telemetry)
 *   SENTRY_AUTH_TOKEN — Sentry dashboard check (ORG/PROJECT auto-discovered from token + DSN)
 *
 * Requires: curl, node 20+, pg (npm package)
 */

import { execSync } from "node:child_process";
import { ALL_CRON_KEYS } from "./cron-keys.mjs";
import { createAuditClient, resolveAuditDbUrl } from "./pg-audit.mjs";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const IS_STAGING = BASE.includes("staging.");
const failures = [];
const warnings = [];

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function warn(msg) {
  warnings.push(msg);
  console.log(`  ⚠ ${msg}`);
}
function fail(msg) {
  failures.push(msg);
  console.log(`  ✗ ${msg}`);
}

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function loadAwsSecrets(secretId) {
  try {
    const raw = sh(
      `aws secretsmanager get-secret-value --secret-id ${secretId} --query SecretString --output text`
    );
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function resolveCronSecret() {
  const fromEnv = process.env.CRON_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const secretId = IS_STAGING ? "blackout-staging/app/env" : "blackout-production/app/env";
  const secrets = loadAwsSecrets(secretId);
  return secrets.CRON_SECRET?.trim() ?? "";
}

/** Parse numeric project id from SENTRY_DSN (no secrets returned). */
function dsnProjectId(dsn) {
  const m = String(dsn ?? "").match(/@[^/]+\/(\d+)/);
  return m ? m[1] : null;
}

/** Resolve org slug (+ optional project slug) from token alone — ORG/PROJECT env not required. */
async function resolveSentryFromToken(token) {
  const orgRes = await fetch("https://sentry.io/api/0/organizations/", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!orgRes.ok) {
    throw new Error(`organizations API ${orgRes.status}`);
  }
  const orgs = await orgRes.json();
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new Error("token returned 0 organizations");
  }
  const org = orgs[0];
  let projectSlug = null;
  try {
    const projRes = await fetch(
      `https://sentry.io/api/0/organizations/${org.slug}/projects/`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (projRes.ok) {
      const projects = await projRes.json();
      const dsnId = dsnProjectId(appSecrets.SENTRY_DSN || appSecrets.NEXT_PUBLIC_SENTRY_DSN);
      if (dsnId && Array.isArray(projects)) {
        const hit = projects.find((p) => String(p.id) === dsnId);
        projectSlug = hit?.slug ?? null;
      }
      if (!projectSlug && projects?.length === 1) projectSlug = projects[0].slug;
    }
  } catch {
    /* project list optional */
  }
  return { orgSlug: org.slug, orgName: org.name, projectSlug };
}

const SENTRY_TEST_ISSUE = /wiring validation.*safe to resolve|DsnValidation.*Test event/i;

async function fetchSentryUnresolved(token, orgSlug, projectSlug) {
  const url = projectSlug
    ? `https://sentry.io/api/0/projects/${orgSlug}/${projectSlug}/issues/?query=is:unresolved&limit=25&statsPeriod=24h`
    : `https://sentry.io/api/0/organizations/${orgSlug}/issues/?query=is:unresolved&limit=25&statsPeriod=24h`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`issues API ${res.status}`);
  return res.json();
}

/** Auto-resolve known wiring/test events so the dashboard stays clean. */
async function resolveSentryTestIssues(token, issues) {
  let resolved = 0;
  for (const issue of issues) {
    const title = issue.title ?? issue.culprit ?? "";
    if (!SENTRY_TEST_ISSUE.test(title)) continue;
    const res = await fetch(`https://sentry.io/api/0/issues/${issue.id}/`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    if (res.ok) resolved += 1;
  }
  return resolved;
}

async function fetchJson(path, opts = {}) {
  const retries = IS_STAGING ? 4 : 1;
  const res = await fetchRetry(`${BASE}${path}`, opts, { retries, baseDelayMs: 1500, timeoutMs: 60_000 });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, body };
}

console.log("\n=== BlackOut post-deploy validation ===\n");
console.log(`Target: ${BASE}`);
console.log(`Time:   ${new Date().toISOString()}\n`);

// ── 1. ECS deploy ──────────────────────────────────────────────────────────
console.log("1. ECS service health");
try {
  const cluster = IS_STAGING ? "blackout-staging-cluster" : "blackout-production-cluster";
  const service = IS_STAGING ? "blackout-staging-web" : "blackout-production-web";
  const out = sh(
    `aws ecs describe-services --cluster ${cluster} --services ${service} --query "services[0].{status:status,running:runningCount,desired:desiredCount,pending:pendingCount}" --output json 2>/dev/null`
  );
  const svc = JSON.parse(out);
  if (svc.status === "ACTIVE" && svc.running >= svc.desired) {
    ok(`ECS ${service}: ${svc.running}/${svc.desired} running`);
  } else if (svc.pending > 0) {
    warn(`ECS ${service}: ${svc.running}/${svc.desired} running, ${svc.pending} pending`);
  } else {
    fail(`ECS ${service}: status=${svc.status} running=${svc.running} desired=${svc.desired}`);
  }
} catch (e) {
  warn(`ECS service check skipped: ${e.message}`);
}

// ── 2. Live HTTP smoke ──────────────────────────────────────────────────────
console.log("\n2. Live HTTP smoke");
const checks = [
  { path: "/api/health", expect: 200, field: (b) => b.ok === true },
  { path: "/api/ready", expect: 200, field: (b) => b.ok === true && b.db !== "unreachable" },
  { path: "/api/market/regime", expect: 200, field: (b) => IS_STAGING ? b.available === true || b.available === false : b.available === true },
  { path: "/api/public/track-record", expect: 401 },
  { path: "/api/signals/open", expect: 401 },
  { path: "/api/admin/debug-uw", expect: 401 },
  { path: "/api/engine/health", expect: 401 },
  { path: "/", expect: 200 },
  { path: "/sign-in", expect: 200 },
];

for (const c of checks) {
  try {
    const { status, body } = await fetchJson(c.path);
    const pass = status === c.expect && (c.field ? c.field(body) : true);
    if (pass) ok(`${c.path} → ${status}`);
    else fail(`${c.path} → ${status} (expected ${c.expect}) ${JSON.stringify(body).slice(0, 80)}`);
  } catch (e) {
    fail(`${c.path} fetch failed: ${e.message}`);
  }
}

// ── 2b. Desk cache warm (post-deploy cold-path guard) ───────────────────────
console.log("\n2b. Cache warmers");
const cronSecret = resolveCronSecret();
const warmPaths = IS_STAGING
  ? ["/api/cron/desk-warm?force=1", "/api/cron/heatmap-warm?force=1", "/api/cron/zerodte-warm?force=1"]
  : ["/api/cron/desk-warm?force=1"];
if (cronSecret) {
  for (const warmPath of warmPaths) {
    try {
      const t0 = Date.now();
      const warmRes = await fetchRetry(
        `${BASE}${warmPath}`,
        { headers: { Authorization: `Bearer ${cronSecret}` } },
        { retries: IS_STAGING ? 4 : 2, baseDelayMs: 1500, timeoutMs: 300_000 }
      );
      const warmBody = await warmRes.json().catch(() => ({}));
      const warmMs = Date.now() - t0;
      const label = warmPath.split("?")[0].replace("/api/cron/", "");
      if (warmRes.ok && warmBody.ok !== false) {
        ok(`${label} → ok (${warmMs}ms)`);
      } else if (warmRes.ok && warmBody.skipped) {
        warn(`${label} skipped (${warmMs}ms)`);
      } else {
        warn(`${label} → HTTP ${warmRes.status} (${warmMs}ms)`);
      }
    } catch (e) {
      warn(`${warmPath} failed: ${e.message}`);
    }
  }
} else {
  warn("CRON_SECRET unset — post-deploy cache warm skipped");
}

// ── 3. Postgres (errors, cron, rate limits) ─────────────────────────────────
console.log("\n3. Postgres / error sink / API telemetry");
const dbUrl = resolveAuditDbUrl();

if (IS_STAGING && dbUrl) {
  warn("Staging Postgres checks run on ECS only (RDS is private) — use cron_job_runs via /api/cron/*");
} else if (dbUrl) {
  try {
    const client = createAuditClient(dbUrl);
    await client.connect();

    const q = async (sql, params) => (await client.query(sql, params)).rows;
    const errors1h = (await q("SELECT COUNT(*)::int AS n FROM error_events WHERE created_at > NOW() - INTERVAL '1 hour'"))[0].n;
    const errors24h = (await q("SELECT COUNT(*)::int AS n FROM error_events WHERE created_at > NOW() - INTERVAL '24 hours'"))[0].n;
    // Latest run per job — historical failures during rolling deploys are not actionable.
    const cronLatest = await q(`
      SELECT DISTINCT ON (job_key) job_key, status, LEFT(COALESCE(message,''),60) AS msg
      FROM cron_job_runs
      ORDER BY job_key, started_at DESC
    `);
    const cronBad = cronLatest.filter((r) => !["ok", "skipped"].includes(r.status));
    const apiFail15m = (
      await q(
        "SELECT COUNT(*)::int AS n FROM api_telemetry_events WHERE at > NOW() - INTERVAL '15 minutes' AND ok = false AND rate_limited = false"
      )
    )[0].n;
    const rateLimited = (await q("SELECT COUNT(*)::int AS n FROM api_telemetry_events WHERE at > NOW() - INTERVAL '1 hour' AND rate_limited = true"))[0].n;
    const regime1h = (await q("SELECT COUNT(*)::int AS n FROM market_regime WHERE captured_at > NOW() - INTERVAL '1 hour'"))[0].n;
    const spxPlays = (await q("SELECT COUNT(*)::int AS n FROM spx_open_play WHERE opened_at > NOW() - INTERVAL '24 hours'"))[0].n;

    if (errors1h === 0) ok(`error_events last 1h: ${errors1h}`);
    else warn(`error_events last 1h: ${errors1h} (check Sentry / admin/errors)`);

    ok(`error_events last 24h: ${errors24h}`);
    ok(`market_regime writes last 1h: ${regime1h}`);
    ok(`spx_open_play last 24h: ${spxPlays}`);

    if (apiFail15m === 0) ok(`API telemetry failures last 15m (excl. rate-limit): ${apiFail15m}`);
    else warn(`API telemetry failures last 15m (excl. rate-limit): ${apiFail15m}`);

    if (rateLimited === 0) ok(`Rate-limited upstream calls last 1h: ${rateLimited}`);
    else ok(`Rate-limited upstream calls last 1h: ${rateLimited} (expected under burst)`);

    if (cronBad.length === 0) ok("All cron jobs latest run ok/skipped");
    else cronBad.forEach((r) => warn(`cron ${r.job_key} latest: ${r.status} — ${r.msg}`));

    const cronKeys = [...ALL_CRON_KEYS];
    const valuesClause = cronKeys.map((_, i) => `($${i + 1})`).join(", ");
    const zeroRuns = (
      await q(
        `SELECT j.key AS job_key FROM (VALUES ${valuesClause}) AS j(key)
         LEFT JOIN (SELECT job_key, COUNT(*)::int AS cnt FROM cron_job_runs GROUP BY job_key) c
           ON c.job_key = j.key
         WHERE COALESCE(c.cnt, 0) = 0
         ORDER BY j.key`,
        cronKeys
      )
    ).map((r) => r.job_key);
    if (zeroRuns.length === 0) ok(`All ${cronKeys.length} registered crons have run history`);
    else warn(`Cron jobs with zero runs ever (ECS cron task may be missing): ${zeroRuns.join(", ")}`);

    await client.end();
  } catch (e) {
    if (IS_STAGING && /ECONNRESET|ETIMEDOUT|ENOTFOUND|timeout|ECONNREFUSED/i.test(e.message)) {
      warn(`Postgres unreachable from this host (private RDS) — skipping DB checks: ${e.message}`);
    } else {
      fail(`Postgres query failed: ${e.message}`);
    }
  }
} else {
  warn("DATABASE_PUBLIC_URL not set — skipping Postgres checks");
}

// ── 4. Sentry (token only — auto-discovers org/project) ─────────────────────
console.log("\n4. Sentry");
const appSecrets = loadAwsSecrets(IS_STAGING ? "blackout-staging/app/env" : "blackout-production/app/env");
const sentryToken =
  process.env.SENTRY_AUTH_TOKEN?.trim() || appSecrets.SENTRY_AUTH_TOKEN?.trim() || "";
const sentryOrgOverride = process.env.SENTRY_ORG?.trim() || appSecrets.SENTRY_ORG?.trim() || "";
const sentryProjectOverride =
  process.env.SENTRY_PROJECT?.trim() || appSecrets.SENTRY_PROJECT?.trim() || "";

if (sentryToken) {
  try {
    const resolved = sentryOrgOverride
      ? { orgSlug: sentryOrgOverride, orgName: sentryOrgOverride, projectSlug: sentryProjectOverride || null }
      : await resolveSentryFromToken(sentryToken);
    ok(
      `Token valid — org: ${resolved.orgName} (${resolved.orgSlug})` +
        (resolved.projectSlug ? `, project: ${resolved.projectSlug}` : " (org-wide issues)")
    );
    let issues = await fetchSentryUnresolved(
      sentryToken,
      resolved.orgSlug,
      sentryProjectOverride || resolved.projectSlug
    );
    const autoResolved = await resolveSentryTestIssues(sentryToken, issues);
    if (autoResolved > 0) {
      ok(`Auto-resolved ${autoResolved} known test/wiring Sentry issue(s)`);
      issues = await fetchSentryUnresolved(
        sentryToken,
        resolved.orgSlug,
        sentryProjectOverride || resolved.projectSlug
      );
    }
    if (!issues.length) ok("Sentry dashboard: 0 unresolved issues (last 24h sample)");
    else {
      warn(`Sentry dashboard: ${issues.length} unresolved issue(s) in sample`);
      issues.slice(0, 5).forEach((i) => {
        const when = i.lastSeen ? new Date(i.lastSeen).toISOString().slice(0, 16) : "?";
        console.log(`       · [${when}] ${(i.title ?? i.culprit ?? "issue").slice(0, 90)}`);
      });
    }
  } catch (e) {
    if (IS_STAGING) warn(`Sentry API: ${e.message} — skipped on staging`);
    else fail(`Sentry API: ${e.message} — verify token scopes (event:read, org:read, project:read)`);
  }
} else {
  warn("SENTRY_AUTH_TOKEN not found — using error_events mirror");
  if (appSecrets.SENTRY_DSN) ok("SENTRY_DSN configured (capture forwarding active)");
  else warn("SENTRY_DSN not set");
}

// ── 4b. REPLICA_COUNT (UW/Polygon cluster rate-limit math) ───────────────────
console.log("\n4b. Cluster config");
const replicaCount = Math.max(
  0,
  Math.floor(Number(process.env.REPLICA_COUNT ?? appSecrets.REPLICA_COUNT ?? 0))
);
let runningReplicas = null;
try {
  const cluster = IS_STAGING ? "blackout-staging-cluster" : "blackout-production-cluster";
  const service = IS_STAGING ? "blackout-staging-web" : "blackout-production-web";
  const out = sh(
    `aws ecs describe-services --cluster ${cluster} --services ${service} --query "services[0].runningCount" --output text 2>/dev/null`
  );
  const n = Number(out);
  if (Number.isFinite(n)) runningReplicas = n;
} catch {
  /* optional */
}
if (replicaCount >= 1 && runningReplicas != null && replicaCount === runningReplicas) {
  ok(`REPLICA_COUNT=${replicaCount} matches ${runningReplicas} running replicas`);
} else if (replicaCount >= 1) {
  ok(`REPLICA_COUNT=${replicaCount} set`);
} else if (runningReplicas != null && runningReplicas > 1) {
  warn(`REPLICA_COUNT unset but ${runningReplicas} replicas running — UW/Polygon limiter math may overshoot`);
} else {
  ok("REPLICA_COUNT check skipped (single replica or unknown)");
}

// ── 5. Options / UW socket churn (socket-health HTTP probe) ─────────────────
console.log("\n5. Socket churn (socket-health)");
if (cronSecret) {
  try {
    const { status, body } = await fetchJson("/api/cron/socket-health", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    const opt = body?.websockets?.options;
    if (status === 200 && opt?.ok) ok(`options-socket (socket-health): ${opt.detail ?? "ok"}`);
    else if (status === 200 && opt) warn(`options-socket (socket-health): ${opt.detail ?? "not ok"}`);
    else warn(`socket-health probe HTTP ${status}`);
  } catch (e) {
    warn(`socket-health probe failed: ${e.message}`);
  }
} else {
  warn("CRON_SECRET unset — socket-health probe skipped");
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n=== Summary ===");
if (warnings.length) {
  console.log(`Warnings (${warnings.length}):`);
  warnings.forEach((w) => console.log(`  · ${w}`));
}
if (failures.length) {
  console.log(`\nFAILED (${failures.length}):`);
  failures.forEach((f) => console.log(`  · ${f}`));
  process.exit(1);
}
console.log("\nGREEN — deploy validation passed.\n");
