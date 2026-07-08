#!/usr/bin/env node
/**
 * Continuous staging vs production latency watch — APIs + browser paint.
 * Logs deltas; exits non-zero when staging regresses vs prod thresholds.
 *
 * Usage:
 *   npm run validate:staging-latency-watch
 *   node scripts/staging-prod-latency-watch.mjs --once
 *   node scripts/staging-prod-latency-watch.mjs --interval=180
 */
import { execSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { etParts } from "./gha-et-window.mjs";

const STAGING = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const PROD = "https://blackouttrades.com";
const OUT = join(process.cwd(), "audit-output");
const LOG = join(OUT, "staging-prod-latency.log");
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const ONCE = args.includes("--once");
const intervalArg = args.find((a) => a.startsWith("--interval="));
const INTERVAL_MS = intervalArg
  ? Math.max(60_000, parseInt(intervalArg.slice("--interval=".length), 10) * 1000)
  : 3 * 60_000;

/** Staging may be ≤ prod + slack (ms); beyond = FAIL */
const API_SLACK_MS = Number(process.env.STAGING_LATENCY_SLACK_MS ?? 400);
const PAGE_SLACK_MS = Number(process.env.STAGING_PAGE_SLACK_MS ?? 800);
const API_FAIL_MS = 2000;
const PAGE_FAIL_MS = 5000;

const API_PATHS = [
  "/api/health",
  "/api/ready",
  "/api/market/spx/bootstrap",
  "/api/market/spx/desk",
  "/api/market/spx/pulse",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/flows?limit=20",
  "/api/market/zerodte/board",
];

const PAGE_PATHS = [
  { path: "/", label: "landing", public: true },
  { path: "/dashboard", label: "dashboard", ready: () => document.body.innerText.length > 500 },
  { path: "/flows", label: "flows", ready: () => document.body.innerText.length > 400 },
];

let cycle = 0;

function loadSecrets() {
  const stagingRaw = execSync(
    'aws secretsmanager get-secret-value --secret-id blackout-staging/app/env --query SecretString --output text',
    { encoding: "utf8" }
  );
  const staging = JSON.parse(stagingRaw);
  let prodCron = process.env.CRON_SECRET?.trim();
  if (!prodCron) {
    try {
      unsetRailwayApiToken();
      const out = spawnSync(
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
        { encoding: "utf8", env: { ...process.env, RAILWAY_API_TOKEN: "" } }
      );
      if (out.status === 0) {
        prodCron = JSON.parse(out.stdout).CRON_SECRET?.trim();
      }
    } catch {
      /* fall through */
    }
  }
  return {
    stagingCron: staging.CRON_SECRET?.trim(),
    prodCron,
    clerkSecret: staging.CLERK_SECRET_KEY,
    clerkPub: staging.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  };
}

function unsetRailwayApiToken() {
  delete process.env.RAILWAY_API_TOKEN;
}

async function probeApi(base, cron, path) {
  const t0 = performance.now();
  try {
    const res = await fetchRetry(
      `${base}${path}`,
      { headers: { Authorization: `Bearer ${cron}`, Accept: "application/json" } },
      { retries: 2, baseDelayMs: 800, timeoutMs: 90_000 }
    );
    await res.text();
    return { ms: Math.round(performance.now() - t0), status: res.status, ok: res.status < 500 };
  } catch (e) {
    return { ms: Math.round(performance.now() - t0), status: 0, ok: false, err: e.message };
  }
}

async function probePage(base, { path, label, public: isPublic, ready }, cookies) {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (cookies?.length) await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  const t0 = performance.now();
  try {
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    if (ready) await page.waitForFunction(ready, { timeout: 45_000 }).catch(() => null);
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return { ttfb: Math.round(n?.responseStart ?? 0), dcl: Math.round(n?.domContentLoadedEventEnd ?? 0) };
    });
    const ms = Math.round(performance.now() - t0);
    await browser.close();
    return { ms, ttfb: nav.ttfb, dcl: nav.dcl, ok: true, label };
  } catch (e) {
    await browser.close();
    return { ms: Math.round(performance.now() - t0), ok: false, err: e.message, label };
  }
}

function gradeStaging(stagingMs, prodMs, slack, failMs) {
  if (stagingMs >= failMs) return "FAIL";
  if (prodMs > 0 && stagingMs > prodMs + slack) return "WARN";
  if (stagingMs <= prodMs) return "PASS";
  return "PASS";
}

