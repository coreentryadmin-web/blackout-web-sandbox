#!/usr/bin/env node
/**
 * Largo 100-question stress run — router (local) + optional live staging answers.
 *
 *   node scripts/largo-stress-run.mjs              # router only (fast)
 *   LARGO_STRESS_LIVE=1 node scripts/largo-stress-run.mjs   # + staging HTTP
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { STRESS_BANK, scoreAnswer } from "./largo-stress-bank.mjs";
import { classifyBieIntent, classifyBieStagingFallback } from "../src/lib/bie/router.ts";
import { isCompoundQuestion } from "../src/lib/bie/decompose.ts";

const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

function routeQuestion(q) {
  const ledger = new Set(["TSLA", "NVDA", "SPY", "AAPL", "META", "PLTR", "XLF", "GLD", "COIN"]);
  if (isCompoundQuestion(q)) return { intent: "compound_lookup", ticker: null };
  return classifyBieIntent(q, ledger) ?? classifyBieStagingFallback(q);
}

async function askStaging(cookieHeader, question) {
  const { fetchRetry } = await import("./audit/lib/fetch-retry.mjs");
  const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
  const t0 = Date.now();
  const res = await fetchRetry(
    `${BASE}/api/market/largo/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ question, session_id: `stress-${Date.now()}` }),
    },
    { retries: 1, timeoutMs: 120_000 }
  );
  const body = await res.json().catch(() => ({}));
  return { status: res.status, answer: body?.answer ?? "", source: body?.source, ms: Date.now() - t0 };
}

const rows = [];
for (const entry of STRESS_BANK) {
  const route = routeQuestion(entry.q);
  const row = { q: entry.q, intent: route?.intent ?? null, ticker: route?.ticker ?? null };
  rows.push(row);
}

const routerBad = STRESS_BANK.filter((e, i) => {
  const r = { intent: rows[i].intent };
  const fake = scoreAnswer(e, r, "x".repeat(100), 200);
  return fake.issues.some((x) => x.startsWith("intent"));
});

console.log(`\n=== Router pass (${STRESS_BANK.length} questions) ===`);
console.log(`Intent mismatches: ${routerBad.length}`);
for (const e of routerBad.slice(0, 25)) {
  const i = STRESS_BANK.indexOf(e);
  console.log(`  ✗ [${rows[i].intent}] ${e.q.slice(0, 70)}`);
}

let liveRows = [];
if (process.env.LARGO_STRESS_LIVE === "1") {
  const { mintAppSession } = await import("./audit/lib/app-session.mjs");
  const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
  const session = await mintAppSession({ appUrl: BASE });
  if (session.skip) {
    console.error("Live auth skip:", session.reason);
  } else {
    console.log(`\n=== Live staging (${BASE}) ===\n`);
    try {
      for (let i = 0; i < STRESS_BANK.length; i++) {
        const entry = STRESS_BANK[i];
        const { status, answer, source, ms } = await askStaging(session.cookieHeader, entry.q);
        const route = { intent: rows[i].intent };
        const scored = scoreAnswer(entry, route, answer, status);
        liveRows.push({ ...entry, status, source, ms, answer_len: answer.length, ...scored, preview: answer.slice(0, 120) });
        const icon = scored.verdict === "OK" ? "✓" : scored.verdict === "WARN" ? "⚠" : "✗";
        console.log(`${icon} ${ms}ms ${scored.verdict} | ${entry.q.slice(0, 55)}`);
        if (scored.issues.length) console.log(`    ${scored.issues.join(", ")}`);
      }
    } finally {
      await session.cleanup?.();
    }
  }
}

const summary = {
  total: STRESS_BANK.length,
  router_mismatch: routerBad.length,
  live_ok: liveRows.filter((r) => r.verdict === "OK").length,
  live_bad: liveRows.filter((r) => r.verdict === "BAD").length,
  live_warn: liveRows.filter((r) => r.verdict === "WARN").length,
};

writeFileSync(
  join(OUT, "largo-stress-report.json"),
  JSON.stringify({ at: new Date().toISOString(), summary, router: rows, live: liveRows }, null, 2)
);
console.log(`\nWrote audit-output/largo-stress-report.json`);
console.log(JSON.stringify(summary, null, 2));
