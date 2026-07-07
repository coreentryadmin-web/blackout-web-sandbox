#!/usr/bin/env node
/**
 * 0DTE Command E2E audit (API + Playwright when available).
 *
 * Classic Grid (the /grid page + its /api/grid/* routes) was deleted 2026-07-07 — this script
 * used to audit BOTH classic Grid's APIs and 0DTE Command's API in one pass. It's kept (not
 * deleted) because the 0DTE Command checks are still live and useful; only the classic-Grid-
 * specific checks were removed. 0DTE Command now lives standalone on /nighthawk.
 *
 * Usage:
 *   node scripts/grid-zerodte-e2e-audit.mjs [--base=https://blackouttrades.com]
 *   npm run validate:grid-e2e
 *
 * Requires: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { isAuthFailureStatus } from "./audit/lib/auth-status.mjs";
import {
  mintIosPlaywrightSession,
  onboardingInitScript,
} from "./audit/lib/ios-playwright-auth.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(
  /\/$/,
  ""
);
const SECRET = process.env.CLERK_SECRET_KEY;
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const EMAIL = process.env.AUDIT_EMAIL || `zerodte-e2e-${Date.now()}@blackouttrades.com`;
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
const TMP = join(tmpdir(), `grid-e2e-${process.pid}`);
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

async function auditGridApis(app) {
  const zb = app("/api/market/zerodte/board");
  if (zb.status === 200 && zb.json?.available) {
    rec("e2e:zerodte-board-api", "PASS", `${zb.json.setups?.length ?? 0} setups · ledger ${zb.json.ledger?.length ?? 0}`);
  } else if (zb.status === 403) {
    rec("e2e:zerodte-board-api", "WARN", "403 — follows Night Hawk's launch gate (requireToolApi('nighthawk'))");
  } else {
    rec("e2e:zerodte-board-api", "FAIL", `HTTP ${zb.status}`);
  }

  // Classic Grid (the /grid page, its 17 components, its 9 /api/grid/* routes) was deleted
  // 2026-07-07 — see docs/audit/FINDINGS.md. 0DTE Command now lives standalone on /nighthawk;
  // its only API route (/api/market/zerodte/board, checked above) is unchanged.

  const flows = app("/api/market/flows?limit=20");
  const count = flows.json?.flows?.length ?? flows.json?.alerts?.length ?? 0;
  rec("e2e:helix-flows", count > 0 ? "PASS" : "WARN", `${count} prints`);
}

async function auditGridUi() {
  let browser;
  try {
    const pw = await mintIosPlaywrightSession({ appUrl: BASE });
    if (pw.skip) {
      rec("ui:playwright", "WARN", pw.reason);
      return;
    }

    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ userAgent: UA });
    await context.addInitScript(onboardingInitScript());
    await context.addCookies(pw.cookies);
    const page = await context.newPage();

    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));

    // /grid is gone — 0DTE Command absorbed into /nighthawk (see FINDINGS.md). This UI check is
    // intentionally minimal (page loads, no console errors) rather than clicking tabs/search that
    // belonged to the deleted classic-Grid UI — NightHawkFeed's own structure is out of scope here.
    await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 60_000 }).catch(() => {});

    const title = await page.title();
    if (/Night ?Hawk|0DTE|BlackOut/i.test(title)) {
      rec("ui:page-load", "PASS", title.slice(0, 60));
    } else {
      rec("ui:page-load", "WARN", title.slice(0, 60));
    }

    await page.waitForTimeout(3000);
    rec("ui:console-errors", errs.length === 0 ? "PASS" : "FAIL", errs.slice(0, 2).join("; "));
  } catch (e) {
    rec("ui:playwright", "WARN", e.message?.slice(0, 120) ?? "browser blocked");
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function main() {
  console.log("\n=== Grid / 0DTE E2E audit ===\n");
  if (!SECRET || !PUB) {
    rec("env:clerk", "FAIL", "CLERK keys required");
    process.exit(1);
  }
  rec("env:clerk", "PASS");

  let session;
  try {
    session = await authSession();
    await auditGridApis(session.app);
    await auditGridUi();
  } catch (e) {
    rec("e2e:auth", "FAIL", e.message);
  } finally {
    if (session?.cleanup) session.cleanup();
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  const reportPath = join(OUT, `grid-e2e-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ ts: new Date().toISOString(), checks }, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`  FAIL: ${fails.length} / ${checks.length}`);
  console.log(`  Report: ${reportPath}\n`);

  if (fails.length) {
    fails.forEach((f) => console.log(`  · ${f.name}: ${f.detail ?? ""}`));
    process.exit(1);
  }
  console.log("GREEN — Grid/0DTE E2E passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
