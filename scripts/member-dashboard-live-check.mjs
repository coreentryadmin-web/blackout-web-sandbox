#!/usr/bin/env node
/**
 * Member-facing live validation — what premium users see on /dashboard during RTH.
 * Injects Clerk session cookies into Playwright (same path as ios-native-ui-e2e).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  mintIosPlaywrightSession,
  onboardingInitScript,
} from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.AUDIT_APP_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail) => {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
};

function isEtCashRth(now = new Date()) {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(now);
  if (wd === "Sat" || wd === "Sun") return false;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  return mins >= 9 * 60 + 30 && mins <= 16 * 60;
}

async function fetchMemberApi(cookieHeader, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: cookieHeader, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  const rth = isEtCashRth();
  console.log(`\n=== Member dashboard live check ===`);
  console.log(`Target: ${BASE}`);
  console.log(`ET RTH: ${rth ? "yes" : "no (off-hours checks relaxed)"}\n`);

  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    rec("env:clerk", "FAIL", session.reason);
    process.exit(1);
  }

  const cookieHeader = session.cookies
    .filter((c) => c.name === "__session" || c.name === "__client_uat")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  try {
    const merged = await fetchMemberApi(cookieHeader, "/api/market/spx/merged");
    const hm = await fetchMemberApi(cookieHeader, "/api/market/gex-heatmap?ticker=SPX");
    const m = merged.json?.merged ?? merged.json;
    const strikeCount = Object.keys(hm.json?.gex?.strike_totals ?? {}).length;

    rec(
      "member-api:merged",
      merged.status === 200 && m?.market_open ? "PASS" : "WARN",
      `HTTP ${merged.status} market_open=${m?.market_open} label=${m?.market_label} price=${m?.price}`
    );
    rec(
      "member-api:heatmap",
      hm.status === 200 && strikeCount > 50 ? "PASS" : "FAIL",
      `HTTP ${hm.status} strikes=${strikeCount} spot=${hm.json?.spot}`
    );

    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    });
    await context.addInitScript(onboardingInitScript());
    await context.addCookies(session.cookies);

    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err.message)));

    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 60_000 });
    rec("member-ui:auth", "PASS", "Clerk session active in browser");

    const desk = page.locator(".spx-sniper-desk");
    await desk.waitFor({ state: "visible", timeout: 45_000 });

    // Members see a brief "Loading gamma matrix…" while SWR fetches — wait for real rows.
    const matrix = page.locator(".spx-gex-matrix-table");
    await page
      .waitForFunction(
        () => {
          const table = document.querySelector(".spx-gex-matrix-table");
          if (!table) return false;
          return table.querySelectorAll("tbody tr").length >= 20;
        },
        { timeout: 45_000 }
      )
      .catch(() => null);

    const text = await desk.innerText();
    const shot = join(OUT, `member-dashboard-live-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true });

    if (rth) {
      if (/\bOFFLINE\b/.test(text)) rec("member-ui:live-badge", "FAIL", "shows OFFLINE during RTH");
      else rec("member-ui:live-badge", "PASS", "not OFFLINE");

      if (/Last session snapshot · not live/i.test(text)) {
        rec("member-ui:snapshot-banner", "FAIL", "stale snapshot banner visible during RTH");
      } else rec("member-ui:snapshot-banner", "PASS");

      if (/MARKET CLOSED/i.test(text) && /0DTE WINDOW CLOSED/i.test(text)) {
        rec("member-ui:trade-alerts-closed", "FAIL", "MARKET CLOSED hero during RTH");
      } else rec("member-ui:trade-alerts-closed", "PASS");

      const stillLoading = /Loading gamma matrix/i.test(text);
      const rows = await matrix.locator("tbody tr").count().catch(() => 0);
      if (stillLoading && rows < 20) {
        rec("member-ui:matrix-loading", "FAIL", "matrix still loading after 45s");
      } else rec("member-ui:matrix-loading", "PASS");

      if (/GEX stale/i.test(text)) rec("member-ui:gex-stale", "WARN", "GEX stale badge visible");
      else rec("member-ui:gex-stale", "PASS");
      if (rows < 20) rec("member-ui:matrix-rows", "FAIL", `${rows} rows visible`);
      else rec("member-ui:matrix-rows", "PASS", `${rows} rows`);

      if (/\bLIVE\b/.test(text)) rec("member-ui:live-label", "PASS", "LIVE present");
      else rec("member-ui:live-label", "WARN", "LIVE label not found in desk text");
    } else {
      rec("member-ui:rth-skipped", "PASS", "off-hours — UI presence only");
      const matrix = page.locator(".spx-gex-matrix-table");
      if (await matrix.isVisible().catch(() => false)) {
        rec("member-ui:matrix-present", "PASS");
      } else {
        rec("member-ui:matrix-present", "WARN", "matrix table not visible off-hours");
      }
    }

    const priceMatch = text.match(/(?:\$)?[\d,]+\.\d{2}/);
    if (priceMatch) rec("member-ui:spot-visible", "PASS", priceMatch[0]);
    else rec("member-ui:spot-visible", "FAIL", "no SPX price visible in desk");

    if (consoleErrors.length) rec("member-ui:console", "FAIL", consoleErrors.slice(0, 2).join(" | "));
    else rec("member-ui:console", "PASS");

    rec("member-ui:screenshot", "PASS", shot);
    await browser.close();
  } finally {
    try {
      await session.cleanup?.();
    } catch {
      /* best-effort */
    }
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  writeFileSync(join(OUT, `member-dashboard-live-${Date.now()}.json`), JSON.stringify({ checks }, null, 2));
  console.log(`\n=== Summary === FAIL: ${fails.length} / ${checks.length}\n`);
  fails.forEach((f) => console.log(`  · ${f.name}: ${f.detail ?? ""}`));
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
