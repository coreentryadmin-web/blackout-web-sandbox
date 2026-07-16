#!/usr/bin/env node
/**
 * DTE GRIND — deep cross-DTE coherence scan (CTO-level), per member directive:
 * "select one dte .. then go other selection .. and keep grinding. The data would be incorrect,
 *  not rendering well, faked out, false positives .. also check terminal while switching .. and
 *  each and every indicator one by one."
 *
 * Per ticker it grinds 0DTE→WEEKLY→MONTHLY→ALL forward, then reversed (2 rounds), asserting at
 * EVERY stop against the horizon-scoped APIs fetched at that moment (in-page, authed):
 *  - banner resistance/support == the horizon walls API's top call/put strikes; regime wording
 *    (long/short/AT FLIP) matches spot-vs-horizon-flip; NO NaN/Infinity/malformed floats anywhere
 *  - chart flip label == horizon flip; max-pain label == horizon max-pain API (when non-null)
 *  - TERMINAL re-scopes on every switch: cites the horizon kings, and when the previous horizon's
 *    kings differ, the terminal must NOT still cite ONLY the stale ones (carryover check)
 *  - beads/canvas re-render across horizons (pixel hash differs when the wall sets differ)
 *  - RAPID-SWITCH RACE: click 0DTE then MONTHLY 150ms later — final state must be MONTHLY's data,
 *    not the late 0DTE response overwriting it
 * Then INDICATORS one-by-one (each enabled alone, by its actual draw color): pixels appear on
 * enable, vanish on disable. Colors from vector-indicators-config/key-levels (pivot-P #f97316
 * after the EMA-collision fix).
 *
 * Known-artifact exclusion: net::ERR_FAILED console lines (SSE-through-test-proxy) are not product.
 * Usage: env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY AWS_REGION=us-east-1 \
 *        T="SPX,SPY,NVDA" node scripts/vector-dte-grind.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const STAGING = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SHOT_DIR || "/tmp/claude-0/-home-user/464bea58-d425-5552-a7bd-de5f2e9c99f9/scratchpad/dte-grind";
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const REGION = process.env.AWS_REGION ?? "";
const TICKERS = (process.env.T ?? "SPX,SPY,NVDA").split(",").map((s) => s.trim());
// "ALL" removed from the member UI (2026-07-13, user-corrected); the grind cycles the three
// narrowed horizons. dte=all API checks live in the hardcore suite's H3 block instead.
const DTES = [
  { btn: "0DTE", q: "0dte" },
  { btn: "WEEKLY", q: "weekly" },
  { btn: "MONTHLY", q: "monthly" },
];
mkdirSync(OUT, { recursive: true });
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

const results = [];
const rec = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };

function cfg() {
  const s = JSON.parse(sh(`aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}"` + (REGION ? ` --region "${REGION}"` : "") + ` --query SecretString --output text`));
  const poolId = s.COGNITO_USER_POOL_ID;
  return { poolId, region: poolId.includes("_") ? poolId.split("_")[0] : REGION };
}
function mkUser(poolId, region, email, pw) {
  const rf = region ? ` --region "${region}"` : "";
  try { sh(`aws cognito-idp admin-create-user --user-pool-id "${poolId}" --username "${email}" --message-action SUPPRESS --user-attributes Name=email,Value="${email}" Name=email_verified,Value=true Name=custom:role,Value=admin Name=custom:tier,Value=premium${rf}`); }
  catch (e) { if (!/UsernameExists/i.test(String(e.stderr ?? e.message))) throw e; }
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
const api = (page, path) => page.evaluate(async (p) => { try { const r = await fetch(p); return r.ok ? await r.json() : null; } catch { return null; } }, path);
const near = (a, b, relTol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.abs(b) * relTol + 1e-9;
const MALFORMED = /\d+\.\d{7,}|NaN|Infinity|undefined|null(?![a-z])/;

async function domSnap(page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const body = document.body.innerText || "";
    const flipM = body.match(/Gamma flip\s+([\d,]+(?:\.\d+)?)/i);
    const mpM = body.match(/Max Pain\s+([\d,]+(?:\.\d+)?)/i);
    return {
      banner: (q(".vector-regime-read")?.textContent || "").replace(/\s+/g, " ").trim(),
      terminal: (q(".vector-pulse")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 6000),
      ladder: [...document.querySelectorAll(".vector-gex-ladder-row")].map((r) => (r.textContent || "").replace(/\s+/g, " ").trim()).join(" | "),
      flipLabel: flipM ? Number(flipM[1].replace(/,/g, "")) : null,
      maxPainLabel: mpM ? Number(mpM[1].replace(/,/g, "")) : null,
    };
  });
}
async function canvasHash(page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) return null;
  const buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let h = 0;
  for (let i = 0; i < data.length; i += 397) h = ((h << 5) - h + data[i]) | 0;
  return h;
}
async function clickDte(page, btn) {
  const b = page.locator(`button:has-text("${btn}")`).first();
  if (!(await b.count().catch(() => 0))) return false;
  await b.click().catch(() => {});
  return true;
}
const fmtCite = (n) => {
  if (!Number.isFinite(n)) return [];
  const plain = String(n);
  const noDec = String(Math.round(n));
  const grouped = Math.round(n).toLocaleString("en-US");
  return [...new Set([plain, noDec, grouped])];
};
const cites = (text, n) => fmtCite(n).some((v) => text.includes(v));

async function grindTicker(page, ticker, consoleErrors) {
  console.log(`\n===== ${ticker} =====`);
  await page.goto(`${STAGING}/vector?ticker=${encodeURIComponent(ticker)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  for (const sel of ['button:has-text("SKIP")', '[aria-label="Close"]']) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) { await el.click().catch(() => {}); break; }
  }
  await page.waitForTimeout(5000);

  // DTE toggle removed from the member UI (2026-07-13, user-directed): the grind's DTE loop and
  // race only run when the toggle exists; otherwise assert its absence (the new contract) and
  // keep the DTE-independent sections (malformed-data scan, indicators one-by-one).
  const dteUiPresent = (await page.locator('button:has-text("0DTE")').count().catch(() => 0)) > 0;
  if (!dteUiPresent) rec(`${ticker}: DTE toggle removed from UI (new contract)`, true);
  let prev = null; // { q, callKing, putKing, flip, hash }
  const order = dteUiPresent ? [...DTES, ...[...DTES].reverse().slice(1)] : [];
  for (const dte of order) {
    if (!(await clickDte(page, dte.btn))) { rec(`${ticker} ${dte.btn}: button present`, false); continue; }
    await page.waitForTimeout(2200);

    // Ground truth AT THIS MOMENT (horizon-scoped).
    const [wallsRes, mpRes, emRes] = await Promise.all([
      api(page, `/api/market/vector/walls?ticker=${ticker}&dte=${dte.q}`),
      api(page, `/api/market/vector/max-pain?ticker=${ticker}&dte=${dte.q}`),
      api(page, `/api/market/vector/expected-move?ticker=${ticker}&dte=${dte.q}`),
    ]);
    const snap = await domSnap(page);
    const hash = await canvasHash(page);

    const callKing = wallsRes?.walls?.callWalls?.[0]?.strike ?? null;
    const putKing = wallsRes?.walls?.putWalls?.[0]?.strike ?? null;
    const flip = wallsRes?.flip ?? null;
    const maxPain = mpRes?.maxPain ?? null;
    const tag = `${ticker} ${dte.btn}`;

    // 1) No malformed data anywhere the member reads.
    const dirty = [snap.banner, snap.terminal, snap.ladder].map((t) => t.match(MALFORMED)?.[0]).filter(Boolean);
    rec(`${tag}: no NaN/Infinity/malformed floats in banner+terminal+ladder`, dirty.length === 0, dirty.slice(0, 3).join(","));

    // 2) Banner levels == horizon kings (when API has them). Live drift tolerance 0.3%.
    if (callKing != null) {
      const bRes = snap.banner.match(/resistance\s+([\d,]+(?:\.\d+)?)/i);
      rec(`${tag}: banner resistance == horizon top call wall`, bRes ? near(Number(bRes[1].replace(/,/g, "")), callKing, 0.003) : false,
        `banner=${bRes?.[1] ?? "absent"} api=${callKing}`);
    }
    if (putKing != null) {
      const bSup = snap.banner.match(/support\s+([\d,]+(?:\.\d+)?)/i);
      rec(`${tag}: banner support == horizon top put wall`, bSup ? near(Number(bSup[1].replace(/,/g, "")), putKing, 0.003) : false,
        `banner=${bSup?.[1] ?? "absent"} api=${putKing}`);
    }

    // 3) Regime wording matches spot vs HORIZON flip.
    const spotM = snap.banner.match(/Spot\s+([\d,]+(?:\.\d+)?)/i);
    const spot = spotM ? Number(spotM[1].replace(/,/g, "")) : null;
    if (spot != null && Number.isFinite(flip)) {
      const dist = Math.abs(spot - flip) / spot;
      // exact product TRANSITION_BAND (0.1%) — a wider harness band flagged NVDA's correct
      // "above" wording as wrong when spot sat between 0.10% and 0.15% from the flip.
      const wantAt = dist <= 0.001;
      const wantLong = spot > flip;
      const saysAt = /sitting on the gamma flip|AT GAMMA FLIP/i.test(snap.banner);
      const saysLong = /above the gamma flip|long gamma/i.test(snap.banner);
      const saysShort = /below the gamma flip|short gamma/i.test(snap.banner);
      const ok = wantAt ? saysAt : wantLong ? saysLong || (dist < 0.003 && saysAt) : saysShort || (dist < 0.003 && saysAt);
      rec(`${tag}: regime wording matches spot-vs-flip`, ok, `spot=${spot} flip=${flip} banner="${snap.banner.slice(0, 60)}"`);
    }

    // 4) Chart flip label == horizon flip (0.3% drift tolerance).
    if (Number.isFinite(flip) && snap.flipLabel != null) {
      rec(`${tag}: chart flip label == horizon flip`, near(snap.flipLabel, flip, 0.003), `label=${snap.flipLabel} api=${flip}`);
    }

    // 5) Max-pain label == horizon max-pain (exact strike; only when API non-null and label present).
    if (Number.isFinite(maxPain) && snap.maxPainLabel != null) {
      rec(`${tag}: max-pain label == horizon max-pain API`, near(snap.maxPainLabel, maxPain, 0.001), `label=${snap.maxPainLabel} api=${maxPain}`);
    }

    // 6) Expected move sanity: API bands are finite and ordered; terminal mentions expected move.
    const bands = emRes?.expectedMove?.bands;
    if (Array.isArray(bands) && bands.length) {
      const finite = bands.every((b) => Number.isFinite(b.low) && Number.isFinite(b.high) && b.low < b.high);
      rec(`${tag}: expected-move bands finite + low<high`, finite, JSON.stringify(bands[0]));
      rec(`${tag}: terminal narrates expected move`, /expected move/i.test(snap.terminal));
    }

    // 7) Terminal re-scopes: cites at least one horizon king. And when the PREVIOUS horizon's kings
    //    differ from this horizon's, the terminal must not cite ONLY stale kings (carryover).
    if (callKing != null || putKing != null) {
      const citesNow = (callKing != null && cites(snap.terminal, callKing)) || (putKing != null && cites(snap.terminal, putKing));
      rec(`${tag}: terminal cites horizon kings`, citesNow, `kings ${callKing}/${putKing}`);
      if (prev && citesNow === false && (prev.callKing !== callKing || prev.putKing !== putKing)) {
        const citesStale = (prev.callKing != null && cites(snap.terminal, prev.callKing)) || (prev.putKing != null && cites(snap.terminal, prev.putKing));
        rec(`${tag}: terminal NOT stuck on previous horizon (${prev.q})`, !citesStale, `stale kings ${prev.callKing}/${prev.putKing} still cited`);
      }
    }

    // 8) Canvas re-renders across horizons when the wall set changed.
    if (prev && prev.hash != null && hash != null && (prev.callKing !== callKing || prev.putKing !== putKing || prev.flip !== flip)) {
      rec(`${tag}: chart re-rendered vs ${prev.q} (walls differ)`, hash !== prev.hash, `hash ${prev.hash}→${hash}`);
    }

    prev = { q: dte.q, callKing, putKing, flip, hash };
  }

  // 9) RAPID-SWITCH RACE: 0DTE then MONTHLY 150ms later → final state must be MONTHLY's.
  if (dteUiPresent) {
  await clickDte(page, "0DTE");
  await page.waitForTimeout(150);
  await clickDte(page, "MONTHLY");
  await page.waitForTimeout(3000);
  const mTruth = await api(page, `/api/market/vector/walls?ticker=${ticker}&dte=monthly`);
  const zTruth = await api(page, `/api/market/vector/walls?ticker=${ticker}&dte=0dte`);
  const raceSnap = await domSnap(page);
  const mFlip = mTruth?.flip, zFlip = zTruth?.flip;
  if (Number.isFinite(mFlip) && raceSnap.flipLabel != null) {
    const matchesMonthly = near(raceSnap.flipLabel, mFlip, 0.003);
    const matchesStale0dte = Number.isFinite(zFlip) && zFlip !== mFlip && near(raceSnap.flipLabel, zFlip, 0.0005);
    rec(`${ticker} RACE 0DTE→150ms→MONTHLY: final flip is MONTHLY's (no late-response overwrite)`,
      matchesMonthly && !matchesStale0dte, `label=${raceSnap.flipLabel} monthly=${mFlip} 0dte=${zFlip}`);
  }

  }

  // 10) INDICATORS one-by-one (each alone): pixels appear with the indicator's DRAW color on
  //     enable, vanish on disable. (Pivot-P is #f97316 after the EMA-collision fix; menu toggles
  //     are per TYPE, so "EMA" enables 9/21/50 — we count its distinct 9-line color.)
  const INDICATORS = [
    { label: "VWAP", rgb: { r: 0x60, g: 0xa5, b: 0xfa } },
    { label: "EMA", rgb: { r: 0xfb, g: 0x92, b: 0x3c } },
    { label: "SMA", rgb: { r: 0x2d, g: 0xd4, b: 0xbf } },
    { label: "HOD / LOD", rgb: { r: 0x34, g: 0xd3, b: 0x99 } },
    { label: "PDH / PDL / PDC", rgb: { r: 0x38, g: 0xbd, b: 0xf8 } },
    { label: "Floor pivots", rgb: { r: 0xf9, g: 0x73, b: 0x16 } },
  ];
  const countColor = async (buf, t, tol) => {
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (Math.abs(data[i] - t.r) <= tol && Math.abs(data[i + 1] - t.g) <= tol && Math.abs(data[i + 2] - t.b) <= tol) n++;
    }
    return n;
  };
  const shot = async () => {
    const box = await page.locator("canvas").first().boundingBox();
    if (!box) return null;
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    return page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  };
  const toggle = async (label) => {
    await page.locator(".vector-ind-trigger").click().catch(() => {});
    await page.waitForTimeout(350);
    await page.locator(`.vector-ind-item:has-text("${label}")`).first().click().catch(() => {});
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1300);
  };
  for (const ind of INDICATORS) {
    await toggle(ind.label); // ON (alone — previous one was toggled back off)
    const on = await shot();
    const onN = on ? await countColor(on, ind.rgb, 14) : 0;
    await toggle(ind.label); // OFF
    const off = await shot();
    const offN = off ? await countColor(off, ind.rgb, 14) : 0;
    rec(`${ticker}: indicator "${ind.label}" paints alone + clears on disable`, onN > 80 && offN < Math.max(30, onN * 0.25), `on=${onN}px off=${offN}px`);
  }
}

async function main() {
  console.log(`\n=== Vector DTE GRIND — ${STAGING} · ${TICKERS.join(",")} ===`);
  const { poolId, region } = cfg();
  const email = `vec-grind-${Date.now()}@blackouttrades.com`;
  const pw = `VecGrind!${String(Date.now()).slice(-6)}`;
  mkUser(poolId, region, email, pw);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await proxyRoute(ctx);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED/.test(m.text())) consoleErrors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + String(e.message).slice(0, 160)));
  try {
    await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.locator('input[name="username"]:visible, input[type="email"]:visible').first().fill(email);
    await page.locator('input[name="password"]:visible, input[type="password"]:visible').first().fill(pw);
    await page.locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible, input[type="submit"]:visible').first().click();
    await page.waitForURL((u) => u.href.startsWith(STAGING), { timeout: 90000 });
    console.log(`signed in as ${email}`);
    for (const t of TICKERS) {
      try { await grindTicker(page, t, consoleErrors); }
      catch (e) { rec(`${t}: grind threw`, false, String(e.message).slice(0, 120)); }
    }
    rec(`console clean across grind (SSE artifact excluded)`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
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
