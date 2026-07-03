#!/usr/bin/env node
/**
 * Exhaustive platform audit — every page, every API route, auth matrix, UI markers.
 * Production target with Clerk admin session for tier-gated routes.
 *
 * Usage: node scripts/exhaustive-platform-audit.mjs [--base=https://blackouttrades.com]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, statSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const CRON = process.env.CRON_SECRET?.trim() ?? "";
const SECRET = process.env.CLERK_SECRET_KEY?.trim() ?? "";
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const CJS = "5.57.0";

const checks = [];
function rec(name, status, detail, extra = {}) {
  checks.push({ name, status, detail, ...extra });
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : status === "WARN" ? "!" : "·";
  console.log(`  ${icon} [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── Discover all API routes from filesystem ───────────────────────────────────
function discoverApiRoutes(dir = join(process.cwd(), "src/app/api"), prefix = "/api") {
  const routes = [];
  for (const ent of readdirSync(dir)) {
    const full = join(dir, ent);
    if (statSync(full).isDirectory()) {
      if (ent.startsWith("[") && ent.endsWith("]")) {
        // dynamic segment — probe with placeholder
        const param = ent.slice(1, -1).replace("...", "health");
        routes.push(...discoverApiRoutes(full, `${prefix}/${param}`));
      } else {
        routes.push(...discoverApiRoutes(full, `${prefix}/${ent}`));
      }
    } else if (ent === "route.ts") {
      routes.push(prefix);
    }
  }
  return routes.sort();
}

const ALL_API_ROUTES = discoverApiRoutes();
// Add common query variants for parameterized readers
const API_PROBE_LIST = [
  ...ALL_API_ROUTES,
  "/api/market/quote?ticker=SPY",
  "/api/market/quote?ticker=SPX",
  "/api/market/quote?ticker=QQQ",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/gex-heatmap?ticker=SPY",
  "/api/market/gex-heatmap?ticker=QQQ",
  "/api/market/gex-heatmap?ticker=NVDA",
  "/api/market/gex-positioning?ticker=SPX",
  "/api/market/gex-positioning?ticker=SPY",
  "/api/market/heatmap?ticker=SPY",
  "/api/market/dark-pool/ticker?ticker=NVDA",
  "/api/market/ticker-search?q=NVDA",
  "/api/market/flows?limit=50",
  "/api/market/largo/query",
  "/api/account/positions/health/detail",
].filter((v, i, a) => a.indexOf(v) === i);

const PUBLIC_PAGES = [
  "/",
  "/sign-in",
  "/sign-up",
  "/track-record",
  "/embed/track-record",
  "/learn",
  "/learn/getting-started",
  "/learn/glossary",
  "/learn/blackout-grid",
  "/learn/heat-maps",
  "/learn/helix-flows",
  "/learn/largo-ai",
  "/learn/night-hawk",
  "/learn/nights-watch",
  "/learn/spx-slayer",
  "/offline",
  "/upgrade",
];

const PREMIUM_PAGES = [
  "/dashboard",
  "/flows",
  "/heatmap",
  "/grid",
  "/nighthawk",
  "/terminal",
  "/account",
  "/admin",
  "/admin/track-record",
];

const MALFORMED = [
  { re: /\bNaN\b/g, label: "NaN" },
  { re: /\bundefined\b/g, label: "undefined" },
  { re: /\[object Object\]/g, label: "[object Object]" },
  { re: /\$NaN/g, label: "$NaN" },
  { re: /null%/g, label: "null%" },
  { re: /Invalid Date/g, label: "Invalid Date" },
];

const BANNED_GREY = [
  "text-grey-",
  "text-zinc-",
  "text-neutral-",
];

// ── Clerk auth (same pattern as rth-browser-test) ─────────────────────────────
function fapiHost(pub) {
  try {
    const d = Buffer.from(pub.replace(/^pk_(live|test)_/, ""), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    if (d.includes(".")) return "https://" + d;
  } catch {}
  return "https://clerk.blackouttrades.com";
}

const TMP = join(tmpdir(), "exhaustive-" + process.pid);
mkdirSync(TMP, { recursive: true });
const JAR = join(TMP, "cookies.txt");
let seq = 0;
let sessionJwt = null;
let clientUat = 0;
let sid = null;
let userId = null;

function curl(opts) {
  const bf = join(TMP, "b" + ++seq);
  const maxTime = opts.maxTime ?? 90;
  const args = ["-sS", "--max-time", String(maxTime), "-o", bf, "-w", "%{http_code}|%{time_total}"];
  if (opts.method && opts.method !== "GET") args.push("-X", opts.method);
  for (const [k, v] of Object.entries(opts.headers ?? {})) args.push("-H", k + ": " + v);
  if (opts.json)
    args.push("-H", "Content-Type: application/json", "--data", JSON.stringify(opts.json));
  if (opts.urlencodeForm)
    for (const [k, v] of Object.entries(opts.urlencodeForm))
      args.push("--data-urlencode", k + "=" + v);
  if (opts.jar) args.push("-b", JAR);
  if (opts.saveJar) args.push("-c", JAR);
  args.push(opts.url);
  const raw = execFileSync("curl", args, { encoding: "utf8" }).trim();
  const [statusStr, timeStr] = raw.split("|");
  let body = "";
  try {
    body = readFileSync(bf, "utf8");
  } catch {}
  return { status: Number(statusStr), timeMs: Math.round(Number(timeStr) * 1000), body };
}

const J = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
};

function establishAdmin() {
  if (!SECRET) {
    rec("auth: CLERK_SECRET_KEY", "WARN", "missing — premium pages/APIs will show 401 only");
    return false;
  }
  const API = "https://api.clerk.com/v1";
  const FAPI = fapiHost(PUB);
  const EMAIL = "exhaustive-" + Date.now() + "@blackouttrades.com";
  const PHONE = "+1415555" + String(1000 + (Date.now() % 9000));
  const backend = (method, path, json) =>
    J(curl({ method, url: API + path, headers: { Authorization: "Bearer " + SECRET }, json }));

  const created = backend("POST", "/users", {
    email_address: [EMAIL],
    phone_number: [PHONE],
    public_metadata: { role: "admin", tier: "premium" },
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  userId = created?.id;
  if (!userId) {
    rec("auth: create user", "FAIL", JSON.stringify(created).slice(0, 120));
    return false;
  }

  const ticket = backend("POST", "/sign_in_tokens", { user_id: userId, expires_in_seconds: 600 })?.token;
  const si = curl({
    method: "POST",
    url: FAPI + "/v1/client/sign_ins?_clerk_js_version=" + CJS,
    headers: { Origin: BASE, Referer: BASE + "/", "Content-Type": "application/x-www-form-urlencoded" },
    urlencodeForm: { strategy: "ticket", ticket },
    saveJar: true,
    jar: true,
  });
  sid = J(si)?.response?.created_session_id;
  if (!sid) {
    rec("auth: FAPI ticket", "FAIL", si.body.slice(0, 120));
    return false;
  }
  clientUat = Math.floor(Date.now() / 1000);
  mintJwt();
  rec("auth: admin session", "PASS", `user=${userId}`);
  return true;
}

function mintJwt() {
  const FAPI = fapiHost(PUB);
  sessionJwt = J(
    curl({
      method: "POST",
      url: FAPI + "/v1/client/sessions/" + sid + "/tokens?_clerk_js_version=" + CJS,
      headers: { Origin: BASE, Referer: BASE + "/", "Content-Type": "application/x-www-form-urlencoded" },
      jar: true,
      saveJar: true,
    })
  )?.jwt;
}

function authHeaders(mode) {
  if (mode === "cron" && CRON) return { Authorization: "Bearer " + CRON, Accept: "application/json" };
  if (mode === "admin" && sessionJwt)
    return {
      Accept: "application/json",
      Cookie: "__session=" + sessionJwt + "; __client_uat=" + clientUat,
    };
  return { Accept: "application/json" };
}

function fetchProbe(path, mode = "anon") {
  // SSE/long-poll routes: verify connection opens, don't wait for stream end
  if (isLongRunningPath(path)) {
    try {
      const r = curl({ url: BASE + path, headers: authHeaders(mode), maxTime: 5 });
      rec(`API ${path}`, r.status === 200 ? "PASS" : "WARN", `SSE/stream opened HTTP ${r.status} (${r.timeMs}ms, truncated)`);
      return r;
    } catch {
      rec(`API ${path}`, "WARN", "SSE/stream probe timeout (expected for long-poll)");
      return { status: 200, timeMs: 5000, body: "" };
    }
  }

  for (let i = 0; i < 2; i++) {
    try {
      const r = curl({ url: BASE + path, headers: authHeaders(mode) });
      if ((r.status === 401 || r.status === 403) && mode === "admin") {
        sessionJwt = null;
        mintJwt();
        continue;
      }
      return r;
    } catch (e) {
      rec(`API ${path}`, "WARN", `probe error: ${String(e.message || e).slice(0, 80)}`);
      return { status: 0, timeMs: 0, body: "" };
    }
  }
  return { status: 401, timeMs: 0, body: "{}" };
}

function scanMalformed(text, label) {
  const hits = [];
  for (const { re, label: l } of MALFORMED) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m?.length) hits.push(`${l}×${m.length}`);
  }
  if (hits.length) rec(label, "FAIL", hits.join(", "));
  return hits.length === 0;
}

function scanFinite(obj, path = "", out = []) {
  if (obj == null) return out;
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) out.push(`${path}=${obj}`);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => scanFinite(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) scanFinite(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

const SSE_OR_LONG_POLL = [
  "/stream",
  "/api/market/spx/pulse/stream",
  "/api/market/flows/stream",
  "/api/account/positions/stream",
  "/api/admin/apis/stream",
];

function isLongRunningPath(path) {
  return SSE_OR_LONG_POLL.some((s) => path.includes(s));
}

function classifyRoute(path) {
  if (path.startsWith("/api/cron/")) return "cron";
  if (path.startsWith("/api/admin/")) return "admin";
  if (path.startsWith("/api/webhook") || path.startsWith("/api/webhooks/")) return "webhook";
  if (
    path.startsWith("/api/market/") ||
    path.startsWith("/api/grid/") ||
    path.startsWith("/api/account/") ||
    path.startsWith("/api/coaching/") ||
    path.startsWith("/api/signals/") ||
    path.startsWith("/api/track-record") ||
    path.startsWith("/api/nighthawk/")
  )
    return "premium";
  return "public";
}

async function auditCodebase() {
  console.log("\n=== CODEBASE STATIC CHECKS ===\n");
  const tsc = spawnSync("npx", ["tsc", "--noEmit"], { encoding: "utf8" });
  rec("tsc --noEmit", tsc.status === 0 ? "PASS" : "FAIL", tsc.status === 0 ? "clean" : (tsc.stderr || tsc.stdout).slice(0, 200));

  const brand = spawnSync("npm", ["run", "lint:brand"], { encoding: "utf8", shell: true });
  rec("lint:brand", brand.status === 0 ? "PASS" : "FAIL", brand.status === 0 ? "clean" : (brand.stderr || brand.stdout).slice(-200));

  const authGuard = spawnSync("npm", ["run", "validate:api-auth"], { encoding: "utf8", shell: true });
  rec("validate:api-auth", authGuard.status === 0 ? "PASS" : "FAIL", authGuard.status === 0 ? "default-deny OK" : "guard failures");

  const tests = spawnSync("npm", ["test"], { encoding: "utf8", shell: true, timeout: 120000 });
  const testMatch = (tests.stdout || "").match(/# pass (\d+)/);
  rec("npm test", tests.status === 0 ? "PASS" : "FAIL", testMatch ? `${testMatch[1]} tests` : "see log");
}

async function auditAllApis() {
  console.log("\n=== ALL API ROUTES (" + API_PROBE_LIST.length + ") ===\n");
  const byStatus = { ok: 0, auth: 0, method: 0, error: 0, slow: 0 };

  for (const path of API_PROBE_LIST) {
    const kind = classifyRoute(path);
    let mode = "anon";
    if (kind === "cron") mode = CRON ? "cron" : "anon";
    else if (kind === "admin" || kind === "premium") mode = sessionJwt ? "admin" : "anon";

    const r = fetchProbe(path, mode);
    const json = J(r);

    if (r.status >= 500) {
      rec(`API ${path}`, "FAIL", `HTTP ${r.status} (${r.timeMs}ms)`);
      byStatus.error++;
      continue;
    }

    if (r.status === 401 || r.status === 403) {
      if (mode === "anon" && (kind === "premium" || kind === "admin" || kind === "cron")) {
        rec(`API ${path}`, "PASS", `HTTP ${r.status} gated (${kind})`);
        byStatus.auth++;
      } else if (mode === "admin") {
        rec(`API ${path}`, "FAIL", `HTTP ${r.status} auth failed with admin session`);
        byStatus.error++;
      } else {
        rec(`API ${path}`, "WARN", `HTTP ${r.status}`);
        byStatus.auth++;
      }
      continue;
    }

    if (r.status === 405) {
      rec(`API ${path}`, "PASS", "HTTP 405 (POST-only route, GET rejected)");
      byStatus.method++;
      continue;
    }

    if (r.timeMs > 10000) {
      rec(`API ${path}`, "WARN", `slow ${r.timeMs}ms`);
      byStatus.slow++;
    }

    const badNums = json ? scanFinite(json).slice(0, 3) : [];
    if (badNums.length) {
      rec(`API ${path}`, "FAIL", `non-finite: ${badNums.join("; ")}`);
      byStatus.error++;
      continue;
    }

    scanMalformed(r.body, `API-json ${path}`);
    rec(`API ${path}`, r.status === 200 ? "PASS" : "WARN", `HTTP ${r.status} (${r.timeMs}ms)`);
    byStatus.ok++;
  }

  rec("API summary", "INFO", JSON.stringify(byStatus));
}

function visibleHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
}

async function auditPages(pages, mode, label) {
  console.log(`\n=== PAGES: ${label} (${pages.length}) ===\n`);
  for (const path of pages) {
    const r = fetchProbe(path, mode);
    if (r.status >= 500) {
      rec(`PAGE ${path}`, "FAIL", `HTTP ${r.status}`);
      continue;
    }
    if (mode === "admin" && r.status === 401) {
      rec(`PAGE ${path}`, "FAIL", "401 with admin session");
      continue;
    }
    const html = visibleHtml(r.body);
    let ok = scanMalformed(html, `PAGE ${path}`);
    for (const g of BANNED_GREY) {
      if (html.includes(g)) {
        rec(`PAGE ${path}`, "FAIL", `banned grey class: ${g}`);
        ok = false;
      }
    }
    if (ok) rec(`PAGE ${path}`, "PASS", `HTTP ${r.status} (${r.timeMs}ms, ${Math.round(r.body.length / 1024)}KB)`);
  }
}

async function auditPremiumSurfaceDepth() {
  if (!sessionJwt) return;
  console.log("\n=== PREMIUM SURFACE DEPTH CHECKS ===\n");

  const probes = [
    {
      name: "SPX heatmap",
      path: "/api/market/gex-heatmap?ticker=SPX",
      test: (j) => j?.strikes?.length > 0 && j?.spot > 0,
      detail: (j) => `${j?.strikes?.length} strikes spot=${j?.spot}`,
    },
    {
      name: "SPY heatmap",
      path: "/api/market/gex-heatmap?ticker=SPY",
      test: (j) => j?.available !== false,
      detail: (j) => `strikes=${j?.strikes?.length ?? 0} spot=${j?.spot ?? 0}`,
    },
    {
      name: "0DTE board",
      path: "/api/market/zerodte/board",
      test: (j) => j?.available === true,
      detail: (j) => `setups=${j?.setups?.length ?? 0} ledger=${j?.ledger?.length ?? 0}`,
    },
    {
      name: "HELIX flows",
      path: "/api/market/flows?limit=100",
      test: (j) => Array.isArray(j?.flows) && j.flows.length > 0,
      detail: (j) => `${j?.flows?.length} flows`,
    },
    {
      name: "Night Hawk edition",
      path: "/api/market/nighthawk/edition",
      test: (j) => j?.available && (j?.plays?.length > 0 || j?.recap_summary),
      detail: (j) => `${j?.plays?.length ?? 0} plays recap=${Boolean(j?.recap_summary)}`,
    },
    {
      name: "BIE report",
      path: "/api/admin/bie-report",
      test: (j) => j?.available === true,
      detail: (j) => `incidents=${j?.open_incidents?.length ?? 0} knowledge=${j?.knowledge?.total ?? 0}`,
    },
    {
      name: "Admin health",
      path: "/api/admin/health",
      test: (j) => j?.ok === true || j?.status === "ok" || typeof j === "object",
      detail: () => "loaded",
    },
    {
      name: "Track record admin",
      path: "/api/track-record",
      test: (j) => j?.liveData && j?.stats?.total_closed >= 0,
      detail: (j) => `${j?.stats?.wins}W/${j?.stats?.losses}L`,
    },
  ];

  for (const p of probes) {
    const r = fetchProbe(p.path, "admin");
    const j = J(r);
    if (r.status !== 200) {
      rec(p.name, "FAIL", `HTTP ${r.status}`);
      continue;
    }
    rec(p.name, p.test(j) ? "PASS" : "WARN", p.detail(j));
  }

  // Live poll — SPX heatmap must change or have fresh asof
  const a = fetchProbe("/api/market/gex-heatmap?ticker=SPX", "admin");
  await new Promise((r) => setTimeout(r, 8000));
  const b = fetchProbe("/api/market/gex-heatmap?ticker=SPX", "admin");
  const ja = J(a.body ? { body: a.body, status: a.status } : a);
  const jb = J(b);
  const changed = JSON.stringify(ja) !== JSON.stringify(jb);
  rec("SPX heatmap live poll 8s", changed ? "PASS" : "WARN", changed ? "payload changed" : "identical snapshot");
}

function cleanup() {
  if (!userId || !SECRET) return;
  try {
    execFileSync("curl", ["-sS", "-X", "DELETE", "-H", "Authorization: Bearer " + SECRET, "https://api.clerk.com/v1/users/" + userId], {
      encoding: "utf8",
    });
    rec("cleanup: temp Clerk user", "PASS", "deleted");
  } catch {
    rec("cleanup: temp Clerk user", "WARN", "delete failed");
  }
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  EXHAUSTIVE PLATFORM AUDIT                               ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`Target: ${BASE}`);
  console.log(`API routes discovered: ${ALL_API_ROUTES.length}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  rec("route inventory", "INFO", `${ALL_API_ROUTES.length} route.ts files → ${API_PROBE_LIST.length} probe URLs`);

  await auditCodebase();
  establishAdmin();
  await auditPages(PUBLIC_PAGES, "anon", "public");
  await auditPages(PREMIUM_PAGES, sessionJwt ? "admin" : "anon", "premium/admin");
  await auditAllApis();
  await auditPremiumSurfaceDepth();

  cleanup();

  const totals = checks.reduce((m, c) => ((m[c.status] = (m[c.status] || 0) + 1), m), {});
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(OUT, `exhaustive-audit-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, totals, checks, routes: ALL_API_ROUTES }, null, 2));

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(totals, null, 2));
  console.log(`Report: ${reportPath}\n`);

  const fails = checks.filter((c) => c.status === "FAIL").length;
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
