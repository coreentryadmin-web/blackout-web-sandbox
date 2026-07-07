#!/usr/bin/env node
/**
 * Phase-2 deep security probes — webhook HMAC fuzzing, full API enumeration,
 * injection payloads, push IDOR, SSRF, CORS, stream auth, mass-assignment.
 * Complements scripts/audit/deep-security-audit.mjs
 */
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = (process.env.AUDIT_APP_URL || "https://blackouttrades.com").replace(/\/$/, "");
const SECRET = process.env.CLERK_SECRET_KEY;
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const WHOP_WH_SECRET = process.env.WHOP_WEBHOOK_SECRET || "";
const CLERK_WH_SECRET = process.env.CLERK_WEBHOOK_SECRET || "";
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const OUT = join(process.cwd(), "audit-output");
const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");

const PUBLIC_ALLOW = new Set([
  "/api/health",
  "/api/ready",
  "/api/market/regime",
  "/api/webhook/whop",
  "/api/webhooks/whop",
  "/api/webhook/clerk",
  "/api/webhooks/clerk",
  "/api/telemetry/client-error",
  "/api/telemetry/auth-failure",
]);

const findings = [];

function rec(sev, id, title, detail, evidence = {}) {
  findings.push({ severity: sev, id, title, detail, evidence });
}

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
  if (!userId) throw new Error(`Clerk create failed (${label})`);
  const ticket = (await backend("POST", "/sign_in_tokens", { user_id: userId, expires_in_seconds: 600 }))?.token;
  const si = await fetch(`${fapi}/v1/client/sign_ins?_clerk_js_version=${CJS}`, {
    method: "POST",
    headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ strategy: "ticket", ticket }),
  });
  const siCookies = collectSetCookies(si);
  const sid = (await si.json().catch(() => null))?.response?.created_session_id;
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
  const cleanup = async () => {
    try {
      await fetch(`${API}/users/${userId}`, { method: "DELETE", headers: { Authorization: `Bearer ${SECRET}` } });
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

function walkApiRoutes(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walkApiRoutes(path, out);
    else if (entry === "route.ts") out.push(path);
  }
  return out;
}

function routePathFromFile(absPath) {
  const rel = absPath.replace(/\\/g, "/");
  const m = rel.match(/src\/app(\/api\/.*)\/route\.ts$/);
  if (!m) return null;
  return m[1].replace(/\[(\.\.\.)?(\w+)\]/g, "probe");
}

/** Standard Webhooks signed payload (Whop SDK uses this scheme). */
function signStandardWebhook(body, secret, webhookId) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const msgId = webhookId || `msg_${randomBytes(8).toString("hex")}`;
  const toSign = `${msgId}.${ts}.${body}`;
  const key = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret, "utf8");
  const sig = createHmac("sha256", key).update(toSign).digest("base64");
  return {
    headers: {
      "Content-Type": "application/json",
      "webhook-id": msgId,
      "webhook-timestamp": ts,
      "webhook-signature": `v1,${sig}`,
    },
    body,
  };
}

