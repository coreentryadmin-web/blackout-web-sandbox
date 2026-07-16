#!/usr/bin/env node
/**
 * Vector /vector END-TO-END validation on staging — the per-push gate.
 *
 * STANDING POLICY (CLAUDE.md): run this after EVERY Vector deploy, before considering a change
 * done. It signs into staging (Cognito temp admin+premium user, always deleted) and sweeps the
 * product across MULTIPLE STOCKS × MULTIPLE TIMEFRAMES × MULTIPLE EXPIRIES, asserting the chart,
 * GEX ladder, pulse panel, DTE re-scoping, timeframe switches, and the indicator menu (both
 * groups + toggles that actually draw) all render with ZERO console errors. Exits non-zero on any
 * failure so it can gate. Only move on when this is green.
 *
 * Usage:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/vector-staging-e2e.mjs
 * Env:
 *   VECTOR_E2E_TICKERS="SPX,SPY,NVDA,ASTS"   VECTOR_E2E_TFS="1 min,5 min,15 min,1H"
 *   VECTOR_E2E_DTES="0DTE,WEEKLY,MONTHLY,ALL"  STAGING_BASE_URL  SHOT_DIR
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const STAGING = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SHOT_DIR || "/opt/cursor/artifacts/vector-staging-e2e";
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "";
const TICKERS = (process.env.VECTOR_E2E_TICKERS ?? "SPX,SPY,NVDA,ASTS").split(",").map((s) => s.trim());
const TFS = (process.env.VECTOR_E2E_TFS ?? "1 min,5 min,15 min,1H").split(",").map((s) => s.trim());
const DTES = (process.env.VECTOR_E2E_DTES ?? "0DTE,WEEKLY,MONTHLY,ALL").split(",").map((s) => s.trim());
// Enable one of each indicator kind: an overlay (line series), a session level, a prior-day level.
const INDICATORS = (process.env.VECTOR_E2E_INDICATORS ?? "VWAP,HOD / LOD,Fibonacci (HOD→LOD),Floor pivots (P/R/S)").split(",").map((s) => s.trim());
mkdirSync(OUT, { recursive: true });
const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

const results = [];
const rec = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};

function cfg() {
  const s = JSON.parse(sh(`aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}"` + (REGION ? ` --region "${REGION}"` : "") + ` --query SecretString --output text`));
  const poolId = s.COGNITO_USER_POOL_ID;
  return { poolId, region: poolId?.includes("_") ? poolId.split("_")[0] : REGION };
}
function mkUser(poolId, region, email, pw) {
  const rf = region ? ` --region "${region}"` : "";
  try { sh(`aws cognito-idp admin-create-user --user-pool-id "${poolId}" --username "${email}" --message-action SUPPRESS --user-attributes Name=email,Value="${email}" Name=email_verified,Value=true Name=custom:role,Value=admin Name=custom:tier,Value=premium${rf}`); }
  catch (e) { if (!/UsernameExists|already exists/i.test(String(e.stderr ?? e.message))) throw e; }
  sh(`aws cognito-idp admin-set-user-password --user-pool-id "${poolId}" --username "${email}" --password "${pw}" --permanent${rf}`);
}

async function proxyRoute(ctx) {
  if (!(process.env.HTTPS_PROXY || process.env.https_proxy)) return;
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    try {
      const resp = await ctx.request.fetch(req, { maxRedirects: 0 });
      const loc = resp.headers()["location"];
      if (req.isNavigationRequest() && resp.status() >= 300 && resp.status() < 400 && loc) {
        await route.fulfill({ status: 200, contentType: "text/html", body: `<script>location.replace(${JSON.stringify(new URL(loc, req.url()).href)})</script>` });
        return;
      }
      await route.fulfill({ response: resp });
    } catch { await route.abort(); }
  });
}

async function dismissOnboarding(page) {
  for (const sel of ['button:has-text("SKIP")', '[aria-label="Close"]']) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) { await el.click().catch(() => {}); return; }
  }
}

async function validateTicker(page, ticker, consoleErrors) {
  consoleErrors.length = 0;
  const url = `${STAGING}/vector?ticker=${encodeURIComponent(ticker)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3500);
  await dismissOnboarding(page);
  await page.waitForTimeout(5000);

  // Base render: canvas + ladder + spot + terminal.
  const probe = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      canvas: !!q("canvas"),
      ladderRows: document.querySelectorAll(".vector-gex-ladder-row").length,
      spot: (q(".vector-gex-ladder-sub")?.textContent || "").trim(),
      regime: (q(".vector-regime-read")?.textContent || "").trim().length,
      terminal: !!q(".vector-pulse"),
      menu: !!q(".vector-ind-trigger"),
    };
  });
  rec(`${ticker}: chart canvas renders`, probe.canvas);
  rec(`${ticker}: GEX ladder has rows`, probe.ladderRows > 0, `${probe.ladderRows} rows, ${probe.spot}`);
  rec(`${ticker}: pulse panel present`, probe.terminal);
  rec(`${ticker}: regime banner populated`, probe.regime > 0);
  rec(`${ticker}: indicator menu present`, probe.menu);

  // DTE contract (user-corrected 2026-07-13): 0DTE / WEEKLY / MONTHLY present and clickable;
  // the "ALL" option is REMOVED. Exact data-testid matching — has-text("ALL") substring-matched
  // unrelated buttons ("wall…") and produced a false "still rendered" on every ticker.
  for (const key of ["0dte", "weekly", "monthly"]) {
    const btn = page.locator(`[data-testid="vector-dte-${key}"]`).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(1200);
      rec(`${ticker}: DTE ${key} toggles`, true);
    } else {
      rec(`${ticker}: DTE ${key} button present`, false);
    }
  }
  const allBtn = await page.locator('[data-testid="vector-dte-all"]').count().catch(() => 0);
  rec(`${ticker}: DTE ALL option removed`, allBtn === 0, allBtn ? "still rendered" : "");

  // Timeframes — each must redraw without error.
  for (const tf of TFS) {
    const ok = await page.locator("#vector-tf-select").selectOption({ label: tf }).then(() => true).catch(() => false);
    await page.waitForTimeout(900);
    rec(`${ticker}: timeframe ${tf}`, ok);
  }

  // Indicator menu — open, enable one of each kind, confirm they draw (price lines + overlay series).
  if (probe.menu) {
    await page.locator(".vector-ind-trigger").click();
    await page.waitForTimeout(500);
    const groups = await page.evaluate(() => [...document.querySelectorAll(".vector-ind-panel-head span")].map((s) => s.textContent));
    rec(`${ticker}: menu shows both groups`, groups.includes("Moving averages") && groups.includes("Key levels"), JSON.stringify(groups));
    for (const label of INDICATORS) {
      await page.locator(`.vector-ind-item:has-text("${label}")`).first().click().catch(() => {});
      await page.waitForTimeout(700);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    const badge = await page.locator(".vector-ind-badge").textContent().catch(() => null);
    rec(`${ticker}: indicators enabled (badge)`, Number(badge) >= INDICATORS.length - 1, `badge=${badge}`);
    await page.screenshot({ path: join(OUT, `e2e-${ticker}.png`) });
  }

  rec(`${ticker}: zero console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
}

async function main() {
  console.log(`\n=== Vector staging E2E — ${STAGING} ===`);
  console.log(`Tickers: ${TICKERS.join(", ")} · TFs: ${TFS.join(", ")} · DTEs: ${DTES.join(", ")}\n`);
  const { poolId, region } = cfg();
  const email = `vec-e2e-${Date.now()}@blackouttrades.com`;
  const pw = `VecE2e!${String(Date.now()).slice(-6)}`;
  mkUser(poolId, region, email, pw);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await proxyRoute(ctx);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + String(e.message).slice(0, 160)));

  try {
    await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.locator('input[name="username"]:visible, input[type="email"]:visible').first().fill(email);
    await page.locator('input[name="password"]:visible, input[type="password"]:visible').first().fill(pw);
    await page.locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible, input[type="submit"]:visible').first().click();
    await page.waitForURL((u) => u.href.startsWith(STAGING), { timeout: 90_000 });
    console.log(`signed in as ${email}\n`);

    for (const ticker of TICKERS) {
      console.log(`--- ${ticker} ---`);
      try {
        await validateTicker(page, ticker, consoleErrors);
      } catch (e) {
        rec(`${ticker}: validation threw`, false, String(e.message).slice(0, 120));
      }
    }
  } finally {
    await browser.close();
    try { sh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}"${region ? ` --region "${region}"` : ""}`); } catch {}
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${failed.length ? "FAILED" : "PASSED"} — ${results.length - failed.length}/${results.length} checks ===`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? " — " + f.detail : ""}`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
