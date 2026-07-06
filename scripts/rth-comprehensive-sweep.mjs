#!/usr/bin/env node
/**
 * RTH comprehensive test sweep — browser + authenticated API + missing-field audit.
 * Usage: node scripts/rth-comprehensive-sweep.mjs [--base=https://blackouttrades.com]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { isAuthFailureStatus } from "./audit/lib/auth-status.mjs";
import { generateDefaultAuditPhone } from "./audit/lib/audit-phone.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(/\/$/, "");
const SECRET = process.env.CLERK_SECRET_KEY;
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const CRON = process.env.CRON_SECRET || "";
const EMAIL = process.env.AUDIT_EMAIL || `rth-sweep-${Date.now()}@blackouttrades.com`;
const PHONE = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const PAGES = [
  { path: "/dashboard", label: "dashboard", liveWaitMs: 12000 },
  { path: "/flows", label: "flows", liveWaitMs: 8000 },
  { path: "/heatmap", label: "heatmap-matrix", liveWaitMs: 20000 },
  { path: "/grid", label: "grid", liveWaitMs: 15000 },
  { path: "/nighthawk", label: "nighthawk", liveWaitMs: 5000 },
  { path: "/terminal", label: "terminal", liveWaitMs: 5000 },
  { path: "/track-record", label: "track-record", liveWaitMs: 10000 },
];

const GRID_APIS = [
  "/api/grid/sectors",
  "/api/grid/movers",
  "/api/grid/economy",
  "/api/grid/earnings",
  "/api/grid/catalysts",
  "/api/grid/analysts",
  "/api/grid/congress",
  "/api/grid/dark-pool",
  "/api/grid/bootstrap",
];

const MARKET_APIS = [
  "/api/market/spx/desk",
  "/api/market/spx/pulse",
  "/api/market/spx/merged",
  "/api/market/gex-positioning?ticker=SPX",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/gex-heatmap?ticker=SPY",
  "/api/market/flows?limit=20",
  "/api/market/nighthawk/edition",
  "/api/public/track-record",
  "/api/market/platform/snapshot",
];

const MISSING_PATTERNS = [
  { re: /\$—/g, label: "dollar-emdash" },
  { re: /—%/g, label: "emdash-percent" },
  { re: /\bN\/A\b/g, label: "N/A" },
  { re: /\bNo data\b/gi, label: "No data" },
];

const report = { ts: new Date().toISOString(), pages: [], apis: [], missing: [], issues: [], largo: null };

function fapiHost() {
  try {
    const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8").replace(/\$$/, "");
    if (d.includes(".")) return `https://${d}`;
  } catch {}
  return "https://clerk.blackouttrades.com";
}
const FAPI = fapiHost();
const TMP = join(tmpdir(), `rth-sweep-${process.pid}`);
mkdirSync(TMP, { recursive: true });
const JAR = join(TMP, "cookies.txt");
let seq = 0;

function curlTimeoutSec(url) {
  if (
    url.includes("/api/cron/data-correctness") ||
    url.includes("gex-heatmap") ||
    url.includes("gex-positioning") ||
    url.includes("/largo/query")
  ) {
    return "180";
  }
  return "120";
}

function curl({ method = "GET", url, headers = {}, form, urlencodeForm, json, jar = false, saveJar = false }) {
  const bf = join(TMP, `b${++seq}`);
  const args = ["-sS", "--max-time", curlTimeoutSec(url), "-o", bf, "-w", "%{http_code}", "-A", UA];
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
const J = (r) => { try { return JSON.parse(r.b); } catch { return null; } };
const backend = (m, p, j) => curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });

function scanMissing(text, page) {
  const hits = [];
  for (const { re, label } of MISSING_PATTERNS) {
    const m = text.match(re);
    if (m?.length) hits.push({ page, pattern: label, count: m.length });
  }
  // em-dash standalone in metric contexts (rough heuristic)
  const emdash = (text.match(/—/g) || []).length;
  if (emdash > 3) hits.push({ page, pattern: "em-dash-total", count: emdash });
  return hits;
}

async function authSession() {
  if (!SECRET) throw new Error("CLERK_SECRET_KEY missing");
  const create = backend("POST", "/users", {
    email_address: [EMAIL],
    phone_number: [PHONE],
    public_metadata: { role: "admin", tier: "premium" },
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  let cj = J(create);
  let userId = cj?.id;
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
            headers: { Origin: BASE, Referer: `${BASE}/`, "Content-Type": "application/x-www-form-urlencoded" },
            jar: true,
            saveJar: true,
          })
        )?.jwt;
      }
      const t0 = Date.now();
      const r = curl({
        method: opts.method || "GET",
        url: `${BASE}${path}`,
        headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, Accept: "application/json", ...(opts.headers || {}) },
        json: opts.json,
      });
      const ms = Date.now() - t0;
      if (isAuthFailureStatus(r.s)) { tok = null; continue; }
      return { status: r.s, json: J(r), ms, raw: r.b };
    }
    return { status: 401, json: null, ms: 0, raw: "" };
  };
  return { userId, signInUrl: `${BASE}/sign-in?__clerk_ticket=${ticket}`, app, cleanup: () => backend("DELETE", `/users/${userId}`) };
}

function freshAsOf(json, maxSec = 300) {
  const asOf = json?.as_of || json?.asOf || json?.updated_at || json?.updatedAt;
  if (!asOf) return { fresh: null, ageSec: null };
  const ageSec = (Date.now() - new Date(asOf).getTime()) / 1000;
  return { fresh: ageSec <= maxSec, ageSec: Math.round(ageSec) };
}

async function auditApis(app) {
  for (const path of [...MARKET_APIS, ...GRID_APIS]) {
    let r = app(path);
    // Cold SPX matrix builds can exceed Cloudflare's ~100s origin timeout; one warm retry.
    if ((r.status === 0 || r.status === 524) && path.includes("gex-heatmap?ticker=SPX")) {
      await new Promise((res) => setTimeout(res, 3000));
      r = app(path);
    }
    const { fresh, ageSec } = freshAsOf(r.json, path.includes("earnings") ? 600 : 300);
    const entry = { path, status: r.status, ms: r.ms, fresh, ageSec };
    if (r.status !== 200) {
      const sev = r.status === 524 || r.status === 0 ? "P2" : "P1";
      report.issues.push({ severity: sev, id: `api-${path}`, detail: `HTTP ${r.status}` });
    } else if (fresh === false) report.issues.push({ severity: "P2", id: `stale-${path}`, detail: `as_of ${ageSec}s old` });
    report.apis.push(entry);
  }
  // Cross-tool GEX
  const desk = app("/api/market/spx/desk").json;
  const gex = app("/api/market/gex-positioning?ticker=SPX").json;
  const heat = app("/api/market/gex-heatmap?ticker=SPX").json;
  const dFlip = desk?.gamma_flip ?? desk?.gex?.gamma_flip;
  const gFlip = gex?.flip ?? gex?.gamma_flip;
  const hFlip = heat?.summary?.gamma_flip ?? heat?.summary?.flip ?? heat?.gamma_flip ?? heat?.flip;
  const spot = desk?.price ?? desk?.spot ?? gex?.spot ?? heat?.spot ?? heat?.summary?.spot ?? 0;
  const flipTol = Math.max(spot * 0.01, 1);
  if (dFlip && gFlip && Math.abs(dFlip - gFlip) > flipTol) {
    report.issues.push({ severity: "P1", id: "gex-flip-mismatch", detail: `desk=${dFlip} gex=${gFlip} (tol=${flipTol.toFixed(1)})` });
  }
  if (gFlip && hFlip && Math.abs(gFlip - hFlip) > flipTol) {
    report.issues.push({ severity: "P1", id: "gex-heatmap-flip-mismatch", detail: `gex=${gFlip} heatmap=${hFlip} (tol=${flipTol.toFixed(1)})` });
  }
  report.crossGex = { deskFlip: dFlip, gexFlip: gFlip, heatFlip: hFlip, deskSpot: desk?.price ?? desk?.spot };
}

async function testLargo(app) {
  const t0 = Date.now();
  // Terminal UI uses SSE (`?stream=1` + Accept: text/event-stream); non-streaming JSON can
  // exceed Cloudflare's ~100s origin timeout on multi-tool questions.
  const r = app("/api/market/largo/query?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    json: { question: "Summarize dark pool activity and options flow on NVDA today with dollar amounts." },
  });
  let answer = "";
  let tools = [];
  let statusLine = null;
  if (r.status === 200 && r.raw) {
    for (const line of r.raw.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        if (ev.type === "token" && ev.text) answer += ev.text;
        if (ev.type === "tool_start" && ev.name) tools.push(ev.name);
        if (ev.type === "done") {
          answer = ev.answer || answer;
          tools = ev.tools_used || tools;
          statusLine = ev.status || ev.working_status || null;
        }
        if (ev.type === "error") statusLine = ev.message;
      } catch {}
    }
  }
  report.largo = {
    status: r.status,
    ms: Date.now() - t0,
    hasAnswer: Boolean(answer && String(answer).length > 50),
    tools: Array.isArray(tools) ? tools : [],
    statusLine,
    preview: String(answer).slice(0, 300),
  };
  if (r.status !== 200) report.issues.push({ severity: "P1", id: "largo-query", detail: `HTTP ${r.status}: ${JSON.stringify(r.json || r.raw?.slice(0, 200)).slice(0, 200)}` });
  else if (!report.largo.hasAnswer) report.issues.push({ severity: "P2", id: "largo-empty", detail: "No grounded answer body" });
}

async function browserSweep(signInUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();
  const consoleErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  // Sign in via ticket
  const signT0 = Date.now();
  await page.goto(signInUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForURL(/dashboard|terminal|upgrade/, { timeout: 60000 }).catch(() => {});
  const signMs = Date.now() - signT0;

  let prevPath = null;
  for (const { path, label, liveWaitMs } of PAGES) {
    const hardT0 = Date.now();
    const navType = prevPath ? "soft" : "hard";
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    const loadMs = Date.now() - hardT0;

    const textBefore = await page.locator("body").innerText().catch(() => "");
    const spotMatch = textBefore.match(/SPX[^\d]*([\d,]+\.?\d*)/i) || textBefore.match(/([\d,]+\.?\d{2})/);
    const spotBefore = spotMatch?.[1]?.replace(/,/g, "");

    await page.waitForTimeout(liveWaitMs);
    const textAfter = await page.locator("body").innerText().catch(() => "");
    const spotAfterMatch = textAfter.match(/SPX[^\d]*([\d,]+\.?\d*)/i);
    const spotAfter = spotAfterMatch?.[1]?.replace(/,/g, "");
    const liveTick = spotBefore && spotAfter ? spotBefore !== spotAfter : null;

    const missing = scanMissing(textAfter, label);
    report.missing.push(...missing);

    // Heatmap profile tab
    if (path === "/heatmap") {
      const profileTab = page.getByRole("tab", { name: /profile/i });
      if (await profileTab.count()) {
        const tabT0 = Date.now();
        await profileTab.click();
        await page.waitForTimeout(2000);
        const profileText = await page.locator("body").innerText().catch(() => "");
        report.missing.push(...scanMissing(profileText, "heatmap-profile"));
        report.pages.push({ label: "heatmap-profile", navType: "tab", loadMs: Date.now() - tabT0, consoleErrors: [] });
      }
    }

    report.pages.push({
      label,
      path,
      navType,
      loadMs,
      liveWaitMs,
      liveTick,
      consoleErrors: consoleErrors.splice(0),
      missingCount: missing.reduce((a, m) => a + m.count, 0),
      signInMs: navType === "hard" ? signMs : undefined,
    });
    prevPath = path;
  }

  await browser.close();
}

async function main() {
  console.log(`\n=== RTH Comprehensive Sweep ===\nTarget: ${BASE}\nTime: ${report.ts}\n`);
  const { signInUrl, app, cleanup } = await authSession();
  try {
    await auditApis(app);
    await testLargo(app);
    await browserSweep(signInUrl);

    const p0p1 = report.issues.filter((i) => i.severity === "P0" || i.severity === "P1");
    const outFile = join(OUT, `rth-sweep-${report.ts.replace(/[:.]/g, "-")}.json`);
    writeFileSync(outFile, JSON.stringify(report, null, 2));

    console.log("\n--- API latency (sample) ---");
    for (const a of report.apis.slice(0, 12)) {
      console.log(`  ${a.path} → ${a.status} ${a.ms}ms fresh=${a.fresh}`);
    }
    console.log("\n--- Browser pages ---");
    for (const p of report.pages) {
      console.log(`  ${p.label}: ${p.navType} ${p.loadMs}ms liveTick=${p.liveTick} missing=${p.missingCount} console=${p.consoleErrors?.length || 0}`);
    }
    console.log("\n--- Largo ---");
    console.log(`  status=${report.largo?.status} ms=${report.largo?.ms} answer=${report.largo?.hasAnswer}`);
    if (report.largo?.preview) console.log(`  preview: ${report.largo.preview.slice(0, 120)}…`);
    console.log("\n--- Missing-field signals ---");
    const grouped = {};
    for (const m of report.missing) {
      grouped[m.page] = (grouped[m.page] || 0) + m.count;
    }
    for (const [page, count] of Object.entries(grouped)) console.log(`  ${page}: ${count} placeholder hits`);
    console.log(`\n--- Issues: ${report.issues.length} (${p0p1.length} P0/P1) ---`);
    for (const i of report.issues) console.log(`  [${i.severity}] ${i.id}: ${i.detail}`);
    console.log(`\nReport: ${outFile}\n`);
    process.exit(p0p1.length ? 1 : 0);
  } finally {
    cleanup();
    rmSync(TMP, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
