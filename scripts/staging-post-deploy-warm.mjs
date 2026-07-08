#!/usr/bin/env node
/**
 * Force warm staging caches after ECS deploy (desk / heatmap / zerodte).
 * Usage: node scripts/staging-post-deploy-warm.mjs
 */
import { fileURLToPath } from "node:url";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? process.env.CRON_TARGET_BASE_URL ?? "https://staging.blackouttrades.com").replace(
  /\/$/,
  ""
);
const cron = process.env.CRON_SECRET?.trim();

const PATHS = [
  "/api/cron/desk-warm?force=1",
  "/api/cron/heatmap-warm?force=1",
  "/api/cron/zerodte-warm?force=1",
];

export async function stagingPostDeployWarm({ base = BASE, cronSecret = cron } = {}) {
  if (!cronSecret) return { ok: false, reason: "CRON_SECRET unset" };
  const results = [];
  for (const path of PATHS) {
    const t0 = Date.now();
    try {
      const res = await fetchRetry(
        `${base}${path}`,
        { headers: { Authorization: `Bearer ${cronSecret}` } },
        { retries: 4, baseDelayMs: 1500, timeoutMs: 300_000 }
      );
      const body = await res.json().catch(() => ({}));
      results.push({ path, status: res.status, ms: Date.now() - t0, ok: res.status === 200 && body.ok !== false });
    } catch (e) {
      results.push({ path, ok: false, err: e.message });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

async function main() {
  const out = await stagingPostDeployWarm();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
