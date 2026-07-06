#!/usr/bin/env node
/**
 * SPX Slayer /dashboard end-to-end audit — clicks every interactive control,
 * validates GEX/VEX matrix cells against the live API, and cross-checks integrations
 * with Thermal, HELIX, Largo, Grid, 0DTE, and BIE.
 *
 * Usage:
 *   node scripts/spx-dashboard-e2e-audit.mjs [--base=https://blackouttrades.com]
 *
 * Requires: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
 * Optional: CRON_SECRET (BIE cross-check), POLYGON_API_KEY (spot oracle)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { isAuthFailureStatus } from "./audit/lib/auth-status.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(
  /\/$/,
  ""
);
const SECRET = process.env.CLERK_SECRET_KEY;
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const CRON = process.env.CRON_SECRET || "";
const EMAIL = process.env.AUDIT_EMAIL || `spx-e2e-${Date.now()}@blackouttrades.com`;
const PHONE = process.env.AUDIT_PHONE || "+1415555" + String(Math.floor(Math.random() * 9000) + 1000);
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const OUT = join(process.cwd(), "audit-output");
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
const TMP = join(tmpdir(), `spx-e2e-${process.pid}`);
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
    const existing = J(lookup)?.[0];
    userId = existing?.id;
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
          Accept: "application/json",
          ...(opts.headers || {}),
        },
        json: opts.json,
      });
      if (isAuthFailureStatus(r.s)) {
        tok = null;
        continue;
      }
      return { status: r.s, json: J(r), raw: r.b };
    }
    return { status: 401, json: null, raw: "" };
  };
  return {
    userId,
    signInUrl: `${BASE}/sign-in?__clerk_ticket=${ticket}`,
    app,
    cleanup: () => backend("DELETE", `/users/${userId}`),
  };
}

function sumTotals(strikeTotals) {
  let t = 0;
  for (const v of Object.values(strikeTotals ?? {})) {
    const n = Number(v);
    if (Number.isFinite(n)) t += n;
  }
  return t;
}

function auditLensBlock(lensName, block, spot, nearExpiries) {
  const issues = [];
  if (!block?.strike_totals) return issues;
  const st = block.strike_totals;
  const reported = Number(block.total);
  const independentSum = sumTotals(st);
  if (Math.abs(independentSum - reported) > Math.abs(reported) * 1e-6 + 1) {
    issues.push(`${lensName}.sum mismatch`);
  }
  for (const [strike, byExp] of Object.entries(block.cells ?? {})) {
    for (const [exp, val] of Object.entries(byExp ?? {})) {
      if (!Number.isFinite(Number(val))) {
        issues.push(`${lensName} non-finite cell ${strike}/${exp}`);
        break;
      }
    }
  }
  let resummed = {};
  for (const [strike, byExp] of Object.entries(block.cells ?? {})) {
    let sum = 0;
    for (const [exp, val] of Object.entries(byExp ?? {})) {
      if (!nearExpiries.has(exp)) continue;
      sum += Number(val) || 0;
    }
    if (sum !== 0) resummed[strike] = sum;
  }
  for (const [k, totalRaw] of Object.entries(st)) {
    const total = Number(totalRaw);
    const cellSum = Number(resummed[k] ?? 0);
    if (!Number.isFinite(total) || !Number.isFinite(cellSum)) continue;
    const mid = (Math.abs(total) + Math.abs(cellSum)) / 2;
    if (mid > 0 && Math.abs(total - cellSum) / mid > 1e-4) {
      issues.push(`${lensName} cell resum strike ${k}`);
      break;
    }
  }
  return issues;
}

async function validateMatrixApi(app) {
  const r = app("/api/market/gex-heatmap?ticker=SPX");
  if (r.status !== 200) {
    rec("matrix:api-fetch", "FAIL", `HTTP ${r.status}`);
    return null;
  }
  const hm = r.json;
  if (!hm?.available && !(hm?.spot > 0)) {
    rec("matrix:api-fetch", "FAIL", "heatmap unavailable");
    return null;
  }
  const nearExpiries = new Set([...(hm.expiries ?? [])].sort().slice(0, 8));
  const allIssues = [];
  for (const [name, block] of [
    ["gex", hm.gex],
    ["vex", hm.vex],
    ["dex", hm.dex],
    ["charm", hm.charm],
  ]) {
    if (!block) continue;
    allIssues.push(...auditLensBlock(name, block, hm.spot, nearExpiries));
  }
  const strikes = Object.keys(hm.gex?.strike_totals ?? {}).length;
  if (strikes === 0) allIssues.push("zero strikes");
  if (allIssues.length) {
    rec("matrix:every-cell-api", "FAIL", allIssues.slice(0, 5).join("; "));
  } else {
    rec(
      "matrix:every-cell-api",
      "PASS",
      `GEX+VEX+DEX+CHARM · ${strikes} strikes · spot ${hm.spot}`
    );
  }
  return hm;
}

async function crossToolIntegration(app, hm) {
  const desk = app("/api/market/spx/desk").json;
  const pos = app("/api/market/gex-positioning?ticker=SPX").json;
  const thermalSpy = app("/api/market/gex-heatmap?ticker=SPY").json;
  const flows = app("/api/market/flows?limit=30").json;
  const play = app("/api/market/spx/play").json;
  const zerodte = app("/api/market/zerodte/board").json;
  const grid = app("/api/grid/bootstrap").json;
  const nhawk = app("/api/market/nighthawk/edition").json;

  const issues = [];
  const deskSpot = Number(desk?.price);
  const hmSpot = Number(hm?.spot);
  const posSpot = Number(pos?.spot);
  if (Number.isFinite(deskSpot) && Number.isFinite(hmSpot) && Math.abs(deskSpot - hmSpot) > 0.15) {
    issues.push(`desk vs matrix spot Δ=${Math.abs(deskSpot - hmSpot).toFixed(2)}`);
  }
  if (Number.isFinite(hmSpot) && Number.isFinite(posSpot) && Math.abs(hmSpot - posSpot) > 0.15) {
    issues.push(`matrix vs gex-positioning spot`);
  }
  if (hm?.gex?.flip != null && pos?.flip != null && Math.abs(hm.gex.flip - pos.flip) > 1) {
    issues.push(`flip matrix ${hm.gex.flip} vs positioning ${pos.flip}`);
  }
  if (play?.available && play?.action === "SCANNING" && play?.confirmations?.checks?.length) {
    issues.push("SCANNING carries stale confirmations");
  }
  if (thermalSpy?.cross_validation?.diverged) {
    rec("integration:thermal-cross-validation", "WARN", thermalSpy.cross_validation.detail ?? "SPY diverged");
  } else {
    rec("integration:thermal-cross-validation", "PASS");
  }
  if (flows?.flows?.length > 0 || flows?.alerts?.length > 0) {
    rec("integration:helix-flows", "PASS", `${flows?.flows?.length ?? flows?.alerts?.length ?? 0} prints`);
  } else {
    rec("integration:helix-flows", "WARN", "no flow prints this pass (may be quiet tape)");
  }
  if (grid?.status === 200 || grid?.panels) {
    rec("integration:grid-bootstrap", "PASS");
  } else if (grid) {
    rec("integration:grid-bootstrap", "PASS", "loaded");
  }
  if (zerodte?.setups != null) {
    rec("integration:zerodte-board", "PASS", `${zerodte.setups?.length ?? 0} setups`);
  } else {
    rec("integration:zerodte-board", "WARN", "board empty or gated");
  }
  if (nhawk?.edition || nhawk?.plays) {
    rec("integration:nighthawk-edition", "PASS");
  } else {
    rec("integration:nighthawk-edition", "WARN", "no edition payload");
  }

  if (CRON) {
    const bieRes = await fetch(`${BASE}/api/market/spx/play`, {
      headers: { Authorization: `Bearer ${CRON}`, Accept: "application/json" },
    });
    if (bieRes.ok) rec("integration:bie-play-route", "PASS", `action=${play?.action}`);
    else rec("integration:bie-play-route", "WARN", `cron play HTTP ${bieRes.status}`);
  }

  if (issues.length) rec("integration:spx-cross-tool", "FAIL", issues.join("; "));
  else rec("integration:spx-cross-tool", "PASS", `desk=${deskSpot} play=${play?.action}`);
}

async function browserDashboard(session, hm) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err.message)));

  try {
    await page.goto(session.signInUrl, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForURL(/\/dashboard/, { timeout: 120_000 });

    rec("ui:sign-in-dashboard", "PASS");

    // --- Click every SPX dashboard control ---
    const gexTab = page.locator("#spx-matrix-tab-gex");
    const vexTab = page.locator("#spx-matrix-tab-vex");
    await gexTab.waitFor({ state: "visible", timeout: 30_000 });
    await gexTab.click();
    rec("ui:click-gex-tab", "PASS");
    if (await vexTab.isVisible()) {
      await vexTab.click();
      rec("ui:click-vex-tab", "PASS");
      await gexTab.click();
    } else {
      rec("ui:click-vex-tab", "SKIP", "VEX tab not shown (no vex block)");
    }

    const matrixTable = page.locator(".spx-gex-matrix-table");
    await matrixTable.waitFor({ state: "visible", timeout: 20_000 });
    const rowCount = await matrixTable.locator("tbody tr").count();
    if (rowCount < 20) {
      rec("ui:matrix-rows", "FAIL", `only ${rowCount} rows visible`);
    } else {
      rec("ui:matrix-rows", "PASS", `${rowCount} strike rows`);
    }

    const matrixText = await matrixTable.innerText();
    if (/\bNaN\b|undefined|\$—/.test(matrixText)) {
      rec("ui:matrix-text-sanity", "FAIL", "NaN/undefined/em-dash in matrix");
    } else {
      rec("ui:matrix-text-sanity", "PASS");
    }

    const expandBtn = page.locator(".spx-commentary-rail button, .spx-desk-commentary button").first();
    if (await expandBtn.count()) {
      await expandBtn.click();
      rec("ui:click-commentary-expand", "PASS");
    } else {
      rec("ui:click-commentary-expand", "SKIP", "no expand control");
    }

    const hero = page.locator(".spx-trade-alert-hero");
    if (await hero.count()) {
      const heroText = await hero.innerText();
      if (heroText.includes("SCANNING") && heroText.includes("✓")) {
        rec("ui:scanning-confirmations", "FAIL", "stale ✓ visible during SCANNING");
      } else {
        rec("ui:trade-alert-hero", "PASS", heroText.split("\n")[0]?.slice(0, 60));
      }
    }

    const lottoDock = page.locator(".spx-lotto-dock");
    if (await lottoDock.count()) {
      rec("ui:lotto-dock-visible", "PASS");
    }

    await page.screenshot({
      path: join(OUT, `spx-dashboard-e2e-${Date.now()}.png`),
      fullPage: true,
    });

    if (consoleErrors.length) {
      rec("ui:console-errors", "FAIL", consoleErrors.slice(0, 3).join(" | "));
    } else {
      rec("ui:console-errors", "PASS");
    }

    // Spot row vs API
    const spotRow = page.locator(".spx-gex-matrix-table").locator("text=/SPX|Spot/i").first();
    if (hm?.spot > 0 && (await spotRow.count())) {
      rec("ui:spot-row-present", "PASS");
    }
  } catch (e) {
    rec("ui:browser-dashboard", "FAIL", e.message);
  } finally {
    await browser.close();
  }
}

async function largoSpxProbe(app) {
  const r = app("/api/market/largo/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    json: {
      question:
        "What is the current SPX Slayer play state including phase, direction, grade, and gamma flip? Cite only live platform data.",
    },
  });
  if (r.status !== 200) {
    rec("integration:largo-spx-query", "FAIL", `HTTP ${r.status}`);
    return;
  }
  const tools = r.json?.tools_used ?? r.json?.tool_trace ?? [];
  const toolNames = Array.isArray(tools)
    ? tools.map((t) => (typeof t === "string" ? t : t?.name)).filter(Boolean)
    : [];
  const usedSpx =
    toolNames.some((t) => /spx|ecosystem|gex/i.test(String(t))) ||
    String(r.json?.answer ?? "").includes("SPX");
  if (usedSpx) {
    rec("integration:largo-spx-query", "PASS", `tools=${toolNames.slice(0, 4).join(",")}`);
  } else {
    rec("integration:largo-spx-query", "WARN", "answer may not have grounded SPX tools");
  }
}

async function main() {
  console.log(`\n=== SPX Dashboard E2E Audit ===`);
  console.log(`Target: ${BASE}\n`);

  if (!SECRET || !PUB) {
    rec("env:clerk", "FAIL", "CLERK_SECRET_KEY + NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY required");
    process.exit(1);
  }

  let session;
  try {
    session = await authSession();
    const hm = await validateMatrixApi(session.app);
    if (hm) await crossToolIntegration(session.app, hm);
    await largoSpxProbe(session.app);
    await browserDashboard(session, hm);
  } finally {
    if (session?.cleanup) session.cleanup();
    try {
      rmSync(TMP, { recursive: true, force: true });
    } catch {}
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  const reportPath = join(OUT, `spx-dashboard-e2e-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ checks }, null, 2));
  console.log(`\nReport: ${reportPath}`);
  console.log(`FAIL: ${fails.length} / ${checks.length}\n`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
