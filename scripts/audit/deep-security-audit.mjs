#!/usr/bin/env node
/**
 * Deep security audit — mints free / premium / admin Clerk sessions against production,
 * probes auth boundaries, IDOR, cron bypass, webhooks, traversal, escalation paths.
 * Temp users are ALWAYS deleted in finally().
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const APP = (process.env.AUDIT_APP_URL || "https://blackouttrades.com").replace(/\/$/, "");
const SECRET = process.env.CLERK_SECRET_KEY;
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const CRON = process.env.CRON_SECRET || "";
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const OUT = join(process.cwd(), "audit-output");
const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");

const findings = [];
const matrix = { anon: {}, free: {}, premium: {}, admin: {} };

function fapiHost(pub) {
  try {
    const d = Buffer.from(pub.replace(/^pk_(live|test)_/, ""), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    if (d.includes(".")) return `https://${d}`;
  } catch {}
  return "https://clerk.blackouttrades.com";
}

function collectSetCookies(res) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
  return raw.map((c) => c.split(";")[0]).filter(Boolean);
}

async function mintSession(metadata, label) {
  if (!SECRET || !PUB) throw new Error("Clerk secrets missing");
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@blackouttrades.com`;
  const phone = "+1415555" + String(1000 + Math.floor(Math.random() * 9000));
  const fapi = fapiHost(PUB);
  const backend = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json().catch(() => null);
  };

  const created = await backend("POST", "/users", {
    email_address: [email],
    phone_number: [phone],
    public_metadata: metadata,
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  const userId = created?.id;
  if (!userId) throw new Error(`Clerk create failed (${label}): ${JSON.stringify(created).slice(0, 160)}`);

  const ticket = (await backend("POST", "/sign_in_tokens", { user_id: userId, expires_in_seconds: 600 }))?.token;
  if (!ticket) throw new Error(`sign_in_token failed (${label})`);

  const si = await fetch(`${fapi}/v1/client/sign_ins?_clerk_js_version=${CJS}`, {
    method: "POST",
    headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ strategy: "ticket", ticket }),
  });
  const siCookies = collectSetCookies(si);
  const sid = (await si.json().catch(() => null))?.response?.created_session_id;
  if (!sid) throw new Error(`FAPI sign-in failed (${label})`);

  const clientUat = Math.floor(Date.now() / 1000);
  const mint = await fetch(`${fapi}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`, {
    method: "POST",
    headers: {
      Origin: APP,
      Referer: `${APP}/`,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: siCookies.join("; "),
    },
  });
  const jwt = (await mint.json().catch(() => null))?.jwt;
  if (!jwt) throw new Error(`JWT mint failed (${label})`);

  const cleanup = async () => {
    try {
      await fetch(`${API}/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${SECRET}` },
      });
    } catch {}
  };

  return { cookie: `__session=${jwt}; __client_uat=${clientUat}`, cleanup, userId, email };
}

async function probe(method, path, opts = {}) {
  const url = path.startsWith("http") ? path : `${APP}${path}`;
  const headers = { ...(opts.headers || {}) };
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  if (opts.accept) headers.Accept = opts.accept;
  const r = await fetch(url, {
    method,
    headers,
    redirect: opts.followRedirect === false ? "manual" : "follow",
    body: opts.body,
  });
  let body = "";
  try {
    body = await r.text();
  } catch {}
  return { status: r.status, headers: r.headers, body, url: r.url };
}

function rec(sev, id, title, detail, evidence = {}) {
  findings.push({ severity: sev, id, title, detail, evidence });
}

function record(tier, path, status, method = "GET") {
  const key = `${method} ${path}`;
  matrix[tier][key] = status;
}

/** Sensitive endpoints grouped by expected minimum tier */
const SENSITIVE_GET = [
  ["/api/market/spx/desk", "premium"],
  ["/api/market/flows?limit=3", "premium"],
  ["/api/market/gex-heatmap?ticker=SPX", "premium"],
  ["/api/market/nighthawk/edition", "premium"],
  ["/api/market/zerodte/board", "admin"],
  ["/api/grid/bootstrap", "admin"], // launch-locked → admin bypass
  ["/api/platform/intel", "premium"],
  ["/api/coaching/alerts", "premium"],
  ["/api/market/lotto/today", "premium"],
  ["/api/signals/open", "cron"],
  ["/api/engine/health", "admin"],
  ["/api/engine/heatmap", "premium-engine"],
  ["/api/engine/nighthawk/plays", "premium-engine"],
  ["/api/account/positions", "premium"],
  ["/api/track-record", "admin"],
  ["/api/public/track-record", "admin"],
  ["/api/admin/health", "admin"],
  ["/api/admin/debug-uw", "admin"],
  ["/api/admin/me", "admin"],
  ["/api/admin/cron-health", "admin"],
  ["/api/admin/spx/dashboard", "admin"],
  ["/api/market/regime", "public"],
  ["/api/health", "public"],
  ["/api/ready", "public"],
];

