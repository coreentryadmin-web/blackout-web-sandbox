#!/usr/bin/env node
/**
 * Capture the Vector wall/bead RAIL for visual verification of the per-bucket-dominant trail fix.
 * Loads each ticker, lets the rail render, and screenshots the full chart. Compare SPX against the
 * pre-fix baseline (every trail full-width) — post-fix should show staggered wall births + short
 * recent clusters (Skylit behavior). Reuses the staging Cognito temp-user auth + proxy route.
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const STAGING = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SHOT_DIR || "/tmp/claude-0/-home-user/464bea58-d425-5552-a7bd-de5f2e9c99f9/scratchpad/rail-shot";
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "";
const TICKERS = (process.env.RAIL_TICKERS ?? "SPX,ASTS").split(",").map((s) => s.trim());
mkdirSync(OUT, { recursive: true });
const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

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
async function dismiss(page) {
  for (const sel of ['button:has-text("SKIP")', '[aria-label="Close"]']) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) { await el.click().catch(() => {}); return; }
  }
}

// Count distinct bead-trail LEFT origins by scanning the canvas: for each screen column, is there a
// bead pixel? A rail where every trail is full-width has beads starting at the same left column;
// staggered births show beads beginning at many different columns. We report the leftmost bead
// column per horizontal band as a coarse "are births staggered" signal alongside the screenshot.
async function railStats(page) {
  return page.evaluate(() => {
    const host = document.querySelector(".vector-chart, [class*='vector']") || document.body;
    const cvs = [...host.querySelectorAll("canvas")].map((c) => ({ c, r: c.getBoundingClientRect() }))
      .filter((o) => o.r.height > 260 && o.r.width > 200).sort((a, b) => b.r.width - a.r.width);
    if (!cvs.length) return { error: "no-canvas" };
    const { c } = cvs[0];
    let ctx; try { ctx = c.getContext("2d"); } catch { return { error: "no-ctx" }; }
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const { data, width, height } = img;
    const isBead = (r, g, b, a) => a > 60 && ((g > 140 && r > 120 && b < 130) /*gold*/ || (b > 140 && r > 90 && g < 110) /*purple*/);
    // For each row-band, find the leftmost bead column. Collect the set of leftmost columns.
    const leftByRow = [];
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 200))) {
      let left = -1;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (isBead(data[i], data[i + 1], data[i + 2], data[i + 3])) { left = x / (c.width / c.getBoundingClientRect().width); break; }
      }
      if (left >= 0) leftByRow.push(Math.round(left));
    }
    const uniq = [...new Set(leftByRow.map((v) => Math.round(v / 20) * 20))];
    return { rows: leftByRow.length, distinctLeftOrigins: uniq.length, origins: uniq.sort((a, b) => a - b).slice(0, 20) };
  });
}

async function main() {
  const { poolId, region } = cfg();
  const email = `vec-rail-${Date.now()}@blackouttrades.com`;
  const pw = `VecRail!${String(Date.now()).slice(-6)}`;
  mkUser(poolId, region, email, pw);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await proxyRoute(ctx);
  const page = await ctx.newPage();
  try {
    await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.locator('input[name="username"]:visible, input[type="email"]:visible').first().fill(email);
    await page.locator('input[name="password"]:visible, input[type="password"]:visible').first().fill(pw);
    await page.locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible, input[type="submit"]:visible').first().click();
    await page.waitForURL((u) => u.href.startsWith(STAGING), { timeout: 90_000 });
    for (const t of TICKERS) {
      await page.goto(`${STAGING}/vector?ticker=${encodeURIComponent(t)}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(3500);
      await dismiss(page);
      await page.waitForTimeout(6000);
      await page.screenshot({ path: join(OUT, `rail-${t}.png`) });
      const stats = await railStats(page).catch((e) => ({ error: String(e.message) }));
      console.log(`${t}: ${JSON.stringify(stats)}`);
    }
  } finally {
    await browser.close();
    try { sh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}"${region ? ` --region "${region}"` : ""}`); } catch {}
  }
  console.log(`screenshots in ${OUT}`);
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
