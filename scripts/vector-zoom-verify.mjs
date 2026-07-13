#!/usr/bin/env node
/**
 * Vector PRICE-AXIS zoom-persistence verification (staging, live).
 *
 * Targets the exact member report: "I zoom in and a split second later it zooms out."
 * The #299 fix preserved the TIME axis; this proves the PRICE (vertical) axis now holds through
 * multiple live SSE ticks after a MANUAL vertical zoom (the residual reset fixed by
 * reassertPriceAutoScale).
 *
 * Method (no chart handle available on the deployed build, so we measure the pixels):
 *   1. Sign in (Cognito temp admin+premium user, always deleted), open /vector?ticker=SPX, let live
 *      ticks flow.
 *   2. Measure the CANDLE BAND vertical extent as a fraction of canvas height (auto-scaled: candles
 *      occupy a slim band because the axis spans the walls; a manual vertical zoom expands/shrinks it).
 *   3. Perform a REAL mouse drag on the right price-axis gutter → lightweight-charts sets
 *      autoScale=false and rescales. Re-measure (R1).
 *   4. Wait through several SSE ticks (>= one trail/overlay refresh). Re-measure (R2).
 *   5. ASSERT R2 ≈ R1 (manual scale HELD) and R1 materially != R0 (the drag actually rescaled).
 *      If the bug were present, R2 would snap back toward R0 within ~1s.
 *   6. Save before/after screenshots for human inspection.
 *
 * Usage: env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/vector-zoom-verify.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const STAGING = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SHOT_DIR || "/tmp/claude-0/-home-user/464bea58-d425-5552-a7bd-de5f2e9c99f9/scratchpad/zoom-verify";
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "";
const TICKER = process.env.ZOOM_TICKER ?? "SPX";
const TICK_WAIT_MS = Number(process.env.ZOOM_TICK_WAIT_MS ?? 12000);
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
async function dismissOnboarding(page) {
  for (const sel of ['button:has-text("SKIP")', '[aria-label="Close"]']) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) { await el.click().catch(() => {}); return; }
  }
}

/**
 * Measure the candle band vertical extent / canvas height across ALL 2D canvases in the chart.
 * Candles are #00e676 (up) / #ff2d55 (down). We scan several vertical columns across the width and
 * take the union of candle-colored pixel rows → the band's [minY,maxY]. Returns { ratio, minFrac,
 * maxFrac, h } with fracs normalized to canvas CSS height.
 */
async function measureBand(page) {
  return page.evaluate(() => {
    const host = document.querySelector(".vector-chart, [class*='vector']") || document.body;
    const canvases = [...host.querySelectorAll("canvas")];
    let minY = Infinity, maxY = -Infinity, cssH = 0, sampled = 0;
    const isCandle = (r, g, b, a) => {
      if (a < 40) return false;
      // green up-candle
      if (g > 150 && r < 120 && b < 150) return true;
      // red/pink down-candle (#ff2d55)
      if (r > 180 && g < 110 && b > 60 && b < 130) return true;
      return false;
    };
    for (const cv of canvases) {
      const rect = cv.getBoundingClientRect();
      if (rect.height < 120 || rect.width < 120) continue; // skip axis/volume strips
      let ctx;
      try { ctx = cv.getContext("2d"); } catch { continue; }
      if (!ctx) continue;
      const dpr = cv.width / rect.width || 1;
      let img;
      try { img = ctx.getImageData(0, 0, cv.width, cv.height); } catch { continue; }
      cssH = Math.max(cssH, rect.height);
      const { data, width, height } = img;
      const cols = 24;
      for (let c = 1; c < cols; c++) {
        const x = Math.floor((width * c) / cols);
        for (let y = 0; y < height; y++) {
          const i = (y * width + x) * 4;
          if (isCandle(data[i], data[i + 1], data[i + 2], data[i + 3])) {
            const cy = y / dpr;
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;
            sampled++;
          }
        }
      }
    }
    if (!isFinite(minY) || cssH === 0) return { ratio: 0, minFrac: 0, maxFrac: 0, h: cssH, sampled };
    return { ratio: (maxY - minY) / cssH, minFrac: minY / cssH, maxFrac: maxY / cssH, h: cssH, sampled };
  });
}

