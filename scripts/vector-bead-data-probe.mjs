#!/usr/bin/env node
/**
 * Ground-truth probe for the bead-rail complaints:
 *   (a) SPX: "every wall runs full-width from the session open, no time-based new walls"
 *   (b) ASTS: "only single beads"
 *
 * Signs in (Cognito temp user, deleted), then IN-PAGE opens the real SSE stream for each ticker,
 * captures the FIRST full frame's wallHistory, and reports per top strike:
 *   - total buckets recorded, session span
 *   - each top call/put strike's BIRTH bucket index (0 = present since the first recorded bucket)
 *   - whether its pct VARIES across buckets (real, forming/fading) or is constant (back-filled/fabricated)
 * This distinguishes "legit persistent wall" from "fabricated flat rail" and shows if ASTS simply
 * has ~1 bucket (unrecorded universe) vs a rendering bug.
 */
import { execSync } from "node:child_process";
import { chromium } from "playwright";

const STAGING = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "";
const TICKERS = (process.env.PROBE_TICKERS ?? "SPX,ASTS,NVDA").split(",").map((s) => s.trim());
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

async function probeTicker(page, ticker) {
  // Open the SSE in-page and grab the first frame that carries a non-trivial wallHistory.
  const data = await page.evaluate(async ({ t }) => {
    return await new Promise((resolve) => {
      const es = new EventSource(`/api/market/vector/stream?ticker=${encodeURIComponent(t)}`);
      let done = false;
      const finish = (val) => { if (done) return; done = true; try { es.close(); } catch {} resolve(val); };
      es.onmessage = (ev) => {
        try {
          const snap = JSON.parse(ev.data);
          if (Array.isArray(snap.wallHistory)) finish({ wallHistory: snap.wallHistory });
        } catch {}
      };
      es.onerror = () => finish({ error: "sse-error" });
      setTimeout(() => finish({ error: "timeout" }), 20000);
    });
  }, { t: ticker });

  if (data.error) return { ticker, error: data.error };
  const h = data.wallHistory || [];
  const buckets = h.length;
  const span = buckets ? { first: h[0].time, last: h[h.length - 1].time, mins: Math.round((h[h.length - 1].time - h[0].time) / 60) } : null;

  // Build per-strike presence across buckets for GEX call+put.
  const analyzeSide = (side) => {
    const byStrike = new Map(); // strike -> { firstIdx, lastIdx, pcts:[] }
    h.forEach((s, i) => {
      const walls = s.gexWalls?.[side] || s.walls?.[side] || [];
      for (const w of walls) {
        const k = Math.round(w.strike);
        let e = byStrike.get(k);
        if (!e) { e = { firstIdx: i, lastIdx: i, pcts: [] }; byStrike.set(k, e); }
        e.lastIdx = i; e.pcts.push(Number(w.pct ?? w.strength ?? 0));
      }
    });
    // Rank by peak pct, take top 5.
    const rows = [...byStrike.entries()].map(([strike, e]) => {
      const peak = Math.max(...e.pcts, 0);
      const min = Math.min(...e.pcts);
      const varies = peak - min > 0.005;
      return { strike, bornIdx: e.firstIdx, lastIdx: e.lastIdx, n: e.pcts.length, peak: +peak.toFixed(3), varies };
    }).sort((a, b) => b.peak - a.peak).slice(0, 5);
    return rows;
  };

  return {
    ticker, buckets, span,
    calls: analyzeSide("callWalls"),
    puts: analyzeSide("putWalls"),
  };
}

async function main() {
  const { poolId, region } = cfg();
  const email = `vec-probe-${Date.now()}@blackouttrades.com`;
  const pw = `VecProbe!${String(Date.now()).slice(-6)}`;
  mkUser(poolId, region, email, pw);

  // Route the BROWSER natively through the agent proxy so long-lived SSE streams work (the
  // single-fetch route interception used elsewhere buffers the whole response and hangs on SSE).
  const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy || "";
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", ...(proxyServer ? [`--proxy-server=${proxyServer}`] : [])],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  const USE_NATIVE_PROXY = !!proxyServer;
  if (!USE_NATIVE_PROXY) await proxyRoute(ctx);
  const page = await ctx.newPage();
  try {
    await page.goto(`${STAGING}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.locator('input[name="username"]:visible, input[type="email"]:visible').first().fill(email);
    await page.locator('input[name="password"]:visible, input[type="password"]:visible').first().fill(pw);
    await page.locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible, input[type="submit"]:visible').first().click();
    await page.waitForURL((u) => u.href.startsWith(STAGING), { timeout: 90_000 });
    await page.goto(`${STAGING}/vector?ticker=SPX`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);

    for (const t of TICKERS) {
      const r = await probeTicker(page, t);
      console.log(`\n=== ${t} ===`);
      if (r.error) { console.log(`  ERROR: ${r.error}`); continue; }
      console.log(`  buckets=${r.buckets}${r.span ? ` span=${r.span.mins}min (first→last)` : ""}`);
      const fmt = (rows) => rows.map((x) => `${x.strike}: born@${x.bornIdx}/${r.buckets - 1} n=${x.n} peak=${x.peak} ${x.varies ? "VARIES" : "flat"}`).join("\n      ");
      console.log(`  TOP CALLS:\n      ${fmt(r.calls) || "(none)"}`);
      console.log(`  TOP PUTS:\n      ${fmt(r.puts) || "(none)"}`);
    }
  } finally {
    await browser.close();
    try { sh(`aws cognito-idp admin-delete-user --user-pool-id "${poolId}" --username "${email}"${region ? ` --region "${region}"` : ""}`); } catch {}
  }
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
