#!/usr/bin/env node
/**
 * One-shot Railway ops bootstrap:
 *   1. CRON_WATCHDOG_SELF_HEAL=1 on blackout-web
 *   2. Ensure provider-health-reconcile + Market-Regime-Detector cron services exist + wired to TOMLs + CRON_SECRET
 *
 * Requires: railway CLI + valid RAILWAY_TOKEN (account or project token with write access)
 *
 * Usage:
 *   node scripts/railway-ops-provision.mjs
 *   node scripts/railway-ops-provision.mjs --dry-run
 */
import { execSync, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CRON_BOOTSTRAP } from "./railway-cron-services.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROJECT = process.env.RAILWAY_PROJECT_ID ?? "9282f541-a288-4c8b-a174-ee22016f4b1a";
const ENV = process.env.RAILWAY_ENVIRONMENT ?? "production";
const REPO = process.env.RAILWAY_REPO ?? "coreentryadmin-web/blackout-web";
const BRANCH = process.env.RAILWAY_BRANCH ?? "main";
const dryRun = process.argv.includes("--dry-run");

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function run(cmd, args, opts = {}) {
  if (dryRun) {
    console.log(`[dry-run] ${cmd} ${args.join(" ")}`);
    return { status: 0, stdout: "", stderr: "" };
  }
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function requireAuth() {
  try {
    JSON.parse(sh("railway service list --json 2>/dev/null"));
    console.log("✓ Railway auth OK (project token)");
  } catch {
    console.error("✗ RAILWAY_TOKEN invalid or missing — create one at https://railway.com/account/tokens");
    process.exit(1);
  }
}

function serviceMap() {
  const list = JSON.parse(sh("railway service list --json"));
  return Object.fromEntries(list.map((s) => [s.name, s.id]));
}

function getVar(service, key) {
  try {
    const vars = JSON.parse(
      execFileSync("railway", ["variables", "--service", service, "--json"], { encoding: "utf8" })
    );
    return vars[key] ?? null;
  } catch {
    return null;
  }
}

console.log("\n=== Railway ops provision ===\n");
requireAuth();

// 1) Self-heal on blackout-web
console.log("── CRON_WATCHDOG_SELF_HEAL on blackout-web ──");
const existing = getVar("blackout-web", "CRON_WATCHDOG_SELF_HEAL");
if (existing === "1") {
  console.log("  ✓ already set to 1");
} else {
  const r = run("railway", [
    "variable", "set", "CRON_WATCHDOG_SELF_HEAL=1",
    "--service", "blackout-web",
    "--environment", ENV,
  ]);
  if (r.status !== 0) {
    console.error("  ✗ failed:", r.stderr || r.stdout);
    process.exit(1);
  }
  console.log("  ✓ set CRON_WATCHDOG_SELF_HEAL=1");
}

// 2) Cron services that may be missing from production (bootstrap + wire TOML)
console.log("\n── Cron service bootstrap ──");
const names = serviceMap();
const cronSecret = getVar("blackout-web", "CRON_SECRET");

if (!cronSecret) {
  console.error("  ✗ CRON_SECRET not found on blackout-web — set it first");
  process.exit(1);
}

// Bootstrap EVERY registered cron service (derived from CRON_SERVICE_NAMES), not a hand-curated
// subset. A hardcoded list is how vector-full-state-snapshot + bie-full-state-snapshot were left
// un-provisioned (see CRON_BOOTSTRAP's doc comment in railway-cron-services.mjs): registered in the
// repo but never created on Railway, so they never ran and their full-state caches went stale.
// ensureCronService is idempotent — existing services just get CRON_SECRET verified + config
// re-wired; only genuinely-missing ones are `railway add`-ed.

function ensureCronService(serviceName, cronKey) {
  if (!names[serviceName]) {
    console.log(`  Creating service "${serviceName}" from ${REPO}@${BRANCH}…`);
    const r = run("railway", [
      "add",
      "--service", serviceName,
      "--repo", REPO,
      "--branch", BRANCH,
      "--variables", `CRON_SECRET=${cronSecret}`,
      "--variables", "CRON_TARGET_BASE_URL=https://blackouttrades.com",
      "--json",
    ]);
    if (r.status !== 0) {
      console.error(`  ✗ railway add failed for ${serviceName}:`, r.stderr || r.stdout);
      process.exit(1);
    }
    console.log(`  ✓ service created (${serviceName})`);
  } else {
    console.log(`  ✓ service exists (${serviceName})`);
    if (!getVar(serviceName, "CRON_SECRET")) {
      const r = run("railway", [
        "variable", "set", `CRON_SECRET=${cronSecret}`,
        "--service", serviceName,
        "--environment", ENV,
      ]);
      if (r.status !== 0) {
        console.error(`  ✗ CRON_SECRET copy failed for ${serviceName}:`, r.stderr || r.stdout);
        process.exit(1);
      }
      console.log(`  ✓ CRON_SECRET synced (${serviceName})`);
    }
  }

  console.log(`\n── Wire config-as-code (${cronKey}) ──`);
  const apply = run("node", [join(ROOT, "scripts/railway-apply-cron-config.mjs"), cronKey], {
    cwd: ROOT,
    env: { ...process.env, RAILWAY_PROJECT_ID: PROJECT, RAILWAY_ENVIRONMENT: ENV },
  });
  process.stdout.write(apply.stdout ?? "");
  process.stderr.write(apply.stderr ?? "");
  if (apply.status !== 0) {
    console.error(`  ✗ railway-apply-cron-config failed for ${cronKey}`);
    process.exit(apply.status ?? 1);
  }
}

for (const { key, serviceName } of CRON_BOOTSTRAP) {
  ensureCronService(serviceName, key);
}

console.log("\nGREEN — Railway ops provision complete.\n");
console.log("Verify after deploy:");
console.log("  npm run validate:cron");
console.log("  node scripts/hit-cron.mjs /api/cron/alert-outcome-sync");
console.log("  node scripts/hit-cron.mjs /api/cron/provider-health-reconcile");
console.log("  node scripts/hit-cron.mjs /api/cron/market-regime-detector\n");