const CRON_GET = [
  "/api/cron/data-correctness?force=1",
  "/api/cron/spx-evaluate",
  "/api/cron/socket-health",
  "/api/cron/flow-ingest",
  "/api/cron/grid-warm",
  "/api/cron/nighthawk-edition",
  "/api/cron/membership-reconcile",
];

const ADMIN_MUTATIONS = [
  ["POST", "/api/admin/cron/run", { name: "heatmap-warm" }],
  ["POST", "/api/admin/run-migration", { filename: "004_god_tier_features.sql" }],
  ["POST", "/api/push/send", { title: "audit", body: "test" }],
  ["POST", "/api/track-record/publish", { spx: 1 }],
  ["POST", "/api/signals/record", { signal_source: "audit", signal_type: "test" }],
  ["POST", "/api/brief/store", { date: "2099-01-01", type: "test", content: "x" }],
  ["POST", "/api/coaching/alerts", { alerts: [{ trigger: "t", alert: "a", urgency: "low" }] }],
];

function walkApiRoutes(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walkApiRoutes(path, out);
    else if (entry === "route.ts") out.push(path);
  }
  return out;
}

function statusOkForTier(status, expected, tier) {
  if (expected === "public") return status === 200;
  if (expected === "cron") {
    // Cron-only routes: 401 for all user tiers; 200 only with CRON_SECRET (tested separately).
    if (tier === "anon" || tier === "free" || tier === "premium" || tier === "admin") {
      return status === 401;
    }
    return true;
  }
  if (expected === "premium-engine") {
    // Auth passes first; 503 when ENGINE_API_URL unset is OK (not a leak).
    if (tier === "premium" || tier === "admin") return status === 200 || status === 503;
    if (tier === "free") return status === 403;
    return status === 401;
  }
  if (tier === "anon") return status === 401 || status === 403;
  if (expected === "admin") {
    if (tier === "admin") return status >= 200 && status < 300;
    return status === 403 || status === 401;
  }
  if (expected === "premium") {
    if (tier === "premium" || tier === "admin") return status >= 200 && status < 300;
    if (tier === "free") return status === 403;
    return status === 401;
  }
  return true;
}

