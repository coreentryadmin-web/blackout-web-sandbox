#!/usr/bin/env node
/**
 * HELIX /flows layout audit — viewport metrics + screenshots on staging.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintAppSession } from "./audit/lib/app-session.mjs";
import { onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.HELIX_UI_AUDIT_DIR ?? join(process.cwd(), "audit-output/helix-ui-audit");
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";

mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail = "") => {
  checks.push({ name, status, detail });
  const icon = status === "PASS" ? "✓" : status === "WARN" ? "⚠" : "✗";
  console.log(`  ${icon} [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
};

function loadSecret() {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`,
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

function playwrightCookiesFromHeader(header, domain) {
  return header.split(";").map((part) => {
    const [name, ...rest] = part.trim().split("=");
    return { name, value: rest.join("="), domain, path: "/", secure: true, sameSite: "Lax" };
  });
}

async function measureHelix(page) {
  return page.evaluate(() => {
    const tape = document.querySelector(".helix-flow-terminal");
    const scroll = document.querySelector(".helix-flow-table-scroll");
    const grid = document.querySelector(".helix-desk-terminal-grid");
    const table = document.querySelector(".helix-flow-table");
    const rows = document.querySelectorAll(".helix-flow-row:not(.helix-flow-row--skeleton)");
    const auxCols = document.querySelectorAll(".helix-flow-col--aux");
    const visibleAux = [...auxCols].filter((el) => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden";
    });
    const bodyH = document.body.scrollHeight;
    const vh = window.innerHeight;
    const tapeRect = tape?.getBoundingClientRect();
    const scrollRect = scroll?.getBoundingClientRect();
    const gridRect = grid?.getBoundingClientRect();
    const firstRow = rows[0];
    const headerCells = table?.querySelectorAll("thead th") ?? [];
    const dataCells = firstRow?.querySelectorAll("td") ?? [];
    return {
      hasTape: Boolean(tape),
      hasGrid: Boolean(grid),
      hasScroll: Boolean(scroll),
      rowCount: rows.length,
      bodyScrollH: bodyH,
      viewportH: vh,
      pageOverflow: bodyH > vh * 1.35,
      tapeW: tapeRect?.width ?? 0,
      tapeH: tapeRect?.height ?? 0,
      scrollH: scrollRect?.height ?? 0,
      gridW: gridRect?.width ?? 0,
      auxColCount: auxCols.length,
      visibleAuxCount: visibleAux.length,
      headerCount: headerCells.length,
      dataColCount: dataCells.length,
      tableLayout: table ? getComputedStyle(table).tableLayout : null,
    };
  });
}

async function auditViewport(browser, session, { width, height, label }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  });
  await ctx.addInitScript(onboardingInitScript());
  const domain = new URL(BASE).hostname;
  if (session.cookies?.length) await ctx.addCookies(session.cookies);
  else if (session.cookieHeader) await ctx.addCookies(playwrightCookiesFromHeader(session.cookieHeader, domain));

  const page = await ctx.newPage();
  await page.goto(`${BASE}/flows`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(3500);

  const url = page.url();
  if (/sign-in|amazoncognito/i.test(url)) {
    rec(`${label}:auth`, "FAIL", url.slice(0, 80));
    await ctx.close();
    return;
  }
  rec(`${label}:auth`, "PASS");

  const table = page.locator(".helix-flow-table").first();
  if (await table.isVisible({ timeout: 15_000 }).catch(() => false)) {
    rec(`${label}:table`, "PASS");
  } else {
    const skel = await page.locator(".helix-flow-row").count();
    rec(`${label}:table`, skel > 0 ? "WARN" : "FAIL", skel > 0 ? "skeleton only" : "no rows");
  }

  const m = await measureHelix(page);

  if (m.hasTape && m.tapeW >= width * 0.55) rec(`${label}:tape-width`, "PASS", `${Math.round(m.tapeW)}px`);
  else rec(`${label}:tape-width`, "FAIL", `tape=${Math.round(m.tapeW)}px viewport=${width}`);

  if (m.hasScroll && m.scrollH >= 120) rec(`${label}:scroll-region`, "PASS", `${Math.round(m.scrollH)}px`);
  else rec(`${label}:scroll-region`, "WARN", `scrollH=${Math.round(m.scrollH)}`);

  if (!m.pageOverflow) rec(`${label}:page-height`, "PASS", `body=${m.bodyScrollH} vh=${m.viewportH}`);
  else rec(`${label}:page-height`, "WARN", `body scroll ${m.bodyScrollH} > 1.35×vh`);

  if (m.rowCount >= 5) rec(`${label}:rows`, "PASS", String(m.rowCount));
  else rec(`${label}:rows`, "WARN", String(m.rowCount));

  if (width < 1536 && m.visibleAuxCount === 0) rec(`${label}:aux-hidden`, "PASS");
  else if (width >= 1536 && m.visibleAuxCount > 0) rec(`${label}:aux-visible`, "PASS", `${m.visibleAuxCount} aux cols`);
  else if (width >= 1536) rec(`${label}:aux-visible`, "WARN", `${m.visibleAuxCount} aux visible`);
  else rec(`${label}:aux-hidden`, "WARN", `${m.visibleAuxCount} aux still visible`);

  const shotPath = join(OUT, `helix-${label}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });
  rec(`${label}:screenshot`, "PASS", shotPath);

  await ctx.close();
}

async function main() {
  console.log(`\n=== HELIX UI audit ===\nTarget: ${BASE}\nArtifacts: ${OUT}\n`);

  const secret = loadSecret();
  if (secret.COGNITO_AUDIT_PASSWORD) {
    process.env.COGNITO_AUDIT_PASSWORD = secret.COGNITO_AUDIT_PASSWORD;
  }

  const session = await mintAppSession({ appUrl: BASE });
  if (session.skip) {
    rec("auth", "FAIL", session.reason);
    process.exit(1);
  }
  rec("auth", "PASS", session.provider ?? "session");

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  await auditViewport(browser, session, { width: 1024, height: 768, label: "1024" });
  await auditViewport(browser, session, { width: 1440, height: 900, label: "1440" });

  await browser.close();
  try {
    await session.cleanup?.();
  } catch {
    /* best-effort */
  }

  writeFileSync(join(OUT, "checks.json"), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));

  const fails = checks.filter((c) => c.status === "FAIL");
  console.log(`\nSummary: ${checks.length - fails.length} pass, ${fails.length} fail`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