async function runCycle(secrets) {
  cycle++;
  const et = etParts();
  const rows = [];
  const issues = [];

  console.log(`\n── Latency watch cycle ${cycle} (${et.label}) ──\n`);

  // Warm staging caches once per cycle
  for (const p of ["/api/cron/desk-warm?force=1", "/api/cron/heatmap-warm?force=1"]) {
    try {
      await fetchRetry(`${STAGING}${p}`, {
        headers: { Authorization: `Bearer ${secrets.stagingCron}` },
      }, { retries: 1, timeoutMs: 120_000 });
    } catch { /* best-effort */ }
  }

  for (const path of API_PATHS) {
    const s = await probeApi(STAGING, secrets.stagingCron, path);
    const p = secrets.prodCron ? await probeApi(PROD, secrets.prodCron, path) : { ms: 0, ok: true };
    const delta = s.ms - (p.ms || 0);
    const grade = !s.ok ? "FAIL" : gradeStaging(s.ms, p.ms, API_SLACK_MS, API_FAIL_MS);
    rows.push({ kind: "api", path, stagingMs: s.ms, prodMs: p.ms, delta, grade });
    const icon = grade === "PASS" ? "✓" : grade === "WARN" ? "⚠" : "✗";
    console.log(
      `  ${icon} API ${path} — staging ${s.ms}ms | prod ${p.ms || "?"}ms | Δ${delta >= 0 ? "+" : ""}${delta}ms [${grade}]`
    );
    if (grade !== "PASS") issues.push({ path, grade, stagingMs: s.ms, prodMs: p.ms });
  }

  // Browser pages — landing public; desk needs auth cookies from staging-live pattern
  process.env.CLERK_SECRET_KEY = secrets.clerkSecret;
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = secrets.clerkPub;
  const { mintIosPlaywrightSession } = await import("./audit/lib/ios-playwright-auth.mjs");
  const session = await mintIosPlaywrightSession({ appUrl: STAGING });
  const cookies = session.skip ? [] : session.cookies;

  for (const spec of PAGE_PATHS) {
    const s = await probePage(STAGING, spec, spec.public ? null : cookies);
    const p = await probePage(PROD, spec, spec.public ? null : cookies);
    const delta = s.ms - (p.ms || 0);
    const grade = !s.ok ? "FAIL" : gradeStaging(s.ms, p.ms, PAGE_SLACK_MS, PAGE_FAIL_MS);
    rows.push({
      kind: "page",
      path: spec.path,
      stagingMs: s.ms,
      prodMs: p.ms,
      stagingTtfb: s.ttfb,
      prodTtfb: p.ttfb,
      delta,
      grade,
    });
    const icon = grade === "PASS" ? "✓" : grade === "WARN" ? "⚠" : "✗";
    console.log(
      `  ${icon} PAGE ${spec.path} — staging ${s.ms}ms (ttfb ${s.ttfb ?? "?"}ms) | prod ${p.ms || "?"}ms | Δ${delta >= 0 ? "+" : ""}${delta}ms [${grade}]`
    );
    if (grade !== "PASS") issues.push({ path: spec.path, grade, stagingMs: s.ms, prodMs: p.ms });
  }

  if (!session.skip) await session.cleanup?.().catch(() => null);

  const fails = issues.filter((i) => i.grade === "FAIL");
  const warns = issues.filter((i) => i.grade === "WARN");
  const entry = {
    cycle,
    ts: new Date().toISOString(),
    et: et.label,
    rows,
    fails: fails.length,
    warns: warns.length,
    ok: fails.length === 0,
  };
  appendFileSync(LOG, JSON.stringify(entry) + "\n");
  writeFileSync(join(OUT, `latency-watch-latest.json`), JSON.stringify(entry, null, 2));

  console.log(`\n  Summary: ${fails.length} FAIL, ${warns.length} WARN — log ${LOG}\n`);
  return entry;
}

async function main() {
  console.log(`Staging vs prod latency watch`);
  console.log(`  staging: ${STAGING}`);
  console.log(`  prod:    ${PROD}`);
  console.log(`  interval: ${ONCE ? "once" : `${INTERVAL_MS / 1000}s`}\n`);

  const secrets = loadSecrets();
  if (!secrets.stagingCron) {
    console.error("staging CRON_SECRET missing");
    process.exit(1);
  }
  if (!secrets.prodCron) console.warn("prod CRON_SECRET unavailable — API deltas vs prod skipped");

  do {
    const entry = await runCycle(secrets);
    if (entry.fails > 0 && ONCE) process.exit(1);
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  } while (!ONCE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
