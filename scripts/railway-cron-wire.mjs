#!/usr/bin/env node
/**
 * Print Railway commands to wire cron trigger services to their per-job TOML.
 *
 * Prefer the automated applier (uses environment JSON stdin — same as dashboard Config-as-code):
 *   node scripts/railway-apply-cron-config.mjs gex-alerts
 *
 * Manual dashboard: Service → Settings → Config-as-code → `railway.<key>.toml`
 */
const jobs = process.argv.slice(2);
const targets = jobs.length > 0 ? jobs : ["gex-alerts"];

console.log("\n=== Railway cron config-as-code wiring ===\n");
console.log("Automated (recommended):\n");
console.log(`  node scripts/railway-apply-cron-config.mjs ${targets.join(" ")}\n`);
console.log("Manual dashboard: Service → Settings → Config-as-code → path = railway.<key>.toml\n");
console.log("Ensure CRON_SECRET matches blackout-web on each cron trigger service.\n");
