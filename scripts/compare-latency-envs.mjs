#!/usr/bin/env node
/**
 * Compare API latency — staging vs production (cron-authenticated paths).
 *
 * Usage: node scripts/compare-latency-envs.mjs
 */
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";

const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const PATHS = [
  "/api/health",
  "/api/ready",
  "/api/market/spx/bootstrap",
  "/api/market/spx/desk",
  "/api/market/spx/pulse",
  "/api/market/flows?limit=20",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/gex-heatmap?ticker=SPY",
  "/api/market/gex-heatmap?ticker=NVDA",
  "/api/market/gex-heatmap?ticker=QQQ",
  "/api/market/nighthawk/edition",
  "/api/market/zerodte/board",
  "/api/market/vector/universe",
  "/api/market/regime",
];

async function probe(base, cronSecret, path) {
  const t0 = performance.now();
  try {
    const res = await fetchRetry(
      `${base}${path}`,
      { headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" } },
      { retries: 4, baseDelayMs: 1500, timeoutMs: 90_000 }
    );
    await res.text();
    return { status: res.status, ms: Math.round(performance.now() - t0), ok: res.status < 500 };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), ok: false, err: e.message };
  }
}

function loadStagingCron() {
  const raw = execSync(
    'aws secretsmanager get-secret-value --secret-id blackout-staging/app/env --query SecretString --output text',
    { encoding: "utf8" }
  );
  return JSON.parse(raw).CRON_SECRET?.trim();
}

async function warmCaches(base, cronSecret) {
  const paths = [
    "/api/cron/desk-warm?force=1",
    "/api/cron/heatmap-warm?force=1",
    "/api/cron/zerodte-warm?force=1",
  ];
  console.log("  (warming caches via cron…)");
  for (const path of paths) {
    try {
      const res = await fetchRetry(
        `${base}${path}`,
        { headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" } },
        { retries: 3, baseDelayMs: 1200, timeoutMs: 180_000 }
      );
      await res.text();
    } catch {
      /* best-effort */
    }
  }
}

async function runEnv(label, base, cronSecret) {
  console.log(`\n=== ${label} (${base}) ===\n`);
  await warmCaches(base, cronSecret);
  // Seed once (3 ECS replicas / multi-instance → first measured hit may still be cold).
  for (const path of PATHS) {
    try {
      const res = await fetchRetry(
        `${base}${path}`,
        { headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" } },
        { retries: 2, baseDelayMs: 800, timeoutMs: 90_000 }
      );
      await res.text();
    } catch {
      /* seed best-effort */
    }
  }
  // Extra seeds for heatmap + ready (multi-replica cold starts).
  const heatmapPaths = PATHS.filter((p) => p.includes("gex-heatmap"));
  const readyPaths = ["/api/health", "/api/ready"];
  for (let i = 0; i < 2; i++) {
    for (const path of [...readyPaths, ...heatmapPaths]) {
      try {
        const res = await fetchRetry(
          `${base}${path}`,
          { headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" } },
          { retries: 2, baseDelayMs: 600, timeoutMs: 90_000 }
        );
        await res.text();
      } catch {
        /* seed best-effort */
      }
    }
  }
  const rows = [];
  for (const path of PATHS) {
    const r = await probe(base, cronSecret, path);
    const grade = r.ms <= 800 ? "PASS" : r.ms <= 2000 ? "WARN" : "FAIL";
    if (!r.ok) rows.push({ path, ...r, grade: "FAIL" });
    else rows.push({ path, ...r, grade });
    console.log(`  [${r.ok ? grade : "FAIL"}] ${path} — ${r.status || "ERR"} (${r.ms}ms)`);
  }
  return rows;
}

async function main() {
  const stagingCron = loadStagingCron();
  const prodCron = process.env.CRON_SECRET?.trim();
  if (!stagingCron) {
    console.error("staging CRON_SECRET missing");
    process.exit(1);
  }
  if (!prodCron) {
    console.error("prod CRON_SECRET env missing — set from Railway for compare");
    process.exit(1);
  }

  const staging = await runEnv("STAGING", "https://staging.blackouttrades.com", stagingCron);
  const prod = await runEnv("PRODUCTION", "https://blackouttrades.com", prodCron);

  const fails = staging.filter((r) => r.grade === "FAIL");
  const report = {
    ts: new Date().toISOString(),
    staging,
    prod,
    staging_failures: fails.length,
  };
  const outPath = join(OUT, `latency-compare-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${outPath}`);
  console.log(`Staging FAIL count: ${fails.length}`);
  if (fails.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
