#!/usr/bin/env node
/**
 * Decommission legacy cron trigger services whose API routes were removed from the app.
 *
 * Product restructure 2026-07-07:
 *   - grid-warm        → zerodte-warm (classic Grid deleted)
 *   - nights-watch-warm → removed with Night's Watch product
 *   - positions-expiry  → removed with Night's Watch positions
 *
 * Safe to re-run: skips services that are already gone; ensures ZeroDTE-Warm-Cron exists
 * and is wired to railway.zerodte-warm.toml.
 *
 * Usage:
 *   node scripts/railway-legacy-cron-cleanup.mjs
 *   node scripts/railway-legacy-cron-cleanup.mjs --dry-run
 */
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PRODUCTION_ENV } from "./railway-cron-services.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const ENV = process.env.RAILWAY_ENVIRONMENT ?? PRODUCTION_ENV;
const REPO = process.env.RAILWAY_REPO ?? "coreentryadmin-web/blackout-web";
const BRANCH = process.env.RAILWAY_BRANCH ?? "main";

/** Obsolete trigger services — config-as-code pointed at deleted routes/TOMLs. */
const LEGACY_SERVICES = [
  "Grid-Warm-Cron",
  "Night's Watch-Warm-New",
  "Positions-Expiry-Cron",
];

const REPLACEMENT = { key: "zerodte-warm", serviceName: "ZeroDTE-Warm-Cron" };

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function run(cmd, args) {
  const line = `${cmd} ${args.join(" ")}`;
  if (dryRun) {
    console.log(`[dry-run] ${line}`);
    return { status: 0, stdout: "", stderr: "" };
  }
  return spawnSync(cmd, args, { encoding: "utf8" });
}

function serviceMap() {
  return Object.fromEntries(JSON.parse(sh("railway service list --json")).map((s) => [s.name, s.id]));
}

function getVar(service, key) {
  try {
    const vars = JSON.parse(sh(`railway variables --service ${JSON.stringify(service)} --json`));
    return vars[key] ?? null;
  } catch {
    return null;
  }
}

console.log("\n=== Legacy cron cleanup ===\n");
if (dryRun) console.log("(dry-run — no mutations)\n");

try {
  JSON.parse(sh("railway service list --json"));
  console.log("✓ CLI auth OK");
} catch {
  console.error("✗ CLI auth failed — set RAILWAY_TOKEN with write access.");
  process.exit(1);
}

let names = serviceMap();
const cronSecret = getVar("blackout-web", "CRON_SECRET");
if (!cronSecret) {
  console.error("✗ CRON_SECRET missing on blackout-web");
  process.exit(1);
}

// ── 1. Ensure ZeroDTE-Warm-Cron exists ──
console.log(`\n── Replacement: ${REPLACEMENT.serviceName} ──`);
if (!names[REPLACEMENT.serviceName]) {
  console.log(`  Creating ${REPLACEMENT.serviceName}…`);
  const r = run("railway", [
    "add",
    "--service",
    REPLACEMENT.serviceName,
    "--repo",
    REPO,
    "--branch",
    BRANCH,
    "--variables",
    `CRON_SECRET=${cronSecret}`,
    "--variables",
    "CRON_TARGET_BASE_URL=http://blackout-web.railway.internal:8080",
    "--json",
  ]);
  if (r.status !== 0) {
    console.error("  ✗ railway add failed:", r.stderr || r.stdout);
    process.exit(1);
  }
  console.log("  ✓ service created");
  names = serviceMap();
} else {
  console.log("  ✓ service exists");
}

console.log(`\n── Wire ${REPLACEMENT.key} config-as-code ──`);
const apply = run("node", [join(ROOT, "scripts/railway-apply-cron-config.mjs"), REPLACEMENT.key]);
process.stdout.write(apply.stdout ?? "");
process.stderr.write(apply.stderr ?? "");
if (apply.status !== 0) {
  console.error(`  ✗ railway-apply-cron-config failed for ${REPLACEMENT.key}`);
  process.exit(apply.status ?? 1);
}

// ── 2. Delete legacy services ──
console.log("\n── Delete obsolete cron triggers ──");
for (const service of LEGACY_SERVICES) {
  if (!names[service]) {
    console.log(`  ✓ ${service}: already removed`);
    continue;
  }
  const r = run("railway", [
    "service",
    "delete",
    "--service",
    service,
    "--environment",
    ENV,
    "--yes",
  ]);
  if (r.status !== 0) {
    console.error(`  ✗ delete ${service}:`, r.stderr || r.stdout);
    process.exit(1);
  }
  console.log(`  ✓ deleted ${service}`);
}

// ── 3. Full audit sync ──
console.log("\n── railway-audit-apply (cron sync) ──");
const audit = run("node", [join(ROOT, "scripts/railway-audit-apply.mjs")]);
process.stdout.write(audit.stdout ?? "");
process.stderr.write(audit.stderr ?? "");
if (audit.status !== 0) process.exit(audit.status ?? 1);

console.log("\nGREEN — legacy cron cleanup complete.");
console.log("Verify: node scripts/hit-cron.mjs /api/cron/zerodte-warm");
console.log("        npm run validate:deploy\n");
