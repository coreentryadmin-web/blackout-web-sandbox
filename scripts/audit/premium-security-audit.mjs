#!/usr/bin/env node
/**
 * Premium access matrix + live security probes against production.
 * Mints temp Clerk users (premium-only + admin), deletes after run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APP = (process.env.AUDIT_APP_URL || "https://blackouttrades.com").replace(/\/$/, "");
const SECRET = process.env.CLERK_SECRET_KEY;
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const CRON = process.env.CRON_SECRET || "";
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const OUT = join(process.cwd(), "audit-output");

const findings = [];
const access = { premium: [], admin: [], anon: [] };

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
  const email = `${label}-${Date.now()}@blackouttrades.com`;
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
  if (!userId) throw new Error(`Clerk create failed (${label}): ${JSON.stringify(created).slice(0, 120)}`);

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

  return { cookie: `__session=${jwt}; __client_uat=${clientUat}`, cleanup, userId };
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

function classifyAccess(mode, path, status, note = "") {
  access[mode].push({ path, status, note });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("\n=== Premium + security audit ===\n");
  console.log("Target:", APP);

  let prem, adm;
  try {
    prem = await mintSession({ tier: "premium" }, "prem-audit");
    adm = await mintSession({ role: "admin", tier: "premium" }, "adm-audit");
    console.log("Sessions: premium + admin minted\n");
  } catch (e) {
    console.error("FATAL:", e.message);
    process.exit(2);
  }

  try {
    // ── Premium page access ────────────────────────────────────────────────
    const pages = [
      "/dashboard",
      "/flows",
      "/heatmap",
      "/grid",
      "/nighthawk",
      "/terminal",
      "/admin",
      "/admin/track-record",
      "/account",
      "/track-record",
      "/embed/track-record",
    ];
    console.log("--- Premium pages ---");
    for (const p of pages) {
      const r = await probe("GET", p, { cookie: prem.cookie, accept: "text/html" });
      const note =
        r.status === 307 || r.status === 308
          ? "redirect"
          : r.body.includes("Coming soon") || r.body.includes("Launching")
            ? "launch-gate"
            : r.body.includes("Sign In") || r.body.includes("sign-in")
              ? "auth-wall"
              : "loaded";
      classifyAccess("premium", p, r.status, note);
      console.log(`  ${r.status} ${p} — ${note}`);
    }

    // ── Premium API access ─────────────────────────────────────────────────
    const apis = [
      ["/api/market/spx/desk", "SPX desk"],
      ["/api/market/flows?limit=5", "HELIX flows"],
      ["/api/market/gex-heatmap?ticker=SPX", "SPX heatmap"],
      ["/api/market/gex-heatmap?ticker=SPY", "SPY heatmap"],
      ["/api/market/nighthawk/edition", "Nighthawk"],
      ["/api/market/zerodte/board", "0DTE board"],
      ["/api/grid/bootstrap", "Grid bootstrap"],
      ["/api/grid/sectors", "Grid sectors"],
      ["/api/track-record", "Track record"],
      ["/api/public/track-record", "Public track record API"],
      ["/api/admin/health", "Admin health"],
      ["/api/admin/debug-uw", "Admin debug UW"],
      ["/api/account/positions", "Account positions"],
      ["/api/market/largo/query", "Largo query POST"],
    ];
    console.log("\n--- Premium APIs ---");
    for (const [p, label] of apis) {
      const method = p.includes("largo") ? "POST" : "GET";
      const r = await probe(method, p, {
        cookie: prem.cookie,
        accept: "application/json",
        body: method === "POST" ? JSON.stringify({ query: "NVDA flow" }) : undefined,
        headers: method === "POST" ? { "Content-Type": "application/json" } : {},
      });
      classifyAccess("premium", p, r.status, label);
      console.log(`  ${r.status} ${method} ${p} (${label})`);
      if (p === "/api/market/zerodte/board" && r.status === 200) {
        rec("P0", "zerodte-premium-leak", "Premium user can read 0DTE board API", `HTTP ${r.status}`);
      }
      if (p.startsWith("/api/admin/") && r.status === 200) {
        rec("P0", "admin-api-leak-" + p, "Premium user reached admin API", p);
      }
    }

    // ── Anonymous security baseline ────────────────────────────────────────
    console.log("\n--- Anonymous security probes ---");
    const anonTargets = [
      "/api/admin/health",
      "/api/admin/debug-uw",
      "/api/track-record",
      "/api/account/positions",
      "/api/market/gex-heatmap?ticker=SPX",
      "/api/market/zerodte/board",
      "/api/grid/bootstrap",
      "/api/cron/data-correctness?force=1",
      "/api/cron/spx-evaluate",
      "/api/engine/health",
      "/api/signals/open",
    ];
    for (const p of anonTargets) {
      const r = await probe("GET", p, { accept: "application/json" });
      classifyAccess("anon", p, r.status);
      if (r.status === 200 && (p.includes("/admin/") || p.includes("/account/") || p.includes("track-record"))) {
        rec("P0", "anon-data-leak-" + p.replace(/\W+/g, "-"), "Unauthenticated access to sensitive API", `${p} → ${r.status}`);
      }
      if (r.status === 200 && p.startsWith("/api/cron/")) {
        rec("P0", "cron-unauth-" + p.split("/").pop(), "Cron endpoint reachable without secret", p);
      }
    }

    // Cron with wrong secret
    const badCron = await probe("GET", "/api/cron/data-correctness?force=1", {
      bearer: "totally-wrong-secret-value",
      accept: "application/json",
    });
    if (badCron.status === 200) {
      rec("P0", "cron-weak-auth", "Cron accepted invalid bearer token", "data-correctness returned 200");
    } else {
      console.log(`  Cron bad-token: ${badCron.status} (expected non-200)`);
    }

    // Mutation backstop — anonymous POST
    const anonPost = await probe("POST", "/api/account/positions", {
      accept: "application/json",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: 1 }),
    });
    if (anonPost.status !== 401 && anonPost.status !== 403) {
      rec("P1", "mutation-backstop", "Anonymous POST not blocked at middleware", `POST /api/account/positions → ${anonPost.status}`);
    } else {
      console.log(`  Mutation backstop: POST /api/account/positions → ${anonPost.status}`);
    }

    // ── Security headers (landing) ─────────────────────────────────────────
    const landing = await probe("GET", "/");
    const hdrs = landing.headers;
    const secHeaders = {
      "strict-transport-security": hdrs.get("strict-transport-security"),
      "x-frame-options": hdrs.get("x-frame-options"),
      "x-content-type-options": hdrs.get("x-content-type-options"),
      "content-security-policy": hdrs.get("content-security-policy")?.slice(0, 80) + "...",
      "referrer-policy": hdrs.get("referrer-policy"),
    };
    console.log("\n--- Security headers (/) ---");
    for (const [k, v] of Object.entries(secHeaders)) {
      console.log(`  ${k}: ${v ? "present" : "MISSING"}`);
      if (!v && k !== "content-security-policy") {
        rec("P2", "header-missing-" + k, `Missing security header: ${k}`, "GET /");
      }
    }
    const csp = hdrs.get("content-security-policy") || "";
    if (csp.includes("unsafe-eval")) {
      rec("P2", "csp-unsafe-eval", "CSP allows unsafe-eval", "Required for some embeds — review exposure");
    }

    // Open redirect probe on sign-in
    const redir = await probe("GET", "/sign-in?redirect_url=https://evil.example/phish", {
      followRedirect: false,
      accept: "text/html",
    });
    if (redir.headers.get("location")?.includes("evil.example")) {
      rec("P0", "open-redirect", "Sign-in reflects external redirect_url", redir.headers.get("location"));
    }

    // Premium vs admin delta on grid + zerodte
    const premZd = await probe("GET", "/api/market/zerodte/board", { cookie: prem.cookie, accept: "application/json" });
    const admZd = await probe("GET", "/api/market/zerodte/board", { cookie: adm.cookie, accept: "application/json" });
    console.log(`\n--- 0DTE board gate ---`);
    console.log(`  Premium: ${premZd.status} | Admin: ${admZd.status}`);
    if (premZd.status === 403 && admZd.status === 200) {
      console.log("  ✓ Admin-only gate working");
    } else if (premZd.status === 200) {
      rec("P1", "zerodte-not-gated", "Premium can still read 0DTE board", `HTTP ${premZd.status}`);
    }

    const premGrid = await probe("GET", "/grid", { cookie: prem.cookie, accept: "text/html" });
    const hasCommandTab = premGrid.body.includes("0DTE Command");
    const hasMarketGrid = premGrid.body.includes("Market Grid") || premGrid.body.includes("GridBoard");
    console.log(`\n--- /grid page (premium) ---`);
    console.log(`  HTTP ${premGrid.status} | 0DTE tab visible: ${hasCommandTab} | grid content: ${hasMarketGrid}`);

    // Webhook without signature
    const whop = await probe("POST", "/api/webhooks/whop", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "test" }),
    });
    if (whop.status === 200) {
      rec("P0", "webhook-whop-open", "Whop webhook accepted unsigned POST", `HTTP ${whop.status}`);
    } else {
      console.log(`\n  Whop webhook unsigned POST: ${whop.status} (expected 401/400)`);
    }

    // Run static api-auth guard
    console.log("\n--- Static api-auth guard ---");
    const { spawnSync } = await import("node:child_process");
    const guard = spawnSync("npm", ["run", "validate:api-auth"], { encoding: "utf8", shell: true });
    if (guard.status !== 0) {
      rec("P1", "api-auth-guard-fail", "validate:api-auth failed locally", (guard.stderr || guard.stdout).slice(-200));
    } else {
      console.log("  validate:api-auth: PASS");
    }
  } finally {
    await prem.cleanup();
    await adm.cleanup();
  }

  const bySev = { P0: 0, P1: 0, P2: 0, INFO: 0 };
  for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;

  const report = {
    at: new Date().toISOString(),
    target: APP,
    bySev,
    findings,
    access,
  };
  const outPath = join(OUT, `premium-security-audit-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Summary ===");
  console.log("Findings:", JSON.stringify(bySev));
  if (findings.length) {
    console.log("\nIssues:");
    for (const f of findings) console.log(`  [${f.severity}] ${f.title} — ${f.detail}`);
  } else {
    console.log("\nNo P0/P1/P2 issues detected in live probes.");
  }
  console.log("\nReport:", outPath);
  process.exit(findings.some((f) => f.severity === "P0" || f.severity === "P1") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
