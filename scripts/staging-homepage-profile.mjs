#!/usr/bin/env node
/**
 * Staging landing page performance profile — browser + asset waterfall.
 * Usage: node scripts/staging-homepage-profile.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const STAGING = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const PROD = "https://blackouttrades.com";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

async function profile(url, label) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requests = [];
  page.on("requestfinished", async (req) => {
    const res = await req.response();
    if (!res) return;
    const timing = req.timing();
    requests.push({
      url: req.url().replace(url, ""),
      type: req.resourceType(),
      status: res.status(),
      size: (await res.body().catch(() => Buffer.alloc(0))).length,
      durationMs: timing.responseEnd,
    });
  });

  const wall0 = Date.now();
  const res = await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
  const wallMs = Date.now() - wall0;
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return {
      ttfb: Math.round(n.responseStart),
      domContentLoaded: Math.round(n.domContentLoadedEventEnd),
      load: Math.round(n.loadEventEnd),
      transferSize: n.transferSize,
    };
  });

  const byType = {};
  for (const r of requests) {
    byType[r.type] = byType[r.type] ?? { count: 0, bytes: 0, ms: 0 };
    byType[r.type].count++;
    byType[r.type].bytes += r.size;
    byType[r.type].ms += r.durationMs;
  }

  const slow = [...requests].sort((a, b) => b.durationMs - a.durationMs).slice(0, 8);

  await browser.close();
  return {
    label,
    url,
    httpStatus: res?.status(),
    wallMs,
    nav,
    requestCount: requests.length,
    totalBytes: requests.reduce((s, r) => s + r.size, 0),
    byType,
    slowest: slow.map((r) => ({ path: r.url.slice(0, 120), ms: Math.round(r.durationMs), status: r.status })),
  };
}

async function main() {
  console.log("\n=== Homepage performance profile ===\n");
  const staging = await profile(STAGING, "staging");
  const prod = await profile(PROD, "prod");

  for (const p of [staging, prod]) {
    console.log(`${p.label.toUpperCase()} (${p.url})`);
    console.log(`  HTTP ${p.httpStatus} | wall ${p.wallMs}ms | TTFB ${p.nav.ttfb}ms | DCL ${p.nav.domContentLoaded}ms | load ${p.nav.load}ms`);
    console.log(`  requests: ${p.requestCount} | bytes: ${(p.totalBytes / 1024).toFixed(0)} KB`);
    console.log(`  by type: ${JSON.stringify(p.byType)}`);
    console.log(`  slowest:`);
    for (const s of p.slowest) console.log(`    ${s.ms}ms ${s.status} ${s.path}`);
    console.log("");
  }

  const delta = staging.wallMs - prod.wallMs;
  const warn = delta > 1500 || staging.nav.ttfb > 800;
  const status = warn ? "WARN" : "PASS";
  console.log(`Delta wall: ${delta > 0 ? "+" : ""}${delta}ms (staging vs prod)`);
  if (staging.nav.ttfb < 200 && staging.wallMs > 2000) {
    console.log("Diagnosis: TTFB is fast — slowness is client-side (JS/CSS/fonts/Clerk hydration).");
    console.log("Staging no-store on HTML forces origin round-trip every visit; static chunks should cache at edge.");
  }

  const report = { at: new Date().toISOString(), staging, prod, delta, status };
  const path = join(OUT, `homepage-profile-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(`Report: ${path}\n`);

  if (warn) {
    console.log("WARN — homepage slower than prod threshold");
    process.exit(0);
  }
  console.log("PASS — homepage within threshold\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
