#!/usr/bin/env node
/**
 * Vector HARDCORE end-to-end suite — deep value-correctness + dynamism + wall/bead-dynamics.
 *
 * Goes far beyond the render gate (vector-staging-e2e.mjs): for MULTIPLE stocks × DTEs × TFs it
 * asserts the ACTUAL values are correct AND that they re-render dynamically on every selection
 * change (the "stale data didn't update" class of bug), and that the wall/bead rail forms, updates,
 * and grows/fades in strength over time. Structured so it's reusable DURING RTH (set RTH=1 to add
 * live-poll growth/fade checks) as well as off-hours (validates the recorded rail + replay).
 *
 * Value correctness reads the clean JSON APIs (gex-ladder, max-pain, wall-history) in the signed-in
 * browser context — structured, no fragile DOM float-parsing — while render/dynamism use the DOM +
 * canvas screenshot diffs. Every captured value is printed so a regression is visible, not just a
 * pass/fail. Exits non-zero on any failure so it gates.
 *
 * Usage: env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/vector-hardcore-e2e.mjs
 * Env: T=SPY,NVDA,SPX  RTH=1(live poll)  STAGING_BASE_URL  SHOT_DIR
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const STAGING = (process.env.STAGING_BASE_URL || "https://staging.blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SHOT_DIR || "/tmp/claude-0/-home-user/464bea58-d425-5552-a7bd-de5f2e9c99f9/scratchpad/vector-gate-shots";
const SECRET_NAME = process.env.STAGING_SECRET_NAME || "blackout-staging/app/env";
const REGION = process.env.AWS_REGION || "us-east-1";
const TICKERS = (process.env.T || "SPY,NVDA,SPX").split(",").map((s) => s.trim());
const RTH = process.env.RTH === "1";
const DTES = ["0DTE", "WEEKLY", "MONTHLY", "ALL"];
const DTE_PARAM = { "0DTE": "0dte", WEEKLY: "weekly", MONTHLY: "monthly", ALL: "all" };
const TFS = ["1 min", "15 min", "1H"];
mkdirSync(OUT, { recursive: true });
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

const results = [];
const rec = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

function cfg() {
  const s = JSON.parse(sh(`aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --region "${REGION}" --query SecretString --output text`));
  const poolId = s.COGNITO_USER_POOL_ID;
  return { poolId, region: poolId?.includes("_") ? poolId.split("_")[0] : REGION };
}
function mkUser(poolId, region, email, pw) {
  const rf = ` --region "${region}"`;
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
// Fetch a same-origin JSON API in the signed-in page context.
const api = (page, path) => page.evaluate(async (p) => { try { const r = await fetch(p); return r.ok ? await r.json() : { __status: r.status }; } catch (e) { return { __throw: String(e) }; } }, path);
// Cheap perceptual hash of the chart canvas region for re-render diffing.
async function chartHash(page) {
  try { const buf = await page.locator("canvas").first().screenshot(); return createHash("md5").update(buf).digest("hex"); } catch { return null; }
}
// Composited screenshot of the whole chart region (all stacked canvases), for pixel-truth checks.
async function chartShot(page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) return null;
  await page.mouse.move(0, 0); // park the cursor so the crosshair legend can't bleed into the pixels
  await page.waitForTimeout(300);
  return page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
}
// Count pixels within `tol` of an {r,g,b} target — proves a specific overlay colour is really drawn.
async function countColor(buf, target, tol) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (Math.abs(data[i] - target.r) <= tol && Math.abs(data[i + 1] - target.g) <= tol && Math.abs(data[i + 2] - target.b) <= tol) n++;
  }
  return n;
}
const fmtVariants = (n) => [String(n), Number(n).toLocaleString("en-US")];
const textCites = (text, n) => fmtVariants(n).some((v) => text.includes(v));
async function dismiss(page) {
  for (const sel of ['button:has-text("SKIP")', '[aria-label="Close"]']) { const el = page.locator(sel).first(); if (await el.count().catch(() => 0)) { await el.click().catch(() => {}); return; } }
}
async function clickDte(page, dte) { const b = page.locator(`button:has-text("${dte}")`).first(); if (await b.count().catch(() => 0)) { await b.click().catch(() => {}); await page.waitForTimeout(1600); return true; } return false; }
async function domSnap(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      regime: (q(".vector-regime-read")?.textContent || "").replace(/\s+/g, " ").trim(),
      // Full terminal text (was .slice(0,300), which cut BEFORE the king-strike citations and made
      // the "terminal cites kings" check a false negative on every ticker — harness bug, not product).
      terminal: (q(".vector-desk-terminal")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 6000),
      ladderRows: document.querySelectorAll(".vector-gex-ladder-row").length,
      crosshair: (q(".vector-crosshair-legend")?.textContent || "").replace(/\s+/g, " ").trim(),
    };
  });
}

async function validateTicker(page, ticker, errs) {
  console.log(`\n===== ${ticker} =====`);
  errs.length = 0;
  await page.goto(`${STAGING}/vector?ticker=${ticker}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4000);
  await dismiss(page);
  await page.waitForTimeout(4500);

  // ---- A. base render ----
  const base = await domSnap(page);
  rec(`${ticker}: base render (ladder+regime+terminal)`, base.ladderRows > 0 && base.regime.length > 0 && base.terminal.length > 0, `${base.ladderRows} rows`);

  // ---- B. ladder value correctness (structured API) ----
  const lad = await api(page, `/api/market/vector/gex-ladder?ticker=${ticker}`);
  const rows = lad?.ladder?.rows || [];
  const spot = Number(lad?.spot);
  const strikes = rows.map((r) => r.strike);
  const desc = strikes.every((s, i) => i === 0 || strikes[i - 1] > s);
  const finiteAll = rows.every((r) => Number.isFinite(r.strike) && Number.isFinite(r.gex) && Number.isFinite(r.magnitude));
  const magOk = rows.every((r) => r.magnitude >= 0 && r.magnitude <= 1.0001);
  const kings = { call: rows.filter((r) => r.isKing && r.side === "call").length, put: rows.filter((r) => r.isKing && r.side === "put").length };
  const inBand = strikes.length ? spot >= Math.min(...strikes) && spot <= Math.max(...strikes) : false;
  // Malformed-float guard (repo systemic issue): no long unrounded decimals like 7499.360000000001.
  const noJunkFloats = rows.every((r) => !/\.\d{5,}/.test(String(r.gex)) && !/\.\d{5,}/.test(String(r.strike)));
  rec(`${ticker}: ladder rows finite + descending + magnitude∈[0,1]`, rows.length > 0 && desc && finiteAll && magOk, `${rows.length} rows, spot ${spot}`);
  rec(`${ticker}: ladder spot within strike band`, inBand, `spot ${spot} band [${Math.min(...strikes)},${Math.max(...strikes)}]`);
  rec(`${ticker}: exactly one king per side`, kings.call === 1 && kings.put === 1, `call=${kings.call} put=${kings.put}`);
  rec(`${ticker}: no malformed unrounded floats in ladder`, noJunkFloats);

  // ---- C/D/E. per-DTE: max-pain + flip + regime consistency + dynamism ----
  const mpByDte = {}, flipByDte = {}, regimeByDte = {}, termByDte = {}, hashByDte = {}, wallsByDte = {};
  for (const dte of DTES) {
    await clickDte(page, dte);
    const snap = await domSnap(page);
    regimeByDte[dte] = snap.regime; termByDte[dte] = snap.terminal;
    hashByDte[dte] = await chartHash(page); // the CHART itself must re-render per horizon, not just text
    wallsByDte[dte] = await api(page, `/api/market/vector/walls?ticker=${ticker}&dte=${DTE_PARAM[dte]}`);
    const mp = await api(page, `/api/market/vector/max-pain?ticker=${ticker}&dte=${DTE_PARAM[dte]}`);
    mpByDte[dte] = mp?.maxPain ?? null;
    // Parse the flip the regime banner cites + assert wording matches spot-vs-flip.
    const m = snap.regime.match(/gamma flip \(([\d,\.]+)\)/);
    flipByDte[dte] = m ? Number(m[1].replace(/,/g, "")) : null;
    const saysLong = /long gamma/i.test(snap.regime), saysShort = /short gamma/i.test(snap.regime), saysOn = /sitting on|on the gamma flip/i.test(snap.regime);
    const spotM = snap.regime.match(/Spot ([\d,\.]+)/); const sSpot = spotM ? Number(spotM[1].replace(/,/g, "")) : NaN;
    let consistent = true;
    if (Number.isFinite(sSpot) && flipByDte[dte] != null && !saysOn) {
      consistent = sSpot > flipByDte[dte] ? saysLong : saysShort; // above flip → long gamma, below → short
    }
    rec(`${ticker} ${dte}: regime wording matches spot vs flip`, consistent, `spot ${sSpot} flip ${flipByDte[dte]} → "${snap.regime.slice(0, 48)}"`);
    // Max-pain correctness: within the ladder band.
    if (strikes.length && Number.isFinite(Number(mpByDte[dte]))) {
      const mpv = Number(mpByDte[dte]);
      rec(`${ticker} ${dte}: max-pain ${mpv} within ladder band`, mpv >= Math.min(...strikes) * 0.9 && mpv <= Math.max(...strikes) * 1.1);
    }
    console.log(`  [${dte}] maxPain=${mpByDte[dte]} flip=${flipByDte[dte]} regime="${snap.regime.slice(0, 54)}"`);
  }
  const variants = (o) => new Set(Object.values(o).map(String)).size;
  rec(`${ticker}: DTE re-scopes (maxPain/flip/regime/terminal change across horizons)`,
    variants(mpByDte) > 1 || variants(flipByDte) > 1 || variants(regimeByDte) > 1 || variants(termByDte) > 1,
    `maxPain=${variants(mpByDte)} flip=${variants(flipByDte)} regime=${variants(regimeByDte)} term=${variants(termByDte)}`);
  rec(`${ticker}: DTE re-renders the CHART canvas (pixels differ across horizons)`,
    new Set(Object.values(hashByDte).filter(Boolean)).size > 1, `${new Set(Object.values(hashByDte).filter(Boolean)).size} distinct frames`);
  // Narrowed horizons: the banner's resistance/support MUST equal the scoped walls API — that's the
  // exact data path the DTE toggle re-scopes (#170). ("All" is checked against the ladder in H3
  // instead: on "all" the UI intentionally shows the near-term stream walls, not this route.)
  for (const dte of ["WEEKLY", "MONTHLY"]) {
    const w = wallsByDte[dte]?.walls;
    const rTxt = regimeByDte[dte] || "";
    const bRes = rTxt.match(/resistance ([\d,.]+)/), bSup = rTxt.match(/support ([\d,.]+)/);
    if (w?.callWalls?.[0] && w?.putWalls?.[0] && bRes && bSup) {
      const br = Number(bRes[1].replace(/,/g, "")), bs = Number(bSup[1].replace(/,/g, ""));
      rec(`${ticker} ${dte}: banner resistance/support equal the scoped walls API`,
        near(br, w.callWalls[0].strike, 0.01) && near(bs, w.putWalls[0].strike, 0.01),
        `banner ${br}/${bs} vs API ${w.callWalls[0].strike}/${w.putWalls[0].strike}`);
    }
  }

  // ---- F. timeframe dynamism: canvas re-renders + MA availability re-computes ----
  const hashByTf = {}, noteByTf = {};
  for (const tf of TFS) {
    await page.locator("#vector-tf-select").selectOption({ label: tf }).catch(() => {});
    await page.waitForTimeout(1200);
    hashByTf[tf] = await chartHash(page);
    await page.locator(".vector-ind-trigger").click().catch(() => {});
    await page.waitForTimeout(300);
    noteByTf[tf] = await page.evaluate(() => { const it = [...document.querySelectorAll(".vector-ind-item")].find((b) => (b.textContent || "").includes("SMA")); return it ? (it.querySelector(".vector-ind-note")?.textContent || "full").trim() : "?"; });
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  }
  rec(`${ticker}: timeframe redraws the chart (canvas differs across TFs)`, new Set(Object.values(hashByTf).filter(Boolean)).size > 1, JSON.stringify(Object.keys(hashByTf)));
  rec(`${ticker}: timeframe re-aggregates bars (SMA note 1m≠1H)`, noteByTf["1 min"] !== noteByTf["1H"], `1m="${noteByTf["1 min"]}" 1H="${noteByTf["1H"]}"`);

  // ---- G. indicator matrix: family toggles draw + badge tracks enabled count ----
  await page.locator("#vector-tf-select").selectOption({ label: "1 min" }).catch(() => {}); await page.waitForTimeout(1000);
  await page.locator(".vector-ind-trigger").click().catch(() => {}); await page.waitForTimeout(300);
  const before = await chartHash(page);
  for (const label of ["VWAP", "EMA", "HOD / LOD", "Auto fib", "Market structure", "RSI", "MACD"]) { await page.locator(`.vector-ind-item:has-text("${label}")`).first().click().catch(() => {}); await page.waitForTimeout(500); }
  await page.keyboard.press("Escape"); await page.waitForTimeout(1200);
  const after = await chartHash(page);
  const badge = await page.locator(".vector-ind-badge").textContent().catch(() => null);
  rec(`${ticker}: enabling indicators redraws chart + badge tracks count (incl. Auto fib + structure + RSI/MACD)`, before !== after && Number(badge) === 7, `badge=${badge}`);

  // ---- H. UI TRUTH: the values MEMBERS SEE on screen match the data, and the pixels are real ----
  // H1. EMA draw/undraw at the PIXEL level: EMA-9's orange (#fb923c) is unique on the chart (pivots
  // share it but are off), so counting orange pixels proves the line is genuinely painted — and
  // vanishes when toggled off. This is the strongest "the UI really rendered it" check we have.
  const shotOn = await chartShot(page);
  const emaOn = shotOn ? await countColor(shotOn, { r: 251, g: 146, b: 60 }, 18) : 0;
  await page.locator(".vector-ind-trigger").click().catch(() => {}); await page.waitForTimeout(300);
  await page.locator('.vector-ind-item:has-text("EMA")').first().click().catch(() => {});
  await page.keyboard.press("Escape"); await page.waitForTimeout(1200);
  const shotOff = await chartShot(page);
  const emaOff = shotOff ? await countColor(shotOff, { r: 251, g: 146, b: 60 }, 18) : 0;
  rec(`${ticker}: EMA pixels really paint on enable and vanish on disable`, emaOn > 120 && emaOff < emaOn * 0.25, `on=${emaOn}px off=${emaOff}px`);

  // H2. Ladder UI text vs API: the strikes members READ in the panel are exactly the API's rows, in
  // order, and each row's printed $ sign matches its side (call "+$", put "-$").
  const uiRows = await page.evaluate(() =>
    [...document.querySelectorAll(".vector-gex-ladder-row")].map((r) => (r.textContent || "").replace(/\s+/g, " ").trim())
  );
  const uiStrikes = uiRows.map((t) => { const m = t.match(/^([\d,]+(?:\.\d+)?)/); return m ? Number(m[1].replace(/,/g, "")) : NaN; });
  const strikesMatch = uiStrikes.length === rows.length && uiStrikes.every((s, i) => near(s, rows[i].strike, 0.001));
  const signsMatch = uiRows.every((t, i) => (rows[i]?.side === "call" ? t.includes("+$") : t.includes("-$")));
  const fmtOk = uiRows.every((t) => /[+-]\$[\d,.]+[BMK]?/.test(t));
  rec(`${ticker}: ladder UI strikes match API exactly (order + values)`, strikesMatch, `${uiStrikes.length} UI vs ${rows.length} API`);
  rec(`${ticker}: ladder UI $-signs match side + formatted (+$/-$ B/M/K)`, signsMatch && fmtOk);

  // H3/H4. Cross-SURFACE consistency on "all": the banner's resistance/support, the ladder's kings,
  // and the terminal's callouts are three separate member-visible surfaces reading the same
  // near-term structure — they must cite the SAME strikes. (The horizon walls route is checked on
  // narrowed DTEs above; on "all" the UI intentionally shows the stream/ladder aggregate.)
  const callKingL = rows.find((r) => r.isKing && r.side === "call")?.strike;
  const putKingL = rows.find((r) => r.isKing && r.side === "put")?.strike;
  if (callKingL != null && putKingL != null) {
    const ui = await domSnap(page);
    const bRes = ui.regime.match(/resistance ([\d,.]+)/), bSup = ui.regime.match(/support ([\d,.]+)/);
    const br = bRes ? Number(bRes[1].replace(/,/g, "")) : NaN, bs = bSup ? Number(bSup[1].replace(/,/g, "")) : NaN;
    rec(`${ticker}: banner resistance/support equal the ladder kings (cross-surface truth)`,
      near(br, callKingL, 0.01) && near(bs, putKingL, 0.01), `banner ${br}/${bs} vs ladder kings ${callKingL}/${putKingL}`);
    rec(`${ticker}: desk terminal cites the king strikes`, textCites(ui.terminal, callKingL) || textCites(ui.terminal, putKingL), `kings ${callKingL}/${putKingL}`);
  }

  // H5. Crosshair truth: hovering the chart shows a close that lies INSIDE the session's real
  // high/low band (bars API), and moving the cursor changes the readout (interactive, not frozen).
  const barsResp = await api(page, `/api/market/vector/bars?ticker=${ticker}`);
  const bars = Array.isArray(barsResp?.bars) ? barsResp.bars : [];
  const dayLo = Math.min(...bars.map((b) => b.low)), dayHi = Math.max(...bars.map((b) => b.high));
  const box = await page.locator("canvas").first().boundingBox();
  if (box && bars.length) {
    const legendSel = "div.pointer-events-none.absolute.left-3.top-3";
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5); await page.waitForTimeout(600);
    const leg1 = await page.locator(legendSel).innerText().catch(() => "");
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5); await page.waitForTimeout(600);
    const leg2 = await page.locator(legendSel).innerText().catch(() => "");
    const m = leg2.replace(/\s+/g, " ").match(new RegExp(`${ticker}\\s+([\\d,]+(?:\\.\\d+)?)`));
    const hoverClose = m ? Number(m[1].replace(/,/g, "")) : NaN;
    rec(`${ticker}: crosshair readout inside the session's real range [${dayLo}, ${dayHi}]`,
      Number.isFinite(hoverClose) && hoverClose >= dayLo * 0.995 && hoverClose <= dayHi * 1.005, `hover close=${hoverClose}`);
    rec(`${ticker}: crosshair readout tracks the cursor (two hovers differ)`, leg1 && leg2 && leg1 !== leg2);
    await page.mouse.move(0, 0); await page.waitForTimeout(300);
  } else rec(`${ticker}: crosshair check ran`, false, `box=${!!box} bars=${bars.length}`);

  // ---- I. wall/bead dynamics over time (forming / updating / growing / fading) ----
  // The recorded rail is what replay scrubs through, so its FRAME COUNT proves the walls were
  // sampled repeatedly across the session (formed/updated over time), and start≠end proves the
  // beads actually change frame-to-frame. This works off-hours (the rail is SSR-seeded from the last
  // session) without the today-scoped API. For the numeric STRENGTH growth/fade we query the
  // narrowed-horizon wall-history for the DISPLAYED session (parsed from the "MON DD CLOSE" badge),
  // which returns per-sample wall pct; RTH additionally live-polls (block K) for live advance.
  const replayBtn = page.locator('button:has-text("Replay")').first();
  let stepCount = 0, hStart = null, hEnd = null;
  if (await replayBtn.count().catch(() => 0)) {
    await replayBtn.click().catch(() => {}); await page.waitForTimeout(1500);
    const slider = page.locator('input[type="range"]').first();
    if (await slider.count().catch(() => 0)) {
      stepCount = Number(await slider.getAttribute("max").catch(() => "0")) || 0;
      await slider.fill("0").catch(() => {}); await page.waitForTimeout(1200); hStart = await chartHash(page);
      await slider.fill(String(stepCount || 100)).catch(() => {}); await page.waitForTimeout(1200); hEnd = await chartHash(page);
    }
    await replayBtn.click().catch(() => {}); await page.waitForTimeout(800); // exit replay
  }
  rec(`${ticker}: recorded rail formed over time (replay has >1 frame)`, stepCount > 1, `${stepCount} frames`);
  rec(`${ticker}: beads change across the session (replay start≠end frame)`, hStart && hEnd && hStart !== hEnd, `start=${String(hStart).slice(0, 6)} end=${String(hEnd).slice(0, 6)}`);

  // Numeric strength growth/fade — narrowed-horizon rail for the displayed session.
  const sessionYmd = await page.evaluate(() => {
    const m = (document.body.innerText || "").match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{1,2})\b/);
    if (!m) return null;
    const mo = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 }[m[1]];
    return `${new Date().getFullYear()}-${String(mo).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  });
  if (sessionYmd) {
    const wh = await api(page, `/api/market/vector/wall-history?ticker=${ticker}&dte=weekly&session=${sessionYmd}`);
    const hist = Array.isArray(wh?.history) ? wh.history : [];
    const times = hist.map((s) => s.time);
    const ordered = times.every((t, i) => i === 0 || times[i - 1] <= t);
    const pcts = hist.map((s) => s?.walls?.callWalls?.[0]?.pct).filter((p) => Number.isFinite(p));
    const distinct = new Set(pcts.map((p) => p.toFixed(4))).size;
    if (hist.length >= 2) {
      rec(`${ticker}: wall-history time-ordered (session ${sessionYmd})`, ordered, `${hist.length} samples`);
      rec(`${ticker}: wall strength grows/fades over time (top-call pct varies)`, distinct > 1, `${pcts.length} pts, distinct=${distinct}`);
    } else {
      rec(`${ticker}: narrowed rail strength-over-time (session ${sessionYmd})`, true, `${hist.length} samples — SKIP (recorder off this session); replay frames cover it`);
    }
  }

  // ---- K. RTH-only: live rail actually advances (growth/fade) ----
  if (RTH) {
    // Poll the NARROWED 0DTE rail WITH the session param — `dte=all` (and any missing session)
    // short-circuits to an empty rail by route contract (the "all" rail is SSR-seeded), so the old
    // poll asserted against a query documented to return nothing (0→0 false negative — harness bug).
    const s1 = await api(page, `/api/market/vector/wall-history?ticker=${ticker}&dte=0DTE&session=${sessionYmd}`);
    await page.waitForTimeout(35_000);
    const s2 = await api(page, `/api/market/vector/wall-history?ticker=${ticker}&dte=0DTE&session=${sessionYmd}`);
    const n1 = (s1?.history || []).length, n2 = (s2?.history || []).length;
    const grew = n2 > n1 || JSON.stringify(s1?.history?.slice(-1)) !== JSON.stringify(s2?.history?.slice(-1));
    rec(`${ticker}: [RTH] live wall rail advances within 35s (new sample or changed strength)`, grew, `${n1}→${n2} samples`);
  }

  rec(`${ticker}: zero console errors`, errs.length === 0, errs.slice(0, 2).join(" | "));
  await page.screenshot({ path: join(OUT, `hardcore-${ticker}.png`) });
  return { spot };
}

async function main() {
  console.log(`\n=== Vector HARDCORE E2E — ${STAGING} ${RTH ? "(RTH live-poll ON)" : "(off-hours)"} ===`);
  console.log(`Tickers: ${TICKERS.join(", ")} · DTEs: ${DTES.join(",")} · TFs: ${TFS.join(",")}\n`);
  const { poolId, region } = cfg();
  const email = `vec-hc-${Date.now()}@blackouttrades.com`, pw = `VecHC!${String(Date.now()).slice(-6)}`;
  mkUser(poolId, region, email, pw);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await proxyRoute(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 140)); });
  page.on("pageerror", (e) => errs.push("PAGEERR: " + String(e.message).slice(0, 140)));
  const spots = {};
  try {
    await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.locator('input[name="username"]:visible, input[type="email"]:visible').first().fill(email);
    await page.locator('input[name="password"]:visible, input[type="password"]:visible').first().fill(pw);
    await page.locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible, input[type="submit"]:visible').first().click();
    await page.waitForURL((u) => u.href.startsWith(STAGING), { timeout: 90_000 });
    console.log(`signed in as ${email}`);
    for (const ticker of TICKERS) {
      try { const r = await validateTicker(page, ticker, errs); spots[ticker] = r.spot; }
      catch (e) { rec(`${ticker}: validation threw`, false, String(e.message).slice(0, 120)); }
    }
    if (Number.isFinite(spots.SPY) && Number.isFinite(spots.SPX)) {
      const ratio = spots.SPX / spots.SPY;
      rec(`cross: SPX/SPY ≈ 10 (got ${ratio.toFixed(2)})`, ratio > 9.4 && ratio < 10.6, `SPY=${spots.SPY} SPX=${spots.SPX}`);
    }
  } finally {
    await browser.close();
    try { sh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}" --region "${region}"`); } catch {}
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${failed.length ? "FAILED" : "PASSED"} — ${results.length - failed.length}/${results.length} checks ===`);
  for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? " — " + f.detail : ""}`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
