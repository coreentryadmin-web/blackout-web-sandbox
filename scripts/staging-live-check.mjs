#!/usr/bin/env node
/**
 * Comprehensive live staging probe — cron APIs + Clerk admin/premium session.
 * Usage: node scripts/staging-live-check.mjs
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { mintClerkPremiumSession } from "./audit/lib/prod-clerk-session.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const results = [];

function row(surface, path, status, detail, ms) {
  results.push({ surface, path, status, detail, ms });
  const icon = status === "PASS" ? "✓" : status === "WARN" ? "⚠" : status === "SKIP" ? "○" : "✗";
  console.log(`  ${icon} [${surface}] ${path} — ${detail}${ms != null ? ` (${ms}ms)` : ""}`);
}

function loadSecret() {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`,
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

async function probe(name, path, init = {}, expect = () => true) {
  const t0 = Date.now();
  try {
    const res = await fetchRetry(`${BASE}${path}`, init, { retries: 4, baseDelayMs: 1500, timeoutMs: 120_000 });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 200);
    }
    const ms = Date.now() - t0;
    const ok = res.status < 500 && expect(res.status, body);
    row(name, path, ok ? "PASS" : "FAIL", `HTTP ${res.status}`, ms);
    return { status: res.status, body, ms, ok };
  } catch (e) {
    row(name, path, "FAIL", e.message, Date.now() - t0);
    return { ok: false, err: e.message };
  }
}

async function main() {
  console.log(`\n=== Staging live check ===\nTarget: ${BASE}\n`);

  let secret;
  try {
    secret = loadSecret();
    console.log(`Secrets: ${Object.keys(secret).length} keys loaded\n`);
  } catch (e) {
    console.error("Secrets load failed:", e.message);
    process.exit(1);
  }

  process.env.CLERK_SECRET_KEY = secret.CLERK_SECRET_KEY;
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = secret.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const posture = {
    CACHE_WARM_ALWAYS: secret.CACHE_WARM_ALWAYS ?? null,
    REPLICA_COUNT: secret.REPLICA_COUNT ?? null,
    LAUNCHED_TOOLS: secret.LAUNCHED_TOOLS ?? null,
    ANTHROPIC: Boolean(secret.ANTHROPIC_API_KEY),
    VOYAGE: Boolean(secret.VOYAGE_API_KEY),
    UW: Boolean(secret.UW_API_KEY),
    POLYGON: Boolean(secret.POLYGON_API_KEY || secret.MASSIVE_API_KEY),
    WHOP: Boolean(secret.WHOP_API_KEY),
  };
  console.log("Env posture:", JSON.stringify(posture, null, 2), "\n");

  const cron = secret.CRON_SECRET?.trim();
  const cronH = { Authorization: `Bearer ${cron}`, Accept: "application/json" };

  console.log("--- Infra ---");
  await probe("infra", "/api/health", { headers: cronH }, (s, b) => s === 200 && b?.ok);
  await probe("infra", "/api/ready", { headers: cronH }, (s, b) => s === 200 && b?.ok);
  await probe("infra", "/api/cron/socket-health", { headers: cronH }, (s) => s === 200);

  console.log("\n--- SPX Slayer ---");
  for (const p of [
    "/api/market/spx/bootstrap",
    "/api/market/spx/desk",
    "/api/market/spx/pulse",
    "/api/market/spx/play",
    "/api/market/spx/flow",
    "/api/market/spx/signals",
    "/api/market/spx/outcomes",
    "/api/market/spx/commentary",
    "/api/market/spx/merged",
    "/api/market/spx/power-hour",
  ]) {
    await probe("spx", p, { headers: cronH }, (s) => s === 200);
  }

  console.log("\n--- HELIX / flows ---");
  await probe("flows", "/api/market/flows?limit=20", { headers: cronH }, (s) => s === 200);
  await probe("flows", "/api/market/flow-brief?ticker=SPX", { headers: cronH }, (s) => s === 200 || s === 404);

  console.log("\n--- GEX / Thermal ---");
  for (const t of ["SPX", "SPY", "QQQ"]) {
    await probe("gex", `/api/market/gex-heatmap?ticker=${t}`, { headers: cronH }, (s) => s === 200);
  }
  await probe("gex", "/api/market/gex-positioning?ticker=SPX", { headers: cronH }, (s) => s === 200);
  await probe("gex", "/api/market/heatmap?ticker=SPX", { headers: cronH }, (s) => s === 200);

  console.log("\n--- Night Hawk / zerodte ---");
  await probe("nighthawk", "/api/market/nighthawk/edition", { headers: cronH }, (s) => s === 200);
  await probe("zerodte", "/api/market/zerodte/board", { headers: cronH }, (s) => s === 200);

  console.log("\n--- Market context ---");
  await probe("context", "/api/market/regime", { headers: cronH }, (s) => s === 200);
  await probe("context", "/api/market/indices", { headers: cronH }, (s) => s === 200);
  await probe("context", "/api/market/news?ticker=SPX", { headers: cronH }, (s) => s === 200);
  await probe("context", "/api/market/dark-pool?ticker=SPX", { headers: cronH }, (s) => s === 200);
  await probe("context", "/api/market/anomalies?ticker=SPX", { headers: cronH }, (s) => s === 200);
  await probe("context", "/api/market/platform/snapshot", { headers: cronH }, (s) => s === 200);

  console.log("\n--- Vector (launch-gated) ---");
  await probe("vector", "/api/market/vector/universe", { headers: cronH }, (s) => s === 200 || s === 403);

  console.log("\n--- Crons (sample) ---");
  await probe("cron", "/api/cron/data-correctness?force=1&surface=heatmap", { headers: cronH }, (s, b) =>
    s === 200 && b?.ok !== false && !(b?.flags?.length > 0)
  );

  console.log("\n--- Clerk admin/premium session ---");
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    row("auth", "clerk", "SKIP", session.reason);
  } else {
    row("auth", "clerk", "PASS", "admin/premium session minted");
    const cookieH = { Cookie: session.cookieHeader, Accept: "application/json" };

    console.log("\n--- Admin APIs ---");
    const health = await probe("admin", "/api/admin/health", { headers: cookieH }, (s) => s === 200);
    if (health.body?.launch_status) {
      const ls = health.body.launch_status;
      row("admin", "launch_status", "PASS", `open=${ls.open_count}/${ls.total_count} locked=${ls.locked_keys?.join(",") || "none"}`);
    }
    await probe("admin", "/api/admin/bie-report", { headers: cookieH }, (s, b) => s === 200 && b?.available !== false);
    if (health.body) {
      const emb = health.body?.bie?.embeddings ?? health.body?.ops_config;
      row("admin", "bie-embeddings", health.body?.bie ? "PASS" : "WARN", JSON.stringify(health.body?.bie ?? {}).slice(0, 120));
    }

    console.log("\n--- Premium member APIs ---");
    await probe("member", "/api/track-record", { headers: cookieH }, (s) => s === 200);
    await probe("member", "/api/signals/open", { headers: cookieH }, (s) => s === 200);
    await probe("member", "/api/nighthawk/play-status", { headers: cookieH }, (s) => s === 200 || s === 404);

    console.log("\n--- Largo ---");
    const largoSession = await probe(
      "largo",
      "/api/market/largo/session?session_id=live-check",
      { headers: cookieH },
      (s) => s === 200 || s === 403 || s === 503
    );
    if (largoSession.status === 403) {
      row("largo", "launch-gate", "WARN", "coming_soon — add LAUNCHED_TOOLS=largo");
    } else if (largoSession.status === 503) {
      row("largo", "config", "FAIL", "Largo not configured");
    }

    const t0 = Date.now();
    try {
      const res = await fetchRetry(
        `${BASE}/api/market/largo/query`,
        {
          method: "POST",
          headers: { ...cookieH, "Content-Type": "application/json" },
          body: JSON.stringify({ question: "What is SPX spot right now?", session_id: "live-check" }),
        },
        { retries: 2, timeoutMs: 180_000 }
      );
      const body = await res.json().catch(() => ({}));
      const ms = Date.now() - t0;
      const ok = res.status === 200 && (body?.answer || body?.text || body?.message);
      row(
        "largo",
        "POST /api/market/largo/query",
        res.status === 403 ? "WARN" : ok ? "PASS" : res.status === 200 ? "WARN" : "FAIL",
        `HTTP ${res.status} ${body?.error || (ok ? "answered" : body?.message || "no answer field")}`,
        ms
      );
    } catch (e) {
      row("largo", "POST /api/market/largo/query", "FAIL", e.message, Date.now() - t0);
    }

    console.log("\n--- HTML pages (commit) ---");
    for (const p of ["/", "/sign-in", "/dashboard", "/flows", "/heatmap", "/terminal", "/nighthawk", "/vector", "/track-record", "/admin"]) {
      const t0 = Date.now();
      try {
        const res = await fetchRetry(`${BASE}${p}`, { headers: { Cookie: session.cookieHeader } }, { retries: 3, timeoutMs: 60_000 });
        const html = await res.text();
        const ms = Date.now() - t0;
        const hasContent = html.length > 500;
        row("page", p, res.status === 200 && hasContent ? "PASS" : "FAIL", `HTTP ${res.status} len=${html.length}`, ms);
      } catch (e) {
        row("page", p, "FAIL", e.message, Date.now() - t0);
      }
    }

    await session.cleanup?.();
  }

  const fails = results.filter((r) => r.status === "FAIL");
  const warns = results.filter((r) => r.status === "WARN");
  const report = { ts: new Date().toISOString(), base: BASE, posture, results, summary: { pass: results.filter((r) => r.status === "PASS").length, warn: warns.length, fail: fails.length, skip: results.filter((r) => r.status === "SKIP").length } };
  const path = join(OUT, `staging-live-check-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));

  console.log(`\n=== Summary === PASS ${report.summary.pass} | WARN ${report.summary.warn} | FAIL ${report.summary.fail} | SKIP ${report.summary.skip}`);
  console.log(`Report: ${path}\n`);
  if (fails.length) {
    console.log("Failures:");
    fails.forEach((f) => console.log(`  · ${f.surface} ${f.path}: ${f.detail}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
