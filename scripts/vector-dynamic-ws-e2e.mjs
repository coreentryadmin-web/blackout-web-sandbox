#!/usr/bin/env node
/**
 * Vector Dynamic WS GEX Subscription — Live E2E Validation
 *
 * Tests the NEW dynamic UW WebSocket gex_strike_expiry subscription across MANY stocks:
 * - Subscription latency: how fast does GEX data appear after opening a new ticker?
 * - GEX data flow: are walls/ladder/flip/regime/max-pain correct for every stock?
 * - Bead formation: do wall-history samples form and grow?
 * - Matrix correctness: full ladder validation × DTEs × TFs
 * - Cross-ticker: SPX ≈ 10× SPY sanity check
 *
 * Ticker set deliberately includes oracle (SPX/SPY/QQQ), popular (NVDA/TSLA/AAPL),
 * and random/unusual (VRT/PLTR/COIN/ARM/MSTR/SOFI) to exercise dynamic subscription.
 *
 * Usage: env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/vector-dynamic-ws-e2e.mjs
 * Env: T=SPX,SPY,NVDA,VRT,...  STAGING_BASE_URL  SHOT_DIR  POLL_SEC=30 (live GEX poll window)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const STAGING = (process.env.STAGING_BASE_URL || "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SHOT_DIR || mkdtempSync(join(tmpdir(), "vector-dws-"));
const SECRET_NAME = process.env.STAGING_SECRET_NAME || "blackout-staging/app/env";
const REGION = process.env.AWS_REGION || "us-east-1";
const TICKERS = (process.env.T || "SPX,SPY,QQQ,NVDA,TSLA,AAPL,VRT,PLTR,COIN,ARM,MSTR,SOFI").split(",").map(s => s.trim());
const DTES = ["0DTE", "WEEKLY", "MONTHLY"];
const DTE_PARAM = { "0DTE": "0dte", WEEKLY: "weekly", MONTHLY: "monthly" };
const TFS = ["1 min", "5 min", "15 min", "1H"];
const POLL_SEC = Number(process.env.POLL_SEC || 30);
mkdirSync(OUT, { recursive: true });
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

const results = [];
const tickerTimings = {};
const rec = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};

function cfg() {
  const s = JSON.parse(sh("aws", ["secretsmanager", "get-secret-value", "--secret-id", SECRET_NAME, "--region", REGION, "--query", "SecretString", "--output", "text"]));
  const poolId = s.COGNITO_USER_POOL_ID;
  return { poolId, region: poolId?.includes("_") ? poolId.split("_")[0] : REGION };
}
function mkUser(poolId, region, email, pw) {
  try { sh("aws", ["cognito-idp", "admin-create-user", "--user-pool-id", poolId, "--username", email, "--message-action", "SUPPRESS", "--user-attributes", `Name=email,Value=${email}`, "Name=email_verified,Value=true", "Name=custom:role,Value=admin", "Name=custom:tier,Value=premium", "--region", region]); }
  catch (e) { if (!/UsernameExists|already exists/i.test(String(e.stderr ?? e.message))) throw e; }
  sh("aws", ["cognito-idp", "admin-set-user-password", "--user-pool-id", poolId, "--username", email, "--password", pw, "--permanent", "--region", region]);
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

const api = (page, path) => page.evaluate(async p => {
  try { const r = await fetch(p); return r.ok ? await r.json() : { __status: r.status }; }
  catch (e) { return { __throw: String(e) }; }
}, path);

async function chartHash(page) {
  try { const buf = await page.locator("canvas").first().screenshot(); return createHash("md5").update(buf).digest("hex"); }
  catch { return null; }
}

async function domSnap(page) {
  return page.evaluate(() => {
    const q = s => document.querySelector(s);
    return {
      regime: (q(".vector-regime-read")?.textContent || "").replace(/\s+/g, " ").trim(),
      terminal: (q(".vector-pulse")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 6000),
      ladderRows: document.querySelectorAll(".vector-gex-ladder-row").length,
    };
  });
}
async function dismiss(page) {
  for (const sel of ['button:has-text("SKIP")', '[aria-label="Close"]']) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) { await el.click().catch(() => {}); return; }
  }
}
async function clickDte(page, dte) {
  const b = page.locator(`button:has-text("${dte}")`).first();
  if (await b.count().catch(() => 0)) { await b.click().catch(() => {}); await page.waitForTimeout(1600); return true; }
  return false;
}

// ====== CORE: per-ticker validation with timing ======
async function validateTicker(page, ticker, errs) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  TICKER: ${ticker}`);
  console.log(`${"=".repeat(60)}`);
  errs.length = 0;

  const timing = { ticker, navStart: Date.now() };

  // 1. Navigate to Vector for this ticker — START THE CLOCK
  await page.goto(`${STAGING}/vector?ticker=${ticker}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  timing.domLoaded = Date.now();
  await page.waitForTimeout(2000);
  await dismiss(page);

  // 2. Poll for GEX ladder to appear — measures "time to first GEX data"
  let ladderReady = false;
  let ladderData = null;
  const pollStart = Date.now();
  for (let attempt = 0; attempt < 15; attempt++) {
    ladderData = await api(page, `/api/market/vector/gex-ladder?ticker=${ticker}`);
    if (ladderData?.ladder?.rows?.length > 0) {
      ladderReady = true;
      break;
    }
    await page.waitForTimeout(1000);
  }
  timing.gexDataMs = Date.now() - pollStart;
  timing.gexRows = ladderData?.ladder?.rows?.length || 0;
  timing.gexReady = ladderReady;

  rec(`${ticker}: GEX ladder loaded`, ladderReady, `${timing.gexRows} rows in ${timing.gexDataMs}ms`);

  if (!ladderReady) {
    timing.totalMs = Date.now() - timing.navStart;
    tickerTimings[ticker] = timing;
    rec(`${ticker}: SKIPPING remaining checks (no GEX data)`, false);
    await page.screenshot({ path: join(OUT, `dyn-${ticker}-nodata.png`) });
    return timing;
  }

  // 3. Wait for full render
  await page.waitForTimeout(3000);

  // 4. GEX LADDER VALUE CORRECTNESS
  const rows = ladderData.ladder.rows;
  const spot = Number(ladderData.spot);
  const strikes = rows.map(r => r.strike);
  const desc = strikes.every((s, i) => i === 0 || strikes[i - 1] > s);
  const finiteAll = rows.every(r => Number.isFinite(r.strike) && Number.isFinite(r.gex) && Number.isFinite(r.magnitude));
  const magOk = rows.every(r => r.magnitude >= 0 && r.magnitude <= 1.0001);
  const kings = { call: rows.filter(r => r.isKing && r.side === "call").length, put: rows.filter(r => r.isKing && r.side === "put").length };
  const inBand = strikes.length ? spot >= Math.min(...strikes) && spot <= Math.max(...strikes) : false;
  const noJunkFloats = rows.every(r => !/\.\d{5,}/.test(String(r.gex)) && !/\.\d{5,}/.test(String(r.strike)));

  rec(`${ticker}: ladder finite + descending + magnitude∈[0,1]`, rows.length > 0 && desc && finiteAll && magOk, `${rows.length} rows, spot ${spot}`);
  rec(`${ticker}: spot within strike band`, inBand, `spot ${spot} band [${Math.min(...strikes)},${Math.max(...strikes)}]`);
  rec(`${ticker}: exactly one king per side`, kings.call === 1 && kings.put === 1, `call=${kings.call} put=${kings.put}`);
  rec(`${ticker}: no malformed unrounded floats`, noJunkFloats);

  // 5. DOM RENDER CHECK
  const snap = await domSnap(page);
  rec(`${ticker}: base render (ladder+regime+terminal)`, snap.ladderRows > 0 && snap.regime.length > 0 && snap.terminal.length > 0, `${snap.ladderRows} rows, regime="${snap.regime.slice(0, 60)}"`);
  timing.domRenderMs = Date.now() - timing.navStart;

  // 6. REGIME CONSISTENCY: spot vs flip wording
  const flipMatch = snap.regime.match(/gamma flip \(([\d,\.]+)\)/);
  const flipVal = flipMatch ? Number(flipMatch[1].replace(/,/g, "")) : null;
  const saysLong = /long gamma/i.test(snap.regime);
  const saysShort = /short gamma/i.test(snap.regime);
  const saysOn = /sitting on|on the gamma flip/i.test(snap.regime);
  const spotMatch = snap.regime.match(/Spot ([\d,\.]+)/);
  const regimeSpot = spotMatch ? Number(spotMatch[1].replace(/,/g, "")) : NaN;
  let regimeConsistent = true;
  if (Number.isFinite(regimeSpot) && flipVal != null && !saysOn) {
    regimeConsistent = regimeSpot > flipVal ? saysLong : saysShort;
  }
  rec(`${ticker}: regime wording matches spot vs flip`, regimeConsistent, `spot ${regimeSpot} flip ${flipVal}`);

  // 7. WALLS CHECK — both call and put walls present
  const walls = await api(page, `/api/market/vector/walls?ticker=${ticker}&dte=0dte`);
  const hasCallWalls = (walls?.walls?.callWalls?.length || 0) > 0;
  const hasPutWalls = (walls?.walls?.putWalls?.length || 0) > 0;
  rec(`${ticker}: walls present (call+put)`, hasCallWalls && hasPutWalls, `call=${walls?.walls?.callWalls?.length || 0} put=${walls?.walls?.putWalls?.length || 0}`);

  // 8. MAX PAIN
  const mpData = await api(page, `/api/market/vector/max-pain?ticker=${ticker}&dte=0dte`);
  const mp = Number(mpData?.maxPain);
  const mpInBand = Number.isFinite(mp) && mp >= Math.min(...strikes) * 0.9 && mp <= Math.max(...strikes) * 1.1;
  rec(`${ticker}: max-pain finite and within band`, mpInBand, `maxPain=${mp}`);

  // 9. PER-DTE SWEEP — validate each horizon
  const dteUiPresent = (await page.locator('button:has-text("0DTE")').count().catch(() => 0)) > 0;
  const mpByDte = {}, flipByDte = {}, regimeByDte = {};
  for (const dte of dteUiPresent ? DTES : []) {
    await clickDte(page, dte);
    const dSnap = await domSnap(page);
    regimeByDte[dte] = dSnap.regime;
    const dMp = await api(page, `/api/market/vector/max-pain?ticker=${ticker}&dte=${DTE_PARAM[dte]}`);
    mpByDte[dte] = dMp?.maxPain ?? null;
    const dFlipMatch = dSnap.regime.match(/gamma flip \(([\d,\.]+)\)/);
    flipByDte[dte] = dFlipMatch ? Number(dFlipMatch[1].replace(/,/g, "")) : null;
    const dWalls = await api(page, `/api/market/vector/walls?ticker=${ticker}&dte=${DTE_PARAM[dte]}`);
    rec(`${ticker} ${dte}: walls present`, (dWalls?.walls?.callWalls?.length || 0) > 0, `call=${dWalls?.walls?.callWalls?.length || 0} put=${dWalls?.walls?.putWalls?.length || 0}`);
    rec(`${ticker} ${dte}: max-pain finite`, Number.isFinite(Number(mpByDte[dte])), `mp=${mpByDte[dte]}`);
    console.log(`    [${dte}] mp=${mpByDte[dte]} flip=${flipByDte[dte]} regime="${dSnap.regime.slice(0, 50)}"`);
  }
  if (dteUiPresent) {
    const variants = o => new Set(Object.values(o).map(String)).size;
    rec(`${ticker}: DTE re-scopes (mp/flip/regime change across horizons)`,
      variants(mpByDte) > 1 || variants(flipByDte) > 1 || variants(regimeByDte) > 1,
      `mp=${variants(mpByDte)} flip=${variants(flipByDte)} regime=${variants(regimeByDte)}`);
  }

  // 10. TIMEFRAME SWEEP — chart redraws on each TF
  const hashByTf = {};
  for (const tf of TFS) {
    await page.locator("#vector-tf-select").selectOption({ label: tf }).catch(() => {});
    await page.waitForTimeout(1200);
    hashByTf[tf] = await chartHash(page);
  }
  rec(`${ticker}: timeframe redraws chart (canvas differs across TFs)`,
    new Set(Object.values(hashByTf).filter(Boolean)).size > 1,
    `${new Set(Object.values(hashByTf).filter(Boolean)).size} distinct of ${TFS.length}`);

  // 11. WALL HISTORY / BEAD FORMATION
  const barsResp = await api(page, `/api/market/vector/bars?ticker=${ticker}`);
  const sessionYmd = barsResp?.sessionYmd;
  let beadCount = 0;
  if (sessionYmd) {
    const wh = await api(page, `/api/market/vector/wall-history?ticker=${ticker}&dte=weekly&session=${sessionYmd}`);
    const hist = Array.isArray(wh?.history) ? wh.history : [];
    beadCount = hist.length;
    const times = hist.map(s => s.time);
    const ordered = times.every((t, i) => i === 0 || times[i - 1] <= t);
    if (hist.length >= 2) {
      rec(`${ticker}: wall-history has beads (session ${sessionYmd})`, true, `${hist.length} samples, ordered=${ordered}`);
      const pcts = hist.map(s => s?.walls?.callWalls?.[0]?.pct).filter(p => Number.isFinite(p));
      const distinct = new Set(pcts.map(p => p.toFixed(4))).size;
      rec(`${ticker}: wall strength varies over time`, distinct > 1, `${pcts.length} pts, distinct=${distinct}`);
    } else {
      rec(`${ticker}: wall-history beads (session ${sessionYmd})`, hist.length > 0, `${hist.length} samples (may be off-hours)`);
    }
  }
  timing.beadCount = beadCount;

  // 12. LIVE GEX POLL — measure if walls update (RTH only, skip if off-hours)
  const now = new Date();
  const etHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(now));
  const isWeekday = now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
  const isRTH = isWeekday && etHour >= 9 && etHour < 16;
  if (isRTH && POLL_SEC > 0) {
    console.log(`  [${ticker}] RTH detected — polling ${POLL_SEC}s for live GEX updates...`);
    const w1 = await api(page, `/api/market/vector/walls?ticker=${ticker}&dte=0dte`);
    await page.waitForTimeout(POLL_SEC * 1000);
    const w2 = await api(page, `/api/market/vector/walls?ticker=${ticker}&dte=0dte`);
    const changed = JSON.stringify(w1) !== JSON.stringify(w2);
    rec(`${ticker}: [RTH] GEX walls updated within ${POLL_SEC}s`, changed, changed ? "walls changed" : "walls static");
    timing.rthPollChanged = changed;
  }

  // 13. CONSOLE ERRORS
  rec(`${ticker}: zero console errors`, errs.length === 0, errs.length ? errs.slice(0, 3).join(" | ") : "clean");

  timing.totalMs = Date.now() - timing.navStart;
  timing.spot = spot;
  tickerTimings[ticker] = timing;

  await page.screenshot({ path: join(OUT, `dyn-${ticker}.png`) });
  return timing;
}

// ====== MAIN ======
async function main() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  VECTOR DYNAMIC WS GEX — LIVE E2E VALIDATION`);
  console.log(`  ${STAGING}`);
  console.log(`  Tickers: ${TICKERS.join(", ")}`);
  console.log(`  DTEs: ${DTES.join(", ")} · TFs: ${TFS.join(", ")}`);
  console.log(`${"=".repeat(70)}\n`);

  const { poolId, region } = cfg();
  const email = `vec-dyn-${Date.now()}@blackouttrades.com`;
  const pw = `VecDyn!${String(Date.now()).slice(-6)}`;
  mkUser(poolId, region, email, pw);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await proxyRoute(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 140)); });
  page.on("pageerror", e => errs.push("PAGEERR: " + String(e.message).slice(0, 140)));

  try {
    // Sign in
    await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.locator('input[name="username"]:visible, input[type="email"]:visible').first().fill(email);
    await page.locator('input[name="password"]:visible, input[type="password"]:visible').first().fill(pw);
    await page.locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible, input[type="submit"]:visible').first().click();
    await page.waitForURL(u => u.href.startsWith(STAGING), { timeout: 90_000 });
    console.log(`Signed in as ${email}\n`);

    // Run each ticker
    for (const ticker of TICKERS) {
      try {
        await validateTicker(page, ticker, errs);
      } catch (e) {
        rec(`${ticker}: validation threw`, false, String(e.message).slice(0, 120));
        tickerTimings[ticker] = { ticker, error: String(e.message).slice(0, 200) };
      }
    }

    // Cross-ticker checks
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  CROSS-TICKER CHECKS`);
    console.log(`${"=".repeat(60)}`);
    const spySpot = tickerTimings.SPY?.spot;
    const spxSpot = tickerTimings.SPX?.spot;
    if (Number.isFinite(spySpot) && Number.isFinite(spxSpot)) {
      const ratio = spxSpot / spySpot;
      rec(`cross: SPX/SPY ≈ 10`, ratio > 9.4 && ratio < 10.6, `ratio=${ratio.toFixed(2)} SPY=${spySpot} SPX=${spxSpot}`);
    }

  } finally {
    await browser.close();
    try { sh("aws", ["cognito-idp", "admin-delete-user", "--user-pool-id", poolId, "--username", email, "--region", region]); } catch {}
  }

  // ====== TIMING SUMMARY ======
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  TIMING SUMMARY — GEX Data Availability per Ticker`);
  console.log(`${"=".repeat(70)}`);
  console.log(`${"Ticker".padEnd(8)} ${"GEX ms".padStart(8)} ${"Rows".padStart(6)} ${"Spot".padStart(10)} ${"Beads".padStart(7)} ${"Total ms".padStart(9)} ${"Status".padStart(8)}`);
  console.log(`${"-".repeat(70)}`);
  for (const t of TICKERS) {
    const tm = tickerTimings[t];
    if (!tm) { console.log(`${t.padEnd(8)} ${"—".padStart(8)} ${"—".padStart(6)} ${"—".padStart(10)} ${"—".padStart(7)} ${"—".padStart(9)} ${"ERROR".padStart(8)}`); continue; }
    if (tm.error) { console.log(`${t.padEnd(8)} ${"—".padStart(8)} ${"—".padStart(6)} ${"—".padStart(10)} ${"—".padStart(7)} ${"—".padStart(9)} ${"THREW".padStart(8)}`); continue; }
    console.log(
      `${t.padEnd(8)} ${String(tm.gexDataMs || "—").padStart(8)} ${String(tm.gexRows || 0).padStart(6)} ${String(tm.spot || "—").padStart(10)} ${String(tm.beadCount || 0).padStart(7)} ${String(tm.totalMs || "—").padStart(9)} ${(tm.gexReady ? "OK" : "NODATA").padStart(8)}`
    );
  }

  // ====== RESULTS ======
  const failed = results.filter(r => !r.ok);
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${failed.length ? "FAILED" : "PASSED"} — ${results.length - failed.length}/${results.length} checks`);
  if (failed.length) {
    console.log(`\n  FAILURES:`);
    for (const f of failed) console.log(`    ✗ ${f.name}${f.detail ? " — " + f.detail : ""}`);
  }
  console.log(`${"=".repeat(70)}`);

  // Write JSON report
  const report = { timestamp: new Date().toISOString(), staging: STAGING, tickers: TICKERS, timings: tickerTimings, results, passed: results.length - failed.length, total: results.length, failed: failed.length };
  writeFileSync(join(OUT, "dynamic-ws-report.json"), JSON.stringify(report, null, 2));
  console.log(`\nReport: ${join(OUT, "dynamic-ws-report.json")}`);

  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
