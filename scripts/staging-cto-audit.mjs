#!/usr/bin/env node
/**
 * Staging CTO deep audit — orchestrates every staging probe in one pass.
 *
 * Usage:
 *   npm run validate:staging-cto
 *   node scripts/staging-cto-audit.mjs [--phase=preopen|open|full]
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { etParts } from "./gha-et-window.mjs";

const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const PHASE = phaseArg ? phaseArg.slice("--phase=".length) : "full";
const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const results = [];
function step(name, cmd, args = [], env = {}) {
  const t0 = Date.now();
  console.log(`\n=== ${name} ===\n`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, STAGING_BASE_URL: BASE, ...env },
  });
  const ms = Date.now() - t0;
  const status = r.status === 0 ? "PASS" : "FAIL";
  results.push({ name, status, ms });
  if (r.status !== 0) {
    console.error(`\n✗ ${name} FAILED (${ms}ms)\n`);
    return false;
  }
  console.log(`\n✓ ${name} (${ms}ms)\n`);
  return true;
}

function loadSecret() {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`,
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

async function main() {
  const et = etParts();
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  STAGING CTO AUDIT — ${et.label.padEnd(22)} ║`);
  console.log(`║  Target: ${BASE.padEnd(38)} ║`);
  console.log(`║  Phase: ${PHASE.padEnd(39)} ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  const secret = loadSecret();
  const env = {
    CRON_TARGET_BASE_URL: BASE,
    CRON_SECRET: secret.CRON_SECRET,
    DATABASE_URL: secret.DATABASE_URL,
    DATABASE_PUBLIC_URL: secret.DATABASE_URL,
    CLERK_SECRET_KEY: secret.CLERK_SECRET_KEY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: secret.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    REPLICA_COUNT: secret.REPLICA_COUNT ?? "3",
  };

  const failures = [];

  const suites =
    PHASE === "preopen"
      ? [
          ["1. Deploy + posture", "node", ["scripts/staging-validate.mjs"]],
          ["2. Live surface probe", "node", ["scripts/staging-live-check.mjs"]],
          ["3. Latency burst", "node", ["scripts/latency-burst-audit.mjs", "--rounds=3"]],
          ["4. Homepage perf", "node", ["scripts/staging-homepage-profile.mjs"]],
        ]
      : [
          ["1. Full staging validate", "node", ["scripts/staging-validate.mjs"]],
          ["2. Staging RTH session", "node", ["scripts/staging-rth-check.mjs", "--force"]],
          ["3. Live surface probe", "node", ["scripts/staging-live-check.mjs"]],
          ["4. Data parity vs prod", "node", ["scripts/staging-prod-data-parity.mjs"]],
          ["5. Latency burst", "node", ["scripts/latency-burst-audit.mjs", "--rounds=5"]],
          ["6. Largo latency", "node", ["scripts/largo-latency-compare.mjs"]],
          ["7. SPX RTH audit", "node", ["scripts/spx-rth-all-day-audit.mjs", `--base=${BASE}`]],
          ["8. Zerodte logic", "node", ["scripts/zerodte-logic-audit.mjs", `--base=${BASE}`]],
          ["9. API auth guards", "node", ["scripts/verify-api-auth-guards.mjs"]],
          ["10. Homepage perf", "node", ["scripts/staging-homepage-profile.mjs"]],
        ];

  for (const [name, cmd, args] of suites) {
    if (!step(name, cmd, args, env)) failures.push(name);
  }

  const report = {
    at: new Date().toISOString(),
    et: et.label,
    base: BASE,
    phase: PHASE,
    results,
    failures,
    pass: failures.length === 0,
  };
  const reportPath = join(OUT, `staging-cto-audit-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${reportPath}`);
  console.log(`\n=== CTO AUDIT SUMMARY ===`);
  console.log(`PASS: ${results.filter((r) => r.status === "PASS").length}/${results.length}`);
  if (failures.length) {
    console.error(`FAILURES: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("GREEN — staging CTO audit passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
