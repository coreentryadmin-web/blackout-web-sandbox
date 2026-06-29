#!/usr/bin/env node
/**
 * Wire a Railway cron trigger service to its per-job TOML via environment config JSON.
 * Uses `railway environment config` + stdin JSON apply (the reliable path — `--service-config`
 * flags often no-op; dashboard "Config-as-code" sets `configFile` on the service).
 *
 * Usage:
 *   node scripts/railway-apply-cron-config.mjs gex-alerts
 *   node scripts/railway-apply-cron-config.mjs gex-alerts spx-signal-weight-optimize
 *
 * Env: RAILWAY_PROJECT_ID (optional), defaults to BlackoutTrades.com prod project.
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PROJECT = process.env.RAILWAY_PROJECT_ID ?? "9282f541-a288-4c8b-a174-ee22016f4b1a";
const ENV = process.env.RAILWAY_ENVIRONMENT ?? "production";

/** Registry key → Railway service display name (when they differ) */
const SERVICE_NAMES = {
  "gex-alerts": "GEX-Alerts",
  "gex-eod-snapshot": "GEX-EOD-Snapshot",
  "spx-signal-weight-optimize": "SPX-Signal-Weight-Optimize",
};

const keys = process.argv.slice(2);
if (!keys.length) {
  console.error("Usage: node scripts/railway-apply-cron-config.mjs <job-key> [job-key...]");
  process.exit(1);
}

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
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

const envJson = JSON.parse(
  sh(`railway environment config --project ${PROJECT} --environment ${ENV} --json`)
);

const serviceList = JSON.parse(sh("railway service list --json"));
const nameToId = Object.fromEntries(serviceList.map((s) => [s.name, s.id]));

let changed = 0;
for (const key of keys) {
  const serviceName = SERVICE_NAMES[key] ?? key;
  const sid = nameToId[serviceName];
  if (!sid) {
    console.error(`[skip] No Railway service named "${serviceName}" for key ${key}`);
    continue;
  }
  const toml = parseTomlCron(key);
  const svc = envJson.services[sid] ?? {};
  envJson.services[sid] = svc;

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

  console.log(`[patch] ${key} → ${serviceName} (${sid})`);
  console.log(`        configFile=${toml.configFile} cron=${toml.cronSchedule}`);
  changed += 1;
}

if (!changed) {
  console.error("No services patched.");
  process.exit(1);
}

const tmp = "/tmp/railway-env-patched.json";
writeFileSync(tmp, JSON.stringify(envJson));

const msg = `Wire cron config-as-code: ${keys.join(", ")}`;
const input = `\n${readFileSync(tmp, "utf8")}`;
const r = spawnSync(
  "railway",
  ["environment", "edit", "-p", PROJECT, "-e", ENV, "-m", msg, "--json"],
  { input, encoding: "utf8" }
);

process.stdout.write(r.stdout ?? "");
process.stderr.write(r.stderr ?? "");
if (r.status !== 0) process.exit(r.status ?? 1);

console.log("\nDone. Railway will redeploy affected cron services automatically.\n");
