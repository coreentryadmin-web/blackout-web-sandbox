#!/usr/bin/env node
/**
 * Reusable live staging screenshotter for Vector — logs in (temp Cognito user),
 * captures the full Vector page + a zoom on the desk terminal, into the scratchpad.
 * Usage: node scripts/vector-shot.mjs [ticker] [label]
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const TICKER = (process.argv[2] || "SPX").toUpperCase();
const LABEL = process.argv[3] || "live";
const STAGING = "https://staging.blackouttrades.com";
const OUT = process.env.VECTOR_SHOT_DIR || "/tmp/vector-shots";
const REGION = "us-east-1";
mkdirSync(OUT, { recursive: true });
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

const s = JSON.parse(sh(`aws secretsmanager get-secret-value --secret-id blackout-staging/app/env --region ${REGION} --query SecretString --output text`));
const poolId = s.COGNITO_USER_POOL_ID;
const region = poolId?.includes("_") ? poolId.split("_")[0] : REGION;
const email = `vec-shot-${Date.now()}@blackouttrades.com`;
const password = `VecShot!${String(Date.now()).slice(-6)}`;
const rf = ` --region "${region}"`;
try { sh(`aws cognito-idp admin-create-user --user-pool-id "${poolId}" --username "${email}" --message-action SUPPRESS --user-attributes Name=email,Value="${email}" Name=email_verified,Value=true Name=custom:role,Value=admin Name=custom:tier,Value=premium${rf}`); } catch (e) { if (!/UsernameExists|already exists/i.test(String(e.stderr ?? e.message))) throw e; }
sh(`aws cognito-idp admin-set-user-password --user-pool-id "${poolId}" --username "${email}" --password "${password}" --permanent${rf}`);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 }, locale: "en-US" });
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    try {
      const resp = await ctx.request.fetch(req, { maxRedirects: 0 });
      const st = resp.status(), loc = resp.headers()["location"];
      if (req.isNavigationRequest() && st >= 300 && st < 400 && loc) {
        const abs = new URL(loc, req.url()).href;
        await route.fulfill({ status: 200, contentType: "text/html", body: `<script>location.replace(${JSON.stringify(abs)})</script>` });
        return;
      }
      await route.fulfill({ response: resp });
    } catch { await route.abort(); }
  });
}
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
try {
  await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('input[name="username"]:visible, input[type="email"]:visible').first().fill(email);
  await page.locator('input[name="password"]:visible, input[type="password"]:visible').first().fill(password);
  await page.locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible, input[type="submit"]:visible').first().click();
  await page.waitForURL((u) => u.href.startsWith(STAGING), { timeout: 90000 });
  const url = TICKER === "SPX" ? `${STAGING}/vector` : `${STAGING}/vector?ticker=${TICKER}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3500);
  for (const sel of ['button:has-text("Skip")', 'button:has-text("SKIP")', '[aria-label="Close"]']) {
    const b = page.locator(sel).first();
    if (await b.count().catch(() => 0)) { await b.click().catch(() => {}); break; }
  }
  await page.waitForTimeout(6000);
  const regime = await page.locator('[data-testid="vector-regime-banner"]').count();
  const pulse = await page.locator('.vector-desk-terminal').count();
  console.log(`[${TICKER}] regimeBanner=${regime} terminal=${pulse} consoleErrors=${errs.length}`);
  await page.screenshot({ path: join(OUT, `${LABEL}-${TICKER}-full.png`) });
  const term = page.locator('.vector-desk-terminal').first();
  if (await term.count()) await term.screenshot({ path: join(OUT, `${LABEL}-${TICKER}-terminal.png`) }).catch(()=>{});
  console.log("saved:", join(OUT, `${LABEL}-${TICKER}-full.png`));
} finally {
  await browser.close();
  try { sh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}"${rf}`); } catch {}
}
