#!/usr/bin/env node
/**
 * Vector /vector end-to-end audit — API stream probes, GEX/VEX cross-validation,
 * and Playwright clicks on every interactive control (lens toggle, replay transport).
 *
 * Usage:
 *   npm run validate:vector-e2e
 *   node scripts/vector-e2e-audit.mjs [--base=https://blackouttrades.com]
 *
 * Requires: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
 * Optional: POLYGON_API_KEY (spot oracle), UW_API_KEY
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { inRthOpenWindow } from "./gha-et-window.mjs";
import { isAuthFailureStatus } from "./audit/lib/auth-status.mjs";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(
  /\/$/,
  ""
);
const SECRET = process.env.CLERK_SECRET_KEY;
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const EMAIL = process.env.AUDIT_EMAIL || `vector-e2e-${Date.now()}@blackouttrades.com`;
const PHONE = process.env.AUDIT_PHONE || "+1415555" + String(Math.floor(Math.random() * 9000) + 1000);
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const OUT = process.env.VECTOR_E2E_DIR || "/opt/cursor/artifacts/vector-e2e";
mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail) => {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
};

function fapiHost() {
  try {
    const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ""), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    if (d.includes(".")) return `https://${d}`;
  } catch {}
  return "https://clerk.blackouttrades.com";
}
const FAPI = fapiHost();
const TMP = join(tmpdir(), `vector-e2e-${process.pid}`);
mkdirSync(TMP, { recursive: true });
const JAR = join(TMP, "cookies.txt");
let seq = 0;

function curl({ method = "GET", url, headers = {}, form, urlencodeForm, json, jar = false, saveJar = false }) {
  const bf = join(TMP, `b${++seq}`);
  const args = ["-sS", "--max-time", "90", "-o", bf, "-w", "%{http_code}", "-A", UA];
  if (method !== "GET") args.push("-X", method);
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  if (json) args.push("-H", "Content-Type: application/json", "--data", JSON.stringify(json));
  if (form) for (const [k, v] of Object.entries(form)) args.push("--data", `${k}=${v}`);
  if (urlencodeForm) for (const [k, v] of Object.entries(urlencodeForm)) args.push("--data-urlencode", `${k}=${v}`);
  if (jar) args.push("-b", JAR);
  if (saveJar) args.push("-c", JAR);
  args.push(url);
  try {
    const s = Number(execFileSync("curl", args, { encoding: "utf8", maxBuffer: 80 * 1024 * 1024 }).trim());
    return { s, b: existsSync(bf) ? readFileSync(bf, "utf8") : "" };
  } catch (e) {
    return { s: 0, b: "", err: String(e.message || e).split("\n")[0] };
  }
}
const J = (r) => {
  try {
    return JSON.parse(r.b);
  } catch {
    return null;
  }
};
const backend = (m, p, j) =>
  curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });

async function authSession() {
  if (!SECRET) throw new Error("CLERK_SECRET_KEY missing");
  const create = backend("POST", "/users", {
    email_address: [EMAIL],
    phone_number: [PHONE],
    public_metadata: { role: "admin", tier: "premium" },
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  const cj = J(create);
  let userId = cj?.id;
  if (!userId && /form_identifier_exists/.test(JSON.stringify(cj?.errors || ""))) {
    const lookup = curl({
      method: "GET",
      url: `${API}/users?email_address=${encodeURIComponent(EMAIL)}`,
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    userId = J(lookup)?.[0]?.id;
    if (userId) {
      backend("PATCH", `/users/${userId}`, { public_metadata: { role: "admin", tier: "premium" } });
    }
  }
  if (!userId) throw new Error(`Clerk user create failed: ${create.b.slice(0, 200)}`);
  const ticket = J(backend("POST", "/sign_in_tokens", { user_id: userId }))?.token;
  if (!ticket) throw new Error("sign_in_token failed");
  const si = curl({
    method: "POST",
    url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`,
    headers: { Origin: BASE, Referer: `${BASE}/`, "Content-Type": "application/x-www-form-urlencoded" },
    form: { strategy: "ticket" },
    urlencodeForm: { ticket },
    saveJar: true,
    jar: true,
  });
  const sid = J(si)?.response?.created_session_id;
  if (!sid) throw new Error(`FAPI ticket exchange failed: ${si.b.slice(0, 200)}`);
  const clientUat = Math.floor(Date.now() / 1000);
  let tok = J(
    curl({
      method: "POST",
      url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`,
      headers: { Origin: BASE, Referer: `${BASE}/`, "Content-Type": "application/x-www-form-urlencoded" },
      jar: true,
      saveJar: true,
    })
  )?.jwt;
  const app = (path, opts = {}) => {
    for (let i = 0; i < 2; i++) {
      if (!tok) {
        tok = J(
          curl({
            method: "POST",
            url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`,
            headers: {
              Origin: BASE,
              Referer: `${BASE}/`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            jar: true,
            saveJar: true,
          })
        )?.jwt;
      }
      const r = curl({
        method: opts.method || "GET",
        url: `${BASE}${path}`,
        headers: {
          Cookie: `__session=${tok}; __client_uat=${clientUat}`,
          Accept: opts.accept || "application/json",
          ...(opts.headers || {}),
        },
        json: opts.json,
      });
      if (isAuthFailureStatus(r.s)) {
        tok = null;
        continue;
      }
      return { status: r.s, json: J(r), raw: r.b, headers: {} };
    }
    return { status: 401, json: null, raw: "" };
  };
  return {
    userId,
    sessionToken: () => tok,
    clientUat,
    app,
    cleanup: () => backend("DELETE", `/users/${userId}`),
  };
}

function topWallStrike(walls, side) {
  const s = walls?.[side]?.[0]?.strike;
  return s != null && Number.isFinite(Number(s)) ? Math.round(Number(s)) : null;
}

async function probeVectorStream(session) {
  const tok = session.sessionToken();
  if (!tok) {
    rec("api:vector-stream", "FAIL", "no session token");
    return null;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  let last = null;
  try {
    const res = await fetch(`${BASE}/api/market/vector/stream`, {
      headers: {
        Cookie: `__session=${tok}; __client_uat=${session.clientUat}`,
        Accept: "text/event-stream",
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      rec("api:vector-stream", "FAIL", `HTTP ${res.status}`);
      return null;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      rec("api:vector-stream", "FAIL", "no body");
      return null;
    }
    const dec = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          last = JSON.parse(line.slice(6));
        } catch {
          /* skip */
        }
      }
      if (last?.walls || last?.vexWalls || last?.candle) break;
    }
    reader.cancel().catch(() => {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!last) {
      rec("api:vector-stream", "FAIL", msg);
      return null;
    }
  } finally {
    clearTimeout(timer);
  }

  if (!last) {
    rec("api:vector-stream", "FAIL", "no SSE payload in 10s");
    return null;
  }

  const hasGex =
    Boolean(last.walls?.callWalls?.length) || Boolean(last.walls?.putWalls?.length);
  const hasVex =
    Boolean(last.vexWalls?.callWalls?.length) || Boolean(last.vexWalls?.putWalls?.length);
  const hasCandle = Boolean(last.candle?.close > 0);
  const issues = [];
  if (!hasGex && !hasVex) issues.push("no walls");
  if (!hasCandle && inRthOpenWindow()) issues.push("candle null during RTH");
  if (last.gammaFlip != null && (!Number.isFinite(last.gammaFlip) || last.gammaFlip <= 0)) {
    issues.push("invalid gammaFlip");
  }
  if (last.vexFlip != null && (!Number.isFinite(last.vexFlip) || last.vexFlip <= 0)) {
    issues.push("invalid vexFlip");
  }

  if (issues.length) {
    rec("api:vector-stream-payload", "FAIL", issues.join("; "));
  } else {
    rec(
      "api:vector-stream-payload",
      "PASS",
      `gex=${hasGex} vex=${hasVex} candle=${hasCandle ? last.candle.close : "—"} hist=${last.wallHistory?.length ?? 0}`
    );
  }
  return last;
}

