import assert from "node:assert/strict";
import test from "node:test";
import { classifyBieIntent, bieFollowups } from "./router";
import { extractNumericClaims, collectContextNumbers, verifyClaims } from "./verifier";

const LEDGER = new Set(["NVDA", "TSLA"]);

// ── router classification ────────────────────────────────────────────────────────

test("router: today's plays questions route to the 0DTE board", () => {
  assert.equal(classifyBieIntent("How are today's plays doing?", LEDGER)?.intent, "zerodte_plays");
  assert.equal(classifyBieIntent("show me the 0dte plays", LEDGER)?.intent, "zerodte_plays");
  assert.equal(classifyBieIntent("0 DTE board?", LEDGER)?.intent, "zerodte_plays");
});

test("router: ledger-ticker state questions route; non-ledger tickers do NOT", () => {
  const r = classifyBieIntent("How is the NVDA play doing?", LEDGER);
  assert.equal(r?.intent, "ticker_play_state");
  assert.equal(r?.ticker, "NVDA");
  // AAPL isn't on today's ledger — general ticker question belongs to Claude.
  assert.equal(classifyBieIntent("How is the AAPL play doing?", LEDGER), null);
});

test("router: SPX structure and market context route", () => {
  assert.equal(classifyBieIntent("SPX levels and walls right now", LEDGER)?.intent, "spx_structure");
  assert.equal(classifyBieIntent("where is the SPX gamma flip", LEDGER)?.intent, "spx_structure");
  assert.equal(classifyBieIntent("What's the market doing?", LEDGER)?.intent, "market_context");
});

test("router: reasoning-shaped questions NEVER route — Claude keeps them", () => {
  assert.equal(classifyBieIntent("Why did the NVDA play stop out?", LEDGER), null);
  assert.equal(classifyBieIntent("Should I hold my TSLA play into the close?", LEDGER), null);
  assert.equal(classifyBieIntent("Explain the SPX gamma flip and what it means for tomorrow", LEDGER), null);
  // Long/compound questions carry nuance a lookup can't honor.
  assert.equal(
    classifyBieIntent(
      "How are today's plays doing? Also I'm worried about CPI tomorrow and whether the market can hold these levels into opex, what do you think about hedging?",
      LEDGER
    ),
    null
  );
});

test("router: every intent has follow-up chips (no LLM on the router path)", () => {
  for (const intent of ["zerodte_plays", "ticker_play_state", "spx_structure", "market_context"] as const) {
    assert.ok(bieFollowups(intent).length === 3);
  }
});

// ── claim extraction ─────────────────────────────────────────────────────────────

test("verifier: extracts prices/percents/dollars, skips years and small counts", () => {
  const claims = extractNumericClaims(
    "SPX is at 7,502.5 with the call wall at 7550. The play is +22% with entry $4.20. I see 3 plays today; back in 2024 this pattern held."
  );
  assert.deepEqual(claims, [7502.5, 7550, 22, 4.2]);
});

test("verifier: context numbers collected from nested objects and formatted strings", () => {
  const ctx = collectContextNumbers({
    spx: { price: 7502.5, walls: [7550, 7400] },
    note: "entry was $4.20 on 1,200 contracts",
  });
  assert.ok(ctx.includes(7502.5));
  assert.ok(ctx.includes(7550));
  assert.ok(ctx.includes(4.2));
  assert.ok(ctx.includes(1200));
});

test("verifier: claims match with rounding tolerance and desk-taught derivations", () => {
  const ctx = [7502.53, 4.2];
  // 7502.5 ≈ 7502.53; $8.40 = 2× the $4.20 entry (the +100% target the desk teaches).
  const v = verifyClaims("SPX 7502.5, target $8.40.", ctx);
  assert.equal(v.total, 2);
  assert.equal(v.verified, 2);
  assert.equal(v.coverage, 1);
});

test("verifier: invented numbers are flagged, coverage drops", () => {
  const v = verifyClaims("SPX is 7502.5 and I expect 9,999 by Friday with an 87% win rate.", [7502.5]);
  assert.equal(v.total, 3);
  assert.equal(v.verified, 1);
  assert.deepEqual(v.unverified, [9999, 87]);
  assert.ok(v.coverage < 0.5);
});

test("verifier: an answer with no numeric claims has full coverage", () => {
  const v = verifyClaims("The tape looks quiet; nothing clears the gates right now.", []);
  assert.equal(v.total, 0);
  assert.equal(v.coverage, 1);
});

// ── Layer 2: chunking + similarity (pure) ────────────────────────────────────────

import { chunkDocument, cosine } from "./embeddings";
import { assembleBieReport, formatBieReport } from "./report";

test("knowledge: documents chunk on paragraph boundaries under the cap", () => {
  const doc = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} ${"x".repeat(200)}`).join("\n\n");
  const chunks = chunkDocument(doc, 1200);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.length <= 1200));
  assert.match(chunks[0]!, /Paragraph 0/);
});

test("knowledge: oversized single paragraphs hard-split with overlap", () => {
  const chunks = chunkDocument("y".repeat(3000), 1200);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.length <= 1200));
});

test("knowledge: cosine similarity behaves (identical=1, orthogonal=0)", () => {
  assert.equal(Math.round(cosine([1, 2, 3], [1, 2, 3]) * 1000) / 1000, 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([], []), 0);
});

// ── Layer 5: daily self-eval assembly (pure) ─────────────────────────────────────

test("self-eval: coverage, verification and win-rate math", () => {
  const report = assembleBieReport(
    "2026-07-06",
    {
      total: 40,
      routed: 26,
      claude: 14,
      avg_claims_total: 8,
      avg_claims_verified: 7,
      avg_latency_router_ms: 180,
      avg_latency_claude_ms: 9200,
    },
    [
      { plan_outcome: "doubled", plan_pnl_pct: 100 },
      { plan_outcome: "stopped", plan_pnl_pct: -50 },
      { plan_outcome: "time_stop", plan_pnl_pct: 12 },
      { plan_outcome: null, plan_pnl_pct: null },
    ]
  );
  assert.equal(report.interactions.router_coverage_pct, 65);
  assert.equal(report.interactions.claude_calls_avoided, 26);
  assert.equal(report.interactions.verification_rate_pct, 87.5);
  assert.equal(report.zerodte.graded, 3);
  assert.equal(report.zerodte.wins, 2);
  assert.equal(report.zerodte.win_rate_pct, 66.7);
  const text = formatBieReport(report);
  assert.match(text, /65% coverage/);
  assert.match(text, /26/);
  assert.match(text, /2W\/1L/);
});