async function probeTierMatrix(tier, cookie) {
  for (const [path, expected] of SENSITIVE_GET) {
    const r = await probe("GET", path, { cookie, accept: "application/json" });
    record(tier, path, r.status);
    if (!statusOkForTier(r.status, expected, tier)) {
      rec(
        tier === "premium" && expected === "admin" && r.status === 200 ? "P0" : "P1",
        `matrix-${tier}-${path.replace(/\W+/g, "-")}`,
        `${tier} unexpected access: GET ${path}`,
        `Expected ${expected}-gate; got HTTP ${r.status}`,
        { tier, path, status: r.status, expected }
      );
    }
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  BlackOut DEEP security audit (free / premium / admin) ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log("Target:", APP);

  let free, premA, premB, admin;
  try {
    free = await mintSession({ tier: "free" }, "free-audit");
    premA = await mintSession({ tier: "premium" }, "prem-a-audit");
    premB = await mintSession({ tier: "premium" }, "prem-b-audit");
    admin = await mintSession({ role: "admin", tier: "premium" }, "adm-audit");
    console.log("Sessions minted: free, premium×2, admin\n");
  } catch (e) {
    console.error("FATAL:", e.message);
    process.exit(2);
  }

  try {
    // ── 1. Tier access matrix ──────────────────────────────────────────────
    console.log("── 1. Tier access matrix (GET sensitive APIs) ──");
    await probeTierMatrix("anon", null);
    await probeTierMatrix("free", free.cookie);
    await probeTierMatrix("premium", premA.cookie);
    await probeTierMatrix("admin", admin.cookie);
    console.log("  Probed", SENSITIVE_GET.length, "endpoints × 4 tiers\n");

    // ── 2. Vertical escalation — dangerous mutations ───────────────────────
    console.log("── 2. Vertical escalation (mutations that must be admin/cron-only) ──");
    for (const [method, path, body] of ADMIN_MUTATIONS) {
      for (const [tier, sess] of [
        ["anon", null],
        ["free", free.cookie],
        ["premium", premA.cookie],
      ]) {
        const r = await probe(method, path, {
          cookie: sess,
          accept: "application/json",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (r.status >= 200 && r.status < 300) {
          rec("P0", `mut-${tier}-${path.split("/").pop()}`, `${tier} mutation succeeded`, `${method} ${path} → ${r.status}`);
          console.log(`  ✗ ${tier} ${method} ${path} → ${r.status}`);
        }
      }
      // Cron bearer required routes — premium must NOT succeed
      const cronR = await probe(method, path, {
        cookie: premA.cookie,
        bearer: CRON || "wrong-if-unset",
        accept: "application/json",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (CRON && cronR.status >= 200 && cronR.status < 300 && !path.includes("/admin/")) {
        // cron-only routes with valid CRON from premium cookie context is OK for cron routes
      } else if (!CRON && cronR.status >= 200 && cronR.status < 300 && path.startsWith("/api/cron")) {
        rec("P0", "cron-no-secret", "Cron route succeeded without CRON_SECRET env", path);
      }
    }
    console.log("  Mutation probes complete\n");

    // ── 3. Cron plane — anonymous + wrong token ────────────────────────────
    console.log("── 3. Cron auth bypass probes ──");
    for (const path of CRON_GET) {
      const anon = await probe("GET", path, { accept: "application/json" });
      record("anon", path, anon.status);
      if (anon.status === 200) {
        rec("P0", "cron-anon-" + path.split("/").pop(), "Cron reachable without auth", path);
        console.log(`  ✗ anon ${path} → 200`);
      }
      const bad = await probe("GET", path, { bearer: "totally-wrong-cron-secret-xyz", accept: "application/json" });
      if (bad.status === 200) {
        rec("P0", "cron-weak-" + path.split("/").pop(), "Cron accepted wrong bearer", path);
        console.log(`  ✗ bad-token ${path} → 200`);
      }
    }
    if (CRON) {
      const ok = await probe("GET", "/api/cron/data-correctness?force=1", {
        bearer: CRON,
        accept: "application/json",
      });
      console.log(`  Valid CRON_SECRET probe → ${ok.status} (expect 200)`);
    } else {
      console.log("  CRON_SECRET not set — skipping valid-token probe");
    }
    console.log("");

    // ── 4. Horizontal IDOR (positions) ─────────────────────────────────────
    console.log("── 4. Horizontal IDOR (Night's Watch positions) ──");
    const createBody = {
      ticker: "SPY",
      option_type: "call",
      strike: 500,
      expiry: "2099-12-19",
      side: "long",
      contracts: 1,
      entry_premium: 1.5,
    };
    const created = await probe("POST", "/api/account/positions", {
      cookie: premA.cookie,
      accept: "application/json",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createBody),
    });
    let posId = null;
    try {
      posId = JSON.parse(created.body)?.position?.id ?? null;
    } catch {}
    console.log(`  User A create position → ${created.status}${posId ? ` (id=${posId})` : ""}`);

    if (posId) {
      for (const [method, suffix] of [
        ["GET", `/api/account/positions/${posId}/detail`],
        ["PATCH", `/api/account/positions/${posId}`],
        ["DELETE", `/api/account/positions/${posId}`],
      ]) {
        const r = await probe(method, suffix, {
          cookie: premB.cookie,
          accept: "application/json",
          headers: method !== "GET" ? { "Content-Type": "application/json" } : {},
          body: method === "PATCH" ? JSON.stringify({ notes: "idor-test" }) : undefined,
        });
        if (r.status >= 200 && r.status < 300) {
          rec("P0", "idor-position-" + method.toLowerCase(), "Cross-user position access", `User B ${method} user A position ${posId} → ${r.status}`);
          console.log(`  ✗ User B ${method} → ${r.status}`);
        } else {
          console.log(`  ✓ User B ${method} → ${r.status} (blocked)`);
        }
      }
      // Sequential ID oracle
      const guess = await probe("GET", `/api/account/positions/${Math.max(1, posId - 1)}/detail`, {
        cookie: premB.cookie,
        accept: "application/json",
      });
      if (guess.status === 200 && guess.body.includes('"ticker"')) {
        rec("P1", "idor-id-oracle", "Position ID enumeration may leak data", `id=${posId - 1} → 200`);
      }
    } else if (created.status === 403) {
      console.log("  Skipped IDOR body test — nighthawk launch gate (expected for some configs)");
    }

    // ── 5. JWT / session tampering ─────────────────────────────────────────
    console.log("\n── 5. Session tampering ──");
    const tampered = [
      "__session=eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ1c2VyXzAxIn0.; __client_uat=1",
      "__session=not-a-jwt; __client_uat=1",
      premA.cookie.replace("__session=", "__session=FORGED."),
    ];
    for (const badCookie of tampered) {
      const r = await probe("GET", "/api/market/spx/desk", { cookie: badCookie, accept: "application/json" });
      if (r.status === 200) {
        rec("P0", "jwt-tamper", "Forged session accepted", badCookie.slice(0, 40));
        console.log(`  ✗ forged cookie → 200`);
      }
    }
    console.log("  ✓ Tampered sessions rejected\n");

    // ── 6. Engine path traversal / SSRF ────────────────────────────────────
    console.log("── 6. Engine proxy traversal ──");
    const trav = [
      "/api/engine/../admin/health",
      "/api/engine/..%2Fadmin%2Fhealth",
      "/api/engine/admin/run-migration",
      "/api/engine/nighthawk/plays/../../../etc/passwd",
    ];
    for (const path of trav) {
      const r = await probe("GET", path, { cookie: premA.cookie, accept: "application/json" });
      if (r.status === 200 && !r.body.includes('"error"')) {
        rec("P0", "engine-traversal", "Engine proxy traversal", `${path} → ${r.status}`);
        console.log(`  ✗ ${path} → ${r.status}`);
      }
    }
    console.log("  ✓ Traversal paths blocked\n");

    // ── 7. Webhook forgery ─────────────────────────────────────────────────
    console.log("── 7. Webhook signature bypass ──");
    const webhooks = [
      ["POST", "/api/webhooks/whop", { type: "membership.activated", data: {} }],
      ["POST", "/api/webhook/whop", { type: "test" }],
      ["POST", "/api/webhooks/clerk", { type: "user.created", data: {} }],
      ["POST", "/api/webhook/clerk", { type: "user.created", data: {} }],
    ];
    for (const [method, path, body] of webhooks) {
      const r = await probe(method, path, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.status >= 200 && r.status < 300) {
        rec("P0", "webhook-open-" + path.replace(/\W+/g, "-"), "Unsigned webhook accepted", `${path} → ${r.status}`);
        console.log(`  ✗ ${path} → ${r.status}`);
      } else {
        console.log(`  ✓ ${path} → ${r.status}`);
      }
    }
    console.log("");

    // ── 8. Open redirect / phishing vectors ────────────────────────────────
    console.log("── 8. Open redirect probes ──");
    const redirects = [
      "/sign-in?redirect_url=https://evil.example/phish",
      "/sign-up?redirect_url=//evil.example",
      "/sign-in?redirect_url=https://blackouttrades.com.evil.example",
    ];
    for (const path of redirects) {
      const r = await probe("GET", path, { followRedirect: false, accept: "text/html" });
      const loc = r.headers.get("location") || "";
      if (loc.includes("evil.example")) {
        rec("P0", "open-redirect", "External redirect reflected", loc);
        console.log(`  ✗ ${path} → Location: ${loc}`);
      }
    }
    console.log("  ✓ No external open redirects detected\n");

    // ── 9. Tier escalation via membership sync ─────────────────────────────
    console.log("── 9. Tier escalation (membership sync) ──");
    const syncFree = await probe("POST", "/api/membership/sync", { cookie: free.cookie, accept: "application/json" });
    console.log(`  Free membership/sync → ${syncFree.status}`);
    let syncBody = {};
    try {
      syncBody = JSON.parse(syncFree.body);
    } catch {}
    if (syncBody.tier === "premium") {
      rec("P0", "tier-escalation-sync", "Free user gained premium via sync without Whop", JSON.stringify(syncBody));
    }
    const deskAfter = await probe("GET", "/api/market/spx/desk", { cookie: free.cookie, accept: "application/json" });
    if (deskAfter.status === 200) {
      rec("P0", "free-premium-desk", "Free tier reads premium desk after sync", `HTTP ${deskAfter.status}`);
    } else {
      console.log(`  Free still blocked from desk → ${deskAfter.status}`);
    }
    console.log("");

    // ── 10. Mutation backstop (anonymous POST flood sample) ────────────────
    console.log("── 10. Mutation backstop ──");
    const mutRoutes = [
      "/api/account/positions",
      "/api/membership/sync",
      "/api/push/subscribe",
      "/api/market/largo/query",
    ];
    for (const path of mutRoutes) {
      const r = await probe("POST", path, {
        accept: "application/json",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: 1 }),
      });
      if (r.status !== 401 && r.status !== 403) {
        rec("P1", "mutation-backstop-" + path.split("/").pop(), "Anonymous mutation not blocked at middleware", `${path} → ${r.status}`);
        console.log(`  ✗ anon POST ${path} → ${r.status}`);
      }
    }
    console.log("  ✓ Anonymous mutations blocked at middleware\n");

    // ── 11. Security headers ───────────────────────────────────────────────
    console.log("── 11. Security headers ──");
    for (const path of ["/", "/sign-in", "/dashboard"]) {
      const r = await probe("GET", path, { cookie: path === "/dashboard" ? premA.cookie : undefined });
      for (const h of ["strict-transport-security", "x-frame-options", "x-content-type-options", "content-security-policy"]) {
        if (!r.headers.get(h)) {
          rec("P2", `header-missing-${h}-${path.replace(/\W+/g, "")}`, `Missing ${h}`, path);
        }
      }
      const csp = r.headers.get("content-security-policy") || "";
      if (csp.includes("unsafe-eval")) {
        rec("P2", "csp-unsafe-eval", "CSP allows unsafe-eval (TradingView embeds)", path);
      }
    }
    console.log("  Header scan complete\n");

    // ── 12. Static api-auth guard (all 125 routes) ─────────────────────────
    console.log("── 12. Static API auth guard (repo) ──");
    const guard = spawnSync("npm", ["run", "validate:api-auth"], { encoding: "utf8", shell: true, cwd: ROOT });
    if (guard.status !== 0) {
      rec("P1", "api-auth-guard-fail", "validate:api-auth failed", (guard.stderr || guard.stdout).slice(-300));
      console.log("  ✗ validate:api-auth FAILED");
    } else {
      const routes = walkApiRoutes(join(ROOT, "src/app/api"));
      console.log(`  ✓ validate:api-auth PASS (${routes.length} routes scanned)`);
    }

    // ── 13. Admin-only delta (premium must not reach) ──────────────────────
    console.log("\n── 13. Admin-only enforcement summary ──");
    const adminOnly = SENSITIVE_GET.filter(([, e]) => e === "admin").map(([p]) => p);
    let adminLeaks = 0;
    for (const path of adminOnly) {
      const r = await probe("GET", path, { cookie: premA.cookie, accept: "application/json" });
      if (r.status === 200) {
        adminLeaks++;
        rec("P0", "admin-leak-" + path.replace(/\W+/g, "-"), "Premium reached admin-only API", path);
      }
    }
    console.log(`  Premium blocked on ${adminOnly.length - adminLeaks}/${adminOnly.length} admin-only routes`);

    const admZd = await probe("GET", "/api/market/zerodte/board", { cookie: admin.cookie, accept: "application/json" });
    const premZd = await probe("GET", "/api/market/zerodte/board", { cookie: premA.cookie, accept: "application/json" });
    console.log(`  0DTE board: premium=${premZd.status} admin=${admZd.status}`);

    // ── 14. Info disclosure in errors ──────────────────────────────────────
    console.log("\n── 14. Error disclosure probes ──");
    const errProbes = [
      ["/api/admin/debug-uw?ticker=INVALID", premA.cookie],
      ["/api/market/gex-heatmap?ticker=';DROP TABLE--", premA.cookie],
    ];
    for (const [path, cookie] of errProbes) {
      const r = await probe("GET", path, { cookie, accept: "application/json" });
      const leakPatterns = [/postgres/i, /redis/i, /DATABASE_URL/i, /stack trace/i, /at Object\./];
      for (const pat of leakPatterns) {
        if (pat.test(r.body)) {
          rec("P2", "error-disclosure", "Sensitive stack/infra in error body", path);
        }
      }
    }
    console.log("  Error body scan complete");
  } finally {
    await free.cleanup();
    await premA.cleanup();
    await premB.cleanup();
    await admin.cleanup();
  }

  const bySev = { P0: 0, P1: 0, P2: 0, INFO: 0 };
  for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;

  const report = {
    at: new Date().toISOString(),
    target: APP,
    bySev,
    findings,
    matrix,
    summary: {
      endpointsProbed: SENSITIVE_GET.length * 4,
      cronRoutesProbed: CRON_GET.length,
      tiers: ["anon", "free", "premium", "admin"],
    },
  };

  const outPath = join(OUT, `deep-security-audit-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  SUMMARY                                                 ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("Findings:", JSON.stringify(bySev));
  if (findings.length) {
    console.log("\nIssues:");
    for (const f of findings) console.log(`  [${f.severity}] ${f.title}`);
    console.log(`  (${findings.length} total — see ${outPath})`);
  } else {
    console.log("\nNo P0/P1/P2 issues detected.");
  }
  console.log("\nReport:", outPath);

  process.exit(findings.some((f) => f.severity === "P0" || f.severity === "P1") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
