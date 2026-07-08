#!/usr/bin/env node
/**
 * Full live staging website E2E — Playwright walks public + authed surfaces,
 * clicks nav/segments, captures console errors and screenshots.
 *
 * Usage:
 *   npm run validate:staging-site-e2e
 *   node scripts/staging-site-e2e.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const OUT = process.env.STAGING_SITE_E2E_DIR || "/opt/cursor/artifacts/staging-site-e2e";
const AUDIT_OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });
mkdirSync(AUDIT_OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail = "") => {
  checks.push({ name, status, detail });
  const icon = status === "PASS" ? "✓" : status === "WARN" ? "⚠" : status === "SKIP" ? "○" : "✗";
  console.log(`  ${icon} [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
};

function loadSecret() {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`,
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

const PUBLIC_PAGES = [
  { path: "/", mustMatch: /One engine|See the structure/i, label: "landing" },
  { path: "/sign-in", mustMatch: /sign in|Sign in/i, label: "sign-in" },
  { path: "/sign-up", mustMatch: /sign up|Sign up|Create/i, label: "sign-up" },
  { path: "/faq", mustMatch: /faq|question/i, label: "faq" },
  { path: "/learn", mustMatch: /learn|SPX|HELIX/i, label: "learn" },
  { path: "/pricing", mustMatch: /pricing|plan|month/i, label: "pricing" },
  { path: "/upgrade", mustMatch: /upgrade|premium|plan/i, label: "upgrade" },
  { path: "/offline", mustMatch: /offline|connection/i, label: "offline" },
];

const AUTH_PAGES = [
  { path: "/dashboard", mustMatch: /SPX|Slayer|gamma|matrix/i, label: "dashboard" },
  { path: "/flows", mustMatch: /flow|HELIX|tape/i, label: "flows" },
  { path: "/heatmap", mustMatch: /thermal|gamma|GEX|heatmap/i, label: "heatmap" },
  { path: "/terminal", mustMatch: /largo|Largo|ask/i, label: "terminal" },
  { path: "/nighthawk", mustMatch: /hawk|playbook|Night/i, label: "nighthawk" },
  { path: "/vector", mustMatch: /vector|universe|coming soon|launch/i, label: "vector" },
  { path: "/account", mustMatch: /account|profile|settings/i, label: "account" },
  { path: "/admin", mustMatch: /admin|operations|health/i, label: "admin" },
  { path: "/learn/getting-started", mustMatch: /getting started|SPX/i, label: "learn-start" },
];

const NAV_LINKS = [
  { href: "/dashboard" },
  { href: "/flows" },
  { href: "/heatmap" },
  { href: "/terminal" },
  { href: "/nighthawk" },
];

async function clickNav(page, { href }) {
  const link = page.locator(`a[href="${href}"], a[href^="${href}/"]`).first();
  if (!(await link.isVisible().catch(() => false))) {
    rec(`nav:${href}`, "WARN", "link not visible");
    return;
  }
  await link.click();
  try {
    await page.waitForURL((url) => url.pathname === href || url.pathname.startsWith(`${href}/`), {
      timeout: 30_000,
    });
    rec(`nav:${href}`, "PASS", page.url());
    await shot(page, `nav-${href.replace(/\//g, "") || "root"}`);
  } catch {
    rec(`nav:${href}`, "FAIL", `stuck at ${page.url()}`);
  }
}

async function shot(page, name) {
  const safe = name.replace(/[^a-z0-9_-]+/gi, "-");
  const path = join(OUT, `${safe}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function visitPage(page, { path, mustMatch, label }, authed = false) {
  const consoleErrors = [];
  const onConsole = (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (!/favicon|chunkLoadError|ResizeObserver|clerk/i.test(t)) consoleErrors.push(t);
    }
  };
  page.on("console", onConsole);

  const t0 = Date.now();
  let res;
  try {
    res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  } catch (e) {
    page.off("console", onConsole);
    rec(`page:${label}`, "FAIL", `navigation: ${e.message}`);
    return;
  }
  const ms = Date.now() - t0;
  const status = res?.status() ?? 0;

  if (status >= 500) {
    page.off("console", onConsole);
    rec(`page:${label}`, "FAIL", `HTTP ${status} (${ms}ms)`);
    return;
  }
  if (status === 404 && authed) {
    page.off("console", onConsole);
    rec(`page:${label}`, "FAIL", `HTTP 404 — auth may have failed (${ms}ms)`);
    return;
  }

  await page.waitForTimeout(authed ? 2000 : 800);
  const body = await page.locator("body").innerText().catch(() => "");
  const title = await page.title().catch(() => "");

  if (!mustMatch.test(body) && !mustMatch.test(title)) {
    rec(`page:${label}`, "FAIL", `content mismatch HTTP ${status} title="${title.slice(0, 60)}" (${ms}ms)`);
  } else {
    rec(`page:${label}`, "PASS", `HTTP ${status} (${ms}ms)`);
  }

  if (consoleErrors.length) {
    rec(`console:${label}`, "WARN", consoleErrors.slice(0, 2).join(" | "));
  } else {
    rec(`console:${label}`, "PASS");
  }

  await shot(page, `page-${label}`);
  page.off("console", onConsole);
}

async function exerciseDashboard(page) {
  const desk = page.locator(".spx-sniper-desk, [data-testid='spx-desk']").first();
  if (await desk.isVisible().catch(() => false)) {
    rec("desk:visible", "PASS");
    const text = await desk.innerText().catch(() => "");
    if (/\$[\d,]+\.\d{2}/.test(text) || /\d{4,}/.test(text)) rec("desk:spot", "PASS");
    else rec("desk:spot", "WARN", "no price pattern in desk");
  } else {
    rec("desk:visible", "FAIL", "SPX desk shell not found");
  }

  for (const seg of ["Matrix", "Plays", "Intel"]) {
    const btn = page.locator(".ios-native-segment-btn, .spx-seg-btn, button", { hasText: seg }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(600);
      rec(`desk:segment-${seg.toLowerCase()}`, "PASS");
    }
  }

  const gexTab = page.locator("[id*='matrix-tab-gex'], #spx-matrix-tab-gex").first();
  if (await gexTab.isVisible().catch(() => false)) {
    await gexTab.click();
    rec("desk:matrix-gex", "PASS");
  }
  await shot(page, "desk-matrix");
}

async function exerciseFlows(page) {
  const tape = page.locator(".flow-scroll-max, .flow-scroll, .helix-feed").first();
  if (await tape.isVisible().catch(() => false)) rec("helix:tape", "PASS");
  else rec("helix:tape", "WARN", "flow tape not visible");
  for (const f of ["CALL", "PUT", "ALL"]) {
    const btn = page.locator(".flow-seg-btn", { hasText: f }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      rec(`helix:filter-${f.toLowerCase()}`, "PASS");
    }
  }
  await shot(page, "helix");
}

async function exerciseHeatmap(page) {
  const matrix = page.locator(".gex-matrix-scroll, .gex-heatmap, table").first();
  if (await matrix.isVisible().catch(() => false)) rec("thermal:matrix", "PASS");
  else rec("thermal:matrix", "WARN");
  for (const tab of [/^Matrix$/i, /^gex$/i, /^vex$/i]) {
    const t = page.getByRole("tab", { name: tab }).first();
    if (await t.isVisible().catch(() => false)) {
      await t.click();
      rec(`thermal:tab-${tab.source}`, "PASS");
    }
  }
  await shot(page, "thermal");
}

async function exerciseLandingCtas(page) {
  const start = page.getByRole("link", { name: /start trading/i }).first();
  if (await start.isVisible().catch(() => false)) {
    const href = await start.getAttribute("href");
    rec("landing:cta-start", href === "/sign-up" ? "PASS" : "WARN", `href=${href}`);
  }
  const signIn = page.getByRole("link", { name: /sign in/i }).first();
  if (await signIn.isVisible().catch(() => false)) {
    await signIn.click();
    await page.waitForURL(/sign-in/, { timeout: 15_000 }).catch(() => null);
    rec("landing:cta-signin", /sign-in/.test(page.url()) ? "PASS" : "WARN", page.url());
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => null);
  }
}

async function main() {
  console.log(`\n=== Staging site E2E (browser) ===`);
  console.log(`Target: ${BASE}`);
  console.log(`Artifacts: ${OUT}\n`);

  const secret = loadSecret();
  process.env.CLERK_SECRET_KEY = secret.CLERK_SECRET_KEY;
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = secret.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  // --- Public surfaces (no auth) ---
  console.log("--- Public pages ---");
  const pubCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  });
  const pubPage = await pubCtx.newPage();
  for (const p of PUBLIC_PAGES) await visitPage(pubPage, p, false);
  await exerciseLandingCtas(pubPage);
  await pubCtx.close();

  // --- Authed surfaces ---
  console.log("\n--- Authed pages (Clerk admin/premium) ---");
  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    rec("auth:clerk", "FAIL", session.reason);
    await browser.close();
    process.exit(1);
  }
  rec("auth:clerk", "PASS", "session minted");

  const authCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  });
  await authCtx.addInitScript(onboardingInitScript());
  await authCtx.addCookies(session.cookies);
  const page = await authCtx.newPage();

  try {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 60_000 });
    rec("auth:browser", "PASS", "Clerk.user active");
  } catch (e) {
    rec("auth:browser", "FAIL", e.message);
  }

  for (const p of AUTH_PAGES) await visitPage(page, p, true);

  console.log("\n--- Nav clicks ---");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);
  for (const link of NAV_LINKS) await clickNav(page, link);

  console.log("\n--- Tool interactions ---");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);
  await exerciseDashboard(page);

  await page.goto(`${BASE}/flows`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);
  await exerciseFlows(page);

  await page.goto(`${BASE}/heatmap`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);
  await exerciseHeatmap(page);

  await authCtx.close();
  await browser.close();

  try {
    await session.cleanup?.();
  } catch {
    /* best-effort */
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  const warns = checks.filter((c) => c.status === "WARN");
  const report = {
    at: new Date().toISOString(),
    base: BASE,
    checks,
    summary: {
      pass: checks.filter((c) => c.status === "PASS").length,
      warn: warns.length,
      fail: fails.length,
    },
    artifactsDir: OUT,
  };
  const reportPath = join(AUDIT_OUT, `staging-site-e2e-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n=== Summary === PASS ${report.summary.pass} | WARN ${report.summary.warn} | FAIL ${report.summary.fail}`);
  console.log(`Report: ${reportPath}`);
  console.log(`Screenshots: ${OUT}\n`);
  if (fails.length) {
    console.log("Failures:");
    fails.forEach((f) => console.log(`  · ${f.name}: ${f.detail}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