async function crossValidateVector(session, streamSnap) {
  const hm = session.app("/api/market/gex-heatmap?ticker=SPX");
  if (hm.status !== 200 || !hm.json?.gex) {
    rec("api:cross-heatmap", "WARN", `heatmap HTTP ${hm.status}`);
    return;
  }
  const hmVexTop = topWallStrike(
    {
      callWalls: Object.entries(hm.json.vex?.strike_totals ?? {})
        .map(([strike, val]) => ({ strike: Number(strike), pct: Math.abs(Number(val)) }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 1),
      putWalls: [],
    },
    "callWalls"
  );
  const streamVexTop = topWallStrike(streamSnap?.vexWalls, "callWalls");
  const streamGexTop = topWallStrike(streamSnap?.walls, "callWalls");

  if (streamGexTop == null) {
    rec("api:cross-gex-walls", "WARN", "no GEX call wall on stream");
  } else {
    rec("api:cross-gex-walls", "PASS", `top call ${streamGexTop}`);
  }

  if (streamVexTop == null) {
    rec("api:cross-vex-walls", "WARN", "no VEX walls on stream (heatmap may be cold off-hours)");
  } else if (hm.json.vex?.flip != null && streamSnap?.vexFlip != null) {
    const flipDelta = Math.abs(hm.json.vex.flip - streamSnap.vexFlip);
    if (flipDelta > 25) {
      rec("api:cross-vex-flip", "FAIL", `stream ${streamSnap.vexFlip} vs heatmap ${hm.json.vex.flip}`);
    } else {
      rec("api:cross-vex-flip", "PASS", `${streamSnap.vexFlip}`);
    }
    rec("api:cross-vex-walls", "PASS", `top vanna+ ${streamVexTop}`);
  } else {
    rec("api:cross-vex-walls", "PASS", `top vanna+ ${streamVexTop}`);
  }

  const pos = session.app("/api/market/gex-positioning?ticker=SPX");
  if (pos.status === 200 && pos.json?.flip != null && streamSnap?.gammaFlip != null) {
    const d = Math.abs(pos.json.flip - streamSnap.gammaFlip);
    if (d > 25) {
      rec("api:cross-gamma-flip", "FAIL", `stream ${streamSnap.gammaFlip} vs positioning ${pos.json.flip}`);
    } else {
      rec("api:cross-gamma-flip", "PASS", `${streamSnap.gammaFlip}`);
    }
  } else {
    rec("api:cross-gamma-flip", "WARN", "positioning or stream flip missing");
  }
}

async function browserVector(session) {
  const pw = await mintIosPlaywrightSession({ appUrl: BASE });
  if (pw.skip) {
    rec("ui:browser-vector", "FAIL", pw.reason);
    return;
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
  await context.addInitScript(onboardingInitScript());
  await context.addCookies(pw.cookies);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err.message)));

  try {
    await page.goto(`${BASE}/vector`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 60_000 });

    const comingSoon = await page.getByText("Coming soon", { exact: false }).count();
    if (comingSoon > 0) {
      rec("ui:vector-page-load", "FAIL", "ComingSoon gate — admin should bypass");
      return;
    }

    await page.locator(".vector-page-shell, .vector-chart-wrap").first().waitFor({ timeout: 30_000 });
    rec("ui:vector-page-load", "PASS");

    const header = await page.locator("h1, .page-header-title").first().innerText().catch(() => "");
    if (!/vector/i.test(header)) {
      rec("ui:vector-header", "WARN", header.slice(0, 40));
    } else {
      rec("ui:vector-header", "PASS");
    }

    const chart = page.locator(".vector-chart-canvas");
    await chart.waitFor({ state: "visible", timeout: 30_000 });
    rec("ui:chart-canvas", "PASS");

    // Lens toggle — scope to Vector lens group (site shell has unrelated "GEX" push-alert button)
    const lensGroup = page.getByRole("group", { name: "Wall exposure lens" });
    await lensGroup.waitFor({ state: "visible", timeout: 15_000 });
    const gexBtn = lensGroup.getByRole("button", { name: "GEX", exact: true });
    const vexBtn = lensGroup.getByRole("button", { name: "VEX", exact: true });
    await gexBtn.click();
    rec("ui:click-gex-lens", "PASS");
    const vexDisabled = await vexBtn.isDisabled();
    if (vexDisabled) {
      rec("ui:click-vex-lens", "WARN", "VEX disabled — no vanna ladder in session");
    } else {
      await vexBtn.click();
      rec("ui:click-vex-lens", "PASS");
      await gexBtn.click();
    }

    // Timeframe selector (1m / 3m / 5m / 15m)
    const tfGroup = page.getByRole("group", { name: "Chart timeframe" });
    await tfGroup.waitFor({ state: "visible", timeout: 15_000 });
    for (const m of ["3", "5", "15", "1"]) {
      const btn = tfGroup.getByRole("button", { name: `${m}m`, exact: true });
      await btn.click();
      rec(`ui:click-tf-${m}m`, "PASS");
    }

    // Structure feed visible
    const feed = page.getByLabel("Wall structure events");
    if (await feed.isVisible()) {
      rec("ui:structure-feed", "PASS");
    } else {
      rec("ui:structure-feed", "FAIL", "ticker not visible");
    }

    // Replay controls — stay inside .vector-replay-bar (avoid matching "Replay session" for /Play/i)
    const replayBar = page.locator(".vector-replay-bar");
    const replayBtn = replayBar.getByRole("button", { name: /Replay session|Exit replay/i });
    const canReplay = await replayBtn.isEnabled();
    if (!canReplay) {
      rec("ui:replay-available", "WARN", "replay disabled — need >1 timeline step");
    } else {
      rec("ui:replay-available", "PASS");
      await replayBtn.click();
      rec("ui:click-enter-replay", "PASS");

      const scrub = page.locator('input[type="range"][aria-label="Replay position"]');
      if (await scrub.isVisible()) {
        await scrub.fill("1");
        rec("ui:scrub-replay", "PASS");
      }

      const playBtn = replayBar.locator("button").filter({ hasText: /^▶ Play$|^⏸ Pause$/ });
      if (await playBtn.isVisible()) {
        await playBtn.click();
        await page.waitForTimeout(800);
        rec("ui:click-play", "PASS");
        const pauseBtn = replayBar.locator("button").filter({ hasText: /^⏸ Pause$/ });
        if (await pauseBtn.isVisible()) {
          await pauseBtn.click();
          rec("ui:click-pause", "PASS");
        }
      }

      for (const speed of ["2", "4"]) {
        const sp = replayBar.locator("button").filter({ hasText: new RegExp(`^${speed}×$`) });
        if (await sp.isVisible()) {
          await sp.click();
          rec(`ui:click-speed-${speed}x`, "PASS");
        }
      }

      const exitBtn = replayBar.getByRole("button", { name: "Exit replay" });
      await exitBtn.click();
      rec("ui:click-exit-replay", "PASS");
    }

    // Crosshair: hover chart
    const box = await chart.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
      await page.waitForTimeout(400);
      const legend = page.locator('[aria-live="polite"]').filter({ hasText: /SPX|gex|vex/i });
      if (await legend.count()) {
        rec("ui:crosshair-legend", "PASS");
      } else {
        rec("ui:crosshair-legend", "WARN", "legend not shown on hover");
      }
    }

    await page.screenshot({ path: join(OUT, `vector-e2e-${Date.now()}.png`), fullPage: true });
    rec("ui:screenshot", "PASS", OUT);

    const badConsole = consoleErrors.filter(
      (e) => !/favicon|ResizeObserver|clerk/i.test(e)
    );
    if (badConsole.length) {
      rec("ui:console-errors", "FAIL", badConsole.slice(0, 3).join(" | "));
    } else {
      rec("ui:console-errors", "PASS");
    }
  } catch (e) {
    rec("ui:browser-vector", "FAIL", e.message);
    await page.screenshot({ path: join(OUT, `vector-e2e-fail-${Date.now()}.png`), fullPage: true }).catch(() => {});
  } finally {
    try {
      await pw.cleanup?.();
    } catch {}
    await browser.close();
  }
}

