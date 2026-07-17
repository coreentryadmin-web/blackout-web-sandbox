#!/usr/bin/env node
/** Print intent mismatches for stress bank tuning. */
import { loadStressBank } from "./largo-stress-banks.mjs";
import { scoreAnswer } from "./largo-stress-scoring.mjs";
import { classifyBieIntent, classifyBieStagingFallback } from "../src/lib/bie/router.ts";
import { isCompoundQuestion } from "../src/lib/bie/decompose.ts";

const spec = process.env.LARGO_STRESS_BANK ?? "all";
const ledger = new Set(["TSLA", "NVDA", "SPY", "AAPL", "META", "PLTR", "XLF", "GLD", "COIN", "AMD", "AMZN", "MSFT", "QQQ", "IWM"]);
const bank = loadStressBank(spec);
let n = 0;
for (const e of bank) {
  const route = isCompoundQuestion(e.q)
    ? { intent: "compound_lookup", ticker: null }
    : classifyBieIntent(e.q, ledger) ?? classifyBieStagingFallback(e.q);
  const scored = scoreAnswer(e, route, "x".repeat(100), 200);
  if (scored.issues.some((x) => x.startsWith("intent"))) {
    n++;
    console.log(`${route?.intent}\t${e.q}`);
  }
}
console.error(`\n${n} mismatches / ${bank.length}`);
