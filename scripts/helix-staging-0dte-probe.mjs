#!/usr/bin/env node
/**
 * HELIX staging probe — Cognito session, 0DTE filter, analytics layout metrics.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintAppSession } from "./audit/lib/app-session.mjs";
import { onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.HELIX_PROBE_DIR ?? "/opt/cursor/artifacts/helix-staging-probe";

mkdirSync(OUT, { recursive: true });

function playwrightCookiesFromHeader(header, domain) {
  return header.split(";").map((part) => {
    const [name, ...rest] = part.trim().split("=");
    return { name, value: rest.join("="), domain, path: "/", secure: true, sameSite: "Lax" };
  });
}

async function main() {
  const session = await mintAppSession({ appUrl: BASE });
  if (session.skip) {
    console.error("Auth failed:", session.reason);
    process.exit(1);
  }
  console.log("Auth:", session.provider);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const width = Number(process.env.HELIX_PROBE_WIDTH ?? 1920);
  const height = Number(process.env.HELIX_PROBE_HEIGHT ?? 1080);
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(onboardingInitScript());
  const domain = new URL(BASE).hostname;
  if (session.cookies?.length) await ctx.addCookies(session.cookies);
  else if (session.cookieHeader) await ctx.addCookies(playwrightCookiesFromHeader(session.cookieHeader, domain));

  const page = await ctx.newPage();
  await page.goto(`${BASE}/flows`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(4000);

  const analyticsBtn = page.locator(".helix-tape-tool-btn").filter({ hasText: /analytics/i }).first();
  if (await analyticsBtn.isVisible().catch(() => false)) {
    const pressed = await analyticsBtn.getAttribute("aria-pressed");
    if (pressed !== "true") await analyticsBtn.click();
    await page.waitForTimeout(1500);
  }

  const morePanels = page.getByRole("button", { name: /more panels/i }).first();
  if (await morePanels.isVisible().catch(() => false)) {
    await morePanels.click();
    await page.waitForTimeout(1500);
  }

  const dte0 = page.locator(".helix-tape-seg-btn").filter({ hasText: /^0DTE$/ }).first();
  if (await dte0.isVisible().catch(() => false)) {
    await dte0.click();
    await page.waitForTimeout(6000);
  }

  const metrics = await page.evaluate(() => {
    const rail = document.querySelector(".helix-desk-analytics-rail");
    const panels = rail ? [...rail.querySelectorAll(".desk-panel")] : [];
    const panelRects = panels.map((p, i) => {
      const r = p.getBoundingClientRect();
      const title = p.querySelector("h3")?.textContent?.trim() ?? `panel-${i}`;
      return { title, top: Math.round(r.top), height: Math.round(r.height), bottom: Math.round(r.bottom) };
    });
    const overlaps = [];
    for (let i = 0; i < panelRects.length; i++) {
      for (let j = i + 1; j < panelRects.length; j++) {
        const a = panelRects[i];
        const b = panelRects[j];
        if (a.top < b.bottom && b.top < a.bottom) {
          overlaps.push({ a: a.title, b: b.title, overlapPx: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) });
        }
      }
    }
    const railStyle = rail ? getComputedStyle(rail) : null;
    const rowCount = document.querySelectorAll(".helix-tape-row:not(.helix-tape-row--skeleton)").length;
    const loadMore = document.querySelector(".helix-tape-load-more");
    return {
      railDisplay: railStyle?.display ?? null,
      railOverflowY: railStyle?.overflowY ?? null,
      railH: rail ? Math.round(rail.getBoundingClientRect().height) : 0,
      panelCount: panels.length,
      panelRects,
      overlaps,
      tapeRows: rowCount,
      loadMoreText: loadMore?.textContent?.trim() ?? null,
      filteredCount: document.querySelector(".helix-flow-terminal-head")?.textContent?.match(/(\d+)\s+print/i)?.[1] ?? null,
    };
  });

  const shot = join(OUT, "helix-0dte-analytics.png");
  await page.screenshot({ path: shot, fullPage: false });
  writeFileSync(join(OUT, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
  console.log("Screenshot:", shot);

  await browser.close();
  try {
    await session.cleanup?.();
  } catch {
    /* noop */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
