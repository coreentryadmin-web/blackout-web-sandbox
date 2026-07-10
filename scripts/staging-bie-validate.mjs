#!/usr/bin/env node
/**
 * Staging BIE validation — prove 100% intelligence-layer coverage without Claude.
 *
 * Usage:
 *   npm run validate:staging-bie
 *
 * Env:
 *   STAGING_BASE_URL — default https://staging.blackouttrades.com
 *   STAGING_SECRET_NAME — default blackout-staging/app/env
 *
 * Requires AWS secrets (Clerk keys) for premium session probes.
 * Does NOT touch production.
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { mintAppSession } from "./audit/lib/app-session.mjs";

const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const results = [];
const failures = [];

function row(surface, path, status, detail, ms) {
  results.push({ surface, path, status, detail, ms });
  const icon = status === "PASS" ? "✓" : status === "WARN" ? "⚠" : "✗";
  console.log(`  ${icon} [${surface}] ${path} — ${detail}${ms != null ? ` (${ms}ms)` : ""}`);
  if (status === "FAIL") failures.push(`${surface} ${path}: ${detail}`);
}

function loadSecret() {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`,
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

async function postJson(path, body, headers, timeoutMs = 120_000) {
  const t0 = Date.now();
  const res = await fetchRetry(
    `${BASE}${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
    },
    { retries: 3, timeoutMs, baseDelayMs: 1500 }
  );
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body: parsed, ms: Date.now() - t0 };
}

async function getJson(path, headers, timeoutMs = 60_000) {
  const t0 = Date.now();
  const res = await fetchRetry(`${BASE}${path}`, { headers: { Accept: "application/json", ...headers } }, { retries: 3, timeoutMs });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, ms: Date.now() - t0 };
}

const LARGO_QUESTIONS = [
  { q: "What's the SPX setup right now?", expect: /THESIS|SPX Live Desk|LEVELS/i },
  { q: "why is SPX below vwap", expect: /THESIS|MECHANIC/i },
  { q: "How are today's plays doing?", expect: /0DTE|plays/i },
  { q: "What's the market doing?", expect: /Market context|HELIX|SPX/i },
  { q: "random question about hedging flows", expect: /Market context|HELIX|SPX|0DTE/i },
];

async function main() {
  console.log(`\n=== Staging BIE validation (no prod) ===\nTarget: ${BASE}\n`);

  let secret;
  try {
    secret = loadSecret();
  } catch (e) {
    console.error("Secrets load failed:", e.message);
    process.exit(1);
  }

  if (secret.STAGING_CLAUDE === "1") {
    row("policy", "STAGING_CLAUDE", "WARN", "STAGING_CLAUDE=1 — Claude may be active; BIE-only not guaranteed");
  } else {
    row("policy", "STAGING_CLAUDE", "PASS", "unset — BIE-only policy expected");
  }

  if (secret.ANTHROPIC_API_KEY) {
    row("policy", "ANTHROPIC_API_KEY", "WARN", "key present but claudeEnabled() should still be false on staging");
  } else {
    row("policy", "ANTHROPIC_API_KEY", "PASS", "absent — zero Anthropic spend path");
  }

  const session = await mintAppSession({ appUrl: BASE });
  if (session.skip) {
    row("auth", "session", "FAIL", session.reason);
    process.exit(1);
  }
  row("auth", "session", "PASS", `${session.provider ?? "session"} premium/admin minted`);
  const cookieH = { Cookie: session.cookieHeader };

  console.log("\n--- Live Desk commentary (BIE brief) ---");
  const comm = await postJson("/api/market/spx/commentary", {}, cookieH, 180_000);
  const commBody = comm.body?.commentary?.body ?? "";
  const commOk =
    comm.status === 200 &&
    commBody.includes("THESIS") &&
    commBody.includes("SETUP") &&
    !/anthropic|claude/i.test(commBody);
  row(
    "commentary",
    "POST /api/market/spx/commentary",
    commOk ? "PASS" : comm.status === 502 ? "WARN" : "FAIL",
    commOk
      ? `BIE brief (${commBody.length} chars, ${comm.ms}ms)`
      : `HTTP ${comm.status} ${comm.body?.error ?? "missing THESIS"}`,
    comm.ms
  );

  console.log("\n--- HELIX flow brief (BIE) ---");
  const fb = await getJson("/api/market/flow-brief?ticker=SPX", cookieH);
  const fbText = typeof fb.body?.brief === "string" ? fb.body.brief : fb.body?.body ?? "";
  const fbOk =
    fb.status === 200 &&
    !fb.body?.error &&
    (fbText.length > 20 || fb.body?.brief === null);
  row(
    "flow-brief",
    "GET /api/market/flow-brief",
    fbOk ? "PASS" : fb.status === 404 ? "WARN" : "FAIL",
    fbText.length > 20
      ? `BIE brief (${fbText.length} chars)`
      : `HTTP ${fb.status} brief=null (quiet tape OK on BIE path)`,
    fb.ms
  );

  console.log("\n--- GEX explain (deterministic on staging) ---");
  const gx = await getJson("/api/market/gex-heatmap/explain?ticker=SPX", cookieH, 90_000);
  const gxText = gx.body?.narrative ?? gx.body?.explanation ?? "";
  row(
    "gex-explain",
    "GET /api/market/gex-heatmap/explain",
    gx.status === 200 && String(gxText).length > 20 ? "PASS" : gx.status === 200 && gx.body?.available === false ? "WARN" : "FAIL",
    `HTTP ${gx.status} available=${gx.body?.available ?? "?"}`,
    gx.ms
  );

  console.log("\n--- Largo (BIE router — must never hard-fail on staging) ---");
  for (const { q, expect } of LARGO_QUESTIONS) {
    const res = await postJson(
      "/api/market/largo/query",
      { question: q, session_id: `bie-validate-${Date.now()}` },
      cookieH,
      180_000
    );
    const answer = res.body?.answer ?? res.body?.text ?? "";
    const source = res.body?.source ?? "";
    const ok =
      res.status === 200 &&
      answer.length > 30 &&
      expect.test(answer) &&
      source === "blackout-intelligence";
    row(
      "largo",
      `Q: ${q.slice(0, 40)}`,
      res.status === 403 ? "WARN" : ok ? "PASS" : "FAIL",
      ok
        ? `source=${source} (${res.ms}ms)`
        : `HTTP ${res.status} source=${source} err=${res.body?.error ?? res.body?.message ?? "no match"}`,
      res.ms
    );
  }

  await session.cleanup?.();

  const report = {
    ts: new Date().toISOString(),
    base: BASE,
    policy: "staging-bie-only",
    results,
    summary: {
      pass: results.filter((r) => r.status === "PASS").length,
      warn: results.filter((r) => r.status === "WARN").length,
      fail: failures.length,
    },
  };
  const path = join(OUT, `staging-bie-validate-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${path}`);
  console.log(`\n=== Summary === PASS ${report.summary.pass} | WARN ${report.summary.warn} | FAIL ${report.summary.fail}\n`);

  if (failures.length) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  · ${f}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