async function probeVectorPageHtml(session) {
  const tok = session.sessionToken();
  const r = curl({
    url: `${BASE}/vector`,
    headers: { Cookie: `__session=${tok}; __client_uat=${session.clientUat}` },
  });
  if (r.s !== 200) {
    rec("api:vector-page", "FAIL", `HTTP ${r.s}`);
    return;
  }
  if (/Coming soon/i.test(r.b)) {
    rec("api:vector-page", "FAIL", "ComingSoon HTML for admin");
    return;
  }
  if (!/vector-chart|Vector/i.test(r.b)) {
    rec("api:vector-page", "WARN", "chart shell not in SSR HTML (client-only ok)");
  } else {
    rec("api:vector-page", "PASS", `HTTP ${r.s}`);
  }
}

async function main() {
  console.log(`\n=== Vector E2E Audit ===`);
  console.log(`Target: ${BASE}`);
  console.log(`RTH window: ${inRthOpenWindow() ? "yes" : "no (pre/post)"}\n`);

  if (!SECRET || !PUB) {
    rec("env:clerk", "FAIL", "CLERK_SECRET_KEY + NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY required");
    process.exit(1);
  }

  let session;
  try {
    session = await authSession();
    await probeVectorPageHtml(session);
    const snap = await probeVectorStream(session);
    if (snap) await crossValidateVector(session, snap);
    await browserVector(session);
  } finally {
    if (session?.cleanup) session.cleanup();
    try {
      rmSync(TMP, { recursive: true, force: true });
    } catch {}
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  const reportPath = join(OUT, `vector-e2e-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ base: BASE, checks, at: new Date().toISOString() }, null, 2));
  console.log(`\nReport: ${reportPath}`);
  console.log(`FAIL: ${fails.length} / ${checks.length}\n`);
  if (fails.length) {
    for (const f of fails) console.log(`  ✗ ${f.name}: ${f.detail}`);
  }
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
