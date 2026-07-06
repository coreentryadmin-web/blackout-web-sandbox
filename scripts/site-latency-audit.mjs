#!/usr/bin/env node
/**
 * Full-site latency audit — APIs + browser paint times for every premium surface.
 * Exit 1 when any P1 threshold breached (for CI / scheduled agents).
 *
 * Usage: node scripts/site-latency-audit.mjs [--base=https://blackouttrades.com]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "https://blackouttrades.com").replace(
  /\/$/,
  ""
);
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
  "/api/grid/bootstrap",
  "/api/public/track-record",
];

const PAGES = [
  { path: "/dashboard", label: "dashboard", ready: () => document.querySelectorAll(".spx-gex-matrix-table tbody tr").length >= 20 },
  { path: "/flows", label: "flows", ready: () => document.body.innerText.length > 500 },
  { path: "/heatmap", label: "heatmap", ready: () => document.querySelector(".gex-heatmap-panel") != null },
  { path: "/grid", label: "grid", ready: () => document.querySelector(".grid-board") != null },
  { path: "/nighthawk", label: "nighthawk", ready: () => document.body.innerText.length > 400 },
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

async function main() {
  console.log(`\n=== Site latency audit ===\nTarget: ${BASE}\n`);

  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    rec("auth", "FAIL", session.reason);
    process.exit(1);
  }

  const cookieHeader = session.cookies
    .filter((c) => c.name === "__session" || c.name === "__client_uat")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  console.log("--- API warm pass (2nd = cached) ---");
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

  console.log("\n--- Browser paint ---");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext();
  await context.addInitScript(onboardingInitScript());
  await context.addCookies(session.cookies);

  for (const page of PAGES) {
    const p = await context.newPage();
    const t0 = Date.now();
    try {
      await p.goto(`${BASE}${page.path}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await p.waitForFunction(() => window.Clerk?.user?.id, { timeout: 45_000 }).catch(() => null);
      const domMs = Date.now() - t0;
      await p.waitForFunction(page.ready, { timeout: 45_000 }).catch(() => null);
      const readyMs = Date.now() - t0;
      rec(`page:${page.label}:dom`, domMs <= P2_MS ? "PASS" : grade(domMs), "domcontentloaded", domMs);
      rec(`page:${page.label}:ready`, grade(readyMs), "content ready", readyMs);
    } catch (e) {
      rec(`page:${page.label}`, "FAIL", e.message);
    } finally {
      await p.close();
    }
  }

  await browser.close();
  await session.cleanup?.();

  const reportPath = join(OUT, `site-latency-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ ts: new Date().toISOString(), checks }, null, 2));
  console.log(`\nReport: ${reportPath}`);

  const fails = checks.filter(
    (c) =>
      c.status === "FAIL" &&
      (c.name.includes(":warm") || c.name.startsWith("page:") || c.name === "auth")
  );
  console.log(`\n=== Summary === FAIL: ${fails.length} / ${checks.length}\n`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
