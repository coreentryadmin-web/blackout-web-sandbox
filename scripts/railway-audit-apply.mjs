#!/usr/bin/env node
/**
 * Idempotent production setup from the infra audit checklist.
 *
 * Applies:
 *   - blackout-web multi-region replicas (iad×3, us-west2×2)
 *   - PgBouncer multi-region (iad×2, us-west2×1)
 *   - CRON_WATCHDOG_SELF_HEAL=1 on blackout-web
 *   - DISCORD_OPS_WEBHOOK_URL / DISCORD_PLAY_WEBHOOK_URL when present in agent env
 *   - CRON_TARGET_BASE_URL (internal VPC) + CRON_SECRET sync on every cron trigger
 *   - Config-as-code wiring for all railway.*.toml cron services
 *
 * Requires: railway CLI + RAILWAY_API_TOKEN (account) or RAILWAY_TOKEN (project write).
 *
 * Usage:
 *   node scripts/railway-audit-apply.mjs
 *   node scripts/railway-audit-apply.mjs --dry-run
 *   node scripts/railway-audit-apply.mjs --skip-crons   # regions + vars only
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ALL_CRON_KEYS,
  CRON_SERVICE_NAMES,
  INTERNAL_CRON_BASE,
  PRODUCTION_ENV,
} from "./railway-cron-services.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const skipCrons = process.argv.includes("--skip-crons");

const WEB_REPLICAS = { iad: { numReplicas: 3 }, "us-west2": { numReplicas: 2 } };
const PGBOUNCER_REPLICAS = { iad: { numReplicas: 2 }, "us-west2": { numReplicas: 1 } };

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function run(cmd, args, opts = {}) {
  const line = `${cmd} ${args.join(" ")}`;
  if (dryRun) {
    console.log(`[dry-run] ${line}`);
    return { status: 0, stdout: "", stderr: "" };
  }
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function requireAuth() {
  try {
    JSON.parse(sh("railway service list --json 2>/dev/null"));
    console.log("✓ CLI auth OK");
  } catch {
    console.error(
      "✗ CLI auth failed — set RAILWAY_API_TOKEN (account) or RAILWAY_TOKEN (project) with write access."
    );
    process.exit(1);
  }
}

function serviceMap() {
  return Object.fromEntries(JSON.parse(sh("railway service list --json")).map((s) => [s.name, s.id]));
}

function railwayJson(args) {
  const r = spawnSync("railway", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "railway failed");
  return JSON.parse(r.stdout);
}

function getVars(service) {
  try {
    return railwayJson(["variables", "--service", service, "--json"]);
  } catch {
    return {};
  }
}

function setVar(service, key, value) {
  const existing = getVars(service)[key];
  if (existing === value) {
    console.log(`  ✓ ${service}.${key} already set`);
    return false;
  }
  const r = run("railway", [
    "variable",
    "set",
    `${key}=${value}`,
    "--service",
    service,
    "--environment",
    PRODUCTION_ENV,
  ]);
  if (r.status !== 0) {
    console.error(`  ✗ ${service}.${key}:`, r.stderr || r.stdout);
    process.exit(1);
  }
  console.log(`  ✓ set ${service}.${key}`);
  return true;
}

function parseTomlCron(key) {
  const path = join(ROOT, `railway.${key}.toml`);
  const raw = readFileSync(path, "utf8");
  const startCommand = raw.match(/startCommand = "([^"]+)"/)?.[1];
  const cronSchedule = raw.match(/cronSchedule = "([^"]+)"/)?.[1];
  const buildCommand = raw.match(/buildCommand = "([^"]+)"/)?.[1];
  const restartPolicyType = raw.match(/restartPolicyType = "([^"]+)"/)?.[1]?.toUpperCase() ?? "NEVER";
  if (!startCommand || !cronSchedule) {
    throw new Error(`Could not parse startCommand/cronSchedule from ${path}`);
  }
  return { configFile: `railway.${key}.toml`, startCommand, cronSchedule, buildCommand, restartPolicyType };
}

function patchMultiRegion(envJson, serviceId, label, mrc) {
  const svc = envJson.services[serviceId] ?? {};
  envJson.services[serviceId] = svc;
  svc.deploy = svc.deploy ?? {};
  const prev = JSON.stringify(svc.deploy.multiRegionConfig ?? null);
  const next = JSON.stringify(mrc);
  if (prev === next) {
    console.log(`  ✓ ${label} multiRegionConfig unchanged`);
    return false;
  }
  svc.deploy.multiRegionConfig = mrc;
  console.log(`  → ${label} multiRegionConfig ${next}`);
  return true;
}

function patchCronService(envJson, key, sid) {
  const serviceName = CRON_SERVICE_NAMES[key] ?? key;
  const toml = parseTomlCron(key);
  const svc = envJson.services[sid] ?? {};
  envJson.services[sid] = svc;

  const before = JSON.stringify({
    configFile: svc.configFile,
    deploy: {
      startCommand: svc.deploy?.startCommand,
      cronSchedule: svc.deploy?.cronSchedule,
      restartPolicyType: svc.deploy?.restartPolicyType,
    },
    build: {
      buildCommand: svc.build?.buildCommand,
      builder: svc.build?.builder,
    },
    cronTarget: svc.variables?.CRON_TARGET_BASE_URL?.value,
  });

  svc.configFile = toml.configFile;
  svc.deploy = svc.deploy ?? {};
  svc.deploy.startCommand = toml.startCommand;
  svc.deploy.cronSchedule = toml.cronSchedule;
  svc.deploy.restartPolicyType = toml.restartPolicyType;
  delete svc.deploy.healthcheckPath;
  delete svc.deploy.healthcheckTimeout;
  svc.build = svc.build ?? {};
  if (toml.buildCommand) svc.build.buildCommand = toml.buildCommand;
  svc.build.builder = "NIXPACKS";

  svc.variables = svc.variables ?? {};
  svc.variables.CRON_TARGET_BASE_URL = { value: INTERNAL_CRON_BASE };

  const after = JSON.stringify({
    configFile: svc.configFile,
    deploy: {
      startCommand: svc.deploy.startCommand,
      cronSchedule: svc.deploy.cronSchedule,
      restartPolicyType: svc.deploy.restartPolicyType,
    },
    build: {
      buildCommand: svc.build.buildCommand,
      builder: svc.build.builder,
    },
    cronTarget: svc.variables.CRON_TARGET_BASE_URL?.value,
  });

  if (before === after) {
    console.log(`  ✓ ${serviceName}: unchanged`);
    return false;
  }
  console.log(`  → ${serviceName}: ${toml.configFile} cron=${toml.cronSchedule}`);
  return true;
}

console.log("\n=== Production audit apply ===\n");
if (dryRun) console.log("(dry-run — no mutations)\n");

requireAuth();
const names = serviceMap();
const webId = names["blackout-web"];
const pgbId = names["PgBouncer"];
if (!webId || !pgbId) {
  console.error("✗ blackout-web or PgBouncer service not found");
  process.exit(1);
}

// ── 1. Web + PgBouncer regions ──
console.log("── Multi-region replicas ──");
const envJson = JSON.parse(sh(`railway environment config --environment ${PRODUCTION_ENV} --json`));
let envChanged = false;
envChanged = patchMultiRegion(envJson, webId, "blackout-web", WEB_REPLICAS) || envChanged;
envChanged = patchMultiRegion(envJson, pgbId, "PgBouncer", PGBOUNCER_REPLICAS) || envChanged;

// ── 2. Cron config-as-code + internal CRON_TARGET in env JSON ──
if (!skipCrons) {
  console.log("\n── Cron config-as-code (all TOMLs) ──");
  const tomlKeys = readdirSync(ROOT)
    .filter((f) => f.startsWith("railway.") && f.endsWith(".toml") && f !== "railway.toml")
    .map((f) => f.replace(/^railway\./, "").replace(/\.toml$/, ""))
    .filter((k) => CRON_SERVICE_NAMES[k] || ALL_CRON_KEYS.includes(k));

  for (const key of tomlKeys.sort()) {
    const serviceName = CRON_SERVICE_NAMES[key] ?? key;
    const sid = names[serviceName];
    if (!sid) {
      console.warn(`  [skip] no service "${serviceName}" for ${key}`);
      continue;
    }
    if (patchCronService(envJson, key, sid)) {
      envChanged = true;
    }
  }
}

if (envChanged) {
  const tmp = "/tmp/railway-audit-apply.json";
  writeFileSync(tmp, JSON.stringify(envJson));
  const msg = "audit-apply: regions + cron config-as-code";
  if (dryRun) {
    console.log(`[dry-run] railway environment edit -e ${PRODUCTION_ENV} (${msg})`);
  } else {
    const r = spawnSync(
      "railway",
      ["environment", "edit", "-e", PRODUCTION_ENV, "-m", msg, "--json"],
      { input: `\n${readFileSync(tmp, "utf8")}`, encoding: "utf8" }
    );
    process.stdout.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
    if (r.status !== 0) process.exit(r.status ?? 1);
    console.log("  ✓ environment config committed");
  }
} else {
  console.log("\n  (environment config unchanged)");
}

// ── 3. blackout-web variables ──
console.log("\n── blackout-web variables ──");
setVar("blackout-web", "CRON_WATCHDOG_SELF_HEAL", "1");

const discordOps = process.env.DISCORD_OPS_WEBHOOK_URL?.trim();
const discordPlay = process.env.DISCORD_PLAY_WEBHOOK_URL?.trim();
if (discordOps) setVar("blackout-web", "DISCORD_OPS_WEBHOOK_URL", discordOps);
else console.log("  ⚠ DISCORD_OPS_WEBHOOK_URL not in agent env — skip (ops alerts still dropped)");
if (discordPlay) setVar("blackout-web", "DISCORD_PLAY_WEBHOOK_URL", discordPlay);

// ── 4. Sync CRON_SECRET + internal base on each cron trigger ──
console.log("\n── Cron trigger variables ──");
const cronSecret = getVars("blackout-web").CRON_SECRET;
if (!cronSecret) {
  console.error("  ✗ CRON_SECRET missing on blackout-web");
  process.exit(1);
}

let syncedCount = 0;
for (const key of ALL_CRON_KEYS) {
  const serviceName = CRON_SERVICE_NAMES[key];
  if (!names[serviceName]) continue;
  const vars = getVars(serviceName);
  let synced = true;
  if (vars.CRON_SECRET !== cronSecret) {
    setVar(serviceName, "CRON_SECRET", cronSecret);
    synced = false;
  }
  if (vars.CRON_TARGET_BASE_URL !== INTERNAL_CRON_BASE) {
    setVar(serviceName, "CRON_TARGET_BASE_URL", INTERNAL_CRON_BASE);
    synced = false;
  }
  if (synced) syncedCount += 1;
}
console.log(`  ✓ ${syncedCount}/${ALL_CRON_KEYS.length} cron triggers in sync`);

// ── 5. PITR bucket posture ──
console.log("\n── PITR bucket ──");
try {
  const status = JSON.parse(sh("railway status --json 2>/dev/null"));
  const buckets = (status.buckets?.edges ?? []).map((e) => e.node?.name).filter(Boolean);
  if (buckets.includes("Postgres-PITR")) {
    console.log("  ✓ Postgres-PITR bucket present");
  } else {
    console.warn("  ⚠ Postgres-PITR bucket not found — enable PITR on Postgres service");
  }
} catch {
  console.warn("  ⚠ could not read bucket list");
}

console.log("\nGREEN — production audit apply complete.");
console.log("Verify:");
console.log("  curl -sS https://blackouttrades.com/api/ready");
console.log("  node scripts/validate-deploy.mjs");
console.log("  railway logs --service Socket-Health-Cron --lines 5\n");
