#!/usr/bin/env node
/**
 * Largo stress run — router (local) + optional live staging answers.
 *
 *   node scripts/largo-stress-run.mjs                    # bank 1 only (legacy default)
 *   LARGO_STRESS_BANK=all node scripts/largo-stress-run.mjs   # all ~400+ questions
 *   LARGO_STRESS_BANK=2,3 node scripts/largo-stress-run.mjs     # subset
 *   LARGO_STRESS_LIVE=1 LARGO_STRESS_BANK=all ...       # live HTTP against staging
 *
 * Env:
 *   LARGO_STRESS_BANK — 1 | 2 | 3 | all | comma list (default: 1)
 *   LARGO_STRESS_LIVE — 1 to POST each question to staging Largo
 *   LARGO_STRESS_CONCURRENCY — parallel live requests (default 1)
 *   LARGO_STRESS_LIMIT — cap questions (debug)
 *   STAGING_BASE_URL — default https://staging.blackouttrades.com
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scoreAnswer } from "./largo-stress-scoring.mjs";
import { loadStressBank, bankStats } from "./largo-stress-banks.mjs";
import { classifyBieIntent, classifyBieStagingFallback } from "../src/lib/bie/router.ts";
import { isCompoundQuestion } from "../src/lib/bie/decompose.ts";

const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const bankSpec = process.env.LARGO_STRESS_BANK ?? "1";
const STRESS_BANK = loadStressBank(bankSpec);
const limit = process.env.LARGO_STRESS_LIMIT ? Number(process.env.LARGO_STRESS_LIMIT) : null;
const entries = limit != null && Number.isFinite(limit) ? STRESS_BANK.slice(0, limit) : STRESS_BANK;

const stats = bankStats();
console.log(`Banks: ${JSON.stringify(stats)} | running: ${entries.length} (spec=${bankSpec})`);

function routeQuestion(q) {
  const ledger = new Set([
    "TSLA", "NVDA", "SPY", "AAPL", "META", "PLTR", "XLF", "GLD", "COIN", "AMD", "AMZN", "MSFT", "QQQ", "IWM",
  ]);
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
for (const entry of entries) {
  const route = routeQuestion(entry.q);
  rows.push({ q: entry.q, intent: route?.intent ?? null, ticker: route?.ticker ?? null });
}

const routerBad = entries.filter((e, i) => {
  const r = { intent: rows[i].intent };
  const fake = scoreAnswer(e, r, "x".repeat(100), 200);
  return fake.issues.some((x) => x.startsWith("intent"));
});

console.log(`\n=== Router pass (${entries.length} questions) ===`);
console.log(`Intent mismatches: ${routerBad.length}`);
for (const e of routerBad.slice(0, 40)) {
  const i = entries.indexOf(e);
  console.log(`  ✗ [${rows[i].intent}] ${e.q.slice(0, 72)}`);
}
if (routerBad.length > 40) console.log(`  … and ${routerBad.length - 40} more`);

let liveRows = [];
if (process.env.LARGO_STRESS_LIVE === "1") {
  const { mintAppSession } = await import("./audit/lib/app-session.mjs");
  const BASE = (process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
  const session = await mintAppSession({ appUrl: BASE });
  if (session.skip) {
    console.error("Live auth skip:", session.reason);
  } else {
    const concurrency = Math.max(1, Number(process.env.LARGO_STRESS_CONCURRENCY) || 1);
    console.log(`\n=== Live staging (${BASE}) concurrency=${concurrency} ===\n`);
    try {
      let idx = 0;
      async function worker() {
        while (idx < entries.length) {
          const i = idx++;
          const entry = entries[i];
          const { status, answer, source, ms } = await askStaging(session.cookieHeader, entry.q);
          const route = { intent: rows[i].intent };
          const scored = scoreAnswer(entry, route, answer, status);
          liveRows.push({
            ...entry,
            status,
            source,
            ms,
            answer_len: answer.length,
            ...scored,
            preview: answer.slice(0, 120),
          });
          const icon = scored.verdict === "OK" ? "✓" : scored.verdict === "WARN" ? "⚠" : "✗";
          console.log(`${icon} ${ms}ms ${scored.verdict} | ${entry.q.slice(0, 55)}`);
          if (scored.issues.length) console.log(`    ${scored.issues.join(", ")}`);
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      liveRows.sort((a, b) => entries.findIndex((e) => e.q === a.q) - entries.findIndex((e) => e.q === b.q));
    } finally {
      await session.cleanup?.();
    }
  }
}

const summary = {
  bank_spec: bankSpec,
  bank_stats: stats,
  total: entries.length,
  router_mismatch: routerBad.length,
  live_ok: liveRows.filter((r) => r.verdict === "OK").length,
  live_bad: liveRows.filter((r) => r.verdict === "BAD").length,
  live_warn: liveRows.filter((r) => r.verdict === "WARN").length,
};

const reportName =
  bankSpec === "1" ? "largo-stress-report.json" : `largo-stress-report-${bankSpec.replace(/[^a-z0-9]+/gi, "-")}.json`;

writeFileSync(join(OUT, reportName), JSON.stringify({ at: new Date().toISOString(), summary, router: rows, live: liveRows }, null, 2));
console.log(`\nWrote audit-output/${reportName}`);
console.log(JSON.stringify(summary, null, 2));

if (routerBad.length > 0 && process.env.LARGO_STRESS_ALLOW_ROUTER_FAIL !== "1") {
  process.exit(1);
}
if (summary.live_bad > 0) {
  process.exit(1);
}
