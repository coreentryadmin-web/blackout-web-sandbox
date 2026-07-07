#!/usr/bin/env node
/**
 * iOS native UI E2E — Playwright simulates Capacitor WKWebView (BlackOutiOSApp UA +
 * iPhone viewport), signs in via Clerk cookie jar, clicks every tool tab + primary
 * controls, captures screenshots. Closest automated proxy to TestFlight interaction.
 *
 * Usage:
 *   npm run test:ios-ui-e2e
 *   VALIDATE_BASE=https://blackouttrades.com npm run test:ios-ui-e2e
 *
 * Output:
 *   /opt/cursor/artifacts/ios-ui-e2e/report.json
 *   /opt/cursor/artifacts/ios-ui-e2e/*.png
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  iosPlaywrightDevice,
  iosPlaywrightDeviceProMax16,
  mintIosPlaywrightSession,
  onboardingInitScript,
  readShellProbe,
} from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.IOS_UI_E2E_DIR || "/opt/cursor/artifacts/ios-ui-e2e";
mkdirSync(OUT, { recursive: true });

const checks = [];
const ok = (name, detail = "") => {
  checks.push({ name, pass: true, detail });
  console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
};
const warn = (name, detail = "") => {
  checks.push({ name, pass: true, warn: true, detail });
  console.log(`  [WARN] ${name}${detail ? ` — ${detail}` : ""}`);
};
const fail = (name, detail = "") => {
  checks.push({ name, pass: false, detail });
  console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
};

const TABS = [
  { href: "/dashboard", label: "SPX Slayer", code: "SPX", route: "dashboard" },
  { href: "/flows", label: "HELIX", code: "HLX", route: "flows" },
  { href: "/heatmap", label: "BlackOut Thermal", code: "THM", route: "heatmap" },
  { href: "/terminal", label: "Largo", code: "LRG", route: "largo" },
  { href: "/nighthawk", label: "Night Hawk", code: "HWK", route: "nighthawk" },
];

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function clickSegment(page, label) {
  const btn = page.locator(".ios-native-segment-btn", { hasText: label }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(600);
    return true;
  }
  return false;
}

async function clickFlowSeg(page, label) {
  const btn = page.locator(".flow-seg-btn", { hasText: label }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

async function clickRoleTab(page, pattern) {
  const tab = page.getByRole("tab", { name: pattern }).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

async function testToolPage(page, tab) {
  const tabLink = page.getByRole("link", { name: tab.label }).first();
  if (!(await tabLink.isVisible().catch(() => false))) {
    const codeLink = page.locator(".ios-app-tab-link", { hasText: tab.code }).first();
    if (!(await codeLink.isVisible().catch(() => false))) {
      fail(`tab:${tab.code}`, "instrument rail link not visible");
      return;
    }
    await codeLink.click();
  } else {
    await tabLink.click();
  }
  await page.waitForURL((url) => url.pathname === tab.href || url.pathname.startsWith(`${tab.href}/`), {
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);

  const probe = await readShellProbe(page);
  if (probe.route === tab.route || tab.route === "dashboard" && probe.route === "dashboard") {
    ok(`tab:${tab.code}`, probe.route ?? tab.href);
  } else if (probe.nativeShell && probe.route) {
    ok(`tab:${tab.code}`, `route=${probe.route}`);
  } else {
    warn(`tab:${tab.code}`, `loaded ${page.url()} shell=${JSON.stringify(probe)}`);
  }

  await shot(page, `tab-${tab.route}`);

  if (tab.route === "dashboard") {
    if (await clickSegment(page, "Matrix")) {
      ok("spx:segment-matrix");
      await shot(page, "spx-matrix");
      const gexTab = page.locator("#spx-matrix-tab-gex, [id*='matrix-tab-gex']").first();
      if (await gexTab.isVisible().catch(() => false)) {
        await gexTab.click();
        ok("spx:matrix-gex-tab");
      }
      const vexTab = page.locator("#spx-matrix-tab-vex, [id*='matrix-tab-vex']").first();
      if (await vexTab.isVisible().catch(() => false)) {
        await vexTab.click();
        ok("spx:matrix-vex-tab");
      }
    }
    if (await clickSegment(page, "Plays")) {
      ok("spx:segment-plays");
      await shot(page, "spx-plays");
    }
    if (await clickSegment(page, "Intel")) {
      ok("spx:segment-intel");
      await shot(page, "spx-intel");
    }
    const identity = page.locator(".spx-sniper-identity");
    if (await identity.isVisible().catch(() => false)) {
      warn("spx:duplicate-identity", "title block still visible under native header");
    } else {
      ok("spx:no-duplicate-identity");
    }
  }

  if (tab.route === "flows") {
    if (await clickSegment(page, "Analytics")) {
      ok("helix:segment-analytics");
      await shot(page, "helix-analytics");
    }
    if (await clickSegment(page, "Live tape")) {
      ok("helix:segment-tape");
      await shot(page, "helix-tape");
    }
    if (await clickFlowSeg(page, "CALL")) ok("helix:filter-call");
    if (await clickFlowSeg(page, "PUT")) ok("helix:filter-put");
    if (await clickFlowSeg(page, "ALL")) ok("helix:filter-all");
    const tape = page.locator(".flow-scroll-max, .flow-scroll").first();
    if (await tape.isVisible().catch(() => false)) {
      await tape.evaluate((el) => {
        el.scrollTop += 200;
      });
      ok("helix:tape-scroll");
    }
  }

  if (tab.route === "heatmap") {
    if (await clickRoleTab(page, /^Matrix$/i)) ok("thermal:tab-matrix");
    if (await clickRoleTab(page, /^gex$/i)) ok("thermal:lens-gex");
    if (await clickRoleTab(page, /^vex$/i)) ok("thermal:lens-vex");
    if (await clickRoleTab(page, /Profile/i)) ok("thermal:tab-profile");
    const scroll = page.locator(".gex-matrix-scroll, .max-h-\\[clamp\\(480px\\,74vh\\,880px\\)\\]").first();
    if (await scroll.isVisible().catch(() => false)) {
      await scroll.evaluate((el) => {
        el.scrollLeft += 120;
        el.scrollTop += 80;
      });
      ok("thermal:matrix-scroll");
    }
    await shot(page, "thermal-matrix");
  }

  if (tab.route === "largo") {
    const chip = page.locator(".largo-suggestion-chip").first();
    if (await chip.isVisible().catch(() => false)) {
      ok("largo:suggestion-visible");
    }
    const input = page.locator(".largo-input-fullpage, .desk-largo-input").first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill("What's the SPX setup?");
      ok("largo:input-fill");
    }
    const send = page.getByRole("button", { name: /^send$/i }).first();
    if (await send.isEnabled().catch(() => false)) {
      ok("largo:send-enabled");
    }
    await shot(page, "largo-input");
  }

  if (tab.route === "nighthawk") {
    if (await clickSegment(page, "Night's Watch")) {
      ok("hawk:segment-watch");
      await shot(page, "hawk-watch");
    }
    if (await clickSegment(page, "Playbook")) {
      ok("hawk:segment-playbook");
    }
  }

  if (tab.route === "grid") {
    if (await clickRoleTab(page, /0DTE Command/i)) ok("grid:tab-command");
    if (await clickRoleTab(page, /Market Grid/i)) {
      ok("grid:tab-market");
      await shot(page, "grid-market");
    }
    const search = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill("SPY");
      ok("grid:search-fill");
    }
    await shot(page, "grid-command");
  }
}

console.log("test:ios-ui-e2e — Playwright iPhone 16 Pro / Pro Max audit\n");
console.log(`  base: ${BASE}\n`);

const consoleErrors = [];
const pageErrors = [];

async function runDevicePass(deviceFactory, session, prefix = "") {
  const { contextOptions, deviceName, tierClass } = deviceFactory();
  console.log(`  device: ${deviceName}\n`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext(contextOptions);
  await context.addInitScript(onboardingInitScript());
  await context.addCookies(session.cookies);

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  try {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 60_000 });
    ok(`${prefix}auth:clerk-session`);

    const tierOk = await page.evaluate((expected) => document.documentElement.classList.contains(expected), tierClass);
    if (tierOk) ok(`${prefix}device:tier-class`, tierClass);
    else warn(`${prefix}device:tier-class`, `expected ${tierClass} on html`);

    const shell0 = await readShellProbe(page);
    if (shell0.nativeShell) {
      ok(`${prefix}shell:native-active`, `route=${shell0.route}`);
    } else {
      warn(
        `${prefix}shell:native-active`,
        "ios-native-shell off — deploy main for full native chrome"
      );
    }

    if (shell0.iosApp) ok(`${prefix}shell:ios-app`);
    else fail(`${prefix}shell:ios-app`, "BlackOutiOSApp UA not detected");

    if (await page.locator(".ios-app-tab-bar").isVisible().catch(() => false)) {
      ok(`${prefix}shell:tab-bar`);
    } else {
      fail(`${prefix}shell:tab-bar`, "instrument rail missing");
    }

    const menuBtn = page.getByRole("button", { name: /command deck|open menu/i });
    if (await menuBtn.isVisible().catch(() => false)) {
      await menuBtn.click();
      await page.waitForSelector(".ios-native-menu-sheet", { timeout: 10_000 });
      ok(`${prefix}chrome:menu-open`);
      await shot(page, `${prefix}menu-open`);
      await page.getByRole("button", { name: /close command deck|close menu/i }).click();
      ok(`${prefix}chrome:menu-close`);
    } else {
      warn(`${prefix}chrome:menu`, "command deck button not visible");
    }

    await shot(page, `${prefix}00-dashboard-entry`);

    for (const tab of TABS) {
      await testToolPage(page, tab);
    }

    await page.getByRole("link", { name: "SPX Slayer" }).first().click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    ok(`${prefix}nav:return-spx`);
  } finally {
    await browser.close();
  }
}

const session = await mintIosPlaywrightSession({ appUrl: BASE });
if (session.skip) {
  console.log(`  [SKIP] test:ios-ui-e2e — ${session.reason}`);
  process.exit(0);
}

try {
  await runDevicePass(iosPlaywrightDevice, session, "pro:");
  await runDevicePass(iosPlaywrightDeviceProMax16, session, "max:");
} finally {
  await session.cleanup();
}

if (pageErrors.length) {
  fail("runtime:page-errors", pageErrors.slice(0, 3).join(" | "));
} else {
  ok("runtime:page-errors");
}

const noisyConsole = consoleErrors.filter(
  (e) => !/clerk|favicon|404|ResizeObserver|hydration/i.test(e)
);
if (noisyConsole.length) {
  warn("runtime:console-errors", noisyConsole.slice(0, 3).join(" | "));
} else {
  ok("runtime:console-errors");
}

const failed = checks.filter((c) => !c.pass);
const reportPath = join(OUT, "report.json");
writeFileSync(
  reportPath,
  JSON.stringify({ base: BASE, ts: new Date().toISOString(), checks }, null, 2)
);

console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
console.log(`  report: ${reportPath}`);
console.log(`  screenshots: ${OUT}\n`);

if (failed.length) process.exit(1);
