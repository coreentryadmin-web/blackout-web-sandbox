#!/usr/bin/env node
/**
 * Ensure cron registry, railway.*.toml files, and cron service map stay aligned.
 * Exit 1 on drift — used by CI and railway-cron-config-check workflow.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ALL_CRON_KEYS, CRON_SERVICE_NAMES } from "./railway-cron-services.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function registryEntries() {
  const raw = readFileSync(join(ROOT, "src/lib/cron-registry.ts"), "utf8");
  const blocks = [...raw.matchAll(/\{\s*key:\s*"([^"]+)"([\s\S]*?)\n\s*\},/g)];
  const entries = [];
  for (const m of blocks) {
    const key = m[1];
    const body = m[2];
    const pathMatch = body.match(/path:\s*"(\/api\/cron\/[^"]+)"/);
    entries.push({ key, path: pathMatch?.[1] ?? null });
  }
  return entries;
}

function routePathForKey(key) {
  const tomlPath = join(ROOT, `railway.${key}.toml`);
  if (existsSync(tomlPath)) {
    const raw = readFileSync(tomlPath, "utf8");
    const hit = raw.match(/hit-cron\.mjs\s+(\/api\/cron\/[^\s"]+)/);
    if (hit) return hit[1];
  }
  return `/api/cron/${key}`;
}

function tomlKeys() {
  return readdirSync(ROOT)
    .filter((f) => f.startsWith("railway.") && f.endsWith(".toml") && f !== "railway.toml")
    .map((f) => f.replace(/^railway\./, "").replace(/\.toml$/, ""))
    .sort();
}

const reg = registryEntries().sort((a, b) => a.key.localeCompare(b.key));
const regKeys = reg.map((e) => e.key);
const toml = tomlKeys();
const mapped = [...ALL_CRON_KEYS].sort();

const issues = [];

for (const { key, path: regPath } of reg) {
  if (!toml.includes(key)) issues.push(`registry key "${key}" has no railway.${key}.toml`);
  if (!CRON_SERVICE_NAMES[key]) issues.push(`registry key "${key}" missing from CRON_SERVICE_NAMES`);
  const cronPath = regPath ?? routePathForKey(key);
  const route = join(ROOT, "src/app", cronPath, "route.ts");
  if (!existsSync(route)) issues.push(`registry key "${key}" missing route ${route}`);
}

for (const k of toml) {
  if (!regKeys.includes(k)) issues.push(`railway.${k}.toml has no CRON_JOBS registry entry`);
}

for (const k of mapped) {
  if (!regKeys.includes(k)) issues.push(`CRON_SERVICE_NAMES key "${k}" not in cron registry`);
}

if (regKeys.length !== mapped.length || regKeys.length !== toml.length) {
  issues.push(`count mismatch: registry=${regKeys.length} toml=${toml.length} service_map=${mapped.length}`);
}

console.log(`Cron manifest: registry=${regKeys.length} toml=${toml.length} services=${mapped.length}`);

if (issues.length) {
  for (const i of issues) console.error(`[FAIL] ${i}`);
  process.exit(1);
}

console.log("GREEN — cron registry, TOMLs, and service map aligned.");
process.exit(0);
