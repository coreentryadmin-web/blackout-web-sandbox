#!/usr/bin/env node
/**
 * Staging full validation — warm caches, data correctness, deploy smoke, latency.
 *
 * Usage:
 *   node scripts/staging-validate.mjs
 *
 * Env (optional overrides):
 *   STAGING_BASE_URL — default https://staging.blackouttrades.com
 *   STAGING_SECRET_NAME — default blackout-staging/app/env
 *   SKIP_DATA_CORRECTNESS=1 — skip long correctness sweep
 */
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { probeDataCorrectness } from "./audit/lib/data-correctness-probe.mjs";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { stagingPostDeployWarm } from "./staging-post-deploy-warm.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(
  /\/$/,
  ""
);
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

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

function loadStagingSecret(attempt = 0) {
  try {
    const raw = execSync(
      `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`,
      { encoding: "utf8" }
    );
    return JSON.parse(raw);
  } catch (e) {
    if (attempt < 4) {
      const delay = 2000 * (attempt + 1);
      execSync(`sleep ${Math.ceil(delay / 1000)}`);
      return loadStagingSecret(attempt + 1);
    }
    throw e;
  }
}

function flagCount(body) {
  if (!body || typeof body !== "object") return null;
  if (Array.isArray(body.flags)) return body.flags.length;
  if (typeof body.flag_count === "number") return body.flag_count;
  if (typeof body.flags === "number") return body.flags;
  return null;
}