async function main() {
  console.log(`\n=== Vector PRICE-AXIS zoom-persistence — ${STAGING} · ${TICKER} ===`);
  const { poolId, region } = cfg();
  const email = `vec-zoom-${Date.now()}@blackouttrades.com`;
  const pw = `VecZoom!${String(Date.now()).slice(-6)}`;
  mkUser(poolId, region, email, pw);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await proxyRoute(ctx);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + String(e.message).slice(0, 160)));

  const results = [];
  const rec = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };

  try {
    await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.locator('input[name="username"]:visible, input[type="email"]:visible').first().fill(email);
    await page.locator('input[name="password"]:visible, input[type="password"]:visible').first().fill(pw);
    await page.locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible, input[type="submit"]:visible').first().click();
    await page.waitForURL((u) => u.href.startsWith(STAGING), { timeout: 90_000 });
    console.log(`signed in as ${email}`);

    await page.goto(`${STAGING}/vector?ticker=${encodeURIComponent(TICKER)}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3500);
    await dismissOnboarding(page);
    await page.waitForTimeout(6000); // let SSE ticks + first trail/overlay refresh settle

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) { rec("chart canvas present", false); throw new Error("no chart canvas"); }
    rec("chart canvas present", true, `${Math.round(box.width)}x${Math.round(box.height)}`);

    const R0 = await measureBand(page);
    await page.screenshot({ path: join(OUT, "0-baseline.png") });
    rec("baseline candle band measured", R0.sampled > 0, `ratio=${R0.ratio.toFixed(3)} band=[${R0.minFrac.toFixed(2)},${R0.maxFrac.toFixed(2)}] px=${R0.sampled}`);

    // Manual vertical zoom: drag on the RIGHT price-axis gutter. rightPriceScale sits in the right
    // ~64px strip. Drag UP from mid-height to compress→expand the price scale (autoScale=false).
    const gutterX = box.x + box.width - 30;
    const midY = box.y + box.height / 2;
    await page.mouse.move(gutterX, midY);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(gutterX, midY - i * 22); await page.waitForTimeout(20); }
    await page.mouse.up();
    await page.waitForTimeout(1200);

    const R1 = await measureBand(page);
    await page.screenshot({ path: join(OUT, "1-after-zoom.png") });
    rec("manual price-axis drag rescaled the axis", Math.abs(R1.ratio - R0.ratio) > 0.03 || Math.abs(R1.minFrac - R0.minFrac) > 0.03,
      `R0=${R0.ratio.toFixed(3)} R1=${R1.ratio.toFixed(3)} Δband=${(R1.ratio - R0.ratio).toFixed(3)}`);

    // Wait through several live SSE ticks + at least one trail/overlay refresh. If the bug were live,
    // the price axis would snap back toward the auto-scaled R0 within ~1s.
    console.log(`  … holding ${TICK_WAIT_MS}ms through live ticks`);
    await page.waitForTimeout(TICK_WAIT_MS);
    const R2 = await measureBand(page);
    await page.screenshot({ path: join(OUT, "2-after-ticks.png") });

    const drift = Math.abs(R2.ratio - R1.ratio);
    const revertedToBaseline = Math.abs(R2.ratio - R0.ratio) < Math.abs(R2.ratio - R1.ratio);
    rec("price-axis zoom HELD across live ticks (no snap-back)", drift < 0.05 && !revertedToBaseline,
      `R1=${R1.ratio.toFixed(3)} → R2=${R2.ratio.toFixed(3)} (drift=${drift.toFixed(3)}); baseline R0=${R0.ratio.toFixed(3)}`);
    rec("did NOT revert toward autoscale baseline", !revertedToBaseline,
      `|R2-R1|=${Math.abs(R2.ratio - R1.ratio).toFixed(3)} vs |R2-R0|=${Math.abs(R2.ratio - R0.ratio).toFixed(3)}`);

    rec("no console errors during zoom test", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
    try { sh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}"${region ? ` --region "${region}"` : ""}`); } catch {}
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${failed.length ? "FAILED" : "PASSED"} — ${results.length - failed.length}/${results.length} · screenshots in ${OUT} ===`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
