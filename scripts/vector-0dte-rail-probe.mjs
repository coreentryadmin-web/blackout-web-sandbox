#!/usr/bin/env node
/** One-shot ground-truth probe: is the persisted 0DTE narrowed rail healthy for SPX/AAPL today?
 *  Signs in (Cognito temp user, deleted), reads /bars for the true sessionYmd, then reads
 *  /wall-history?dte=0dte&session=<ymd> and reports sample counts + first/last bucket. */
import { execSync } from "node:child_process";
import { chromium } from "playwright";
const STAGING = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const REGION = process.env.AWS_REGION ?? "";
const TICKERS = (process.env.PROBE_TICKERS ?? "SPX,AAPL,NVDA").split(",");
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const s = JSON.parse(sh(`aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}"` + (REGION ? ` --region "${REGION}"` : "") + ` --query SecretString --output text`));
const poolId = s.COGNITO_USER_POOL_ID; const region = poolId.split("_")[0];
const email = `vec-railprobe-${Date.now()}@blackouttrades.com`; const pw = `RailP!${String(Date.now()).slice(-6)}`;
try { sh(`aws cognito-idp admin-create-user --user-pool-id "${poolId}" --username "${email}" --message-action SUPPRESS --user-attributes Name=email,Value="${email}" Name=email_verified,Value=true Name=custom:role,Value=admin Name=custom:tier,Value=premium --region "${region}"`); } catch {}
sh(`aws cognito-idp admin-set-user-password --user-pool-id "${poolId}" --username "${email}" --password "${pw}" --permanent --region "${region}"`);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext();
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
const page = await ctx.newPage();
try {
  await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('input[name="username"]:visible, input[type="email"]:visible').first().fill(email);
  await page.locator('input[name="password"]:visible, input[type="password"]:visible').first().fill(pw);
  await page.locator('button[type="submit"]:visible, input[type="submit"]:visible, input[name="signInSubmitButton"]:visible').first().click();
  await page.waitForURL((u) => u.href.startsWith(STAGING), { timeout: 90000 });
  for (const t of TICKERS) {
    const out = await page.evaluate(async (tk) => {
      const bars = await fetch(`/api/market/vector/bars?ticker=${tk}`).then((r) => r.json()).catch(() => null);
      const ymd = bars?.sessionYmd;
      const res = {};
      for (const dte of ["0dte", "weekly", "monthly"]) {
        const wh = await fetch(`/api/market/vector/wall-history?ticker=${tk}&dte=${dte}&session=${ymd}`).then((r) => r.json()).catch(() => null);
        const h = wh?.history || [];
        res[dte] = { n: h.length, first: h[0]?.time ?? null, last: h[h.length - 1]?.time ?? null };
      }
      return { ymd, res };
    }, t);
    console.log(t, JSON.stringify(out));
  }
} finally {
  await browser.close();
  try { sh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}" --region "${region}"`); } catch {}
}