async function hitCron(path, secret, timeoutMs = 300_000) {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}force=1`;
  const res = await fetchRetry(
    url,
    { headers: { Authorization: `Bearer ${secret}` } },
    { timeoutMs, retries: 4, baseDelayMs: 2000 }
  );
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, ms: null };
}

function pause(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runNode(script, extraEnv = {}) {
  const env = {
    ...process.env,
    CRON_TARGET_BASE_URL: BASE,
    SKIP_ECS: "1",
    ...extraEnv,
  };
  const res = spawnSync("node", [script], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  return res.status ?? 1;
}

console.log("\n=== Staging full validation ===\n");
console.log(`Target: ${BASE}`);
console.log(`Secret: ${SECRET_NAME}\n`);

let secret;
try {
  secret = loadStagingSecret();
  ok(`Loaded ${Object.keys(secret).length} keys from Secrets Manager`);
} catch (e) {
  fail(`Secrets load failed: ${e.message}`);
  process.exit(1);
}

const cronSecret = secret.CRON_SECRET?.trim();
if (!cronSecret) {
  fail("CRON_SECRET missing in staging secret");
  process.exit(1);
}

// ── 0. Ensure staging always-warm + replica count ───────────────────────────
console.log("\n0. Staging env posture");
if (secret.CACHE_WARM_ALWAYS === "1") ok("CACHE_WARM_ALWAYS=1");
else warn("CACHE_WARM_ALWAYS not set — warmers skip outside extended ET hours");

if (String(secret.REPLICA_COUNT) === "3") ok("REPLICA_COUNT=3");
else warn(`REPLICA_COUNT=${secret.REPLICA_COUNT ?? "unset"} (expected 3 for ECS)`);

if (secret.UW_MAX_RPS === "1") ok("UW_MAX_RPS=1 (staging quota isolation)");
else if (secret.UW_MAX_RPS === "2") ok("UW_MAX_RPS=2 (staging beast — isolated from prod)");
else warn(`UW_MAX_RPS=${secret.UW_MAX_RPS ?? "unset"} — set 1 or 2 for staging`);

if (secret.UW_WS_OPTION_TRADES_TICKERS) ok(`UW_WS_OPTION_TRADES_TICKERS=${secret.UW_WS_OPTION_TRADES_TICKERS}`);
else warn("UW_WS_OPTION_TRADES_TICKERS unset — using app defaults");

if (secret.PG_STATEMENT_TIMEOUT_MS === "0") ok("PG_STATEMENT_TIMEOUT_MS=0 (RDS Proxy safe)");
else warn(`PG_STATEMENT_TIMEOUT_MS=${secret.PG_STATEMENT_TIMEOUT_MS ?? "unset"} — use 0 for RDS Proxy`);

// ── 1. Force cache warmers ───────────────────────────────────────────────────
console.log("\n1. Cache warmers (force=1)");
const warmers = [
  ["/api/cron/desk-warm", 300_000],
  ["/api/cron/heatmap-warm", 180_000],
  ["/api/cron/zerodte-warm", 120_000],
];

for (const [path, timeout] of warmers) {
  const t0 = Date.now();
  try {
    const { status, body } = await hitCron(path, cronSecret, timeout);
    const ms = Date.now() - t0;
    if (status === 200 && body.ok !== false) {
      ok(`${path} → ${status} (${ms}ms)`);
    } else if (status === 200 && body.skipped) {
      warn(`${path} skipped: ${body.reason ?? "off-hours"}`);
    } else {
      fail(`${path} → HTTP ${status} (${ms}ms)`);
    }
  } catch (e) {
    fail(`${path} failed: ${e.message}`);
  }
}

// ── 2. Seed regime + data correctness ───────────────────────────────────────
console.log("\n2. Data plane");
try {
  const { status, body } = await hitCron("/api/cron/market-regime-detector", cronSecret, 120_000);
  if (status === 200) ok(`market-regime-detector → ${status}`);
  else warn(`market-regime-detector → HTTP ${status}`);
} catch (e) {
  warn(`market-regime-detector: ${e.message}`);
}

if (process.env.SKIP_DATA_CORRECTNESS !== "1") {
  try {
    const t0 = Date.now();
    const probe = await probeDataCorrectness({
      base: BASE,
      cronSecret,
      timeoutMs: 120_000,
      tryFull: false,
    });
    const ms = Date.now() - t0;
    const flags = probe.flags ?? flagCount(probe.json);
    if (probe.ok && flags === 0) {
      ok(`data-correctness (${probe.mode}) → flags=0 (${ms}ms)`);
    } else if (probe.status === 200) {
      warn(`data-correctness (${probe.mode}) → flags=${flags ?? "?"} (${ms}ms)`);
    } else {
      fail(`data-correctness → HTTP ${probe.status} ${probe.err ?? ""}`.trim());
    }
  } catch (e) {
    warn(`data-correctness: ${e.message}`);
  }
} else {
  warn("data-correctness skipped (SKIP_DATA_CORRECTNESS=1)");
}

// Brief pause — burst probes can trip intermittent CF/ALB connection resets.
await pause(3000);

// ── 3. validate-deploy ───────────────────────────────────────────────────────
console.log("\n3. validate-deploy");
const deployCode = runNode("scripts/validate-deploy.mjs", {
  CRON_SECRET: cronSecret,
  DATABASE_URL: secret.DATABASE_URL,
  DATABASE_PUBLIC_URL: secret.DATABASE_URL,
  REPLICA_COUNT: secret.REPLICA_COUNT ?? "3",
});
if (deployCode !== 0) fail("validate-deploy exited non-zero");
else ok("validate-deploy GREEN");

console.log("\n3b. Post-deploy cache warm");
const warm = await stagingPostDeployWarm({ base: BASE, cronSecret });
if (warm.ok) ok("post-deploy warm GREEN");
else fail(`post-deploy warm incomplete: ${JSON.stringify(warm.results?.filter((r) => !r.ok) ?? warm)}`);

await pause(2000);

// ── 4. Latency audit ───────────────────────────────────────────────────────
console.log("\n4. Site latency audit");
const apiOnly = process.env.STAGING_VALIDATE_BROWSER !== "1";
const latCode = runNode("scripts/site-latency-audit.mjs", {
  CRON_SECRET: cronSecret,
  STAGING_CRON_WARM: "1",
  SITE_LATENCY_API_ONLY: apiOnly ? "1" : "0",
});
if (latCode !== 0) fail("site-latency-audit exited non-zero");
else ok(`site-latency-audit GREEN${apiOnly ? " (api-only)" : " (browser)"}`);

const summary = {
  ts: new Date().toISOString(),
  base: BASE,
  failures,
  warnings,
};
const reportPath = join(OUT, `staging-full-validate-${Date.now()}.json`);
writeFileSync(reportPath, JSON.stringify(summary, null, 2));
console.log(`\nReport: ${reportPath}`);

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
console.log("\nGREEN — staging validation passed.\n");
