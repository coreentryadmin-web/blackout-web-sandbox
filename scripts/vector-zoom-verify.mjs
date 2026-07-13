#!/usr/bin/env node
/**
 * Vector zoom-persistence verification (staging, live) — tests the MEMBER'S REAL GESTURE.
 *
 * Member report: "I try to zoom and after a split second it zooms out." On desktop that gesture is
 * the MOUSE WHEEL over the chart pane (time-axis zoom; price auto-fits the fewer visible bars).
 * A prior harness version dragged the price-axis gutter instead and never engaged (R0≈R1 —
 * self-detected and aborted rather than false-passing), so this rewrite drives the wheel.
 *
 * Measurement (deployed build exposes no chart handle, so we measure pixels):
 *  - BAR-RUN COUNT: for each x column of the main pane, does any pixel hold candle color → count
 *    contiguous runs. Fully zoomed-out 1m bars merge into few wide runs; zooming IN separates them
 *    into many distinct runs. If the chart "zooms back out after a split second", the run count
 *    snaps back toward the baseline within the hold window.
 *  - CANDLE BAND ratio (vertical extent / canvas height): rises on zoom-in (price auto-fit).
 *
 * Sequence: baseline → wheel-zoom in (6×240px steps at pane center) → measure (must change
 * materially, else ABORT as harness failure) → hold through live SSE ticks (12s default) →
 * measure again → assert the zoom HELD. Screenshots at every stage.
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

/** Candle-pixel scan of the widest chart canvas: bar-run count + vertical band extent. */
async function measureChart(page) {
  return page.evaluate(() => {
    const host = document.querySelector(".vector-chart, [class*='vector']") || document.body;
    const cvs = [...host.querySelectorAll("canvas")].map((c) => ({ c, r: c.getBoundingClientRect() }))
      .filter((o) => o.r.height > 260 && o.r.width > 300).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    if (!cvs.length) return { error: "no-canvas" };
    const { c } = cvs[0];
    let ctx; try { ctx = c.getContext("2d"); } catch { return { error: "no-ctx" }; }
    if (!ctx) return { error: "no-ctx" };
    let img; try { img = ctx.getImageData(0, 0, c.width, c.height); } catch { return { error: "tainted" }; }
    const { data, width, height } = img;
    const isCandle = (r, g, b, a) => {
      if (a < 40) return false;
      if (g > 150 && r < 120 && b < 150) return true; // green up
      if (r > 180 && g < 110 && b > 60 && b < 130) return true; // #ff2d55 down
      return false;
    };
    // Column occupancy → contiguous run count (≈ visible bar separation) + band extent.
    const colHas = new Array(width).fill(false);
    let minY = Infinity, maxY = -Infinity, sampled = 0;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y += 2) {
        const i = (y * width + x) * 4;
        if (isCandle(data[i], data[i + 1], data[i + 2], data[i + 3])) {
          colHas[x] = true;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          sampled++;
          break;
        }
      }
    }
    let runs = 0;
    for (let x = 0; x < width; x++) if (colHas[x] && (x === 0 || !colHas[x - 1])) runs++;
    const band = isFinite(minY) ? (maxY - minY) / height : 0;
    return { runs, band: +band.toFixed(3), sampled, width };
  });
}

async function main() {
  console.log(`\n=== Vector WHEEL zoom-persistence — ${STAGING} · ${TICKER} ===`);
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

    const box = await page.locator("canvas").first().boundingBox();
    if (!box) { rec("chart canvas present", false); throw new Error("no chart canvas"); }
    rec("chart canvas present", true, `${Math.round(box.width)}x${Math.round(box.height)}`);

    const R0 = await measureChart(page);
    await page.screenshot({ path: join(OUT, "0-baseline.png") });
    rec("baseline measured", !R0.error && R0.sampled > 0, JSON.stringify(R0));

    // THE MEMBER GESTURE: mouse-wheel zoom IN over the pane center (~40% width to keep the live
    // edge in view). lightweight-charts narrows the visible time range; price auto-fits.
    const cx = box.x + box.width * 0.55;
    const cy = box.y + box.height * 0.5;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(120); }
    await page.waitForTimeout(1000);

    const R1 = await measureChart(page);
    await page.screenshot({ path: join(OUT, "1-after-zoom.png") });
    const engaged = !R1.error && (R1.runs > R0.runs * 1.5 || R1.band - R0.band > 0.08);
    rec("wheel zoom-in engaged (bars separated / band expanded)", engaged, `runs ${R0.runs}→${R1.runs}, band ${R0.band}→${R1.band}`);
    if (!engaged) { rec("VERIFY ABORTED — gesture did not engage (harness, not the fix)", false); throw new Error("gesture not engaged"); }

    // Hold through live SSE ticks + trail refreshes. The reported bug reverts within ~1s; we hold
    // 12s (≥1 full trail refresh + many ticks). Then measure drift vs the zoomed state.
    console.log(`  … holding ${TICK_WAIT_MS}ms through live ticks`);
    await page.waitForTimeout(TICK_WAIT_MS);
    const R2 = await measureChart(page);
    await page.screenshot({ path: join(OUT, "2-after-ticks.png") });

    // Small drift allowed: live follow can shift bars into view at the right edge (run count ±20%).
    const heldRuns = R2.runs > R0.runs * 1.4 && Math.abs(R2.runs - R1.runs) <= Math.max(3, R1.runs * 0.25);
    const revertedToBaseline = Math.abs(R2.runs - R0.runs) < Math.abs(R2.runs - R1.runs);
    rec("zoom HELD across live ticks (no snap-back)", heldRuns && !revertedToBaseline,
      `runs ${R1.runs}→${R2.runs} (baseline ${R0.runs}), band ${R1.band}→${R2.band} (baseline ${R0.band})`);

    // Secondary: manual PRICE-AXIS drag (vertical zoom) — informational; primary member gesture is
    // the wheel. Uses the rightmost tall/narrow canvas (the price-scale strip).
    const axis = await page.evaluate(() => {
      const host = document.querySelector(".vector-chart, [class*='vector']") || document.body;
      const cands = [...host.querySelectorAll("canvas")].map((cv) => cv.getBoundingClientRect())
        .filter((r) => r.height > 260 && r.width > 8 && r.width < 120)
        .sort((a, b) => b.x - a.x);
      const r = cands[0];
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
    if (axis) {
      await page.mouse.move(axis.x, axis.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(axis.x, axis.y - i * 24); await page.waitForTimeout(25); }
      await page.mouse.up();
      await page.waitForTimeout(800);
      const R3 = await measureChart(page);
      const priceEngaged = Math.abs(R3.band - R2.band) > 0.05;
      if (priceEngaged) {
        await page.waitForTimeout(TICK_WAIT_MS);
        const R4 = await measureChart(page);
        await page.screenshot({ path: join(OUT, "3-price-axis-hold.png") });
        rec("price-axis manual scale HELD across live ticks", Math.abs(R4.band - R3.band) < 0.05,
          `band ${R3.band}→${R4.band} after drag (pre-drag ${R2.band})`);
      } else {
        console.log(`  (price-axis drag did not engage in headless — informational only; wheel is the member gesture)`);
      }
    }

    const realErrors = consoleErrors.filter((e) => !/ERR_FAILED/.test(e)); // SSE-through-proxy artifact
    rec("no console errors (SSE proxy artifact excluded)", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
    try { sh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}"${region ? ` --region "${region}"` : ""}`); } catch {}
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${failed.length ? "FAILED" : "PASSED"} — ${results.length - failed.length}/${results.length} · screenshots in ${OUT} ===`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
