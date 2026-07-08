#!/usr/bin/env node
/**
 * Burst latency probe — N rounds across hot paths, staging vs prod.
 * Usage: node scripts/latency-burst-audit.mjs [--rounds=5]
 */
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";

const ROUNDS = Number(process.argv.find((a) => a.startsWith("--rounds="))?.split("=")[1] ?? 5);
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const PATHS = [
  "/api/ready",
  "/api/market/spx/bootstrap",
  "/api/market/spx/desk",
  "/api/market/spx/pulse",
  "/api/market/spx/play",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/gex-heatmap?ticker=SPY",
  "/api/market/flows?limit=20",
  "/api/market/zerodte/board",
  "/api/market/regime",
  "/api/market/vector/universe",
];

function loadProdCron() {
  const res = spawnSync(
    "railway",
    [
      "variables",
      "--service",
      "blackout-web",
      "--environment",
      "production",
      "--project",
      process.env.RAILWAY_PROJECT_ID ?? "9282f541-a288-4c8b-a174-ee22016f4b1a",
      "--json",
    ],
    { encoding: "utf8", env: process.env }
  );
  if (res.status !== 0) return process.env.CRON_SECRET?.trim() ?? null;
  return JSON.parse(res.stdout).CRON_SECRET?.trim() ?? process.env.CRON_SECRET?.trim() ?? null;
}

function loadStagingCron() {
  const raw = execSync(
    'aws secretsmanager get-secret-value --secret-id blackout-staging/app/env --query SecretString --output text',
    { encoding: "utf8" }
  );
  return JSON.parse(raw).CRON_SECRET?.trim();
}

async function warm(base, cron) {
  for (const p of ["/api/cron/desk-warm?force=1", "/api/cron/heatmap-warm?force=1"]) {
    try {
      await fetchRetry(`${base}${p}`, { headers: { Authorization: `Bearer ${cron}` } }, { retries: 2, timeoutMs: 180_000 });
    } catch {
      /* best-effort */
    }
  }
  for (const path of PATHS) {
    try {
      await fetchRetry(`${base}${path}`, { headers: { Authorization: `Bearer ${cron}` } }, { retries: 1, timeoutMs: 60_000 });
    } catch {
      /* seed */
    }
  }
}

async function probe(base, cron, path) {
  const t0 = performance.now();
  const res = await fetchRetry(
    `${base}${path}`,
    { headers: { Authorization: `Bearer ${cron}`, Accept: "application/json" } },
    { retries: 1, timeoutMs: 90_000 }
  );
  await res.text();
  return { status: res.status, ms: Math.round(performance.now() - t0) };
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))] ?? 0;
  return {
    n: sorted.length,
    min: sorted[0] ?? 0,
    p50: p(0.5),
    p95: p(0.95),
    max: sorted[sorted.length - 1] ?? 0,
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1)),
  };
}

async function runEnv(label, base, cron) {
  console.log(`\n=== ${label} (${ROUNDS} rounds) ===\n`);
  await warm(base, cron);
  const byPath = Object.fromEntries(PATHS.map((p) => [p, []]));
  for (let r = 1; r <= ROUNDS; r++) {
    for (const path of PATHS) {
      try {
        const { status, ms } = await probe(base, cron, path);
        byPath[path].push(ms);
        const g = ms <= 800 ? "PASS" : ms <= 2000 ? "WARN" : "FAIL";
        console.log(`  r${r} [${g}] ${path} — ${status} (${ms}ms)`);
      } catch (e) {
        console.log(`  r${r} [FAIL] ${path} — ${e.message}`);
        byPath[path].push(9999);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const summary = PATHS.map((path) => ({ path, ...stats(byPath[path]) }));
  console.log(`\n--- ${label} summary ---`);
  for (const row of summary) {
    console.log(`  ${row.path.padEnd(42)} p50=${String(row.p50).padStart(4)}ms p95=${String(row.p95).padStart(4)}ms max=${row.max}ms`);
  }
  return summary;
}

async function main() {
  const stagingCron = loadStagingCron();
  const prodCron = loadProdCron();
  if (!stagingCron || !prodCron) {
    console.error("Need staging secret + CRON_SECRET for prod");
    process.exit(1);
  }
  const staging = await runEnv("STAGING", "https://staging.blackouttrades.com", stagingCron);
  const prod = await runEnv("PRODUCTION", "https://blackouttrades.com", prodCron);

  console.log("\n=== Head-to-head (p50 ms, lower wins) ===\n");
  for (let i = 0; i < PATHS.length; i++) {
    const p = PATHS[i];
    const s = staging[i].p50;
    const pr = prod[i].p50;
    const delta = s - pr;
    const winner = delta < -10 ? "staging" : delta > 10 ? "prod" : "tie";
    console.log(`  ${p.padEnd(42)} staging=${String(s).padStart(4)} prod=${String(pr).padStart(4)} Δ${delta >= 0 ? "+" : ""}${delta}ms → ${winner}`);
  }

  const report = { ts: new Date().toISOString(), rounds: ROUNDS, staging, prod };
  const outPath = join(OUT, `latency-burst-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