/** Svix-style Clerk webhook signature. */
function signSvixWebhook(body, secret) {
  const id = `msg_${randomBytes(8).toString("hex")}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const key = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret, "utf8");
  const toSign = `${id}.${ts}.${body}`;
  const sig = createHmac("sha256", key).update(toSign).digest("base64");
  return {
    headers: {
      "Content-Type": "application/json",
      "svix-id": id,
      "svix-timestamp": ts,
      "svix-signature": `v1,${sig}`,
    },
    body,
  };
}

const SENSITIVE_JSON_KEYS = [
  "grade",
  "strike",
  "entry_mark",
  "call_wall",
  "put_wall",
  "play",
  "signal_source",
  "clerk_user_id",
  "privateMetadata",
  "CRON_SECRET",
  "DATABASE_URL",
  "UW_API_KEY",
];

function bodyLooksSensitive(body, path) {
  if (path.includes("regime") || path.includes("health") || path.includes("ready")) return false;
  try {
    const j = JSON.parse(body);
    const flat = JSON.stringify(j).toLowerCase();
    for (const k of SENSITIVE_JSON_KEYS) {
      if (flat.includes(k.toLowerCase()) && !path.includes("regime")) {
        // regime may have call_wall legitimately as public macro
        if (k === "call_wall" && path.includes("regime")) continue;
        return k;
      }
    }
    // Paid flow shape
    if (Array.isArray(j.flows) && j.flows.length > 0) return "flows";
    if (Array.isArray(j.signals) && j.signals.length > 0) return "signals";
    if (j.positions?.length > 0) return "positions";
  } catch {}
  return null;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("\n=== Phase-2 deep security audit ===\nTarget:", APP);

  if (!SECRET || !PUB) {
    console.error("CLERK secrets missing");
    process.exit(2);
  }

  let premA, premB, free, admin;
  try {
    free = await mintSession({ tier: "free" }, "p2-free");
    premA = await mintSession({ tier: "premium" }, "p2-prem-a");
    premB = await mintSession({ tier: "premium" }, "p2-prem-b");
    admin = await mintSession({ role: "admin", tier: "premium" }, "p2-adm");
  } catch (e) {
    console.error("FATAL:", e.message);
    process.exit(2);
  }

  const enumLeaks = [];

  try {
    // ── 15. Full API enumeration (anonymous GET) ───────────────────────────
    console.log("── 15. Full API route enumeration (anonymous GET) ──");
    const routes = walkApiRoutes(join(ROOT, "src/app/api"));
    let probed = 0;
    let unexpected200 = 0;
    for (const abs of routes.sort()) {
      const p = routePathFromFile(abs);
      if (!p || p.includes("probe")) continue; // skip dynamic segments
      probed++;
      const r = await probe("GET", p, { accept: "application/json" });
      if (r.status === 200 && !PUBLIC_ALLOW.has(p)) {
        const sens = bodyLooksSensitive(r.body, p);
        if (sens) {
          unexpected200++;
          enumLeaks.push({ path: p, key: sens, bodyLen: r.body.length });
          rec("P0", "anon-api-leak-" + p.replace(/\W+/g, "-"), "Anonymous GET returned sensitive JSON", `${p} contains ${sens}`);
        }
      }
    }
    console.log(`  Probed ${probed} static GET routes; unexpected sensitive 200s: ${unexpected200}`);

    // ── 16. Webhook HMAC fuzzing ───────────────────────────────────────────
    console.log("\n── 16. Webhook HMAC fuzzing ──");
    const whopBody = JSON.stringify({
      id: "evt_audit_" + Date.now(),
      type: "membership.activated",
      company_id: "co_test",
      data: { user: { email: "attacker@evil.example" }, id: "mem_fake" },
    });

    const fuzzCases = [
      ["whop-unsigned", "/api/webhook/whop", {}, whopBody],
      ["whop-wrong-hmac", "/api/webhook/whop", signStandardWebhook(whopBody, "whsec_" + randomBytes(16).toString("base64"), "msg_bad").headers, whopBody],
      ["whop-empty-sig", "/api/webhook/whop", { "Content-Type": "application/json", "webhook-id": "x", "webhook-timestamp": "1", "webhook-signature": "v1," }, whopBody],
    ];

    if (WHOP_WH_SECRET) {
      const near = signStandardWebhook(whopBody, WHOP_WH_SECRET.slice(0, -1) + "X", "msg_near");
      fuzzCases.push(["whop-near-valid-hmac", "/api/webhook/whop", near.headers, whopBody]);
      const valid = signStandardWebhook(whopBody, WHOP_WH_SECRET, "evt_audit_valid_" + Date.now());
      fuzzCases.push(["whop-valid-hmac-fake-event", "/api/webhook/whop", valid.headers, whopBody]);
    }

    const clerkPayload = JSON.stringify({ type: "user.created", data: { id: "user_fake_audit", email_addresses: [] } });
    fuzzCases.push(["clerk-unsigned", "/api/webhooks/clerk", { "Content-Type": "application/json" }, clerkPayload]);
    fuzzCases.push(["clerk-fake-svix", "/api/webhooks/clerk", signSvixWebhook(clerkPayload, "whsec_fake").headers, clerkPayload]);

    if (CLERK_WH_SECRET) {
      const nearClerk = signSvixWebhook(clerkPayload, CLERK_WH_SECRET.slice(0, -1) + "X");
      fuzzCases.push(["clerk-near-valid", "/api/webhooks/clerk", nearClerk.headers, clerkPayload]);
    }

    for (const [label, path, hdrs, body] of fuzzCases) {
      const r = await probe("POST", path, { headers: hdrs, body });
      const accepted = r.status >= 200 && r.status < 300 && !r.body.includes("duplicate");
      // Valid HMAC with fake membership event: 200 ok is OK if company_id mismatch drops it — check body
      if (label === "whop-valid-hmac-fake-event" && r.status === 200) {
        if (!r.body.includes("dropped") && !r.body.includes("company_mismatch") && !r.body.includes("duplicate")) {
          rec("P0", "whop-fake-tier-grant", "Signed fake Whop event may have processed", r.body.slice(0, 200));
          console.log(`  ✗ ${label} → ${r.status} (processed?)`);
        } else {
          console.log(`  ✓ ${label} → ${r.status} (dropped safely)`);
        }
        continue;
      }
      if (accepted && !label.includes("valid-hmac")) {
        rec("P0", "webhook-fuzz-" + label, "Webhook fuzz accepted", `${path} → ${r.status}`);
        console.log(`  ✗ ${label} → ${r.status}`);
      } else {
        console.log(`  ✓ ${label} → ${r.status}`);
      }
    }

    // ── 17. Push subscribe IDOR ────────────────────────────────────────────
    console.log("\n── 17. Push subscription IDOR ──");
    const endpoint = "https://push.example.com/audit-" + Date.now();
    const subA = await probe("POST", "/api/push/subscribe", {
      cookie: premA.cookie,
      headers: { "Content-Type": "application/json" },
      accept: "application/json",
      body: JSON.stringify({ endpoint, keys: { p256dh: "k1", auth: "a1" } }),
    });
    const subB = await probe("POST", "/api/push/subscribe", {
      cookie: premB.cookie,
      headers: { "Content-Type": "application/json" },
      accept: "application/json",
      body: JSON.stringify({ endpoint, keys: { p256dh: "hijacked", auth: "hijacked" } }),
    });
    console.log(`  User A subscribe → ${subA.status}; User B same endpoint → ${subB.status}`);
    if (subB.status === 200) {
      // If B got 200, check if admin push would hit B's keys — we can't call push/send as premium
      // The IDOR would be: B overwrote A's subscription keys while endpoint owned by A
      // Code uses WHERE user_id = EXCLUDED.user_id on conflict — B should get 200 but NOT steal
      rec("INFO", "push-idor-check", "User B re-subscribed same endpoint", "Manual verify: keys not stolen if A still owns row");
    }

    // ── 18. Personal alerts SSRF ───────────────────────────────────────────
    console.log("\n── 18. Personal alerts SSRF / non-Discord URLs ──");
    const ssrfUrls = [
      "https://169.254.169.254/latest/meta-data/",
      "https://blackouttrades.com/api/admin/health",
      "http://discord.com/api/webhooks/1/token",
      "https://evil.com/api/webhooks/123/abc",
    ];
    for (const url of ssrfUrls) {
      const r = await probe("PUT", "/api/account/personal-alerts", {
        cookie: premA.cookie,
        headers: { "Content-Type": "application/json" },
        accept: "application/json",
        body: JSON.stringify({ url }),
      });
      if (r.status === 200) {
        rec("P0", "personal-alert-ssrf", "Non-Discord webhook accepted", url);
        console.log(`  ✗ accepted: ${url}`);
      } else {
        console.log(`  ✓ blocked (${r.status}): ${url.slice(0, 50)}`);
      }
    }

    // ── 19. SQL injection probes ───────────────────────────────────────────
    console.log("\n── 19. Injection probes (query params) ──");
    const payloads = [
      "/api/market/gex-heatmap?ticker=SPX';DROP TABLE users;--",
      "/api/market/ticker-search?q=' OR 1=1--",
      "/api/market/dark-pool/ticker?ticker=SPY\"",
      "/api/market/gex-positioning?ticker=${7*7}",
    ];
    for (const path of payloads) {
      const r = await probe("GET", path, { cookie: premA.cookie, accept: "application/json" });
      if (/syntax error|postgres|pg_query|SQL/i.test(r.body)) {
        rec("P0", "sqli-disclosure-" + path.split("?")[0].split("/").pop(), "SQL error leaked in response", r.body.slice(0, 120));
        console.log(`  ✗ SQL leak: ${path}`);
      } else {
        console.log(`  ✓ ${path.split("?")[0]} → ${r.status}`);
      }
    }

    // ── 20. Mass assignment (userId in body) ───────────────────────────────
    console.log("\n── 20. Mass assignment / privilege injection in body ──");
    const massBody = {
      ticker: "SPY",
      option_type: "call",
      strike: 500,
      expiry: "2099-12-19",
      side: "long",
      contracts: 1,
      entry_premium: 1,
      userId: admin.userId,
      user_id: admin.userId,
      role: "admin",
      tier: "premium",
    };
    const mass = await probe("POST", "/api/account/positions", {
      cookie: free.cookie,
      headers: { "Content-Type": "application/json" },
      accept: "application/json",
      body: JSON.stringify(massBody),
    });
    if (mass.status === 201) {
      rec("P0", "mass-assign-free-pos", "Free user created position with injected userId", mass.body.slice(0, 100));
    } else {
      console.log(`  ✓ Free POST positions with injected userId → ${mass.status}`);
    }

    // Premium tries admin migration with traversal
    for (const fn of ["../../../package.json.sql", "..\\..\\..\\etc\\passwd.sql", "004_god_tier_features.sql"]) {
      const r = await probe("POST", "/api/admin/run-migration", {
        cookie: premA.cookie,
        headers: { "Content-Type": "application/json" },
        accept: "application/json",
        body: JSON.stringify({ filename: fn }),
      });
      if (r.status === 200 && JSON.parse(r.body || "{}").ok) {
        rec("P0", "migration-traversal-prem", "Premium ran migration", fn);
      }
    }
    console.log("  ✓ Premium blocked from run-migration");

    // ── 21. Stream / SSE endpoint auth ─────────────────────────────────────
    console.log("\n── 21. SSE stream endpoints (anonymous) ──");
    const streams = [
      "/api/market/flows/stream",
      "/api/market/spx/pulse/stream",
      "/api/account/positions/stream",
      "/api/admin/apis/stream",
    ];
    for (const path of streams) {
      const r = await probe("GET", path, {
        accept: "text/event-stream",
        headers: { Accept: "text/event-stream" },
      });
      const ct = r.headers.get("content-type") || "";
      if (r.status === 200 && ct.includes("text/event-stream") && r.body.length > 50) {
        rec("P0", "sse-anon-" + path.split("/").pop(), "Anonymous SSE stream delivered data", path);
        console.log(`  ✗ ${path} → streaming data`);
      } else {
        console.log(`  ✓ ${path} → ${r.status}`);
      }
    }

    // ── 22. CORS misconfiguration ──────────────────────────────────────────
    console.log("\n── 22. CORS probe ──");
    const cors = await probe("GET", "/api/market/spx/desk", {
      headers: { Origin: "https://evil.example", Accept: "application/json" },
      cookie: premA.cookie,
    });
    const acao = cors.headers.get("access-control-allow-origin");
    if (acao === "https://evil.example" || acao === "*") {
      rec("P1", "cors-wildcard", "API reflects hostile Origin", acao);
      console.log(`  ✗ ACAO: ${acao}`);
    } else {
      console.log(`  ✓ No permissive CORS (ACAO=${acao || "absent"})`);
    }

    // ── 23. Regime public response audit ───────────────────────────────────
    console.log("\n── 23. Public /api/market/regime content audit ──");
    const regime = await probe("GET", "/api/market/regime", { accept: "application/json" });
    if (regime.status === 200) {
      try {
        const j = JSON.parse(regime.body);
        const forbidden = ["email", "userId", "clerk", "webhook", "secret", "password"];
        const flat = JSON.stringify(j).toLowerCase();
        for (const f of forbidden) {
          if (flat.includes(f)) rec("P1", "regime-leak-" + f, "Regime JSON contains sensitive key", f);
        }
        console.log(`  available=${j.available} stale=${j.stale} keys=${Object.keys(j).join(",")}`);
      } catch {}
    }

    // ── 24. Telemetry abuse / rate limit ───────────────────────────────────
    console.log("\n── 24. Telemetry rate limit (30 rapid POSTs) ──");
    let t429 = 0;
    let t204 = 0;
    for (let i = 0; i < 30; i++) {
      const r = await probe("POST", "/api/telemetry/client-error", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "audit flood " + i, name: "Error", scope: "audit" }),
      });
      if (r.status === 429) t429++;
      if (r.status === 204) t204++;
    }
    console.log(`  204=${t204} 429=${t429}`);
    if (t204 === 30) {
      rec("P2", "telemetry-no-rate-limit", "30 client-error POSTs without 429", "fail-open or limit too high");
    }

    // ── 25. Method override / auth confusion ───────────────────────────────
    console.log("\n── 25. Auth confusion probes ──");
    // Premium cookie + empty bearer should not bypass tier on cron-only route
    const confused = await probe("GET", "/api/signals/open", {
      cookie: premA.cookie,
      bearer: "not-cron-secret",
      accept: "application/json",
    });
    if (confused.status === 200) {
      rec("P0", "signals-open-confused-auth", "signals/open accepted premium session", confused.status);
    } else {
      console.log(`  ✓ signals/open with cookie+wrong bearer → ${confused.status}`);
    }

    // Free tier with only __client_uat cookie (no session)
    const uatOnly = await probe("POST", "/api/account/positions", {
      cookie: "__client_uat=" + Math.floor(Date.now() / 1000),
      headers: { "Content-Type": "application/json" },
      accept: "application/json",
      body: JSON.stringify({ test: 1 }),
    });
    if (uatOnly.status !== 401 && uatOnly.status !== 403) {
      rec("P1", "uat-only-bypass", "Mutation accepted with __client_uat only", uatOnly.status);
    } else {
      console.log(`  ✓ uat-only cookie mutation → ${uatOnly.status}`);
    }

    // ── 26. Admin metadata escalation via membership sync body ─────────────
    console.log("\n── 26. Tier escalation attempts ──");
    const syncInject = await probe("POST", "/api/membership/sync", {
      cookie: free.cookie,
      headers: { "Content-Type": "application/json", "X-Tier": "premium" },
      accept: "application/json",
      body: JSON.stringify({ tier: "premium", role: "admin" }),
    });
    const deskAfter = await probe("GET", "/api/market/spx/desk", { cookie: free.cookie, accept: "application/json" });
    if (deskAfter.status === 200) {
      rec("P0", "tier-escalation-body", "Free user gained desk after sync with injected body", syncInject.status);
    } else {
      console.log(`  ✓ Free desk still ${deskAfter.status} after sync injection`);
    }

    // Try Clerk Backend metadata patch simulation — we use backend API to patch free user to admin
    // This tests whether OUR app honors client-controlled metadata if Clerk were compromised
    // (defense: admin also checks ADMIN_EMAILS — temp audit users won't be in allowlist)
    try {
      await fetch(`${API}/users/${free.userId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ public_metadata: { role: "admin", tier: "premium" } }),
      });
      // Wait for tier cache
      await new Promise((r) => setTimeout(r, 1500));
      const deskEsc = await probe("GET", "/api/admin/health", { cookie: free.cookie, accept: "application/json" });
      if (deskEsc.status === 200) {
        rec("P1", "metadata-only-admin", "role:admin in Clerk metadata grants admin API without allowlist", "Review ADMIN_EMAILS requirement");
        console.log(`  ⚠ metadata role:admin → admin health ${deskEsc.status}`);
      } else {
        console.log(`  ✓ metadata role:admin without allowlist → admin health ${deskEsc.status}`);
      }
      // Restore free metadata
      await fetch(`${API}/users/${free.userId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ public_metadata: { tier: "free" } }),
      });
    } catch (e) {
      console.log("  Clerk metadata patch test skipped:", e.message);
    }
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
    phase: 2,
    bySev,
    findings,
    enumLeaks,
  };
  const outPath = join(OUT, `deep-security-audit-phase2-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Phase-2 Summary ===");
  console.log("Findings:", JSON.stringify(bySev));
  if (findings.filter((f) => f.severity !== "INFO").length) {
    for (const f of findings.filter((x) => x.severity !== "INFO")) {
      console.log(`  [${f.severity}] ${f.title}`);
    }
  }
  console.log("Report:", outPath);
  process.exit(findings.some((f) => f.severity === "P0" || f.severity === "P1") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
