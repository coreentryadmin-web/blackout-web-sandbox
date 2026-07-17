#!/usr/bin/env node
/**
 * Local compose pass for the 102-question bank — scores answers from classify + composeBieAnswer
 * (no HTTP). Use before deploy to catch platform-dump regressions.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { STRESS_BANK, scoreAnswer } from "./largo-stress-bank.mjs";
import { classifyBieIntent, classifyBieStagingFallback } from "../src/lib/bie/router.ts";
import { isCompoundQuestion } from "../src/lib/bie/decompose.ts";
import { composeBieAnswer } from "../src/lib/bie/composers.ts";

const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

function routeQuestion(q) {
  const ledger = new Set(["TSLA", "NVDA", "SPY", "AAPL", "META", "PLTR", "XLF", "GLD", "COIN"]);
  if (isCompoundQuestion(q)) return { intent: "compound_lookup", ticker: null };
  return classifyBieIntent(q, ledger) ?? classifyBieStagingFallback(q);
}

const rows = [];
for (const entry of STRESS_BANK) {
  const route = routeQuestion(entry.q);
  let answer = "";
  let err = null;
  try {
    if (route) {
      const composed = await composeBieAnswer(route, { question: entry.q });
      answer = composed?.answer ?? "";
    }
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const scored = scoreAnswer(entry, route, answer, err ? 500 : 200);
  rows.push({
    q: entry.q,
    intent: route?.intent ?? null,
    answer_len: answer.length,
    ...scored,
    preview: answer.slice(0, 140),
    err,
  });
  const icon = scored.verdict === "OK" ? "✓" : scored.verdict === "WARN" ? "⚠" : "✗";
  console.log(`${icon} ${scored.verdict} | ${entry.q.slice(0, 58)}`);
  if (scored.issues.length) console.log(`    ${scored.issues.join(", ")}`);
}

const summary = {
  total: rows.length,
  ok: rows.filter((r) => r.verdict === "OK").length,
  bad: rows.filter((r) => r.verdict === "BAD").length,
  warn: rows.filter((r) => r.verdict === "WARN").length,
};

writeFileSync(join(OUT, "largo-stress-compose.json"), JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 2));
console.log("\n", JSON.stringify(summary, null, 2));
