#!/usr/bin/env node
/**
 * Ensure cron registry keys have matching /api/cron/* route handlers.
 * Exit 1 on drift — used by CI.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { allCronKeys, registryEntries, REPO_ROOT } from "./cron-registry-parse.mjs";

const reg = registryEntries().sort((a, b) => a.key.localeCompare(b.key));
const regKeys = reg.map((e) => e.key);
const keys = allCronKeys();

const issues = [];

for (const { key, path: regPath } of reg) {
  const cronPath = regPath ?? `/api/cron/${key}`;
  const route = join(REPO_ROOT, "src/app", cronPath, "route.ts");
  if (!existsSync(route)) issues.push(`registry key "${key}" missing route ${route}`);
}

if (regKeys.length !== keys.length) {
  issues.push(`count mismatch: registry=${regKeys.length} parsed=${keys.length}`);
}

console.log(`Cron manifest: registry=${regKeys.length} routes checked`);

if (issues.length) {
  for (const i of issues) console.error(`[FAIL] ${i}`);
  process.exit(1);
}

console.log("GREEN — cron registry and route handlers aligned.");
process.exit(0);
