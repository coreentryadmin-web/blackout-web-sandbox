#!/usr/bin/env node
/**
 * One-shot Railway ops bootstrap:
 *   1. CRON_WATCHDOG_SELF_HEAL=1 on blackout-web
 *   2. Ensure provider-health-reconcile cron service exists + wired to TOML + CRON_SECRET
 *
 * Requires: railway CLI + valid RAILWAY_TOKEN (account or project token with write access)
 *
 * Usage:
 *   node scripts/railway-ops-provision.mjs
 *   node scripts/railway-ops-provision.mjs --dry-run
 */
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
    const who = sh("railway whoami 2>/dev/null");
    console.log(`✓ Railway auth: ${who.split("\n")[0]}`);
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
    const vars = JSON.parse(sh(`railway variables --service ${service} --json 2>/dev/null`));
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
    "--project", PROJECT,
    "--environment", ENV,
  ]);
  if (r.status !== 0) {
    console.error("  ✗ failed:", r.stderr || r.stdout);
    process.exit(1);
  }
  console.log("  ✓ set CRON_WATCHDOG_SELF_HEAL=1");
}

// 2) provider-health-reconcile cron service
console.log("\n── provider-health-reconcile cron ──");
const names = serviceMap();
const cronKey = "provider-health-reconcile";
const cronSecret = getVar("blackout-web", "CRON_SECRET");

if (!cronSecret) {
  console.error("  ✗ CRON_SECRET not found on blackout-web — set it first");
  process.exit(1);
}

if (!names[cronKey]) {
  console.log(`  Creating service "${cronKey}" from ${REPO}@${BRANCH}…`);
  const r = run("railway", [
    "add",
    "--service", cronKey,
    "--repo", REPO,
    "--branch", BRANCH,
    "--project", PROJECT,
    "--environment", ENV,
    "--variables", `CRON_SECRET=${cronSecret}`,
    "--variables", "CRON_TARGET_BASE_URL=https://blackouttrades.com",
    "--json",
  ]);
  if (r.status !== 0) {
    console.error("  ✗ railway add failed:", r.stderr || r.stdout);
    process.exit(1);
  }
  console.log("  ✓ service created");
} else {
  console.log(`  ✓ service exists (${names[cronKey]})`);
  if (!getVar(cronKey, "CRON_SECRET")) {
    const r = run("railway", [
      "variable", "set", `CRON_SECRET=${cronSecret}`,
      "--service", cronKey,
      "--project", PROJECT,
      "--environment", ENV,
    ]);
    if (r.status !== 0) {
      console.error("  ✗ CRON_SECRET copy failed:", r.stderr || r.stdout);
      process.exit(1);
    }
    console.log("  ✓ CRON_SECRET synced from blackout-web");
  } else {
    console.log("  ✓ CRON_SECRET already set");
  }
}

// 3) Wire config-as-code TOML
console.log("\n── Wire config-as-code ──");
const apply = run("node", [join(ROOT, "scripts/railway-apply-cron-config.mjs"), cronKey], {
  cwd: ROOT,
  env: { ...process.env, RAILWAY_PROJECT_ID: PROJECT, RAILWAY_ENVIRONMENT: ENV },
});
process.stdout.write(apply.stdout ?? "");
process.stderr.write(apply.stderr ?? "");
if (apply.status !== 0) {
  console.error("  ✗ railway-apply-cron-config failed");
  process.exit(apply.status ?? 1);
}

console.log("\nGREEN — Railway ops provision complete.\n");
console.log("Verify after deploy:");
console.log("  npm run validate:cron");
console.log("  node scripts/hit-cron.mjs /api/cron/provider-health-reconcile\n");
