#!/usr/bin/env node
/**
 * Full-site latency audit — APIs + browser paint times for every premium surface.
 * Exit 1 when any P1 threshold breached (for CI / scheduled agents).
 *
 * Usage:
 *   node scripts/site-latency-audit.mjs [--base=https://blackouttrades.com]
 *   node scripts/site-latency-audit.mjs --base=https://staging.blackouttrades.com --api-only
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const args = process.argv.slice(2);
const API_ONLY = args.includes("--api-only") || process.env.SITE_LATENCY_API_ONLY === "1";
const BASE = (
  args.find((a) => a.startsWith("--base="))?.slice(7) ??
  process.env.CRON_TARGET_BASE_URL ??
  "https://blackouttrades.com"
).replace(/\/$/, "");
const IS_STAGING = BASE.includes("staging.");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const P1_MS = 2_000;
const P2_MS = 1_000;
const WARN_MS = 800;

const API_PATHS = [
  "/api/health",
  "/api/ready",
  "/api/market/spx/bootstrap",
  "/api/market/spx/pulse",
  "/api/market/spx/desk",
  "/api/market/spx/play",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/gex-heatmap?ticker=SPY",
  "/api/market/flows?limit=30",
  "/api/market/nighthawk/edition",
  "/api/market/zerodte/board",
  "/api/public/track-record",
];

const WARM_PATHS = [
  "/api/market/spx/bootstrap",
  "/api/market/spx/desk",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/gex-heatmap?ticker=SPY",
];

const PAGES = [
  {
    path: "/dashboard",
    label: "dashboard",
    ready: IS_STAGING
      ? () =>
          document.querySelectorAll(".spx-gex-matrix-table tbody tr").length >= 5 ||
          document.body.innerText.length > 800
      : () =>
          document.querySelectorAll(".spx-gex-matrix-table tbody tr").length >= 20 ||
          document.body.innerText.length > 800,
  },
  {
    path: "/flows",
    label: "flows",
    ready: () => document.body.innerText.length > 400,
  },
  {
    path: "/heatmap",
    label: "heatmap",
    ready: () =>
      document.querySelector(".gex-heatmap-panel") != null ||
      document.body.innerText.toLowerCase().includes("thermal"),
  },
  {
    path: "/nighthawk",
    label: "nighthawk",
    ready: () =>
      /today'?s 0dte plays/i.test(document.body.innerText) ||
      document.body.innerText.length > 300,
  },
];

const checks = [];
const rec = (name, status, detail, ms) => {
  checks.push({ name, status, detail, ms });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}${ms != null ? ` (${ms}ms)` : ""}`);
};

function grade(ms) {
  if (ms <= WARN_MS) return "PASS";
  if (ms <= P2_MS) return "WARN";
  if (ms <= P1_MS) return "FAIL";
  return "FAIL";
}

async function stagingForceWarmCrons() {
  if (!IS_STAGING || process.env.STAGING_CRON_WARM !== "1") return;
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return;
  const paths = [
    "/api/cron/desk-warm?force=1",
    "/api/cron/heatmap-warm?force=1",
    "/api/cron/zerodte-warm?force=1",
  ];
  console.log("--- Staging cron warm (force) ---");
  for (const path of paths) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      await res.text();
      const ms = Math.round(performance.now() - t0);
      console.log(`  warmed ${path.split("?")[0]} → HTTP ${res.status} (${ms}ms)`);
    } catch (e) {
      console.warn(`  warm ${path} failed: ${e.message}`);
    }
  }
}

async function main() {
  console.log(`\n=== Site latency audit ===\nTarget: ${BASE}\n`);

  await stagingForceWarmCrons();

  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    rec("auth", "FAIL", session.reason);
    process.exit(1);
  }

  const cookieHeader = session.cookies
    .filter((c) => c.name === "__session" || c.name === "__client_uat")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  console.log("--- Pre-warm (desk-warm lane proxies) ---");
  for (const path of WARM_PATHS) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookieHeader, Accept: "application/json" } });
      await res.text();
      const ms = Math.round(performance.now() - t0);
      rec(`prewarm:${path.split("?")[0]}`, grade(ms), `HTTP ${res.status}`, ms);
    } catch (e) {
      rec(`prewarm:${path}`, "FAIL", e.message);
    }
  }

  console.log("\n--- API warm pass (2nd = cached) ---");
  for (const path of API_PATHS) {
    for (let pass = 1; pass <= 2; pass++) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookieHeader, Accept: "application/json" } });
        await res.text();
        const ms = Math.round(performance.now() - t0);
        const label = pass === 1 ? `api:${path.split("?")[0]}` : `api:${path.split("?")[0]}:warm`;
        rec(label, grade(ms), `HTTP ${res.status}`, ms);
      } catch (e) {
        rec(`api:${path}`, "FAIL", e.message);
      }
    }
  }

  if (!API_ONLY) {
    console.log("\n--- Browser paint ---");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext();
    await context.addInitScript(onboardingInitScript());
    await context.addCookies(session.cookies);

    for (const page of PAGES) {
      const p = await context.newPage();
      const t0 = Date.now();
      try {
        const navStart = Date.now();
        await p.goto(`${BASE}${page.path}`, { waitUntil: "commit", timeout: 60_000 });
        const navMs = Date.now() - navStart;
        await p.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => null);
        const domMs = Date.now() - t0;
        await p.waitForFunction(() => window.Clerk?.user?.id, { timeout: 20_000 }).catch(() => null);
        await p.waitForFunction(page.ready, { timeout: 30_000 }).catch(() => null);
        const readyMs = Date.now() - t0;
        rec(`page:${page.label}:nav`, grade(navMs), "commit", navMs);
        rec(`page:${page.label}:dom`, domMs <= P2_MS ? "PASS" : grade(domMs), "domcontentloaded", domMs);
        rec(`page:${page.label}:ready`, grade(readyMs), "content ready", readyMs);
      } catch (e) {
        rec(`page:${page.label}`, "FAIL", e.message);
      } finally {
        await p.close();
      }
    }

    await browser.close();
  } else {
    rec("browser", "SKIP", "--api-only");
  }

  await session.cleanup?.();

  const reportPath = join(OUT, `site-latency-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ ts: new Date().toISOString(), base: BASE, checks }, null, 2));
  console.log(`\nReport: ${reportPath}`);

  const fails = checks.filter(
    (c) =>
      c.status === "FAIL" &&
      c.name !== "browser" &&
      !c.name.endsWith(":warm")
  );
  console.log(`\n=== Summary === FAIL: ${fails.length} / ${checks.length}\n`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
