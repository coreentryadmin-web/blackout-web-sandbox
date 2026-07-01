#!/usr/bin/env node
/**
 * Human-readable audit of all Railway cron schedules (UTC → America/New_York).
 * Usage: node scripts/railway-cron-schedule-audit.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CRON_SERVICE_NAMES } from "./railway-cron-services.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Approximate UTC hour range → ET (dual-offset note). */
function utcBandToEt(cron) {
  const m = cron.match(/(\d{1,2}(?:,\d{1,2})*|\*|\*\/\d+|\d+\/\d+)\s+(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const start = Number(m[2]);
  const end = Number(m[3]);
  return {
    utc: `${start}:00–${end}:59 UTC`,
    edt: `${start - 4}:00–${end - 4}:59 ET (EDT, Mar–Nov)`,
    est: `${start - 5}:00–${end - 5}:59 ET (EST, Nov–Mar)`,
  };
}

const rows = [];
for (const f of readdirSync(ROOT).filter((x) => x.startsWith("railway.") && x.endsWith(".toml") && x !== "railway.toml")) {
  const key = f.replace(/^railway\./, "").replace(/\.toml$/, "");
  const raw = readFileSync(join(ROOT, f), "utf8");
  const cron = raw.match(/cronSchedule = "([^"]+)"/)?.[1] ?? "(none — long-running)";
  const svc = CRON_SERVICE_NAMES[key] ?? key;
  const band = utcBandToEt(cron);
  rows.push({ key, svc, cron, band });
}

console.log("\n=== Railway cron schedule audit (all times UTC on Railway) ===\n");
console.log(
  "Railway UI shows UTC hours as plain '11:00 am–9:59 pm' without a timezone label.\n" +
    "RTH crons use UTC band 11–21 + in-app ET gate (9:30 AM–4:00 PM ET) on the route.\n"
);

for (const r of rows.sort((a, b) => a.svc.localeCompare(b.svc))) {
  console.log(`${r.svc}`);
  console.log(`  cron: ${r.cron}`);
  if (r.band) {
    console.log(`  → ${r.band.utc}`);
    console.log(`  → ${r.band.edt}  (app skips outside 9:30–16:00 ET)`);
    console.log(`  → ${r.band.est}`);
  }
  console.log("");
}

PY