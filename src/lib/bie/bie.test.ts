import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBieIntent,
  classifyBieStagingFallback,
  bieFollowups,
  bieIntentBucket,
  isSpxDeskFallbackQuestion,
} from "./router";
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

test("router: SPX desk read and channel commentary route", () => {
  assert.equal(classifyBieIntent("What's the SPX setup right now?", LEDGER)?.intent, "spx_desk_read");
  assert.equal(classifyBieIntent("SPX desk read", LEDGER)?.intent, "spx_desk_read");
  assert.equal(classifyBieIntent("commentary on SPX channel", LEDGER)?.intent, "spx_desk_read");
});

test("router: isSpxDeskFallbackQuestion catches loose SPX asks including SPX why", () => {
  assert.equal(isSpxDeskFallbackQuestion("tell me about SPX gamma today"), true);
  assert.equal(isSpxDeskFallbackQuestion("why did SPX dump"), true);
  assert.equal(isSpxDeskFallbackQuestion("should I buy bonds"), false);
});

test("router: SPX-scoped why routes to synthesis desk read (BIE), not Claude", () => {
  assert.equal(classifyBieIntent("why is SPX below vwap", LEDGER)?.intent, "spx_desk_read");
  assert.equal(classifyBieIntent("why did SPX dump", LEDGER)?.intent, "spx_desk_read");
  assert.equal(classifyBieIntent("SPX why are dealers short gamma", LEDGER)?.intent, "spx_desk_read");
});

test("router: SPX-scoped explain routes to synthesis desk read (staging BIE)", () => {
  assert.equal(classifyBieIntent("explain SPX gamma flip", LEDGER)?.intent, "spx_desk_read");
  assert.equal(classifyBieIntent("SPX gex explain", LEDGER)?.intent, "spx_desk_read");
});

test("router: loose market context phrases route without exact match", () => {
  assert.equal(classifyBieIntent("how's the market tape today", LEDGER)?.intent, "market_context");
  assert.equal(classifyBieIntent("market backdrop right now", LEDGER)?.intent, "market_context");
});

test("router: classifyBieStagingFallback never leaves Largo without a route", () => {
  assert.equal(classifyBieStagingFallback("random question about hedging flows").intent, "flow_tape");
  assert.equal(classifyBieStagingFallback("tell me something").intent, "market_context");
  assert.equal(classifyBieStagingFallback("SPX gamma").intent, "spx_desk_read");
  assert.equal(classifyBieStagingFallback("what's going on with NVDA").intent, "ticker_ecosystem");
  assert.equal(classifyBieStagingFallback("what's going on with NVDA").ticker, "NVDA");
});

test("router: ticker advice and compare route before generic reasoning", () => {
  assert.equal(classifyBieIntent("Should I buy NVDA calls into earnings?", LEDGER)?.intent, "ticker_advice");
  assert.equal(classifyBieIntent("Should I buy NVDA calls into earnings?", LEDGER)?.ticker, "NVDA");
  const cmp = classifyBieIntent("compare NVDA vs AMD flow", LEDGER);
  assert.equal(cmp?.intent, "ticker_compare");
  assert.equal(cmp?.ticker, "NVDA");
  assert.equal(cmp?.ticker_b, "AMD");
});

test("router: SPX invalidation and flow tape", () => {
  assert.equal(classifyBieIntent("what would flip the SPX read", LEDGER)?.intent, "spx_invalidation");
  assert.equal(classifyBieIntent("any unusual flow right now", LEDGER)?.intent, "flow_tape");
});

test("router: reasoning-shaped questions without ticker advice route fall through", () => {
  assert.equal(classifyBieIntent("Why did the NVDA play stop out?", LEDGER), null);
  assert.equal(classifyBieIntent("Should I hold my TSLA play into the close?", LEDGER)?.intent, "ticker_advice");
  // SPX-scoped explain is BIE on staging; open-ended teach still falls through.
  assert.equal(classifyBieIntent("Explain how gamma hedging works in general", LEDGER), null);
  // Long/compound questions carry nuance a lookup can't honor.
  assert.equal(
    classifyBieIntent(
      "How are today's plays doing? Also I'm worried about CPI tomorrow and whether the market can hold these levels into opex, what do you think about hedging?",
      LEDGER
    ),
    null
  );
});

test("router: 'what's going on with' a known ticker routes to the ecosystem snapshot, even off-ledger", () => {
  const r = classifyBieIntent("What's going on with AAPL", LEDGER);
  assert.equal(r?.intent, "ticker_ecosystem");
  assert.equal(r?.ticker, "AAPL");
  // Any known ticker works, not just today's 0DTE ledger.
  assert.equal(classifyBieIntent("any flow on GOOGL", LEDGER)?.ticker, "GOOGL");
  assert.equal(classifyBieIntent("anything on COIN today", LEDGER)?.ticker, "COIN");
  assert.equal(classifyBieIntent("what's the latest on $RKLB", LEDGER)?.ticker, "RKLB");
});

test("router: 'what's going on with' never fires without a recognizable ticker", () => {
  // "IT" is a real word capitalized mid-sentence, not a ticker — must NOT mis-pin (LARGO-9 class bug).
  assert.equal(classifyBieIntent("what's going on with IT lately", LEDGER), null);
  assert.equal(classifyBieIntent("what's going on", LEDGER), null);
});

test("router: 'what does X think' phrasing stays with Claude (REASONING_RE wins, not the ecosystem branch)", () => {
  assert.equal(classifyBieIntent("what does the desk think about NVDA", LEDGER), null);
});

test("router: every intent has follow-up chips (no LLM on the router path)", () => {
  for (const intent of [
    "zerodte_plays",
    "ticker_play_state",
    "spx_structure",
    "spx_desk_read",
    "spx_invalidation",
    "market_context",
    "flow_tape",
    "ticker_ecosystem",
    "ticker_advice",
    "ticker_compare",
  ] as const) {
    assert.ok(bieFollowups(intent).length === 3);
  }
});

// ── task #103: bie_interactions.intent_bucket (groundwork for #112's self-eval loop) ──

test("bieIntentBucket: a matched route's intent name passes through unchanged", () => {
  for (const intent of ["zerodte_plays", "ticker_play_state", "spx_structure", "market_context"] as const) {
    assert.equal(bieIntentBucket(intent), intent);
  }
});

test("bieIntentBucket: null (the router's own no-match convention) becomes the explicit 'claude_fallback' sentinel", () => {
  assert.equal(bieIntentBucket(null), "claude_fallback");
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

test("verifier: router play-line numbers trace to board context (Layer 4 on bie-router path)", () => {
  const context = {
    ticker: "NVDA",
    direction: "long",
    strike: 142.5,
    status: "LIVE",
    entry_premium: 4.2,
    last_mark: 6.3,
    live_pnl_pct: 50,
    peak_score: 72,
    action: "Hold",
    intel: "Flow concentrated",
    graded: null,
  };
  const answer =
    "**LIVE** · **NVDA 142.5c** @ $4.20 (+50%)\n  Hold — Flow concentrated";
  const ctxNumbers = collectContextNumbers(context);
  const v = verifyClaims(answer, ctxNumbers);
  assert.equal(v.total, 3);
  assert.equal(v.verified, 3);
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

// ── Layer 5: calibration harness (pure) ──────────────────────────────────────────

import {
  computeCalibration,
  computeHelixToolCallCalibration,
  computeMarketContextToolCallCalibration,
  computeNighthawkToolCallCalibration,
  computeSpxCalibration,
  computeSpxToolCallCalibration,
  computeThermalToolCallCalibration,
  computeZeroDteToolCallCalibration,
  formatCalibration,
  formatHelixToolCallCalibration,
  formatMarketContextToolCallCalibration,
  formatNighthawkToolCallCalibration,
  formatSpxCalibration,
  formatSpxToolCallCalibration,
  formatThermalToolCallCalibration,
  formatZeroDteToolCallCalibration,
  type CalibrationInputRow,
  type HelixToolCallInputRow,
  type MarketContextToolCallInputRow,
  type NighthawkToolCallInputRow,
  type SpxCalibrationInputRow,
  type SpxToolCallInputRow,
  type ThermalToolCallInputRow,
  type ZeroDteToolCallInputRow,
} from "./calibration";

const calRow = (over: Partial<CalibrationInputRow>): CalibrationInputRow => ({
  session_date: "2026-07-06",
  score_max: 70,
  spike: false,
  first_flagged_at: "2026-07-06T14:15:00Z", // 10:15 ET — prime window
  plan_outcome: "doubled",
  plan_pnl_pct: 100,
  flags_json: null,
  ...over,
});

test("calibration: buckets by score band and cites evidence in recommendations", () => {
  const rows: CalibrationInputRow[] = [
    // score 55-64: 2W/10L over 12 → underperformer (n≥10)
    ...Array.from({ length: 10 }, () => calRow({ score_max: 58, plan_outcome: "stopped", plan_pnl_pct: -50 })),
    ...Array.from({ length: 2 }, () => calRow({ score_max: 58 })),
    // score 75+: 9W/2L over 11 → outperformer
    ...Array.from({ length: 9 }, () => calRow({ score_max: 80 })),
    ...Array.from({ length: 2 }, () => calRow({ score_max: 80, plan_outcome: "stopped", plan_pnl_pct: -50 })),
  ];
  const r = computeCalibration(rows, { since: "2026-06-22", through: "2026-07-06", sessions: 10 });
  assert.equal(r.graded_plays, 23);
  const low = r.by_score_band.find((b) => b.label === "score 55-64")!;
  assert.equal(low.n, 12);
  assert.equal(low.win_rate_pct, 16.7);
  assert.ok(r.recommendations.some((x) => /score 55-64 underperforms/.test(x)));
  assert.ok(r.recommendations.some((x) => /score 75\+ outperforms/.test(x)));
});

test("calibration: refuses to recommend on thin evidence — waits for n≥10", () => {
  const rows = Array.from({ length: 5 }, () => calRow({ score_max: 58, plan_outcome: "stopped", plan_pnl_pct: -50 }));
  const r = computeCalibration(rows, { since: "2026-07-01", through: "2026-07-06", sessions: 3 });
  assert.equal(r.recommendations.length, 0);
  assert.match(formatCalibration(r), /never tunes on noise/);
});

test("calibration: ungraded rows are excluded from every bucket", () => {
  const rows = [calRow({}), calRow({ plan_outcome: null, plan_pnl_pct: null }), calRow({ plan_outcome: "ungradeable" })];
  const r = computeCalibration(rows, { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  assert.equal(r.graded_plays, 1);
});

// ── Layer 5: SPX Slayer calibration pass (additive, parallel to the 0DTE pass above) ─

const spxRow = (over: Partial<SpxCalibrationInputRow>): SpxCalibrationInputRow => ({
  session_date: "2026-07-06",
  grade: "B",
  outcome: "win",
  pnl_pts: 5,
  opened_at: "2026-07-06T14:15:00Z", // 10:15 ET — prime window
  ...over,
});

test("spx calibration: buckets by grade band and time-of-day, cites evidence in recommendations", () => {
  const rows: SpxCalibrationInputRow[] = [
    // grade C/D: 2W/10L over 12 → underperformer (n≥10)
    ...Array.from({ length: 10 }, () => spxRow({ grade: "C", outcome: "loss", pnl_pts: -3 })),
    ...Array.from({ length: 2 }, () => spxRow({ grade: "C", outcome: "win", pnl_pts: 4 })),
    // grade A/A+: 9W/2L over 11 → outperformer
    ...Array.from({ length: 9 }, () => spxRow({ grade: "A", outcome: "win", pnl_pts: 6 })),
    ...Array.from({ length: 2 }, () => spxRow({ grade: "A", outcome: "loss", pnl_pts: -2 })),
  ];
  const r = computeSpxCalibration(rows, { since: "2026-06-22", through: "2026-07-06", sessions: 10 });
  assert.equal(r.closed_plays, 23);
  const low = r.by_grade_band.find((b) => b.label === "C/D")!;
  assert.equal(low.n, 12);
  assert.equal(low.win_rate_pct, 16.7);
  assert.ok(r.recommendations.some((x) => /SPX Slayer grade C\/D underperforms/.test(x)));
  assert.ok(r.recommendations.some((x) => /SPX Slayer grade A\/A\+ outperforms/.test(x)));
});

test("spx calibration: refuses to recommend on thin evidence — waits for n≥10, same gate as 0DTE", () => {
  const rows = Array.from({ length: 5 }, () => spxRow({ grade: "C", outcome: "loss", pnl_pts: -3 }));
  const r = computeSpxCalibration(rows, { since: "2026-07-01", through: "2026-07-06", sessions: 3 });
  assert.equal(r.recommendations.length, 0);
  assert.match(formatSpxCalibration(r), /never tunes on noise/);
});

test("spx calibration: open (unclosed) plays are excluded from every bucket", () => {
  const rows = [spxRow({}), spxRow({ outcome: "open", pnl_pts: null })];
  const r = computeSpxCalibration(rows, { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  assert.equal(r.closed_plays, 1);
});

test("calibration: combined report clearly labels the 0DTE vs SPX Slayer sections", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const spx = computeSpxCalibration([spxRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const text = formatCalibration({ ...zeroDte, spx_slayer: spx });
  assert.match(text, /0DTE Command calibration/);
  assert.match(text, /SPX Slayer calibration/);
});

test("calibration: without an attached SPX pass the report stays 0DTE-only — no restructuring", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  assert.equal(zeroDte.spx_slayer, null);
  assert.doesNotMatch(formatCalibration(zeroDte), /SPX Slayer/);
});

// ── Task #112: SPX-tool-calling cohort within bie_interactions ──────────────────
// Largo's own answer-quality cohort — turns where SPX Slayer's live-engine state
// was involved, either via a real tool dispatch (Claude path) or the router's
// spx_structure composer (which reads the same engine state internally but never
// records a real tool name — see isSpxToolCallingRow's doc comment).

const spxToolRow = (over: Partial<SpxToolCallInputRow>): SpxToolCallInputRow => ({
  tools_used: ["live_feed_capture", "get_spx_play"],
  intent_bucket: "claude_fallback",
  answer_source: "claude",
  claims_total: 4,
  claims_verified: 4,
  latency_ms: 3000,
  ...over,
});

test("spx tool-call calibration: cohort includes tools_used intersecting SPX_ENGINE_TOOL_NAMES, excludes generic-only turns", () => {
  const rows: SpxToolCallInputRow[] = [
    spxToolRow({ tools_used: ["live_feed_capture", "get_spx_play"] }), // in cohort
    spxToolRow({ tools_used: ["live_feed_capture", "get_quote", "get_gex"] }), // generic-only — NOT in cohort
    spxToolRow({ tools_used: ["live_feed_capture", "get_signal_log"] }), // in cohort
  ];
  const r = computeSpxToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
});

test("spx tool-call calibration: a router-matched spx_structure row joins the cohort despite tools_used being the router's sentinel", () => {
  const rows: SpxToolCallInputRow[] = [
    spxToolRow({
      tools_used: ["blackout_intelligence"],
      intent_bucket: "spx_structure",
      answer_source: "bie-router",
      claims_total: 5,
      claims_verified: 5,
      latency_ms: 40,
    }),
    // A router match for a DIFFERENT product (0DTE board) never joins this cohort.
    spxToolRow({ tools_used: ["blackout_intelligence"], intent_bucket: "zerodte_plays", answer_source: "bie-router" }),
  ];
  const r = computeSpxToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 1);
  assert.equal(r.router_matched_n, 1);
  assert.equal(r.claude_fallback_n, 0);
  assert.equal(r.router_match_rate_pct, 100);
});

test("spx tool-call calibration: aggregate grounding pass rate, router-match rate, and avg latency over a mixed cohort", () => {
  const rows: SpxToolCallInputRow[] = [
    spxToolRow({ tools_used: ["get_spx_play"], answer_source: "claude", claims_total: 4, claims_verified: 4, latency_ms: 4000 }),
    spxToolRow({ tools_used: ["get_open_plays"], answer_source: "claude", claims_total: 6, claims_verified: 3, latency_ms: 6000 }),
    spxToolRow({
      tools_used: ["blackout_intelligence"],
      intent_bucket: "spx_structure",
      answer_source: "bie-router",
      claims_total: 5,
      claims_verified: 5,
      latency_ms: 40,
    }),
  ];
  const r = computeSpxToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 3);
  assert.equal(r.claude_fallback_n, 2);
  assert.equal(r.router_matched_n, 1);
  assert.equal(r.router_match_rate_pct, 33.3);
  // sum(verified)/sum(total) = (4+3+5)/(4+6+5) = 12/15 = 80% — weighted, not an
  // unweighted average of each row's own ratio.
  assert.equal(r.grounding_pass_rate_pct, 80);
  // (4000 + 6000 + 40) / 3 = 3346.67 → rounds to 3347.
  assert.equal(r.avg_latency_ms, 3347);
});

test("spx tool-call calibration: turns with zero numeric claims are excluded from the grounding ratio but still counted in n", () => {
  const rows: SpxToolCallInputRow[] = [
    spxToolRow({ tools_used: ["get_spx_play"], claims_total: 0, claims_verified: 0 }),
    spxToolRow({ tools_used: ["get_spx_play"], claims_total: 4, claims_verified: 2 }),
  ];
  const r = computeSpxToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
  assert.equal(r.grounding_pass_rate_pct, 50);
});

test("spx tool-call calibration: refuses to recommend on thin evidence — waits for n≥10, same gate as the other passes", () => {
  const rows = Array.from({ length: 5 }, () =>
    spxToolRow({ tools_used: ["get_spx_play"], claims_total: 4, claims_verified: 1 })
  );
  const r = computeSpxToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.recommendations.length, 0);
  assert.match(formatSpxToolCallCalibration(r), /never tunes on noise/);
});

test("spx tool-call calibration: cites low grounding and low router-match-rate once evidence clears n≥10", () => {
  const rows: SpxToolCallInputRow[] = Array.from({ length: 10 }, () =>
    spxToolRow({ tools_used: ["get_spx_play"], answer_source: "claude", claims_total: 4, claims_verified: 1 })
  );
  const r = computeSpxToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.n, 10);
  assert.equal(r.grounding_pass_rate_pct, 25);
  assert.equal(r.router_match_rate_pct, 0);
  assert.ok(r.recommendations.some((x) => /show only 25% claim grounding/.test(x)));
  assert.ok(r.recommendations.some((x) => /Only 0% of SPX-tool-calling turns were answered by the deterministic router/.test(x)));
});

test("spx tool-call calibration: empty cohort reports null rates, not zero/NaN", () => {
  const r = computeSpxToolCallCalibration([], { since: "2026-07-06", through: "2026-07-06" });
  assert.equal(r.n, 0);
  assert.equal(r.router_match_rate_pct, null);
  assert.equal(r.grounding_pass_rate_pct, null);
  assert.equal(r.avg_latency_ms, null);
  assert.match(formatSpxToolCallCalibration(r), /no graded claims yet/);
});

test("calibration: combined report can carry all three sections — 0DTE, SPX Slayer outcomes, and SPX-tool-calling turns", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const spx = computeSpxCalibration([spxRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const toolCalls = computeSpxToolCallCalibration([spxToolRow({ tools_used: ["get_spx_play"] })], {
    since: "2026-07-06",
    through: "2026-07-06",
  });
  const text = formatCalibration({ ...zeroDte, spx_slayer: spx, spx_tool_calls: toolCalls });
  assert.match(text, /0DTE Command calibration/);
  assert.match(text, /SPX Slayer calibration/);
  assert.match(text, /SPX-tool-calling Largo turns/);
});

test("calibration: without an attached spx_tool_calls pass, the report doesn't grow a third section", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  assert.equal(zeroDte.spx_tool_calls, null);
  assert.doesNotMatch(formatCalibration(zeroDte), /SPX-tool-calling/);
});

// ── Task #133: HELIX-tool-calling cohort within bie_interactions ────────────────
// Largo's own answer-quality cohort — turns where HELIX's own tape/anomaly-
// detector state was involved. Unlike the SPX cohort above, membership is a PURE
// tools_used check — there is no deterministic HELIX router intent to OR in (see
// isHelixToolCallingRow's doc comment in calibration.ts), so every row here uses
// answer_source: "claude" by default and router_matched_n/router_match_rate_pct
// are expected to read 0/0% throughout.

const helixToolRow = (over: Partial<HelixToolCallInputRow>): HelixToolCallInputRow => ({
  tools_used: ["live_feed_capture", "get_flow_tape"],
  intent_bucket: "claude_fallback",
  answer_source: "claude",
  claims_total: 4,
  claims_verified: 4,
  latency_ms: 3000,
  ...over,
});

test("helix tool-call calibration: cohort includes tools_used intersecting HELIX_ENGINE_TOOL_NAMES, excludes generic-only turns", () => {
  const rows: HelixToolCallInputRow[] = [
    helixToolRow({ tools_used: ["live_feed_capture", "get_flow_tape"] }), // in cohort
    helixToolRow({ tools_used: ["live_feed_capture", "get_options_flow", "get_dark_pool"] }), // generic-only — NOT in cohort
    helixToolRow({ tools_used: ["live_feed_capture", "get_flow_anomaly_near_misses"] }), // in cohort
  ];
  const r = computeHelixToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
});

test("helix tool-call calibration: a router-matched row NEVER joins the cohort — no intent_bucket OR-clause exists for HELIX", () => {
  const rows: HelixToolCallInputRow[] = [
    // Even a bie-router answer_source with the router's sentinel tools_used does
    // NOT join — isHelixToolCallingRow is tools_used-only, unlike SPX's UNION test.
    helixToolRow({
      tools_used: ["blackout_intelligence"],
      intent_bucket: "spx_structure",
      answer_source: "bie-router",
    }),
  ];
  const r = computeHelixToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 0);
  assert.equal(r.router_matched_n, 0);
  assert.equal(r.router_match_rate_pct, null);
});

test("helix tool-call calibration: aggregate grounding pass rate and avg latency over a mixed cohort, router-match rate stays 0", () => {
  const rows: HelixToolCallInputRow[] = [
    helixToolRow({ tools_used: ["get_flow_tape"], claims_total: 4, claims_verified: 4, latency_ms: 4000 }),
    helixToolRow({ tools_used: ["get_flow_anomaly_near_misses"], claims_total: 6, claims_verified: 3, latency_ms: 6000 }),
    helixToolRow({ tools_used: ["get_flow_tape", "get_flow_anomaly_near_misses"], claims_total: 5, claims_verified: 5, latency_ms: 2000 }),
  ];
  const r = computeHelixToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 3);
  assert.equal(r.claude_fallback_n, 3);
  assert.equal(r.router_matched_n, 0);
  assert.equal(r.router_match_rate_pct, 0);
  // sum(verified)/sum(total) = (4+3+5)/(4+6+5) = 12/15 = 80% — weighted, not an
  // unweighted average of each row's own ratio.
  assert.equal(r.grounding_pass_rate_pct, 80);
  // (4000 + 6000 + 2000) / 3 = 4000.
  assert.equal(r.avg_latency_ms, 4000);
});

test("helix tool-call calibration: turns with zero numeric claims are excluded from the grounding ratio but still counted in n", () => {
  const rows: HelixToolCallInputRow[] = [
    helixToolRow({ tools_used: ["get_flow_tape"], claims_total: 0, claims_verified: 0 }),
    helixToolRow({ tools_used: ["get_flow_tape"], claims_total: 4, claims_verified: 2 }),
  ];
  const r = computeHelixToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
  assert.equal(r.grounding_pass_rate_pct, 50);
});

test("helix tool-call calibration: refuses to recommend on thin evidence — waits for n≥10, same gate as the other passes", () => {
  const rows = Array.from({ length: 5 }, () =>
    helixToolRow({ tools_used: ["get_flow_tape"], claims_total: 4, claims_verified: 1 })
  );
  const r = computeHelixToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.recommendations.length, 0);
  assert.match(formatHelixToolCallCalibration(r), /never tunes on noise/);
});

test("helix tool-call calibration: at n=10 evidence clears and low grounding fires a recommendation (no router-match recommendation exists)", () => {
  const rows: HelixToolCallInputRow[] = Array.from({ length: 10 }, () =>
    helixToolRow({ tools_used: ["get_flow_tape"], claims_total: 4, claims_verified: 1 })
  );
  const r = computeHelixToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.n, 10);
  assert.equal(r.grounding_pass_rate_pct, 25);
  assert.equal(r.router_match_rate_pct, 0);
  assert.ok(r.recommendations.some((x) => /show only 25% claim grounding/.test(x)));
  // Unlike the SPX pass, there is no "Only X% ... answered by the deterministic
  // router" recommendation for HELIX — a permanent, structural 0% would be noise,
  // not evidence-cited signal (see isHelixToolCallingRow's doc comment).
  assert.equal(r.recommendations.length, 1);
});

test("helix tool-call calibration: empty cohort reports null rates, not zero/NaN", () => {
  const r = computeHelixToolCallCalibration([], { since: "2026-07-06", through: "2026-07-06" });
  assert.equal(r.n, 0);
  assert.equal(r.router_match_rate_pct, null);
  assert.equal(r.grounding_pass_rate_pct, null);
  assert.equal(r.avg_latency_ms, null);
  assert.match(formatHelixToolCallCalibration(r), /no graded claims yet/);
});

test("calibration: combined report can carry all four sections — 0DTE, SPX Slayer outcomes, SPX-tool-calling, and HELIX-tool-calling turns", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const spx = computeSpxCalibration([spxRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const spxToolCalls = computeSpxToolCallCalibration([spxToolRow({ tools_used: ["get_spx_play"] })], {
    since: "2026-07-06",
    through: "2026-07-06",
  });
  const helixToolCalls = computeHelixToolCallCalibration([helixToolRow({ tools_used: ["get_flow_tape"] })], {
    since: "2026-07-06",
    through: "2026-07-06",
  });
  const text = formatCalibration({
    ...zeroDte,
    spx_slayer: spx,
    spx_tool_calls: spxToolCalls,
    helix_tool_calls: helixToolCalls,
  });
  assert.match(text, /0DTE Command calibration/);
  assert.match(text, /SPX Slayer calibration/);
  assert.match(text, /SPX-tool-calling Largo turns/);
  assert.match(text, /HELIX-tool-calling Largo turns/);
});

test("calibration: without an attached helix_tool_calls pass, the report doesn't grow a fourth section", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  assert.equal(zeroDte.helix_tool_calls, null);
  assert.doesNotMatch(formatCalibration(zeroDte), /HELIX-tool-calling/);
});

// ── Task #137: Thermal-tool-calling cohort within bie_interactions ──────────────
// Same shape as task #112's SPX-tool-calling cohort above, but for BlackOut
// Thermal (the GEX/dealer-positioning product behind /heatmap). The one
// deliberate asymmetry: BIE's router has NO Thermal/GEX intent at all (only
// zerodte_plays/ticker_play_state/spx_structure/market_context exist), so unlike
// isSpxToolCallingRow there is no intent_bucket OR-clause — see
// isThermalToolCallingRow's doc comment in calibration.ts.

const thermalToolRow = (over: Partial<ThermalToolCallInputRow>): ThermalToolCallInputRow => ({
  tools_used: ["live_feed_capture", "get_positioning"],
  intent_bucket: null,
  answer_source: "claude",
  claims_total: 4,
  claims_verified: 4,
  latency_ms: 1200,
  ...over,
});

test("thermal tool-call calibration: cohort includes tools_used intersecting THERMAL_ENGINE_TOOL_NAMES, excludes generic-only turns", () => {
  const rows: ThermalToolCallInputRow[] = [
    thermalToolRow({ tools_used: ["live_feed_capture", "get_positioning"] }), // in cohort
    thermalToolRow({ tools_used: ["live_feed_capture", "get_quote", "get_gex"] }), // generic-only (get_gex excluded) — NOT in cohort
    thermalToolRow({ tools_used: ["live_feed_capture", "get_gex_regime_events"] }), // in cohort
  ];
  const r = computeThermalToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
});

test("thermal tool-call calibration: a router-sentinel row never joins the cohort, for ANY intent_bucket — BIE has no Thermal router intent to OR in", () => {
  const rows: ThermalToolCallInputRow[] = [
    thermalToolRow({ tools_used: ["blackout_intelligence"], intent_bucket: "spx_structure", answer_source: "bie-router" }),
    thermalToolRow({ tools_used: ["blackout_intelligence"], intent_bucket: "market_context", answer_source: "bie-router" }),
  ];
  const r = computeThermalToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 0);
  assert.equal(r.router_matched_n, 0);
});

test("thermal tool-call calibration: aggregate grounding pass rate and avg latency over a mixed cohort; router_matched_n is honestly 0", () => {
  const rows: ThermalToolCallInputRow[] = [
    thermalToolRow({ tools_used: ["get_positioning"], answer_source: "claude", claims_total: 4, claims_verified: 4, latency_ms: 4000 }),
    thermalToolRow({ tools_used: ["get_gex_regime_events"], answer_source: "claude", claims_total: 6, claims_verified: 3, latency_ms: 6000 }),
  ];
  const r = computeThermalToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
  assert.equal(r.claude_fallback_n, 2);
  assert.equal(r.router_matched_n, 0);
  assert.equal(r.router_match_rate_pct, 0);
  // sum(verified)/sum(total) = (4+3)/(4+6) = 7/10 = 70% — weighted, not an
  // unweighted average of each row's own ratio.
  assert.equal(r.grounding_pass_rate_pct, 70);
  // (4000 + 6000) / 2 = 5000.
  assert.equal(r.avg_latency_ms, 5000);
});

test("thermal tool-call calibration: turns with zero numeric claims are excluded from the grounding ratio but still counted in n", () => {
  const rows: ThermalToolCallInputRow[] = [
    thermalToolRow({ tools_used: ["get_positioning"], claims_total: 0, claims_verified: 0 }),
    thermalToolRow({ tools_used: ["get_positioning"], claims_total: 4, claims_verified: 2 }),
  ];
  const r = computeThermalToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
  assert.equal(r.grounding_pass_rate_pct, 50);
});

test("thermal tool-call calibration: refuses to recommend on thin evidence — waits for n≥10, same gate as the other passes", () => {
  const rows = Array.from({ length: 5 }, () =>
    thermalToolRow({ tools_used: ["get_positioning"], claims_total: 4, claims_verified: 1 })
  );
  const r = computeThermalToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.recommendations.length, 0);
  assert.match(formatThermalToolCallCalibration(r), /never tunes on noise/);
});

test("thermal tool-call calibration: cites low grounding and the router-coverage gap once evidence clears n≥10", () => {
  const rows: ThermalToolCallInputRow[] = Array.from({ length: 10 }, () =>
    thermalToolRow({ tools_used: ["get_positioning"], answer_source: "claude", claims_total: 4, claims_verified: 1 })
  );
  const r = computeThermalToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.n, 10);
  assert.equal(r.grounding_pass_rate_pct, 25);
  assert.equal(r.router_match_rate_pct, 0);
  assert.ok(r.recommendations.some((x) => /show only 25% claim grounding/.test(x)));
  assert.ok(r.recommendations.some((x) => /Only 0% of Thermal-tool-calling turns were answered by the deterministic router/.test(x)));
});

test("thermal tool-call calibration: empty cohort reports null rates, not zero/NaN", () => {
  const r = computeThermalToolCallCalibration([], { since: "2026-07-06", through: "2026-07-06" });
  assert.equal(r.n, 0);
  assert.equal(r.router_match_rate_pct, null);
  assert.equal(r.grounding_pass_rate_pct, null);
  assert.equal(r.avg_latency_ms, null);
  assert.match(formatThermalToolCallCalibration(r), /no graded claims yet/);
});

test("calibration: combined report can carry all four sections — 0DTE, SPX Slayer outcomes, SPX-tool-calling, and Thermal-tool-calling turns", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const spx = computeSpxCalibration([spxRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const spxToolCalls = computeSpxToolCallCalibration([spxToolRow({ tools_used: ["get_spx_play"] })], {
    since: "2026-07-06",
    through: "2026-07-06",
  });
  const thermalToolCalls = computeThermalToolCallCalibration([thermalToolRow({ tools_used: ["get_positioning"] })], {
    since: "2026-07-06",
    through: "2026-07-06",
  });
  const text = formatCalibration({
    ...zeroDte,
    spx_slayer: spx,
    spx_tool_calls: spxToolCalls,
    thermal_tool_calls: thermalToolCalls,
  });
  assert.match(text, /0DTE Command calibration/);
  assert.match(text, /SPX Slayer calibration/);
  assert.match(text, /SPX-tool-calling Largo turns/);
  assert.match(text, /Thermal-tool-calling Largo turns/);
});

test("calibration: without an attached thermal_tool_calls pass, the report doesn't grow a fourth section", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  assert.equal(zeroDte.thermal_tool_calls, null);
  assert.doesNotMatch(formatCalibration(zeroDte), /Thermal-tool-calling/);
});

// ── Task #144: Night-Hawk-tool-calling cohort within bie_interactions ───────────
// Same idea as the task #112 SPX block above, applied to Night Hawk. Cohort
// membership is tools_used-ONLY (no intent_bucket OR-clause) because there is no
// deterministic BIE router intent for Night Hawk questions at all — see
// isNighthawkToolCallingRow's doc comment in calibration.ts.

const nighthawkToolRow = (over: Partial<NighthawkToolCallInputRow>): NighthawkToolCallInputRow => ({
  tools_used: ["live_feed_capture", "get_nighthawk_edition"],
  intent_bucket: "claude_fallback",
  answer_source: "claude",
  claims_total: 4,
  claims_verified: 4,
  latency_ms: 3000,
  ...over,
});

test("nighthawk tool-call calibration: cohort includes tools_used intersecting NIGHTHAWK_ENGINE_TOOL_NAMES, excludes generic-only turns", () => {
  const rows: NighthawkToolCallInputRow[] = [
    nighthawkToolRow({ tools_used: ["live_feed_capture", "get_nighthawk_edition"] }), // in cohort
    nighthawkToolRow({ tools_used: ["live_feed_capture", "get_quote", "get_gex"] }), // generic-only — NOT in cohort
    nighthawkToolRow({ tools_used: ["live_feed_capture", "get_nighthawk_dossier"] }), // in cohort
  ];
  const r = computeNighthawkToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
});

test("nighthawk tool-call calibration: an intent_bucket alone, WITHOUT a matching tool call, never joins the cohort", () => {
  // Unlike the SPX cohort, there is no router path that can answer a Night Hawk
  // question deterministically — so even a made-up "nighthawk"-flavored
  // intent_bucket must NOT be enough on its own to admit a row (guards against a
  // future edit reintroducing an OR-clause that isn't backed by a real router
  // intent).
  const rows: NighthawkToolCallInputRow[] = [
    nighthawkToolRow({ tools_used: ["blackout_intelligence"], intent_bucket: "nighthawk_edition", answer_source: "bie-router" }),
  ];
  const r = computeNighthawkToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 0);
});

test("nighthawk tool-call calibration: aggregate grounding pass rate and avg latency over a mixed cohort; router_matched_n is honestly 0", () => {
  const rows: NighthawkToolCallInputRow[] = [
    nighthawkToolRow({ tools_used: ["get_nighthawk_edition"], answer_source: "claude", claims_total: 4, claims_verified: 4, latency_ms: 4000 }),
    nighthawkToolRow({ tools_used: ["get_nighthawk_outcomes"], answer_source: "claude", claims_total: 6, claims_verified: 3, latency_ms: 6000 }),
    nighthawkToolRow({ tools_used: ["get_nighthawk_dossier"], answer_source: "claude", claims_total: 5, claims_verified: 5, latency_ms: 40 }),
  ];
  const r = computeNighthawkToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 3);
  assert.equal(r.claude_fallback_n, 3);
  // No deterministic router intent for Night Hawk exists — always 0, never fabricated.
  assert.equal(r.router_matched_n, 0);
  assert.equal(r.router_match_rate_pct, 0);
  // sum(verified)/sum(total) = (4+3+5)/(4+6+5) = 12/15 = 80% — weighted, not an
  // unweighted average of each row's own ratio.
  assert.equal(r.grounding_pass_rate_pct, 80);
  // (4000 + 6000 + 40) / 3 = 3346.67 → rounds to 3347.
  assert.equal(r.avg_latency_ms, 3347);
});

test("nighthawk tool-call calibration: turns with zero numeric claims are excluded from the grounding ratio but still counted in n", () => {
  const rows: NighthawkToolCallInputRow[] = [
    nighthawkToolRow({ tools_used: ["get_nighthawk_edition"], claims_total: 0, claims_verified: 0 }),
    nighthawkToolRow({ tools_used: ["get_nighthawk_edition"], claims_total: 4, claims_verified: 2 }),
  ];
  const r = computeNighthawkToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
  assert.equal(r.grounding_pass_rate_pct, 50);
});

test("nighthawk tool-call calibration: refuses to recommend on thin evidence — waits for n≥10, same gate as the other passes", () => {
  const rows = Array.from({ length: 5 }, () =>
    nighthawkToolRow({ tools_used: ["get_nighthawk_edition"], claims_total: 4, claims_verified: 1 })
  );
  const r = computeNighthawkToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.recommendations.length, 0);
  assert.match(formatNighthawkToolCallCalibration(r), /never tunes on noise/);
});

test("nighthawk tool-call calibration: exactly n=10 clears the evidence gate and cites low grounding", () => {
  const rows: NighthawkToolCallInputRow[] = Array.from({ length: 10 }, () =>
    nighthawkToolRow({ tools_used: ["get_nighthawk_edition"], answer_source: "claude", claims_total: 4, claims_verified: 1 })
  );
  const r = computeNighthawkToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.n, 10);
  assert.equal(r.grounding_pass_rate_pct, 25);
  assert.ok(r.recommendations.some((x) => /show only 25% claim grounding/.test(x)));
  // Deliberately no "router coverage" recommendation for Night Hawk — see
  // computeNighthawkToolCallCalibration's comment: with router_matched_n
  // structurally always 0, that recommendation would fire on every report
  // forever and teach a reader to ignore this section.
  assert.ok(!r.recommendations.some((x) => /router/i.test(x)));
});

test("nighthawk tool-call calibration: n=11 (just above the gate) still cites low grounding", () => {
  const rows: NighthawkToolCallInputRow[] = Array.from({ length: 11 }, () =>
    nighthawkToolRow({ tools_used: ["get_nighthawk_edition"], answer_source: "claude", claims_total: 4, claims_verified: 1 })
  );
  const r = computeNighthawkToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.n, 11);
  assert.ok(r.recommendations.some((x) => /show only 25% claim grounding/.test(x)));
});

test("nighthawk tool-call calibration: empty cohort reports null rates, not zero/NaN", () => {
  const r = computeNighthawkToolCallCalibration([], { since: "2026-07-06", through: "2026-07-06" });
  assert.equal(r.n, 0);
  assert.equal(r.router_match_rate_pct, null);
  assert.equal(r.grounding_pass_rate_pct, null);
  assert.equal(r.avg_latency_ms, null);
  assert.match(formatNighthawkToolCallCalibration(r), /no graded claims yet/);
});

test("calibration: combined report can carry all four sections — 0DTE, SPX Slayer outcomes, SPX-tool-calling, and Night-Hawk-tool-calling turns", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const spx = computeSpxCalibration([spxRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const spxToolCalls = computeSpxToolCallCalibration([spxToolRow({ tools_used: ["get_spx_play"] })], {
    since: "2026-07-06",
    through: "2026-07-06",
  });
  const nighthawkToolCalls = computeNighthawkToolCallCalibration(
    [nighthawkToolRow({ tools_used: ["get_nighthawk_edition"] })],
    { since: "2026-07-06", through: "2026-07-06" }
  );
  const text = formatCalibration({
    ...zeroDte,
    spx_slayer: spx,
    spx_tool_calls: spxToolCalls,
    nighthawk_tool_calls: nighthawkToolCalls,
  });
  assert.match(text, /0DTE Command calibration/);
  assert.match(text, /SPX Slayer calibration/);
  assert.match(text, /SPX-tool-calling Largo turns/);
  assert.match(text, /Night-Hawk-tool-calling Largo turns/);
});

test("calibration: without an attached nighthawk_tool_calls pass, the report doesn't grow a fourth section", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  assert.equal(zeroDte.nighthawk_tool_calls, null);
  assert.doesNotMatch(formatCalibration(zeroDte), /Night-Hawk-tool-calling/);
});

// ── Task #149: 0DTE-Command-tool-calling cohort within bie_interactions ─────────
// Direct analogue of the task #112 SPX-tool-calling cohort above, applied to 0DTE
// Command (the SEPARATE multi-ticker `/grid` scanner, per task #127's standing
// disambiguation — not SPX Slayer). Largo's own answer-quality cohort for turns
// where 0DTE Command's live board state was involved, either via a real tool
// dispatch (Claude path) or the router's zerodte_plays composer (which reads the
// same board state internally but never records a real tool name — see
// isZeroDteToolCallingRow's doc comment).

const zeroDteToolRow = (over: Partial<ZeroDteToolCallInputRow>): ZeroDteToolCallInputRow => ({
  tools_used: ["live_feed_capture", "get_zerodte_plays"],
  intent_bucket: "claude_fallback",
  answer_source: "claude",
  claims_total: 4,
  claims_verified: 4,
  latency_ms: 3000,
  ...over,
});

test("zerodte tool-call calibration: cohort includes tools_used intersecting ZERODTE_ENGINE_TOOL_NAMES, excludes generic-only turns", () => {
  const rows: ZeroDteToolCallInputRow[] = [
    zeroDteToolRow({ tools_used: ["live_feed_capture", "get_zerodte_plays"] }), // in cohort
    zeroDteToolRow({ tools_used: ["live_feed_capture", "get_quote", "get_gex"] }), // generic-only — NOT in cohort
    zeroDteToolRow({ tools_used: ["live_feed_capture", "get_zerodte_rejections"] }), // in cohort
  ];
  const r = computeZeroDteToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
});

test("zerodte tool-call calibration: a router-matched zerodte_plays row joins the cohort despite tools_used being the router's sentinel", () => {
  const rows: ZeroDteToolCallInputRow[] = [
    zeroDteToolRow({
      tools_used: ["blackout_intelligence"],
      intent_bucket: "zerodte_plays",
      answer_source: "bie-router",
      claims_total: 5,
      claims_verified: 5,
      latency_ms: 40,
    }),
    // A router match for a DIFFERENT product (SPX structure) never joins this cohort.
    zeroDteToolRow({ tools_used: ["blackout_intelligence"], intent_bucket: "spx_structure", answer_source: "bie-router" }),
  ];
  const r = computeZeroDteToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 1);
  assert.equal(r.router_matched_n, 1);
  assert.equal(r.claude_fallback_n, 0);
  assert.equal(r.router_match_rate_pct, 100);
});

// ── Task #162: fix the undercounted `ticker_play_state` intent_bucket ──────
// composeTickerPlayState ("how's the NVDA play") reads the exact same
// zeroDtePlaysForLargo() board as composeZeroDtePlays above, just filtered to
// one ticker — genuinely 0DTE Command engine state — but router.ts logs ITS
// intent_bucket as the distinct string "ticker_play_state", not
// "zerodte_plays". Before this fix, isZeroDteToolCallingRow's OR-condition
// only checked for "zerodte_plays", so a ticker_play_state row matched
// neither the tools_used arm (router path always logs the
// ["blackout_intelligence"] sentinel) nor the intent_bucket arm — invisible
// to the cohort despite answering from live 0DTE Command state.
test("zerodte tool-call calibration: a router-matched ticker_play_state row now joins the cohort (task #162 undercount fix)", () => {
  const rows: ZeroDteToolCallInputRow[] = [
    zeroDteToolRow({
      tools_used: ["blackout_intelligence"],
      intent_bucket: "ticker_play_state",
      answer_source: "bie-router",
      claims_total: 3,
      claims_verified: 3,
      latency_ms: 35,
    }),
  ];
  const r = computeZeroDteToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 1);
  assert.equal(r.router_matched_n, 1);
  assert.equal(r.claude_fallback_n, 0);
  assert.equal(r.router_match_rate_pct, 100);
});

test("zerodte tool-call calibration: existing zerodte_plays-intent behavior is unchanged by the task #162 fix", () => {
  const rows: ZeroDteToolCallInputRow[] = [
    zeroDteToolRow({
      tools_used: ["blackout_intelligence"],
      intent_bucket: "zerodte_plays",
      answer_source: "bie-router",
      claims_total: 5,
      claims_verified: 5,
      latency_ms: 40,
    }),
  ];
  const r = computeZeroDteToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 1);
  assert.equal(r.router_matched_n, 1);
  assert.equal(r.claude_fallback_n, 0);
  assert.equal(r.router_match_rate_pct, 100);
});

test("zerodte tool-call calibration: a row with neither a matching tool nor a matching intent_bucket is still excluded", () => {
  const rows: ZeroDteToolCallInputRow[] = [
    // Router match for a DIFFERENT product (SPX structure) — never joins this cohort.
    zeroDteToolRow({ tools_used: ["blackout_intelligence"], intent_bucket: "spx_structure", answer_source: "bie-router" }),
    // Claude fallback that never touched a 0DTE-Command engine tool.
    zeroDteToolRow({ tools_used: ["get_quote", "get_gex"], intent_bucket: "claude_fallback", answer_source: "claude" }),
    // Pre-task-#103 row: no intent_bucket at all, no matching tool.
    zeroDteToolRow({ tools_used: ["get_market_context"], intent_bucket: null, answer_source: "claude" }),
  ];
  const r = computeZeroDteToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 0);
});

test("zerodte tool-call calibration: aggregate grounding pass rate, router-match rate, and avg latency over a mixed cohort", () => {
  const rows: ZeroDteToolCallInputRow[] = [
    zeroDteToolRow({ tools_used: ["get_zerodte_plays"], answer_source: "claude", claims_total: 4, claims_verified: 4, latency_ms: 4000 }),
    zeroDteToolRow({ tools_used: ["get_zerodte_rejections"], answer_source: "claude", claims_total: 6, claims_verified: 3, latency_ms: 6000 }),
    zeroDteToolRow({
      tools_used: ["blackout_intelligence"],
      intent_bucket: "zerodte_plays",
      answer_source: "bie-router",
      claims_total: 5,
      claims_verified: 5,
      latency_ms: 40,
    }),
  ];
  const r = computeZeroDteToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 3);
  assert.equal(r.claude_fallback_n, 2);
  assert.equal(r.router_matched_n, 1);
  assert.equal(r.router_match_rate_pct, 33.3);
  // sum(verified)/sum(total) = (4+3+5)/(4+6+5) = 12/15 = 80% — weighted, not an
  // unweighted average of each row's own ratio.
  assert.equal(r.grounding_pass_rate_pct, 80);
  // (4000 + 6000 + 40) / 3 = 3346.67 → rounds to 3347.
  assert.equal(r.avg_latency_ms, 3347);
});

test("zerodte tool-call calibration: turns with zero numeric claims are excluded from the grounding ratio but still counted in n", () => {
  const rows: ZeroDteToolCallInputRow[] = [
    zeroDteToolRow({ tools_used: ["get_zerodte_plays"], claims_total: 0, claims_verified: 0 }),
    zeroDteToolRow({ tools_used: ["get_zerodte_plays"], claims_total: 4, claims_verified: 2 }),
  ];
  const r = computeZeroDteToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
  assert.equal(r.grounding_pass_rate_pct, 50);
});

test("zerodte tool-call calibration: refuses to recommend on thin evidence — waits for n≥10, same gate as the other passes", () => {
  const rows = Array.from({ length: 5 }, () =>
    zeroDteToolRow({ tools_used: ["get_zerodte_plays"], claims_total: 4, claims_verified: 1 })
  );
  const r = computeZeroDteToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.recommendations.length, 0);
  assert.match(formatZeroDteToolCallCalibration(r), /never tunes on noise/);
});

test("zerodte tool-call calibration: cites low grounding and low router-match-rate once evidence clears n≥10", () => {
  const rows: ZeroDteToolCallInputRow[] = Array.from({ length: 10 }, () =>
    zeroDteToolRow({ tools_used: ["get_zerodte_plays"], answer_source: "claude", claims_total: 4, claims_verified: 1 })
  );
  const r = computeZeroDteToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.n, 10);
  assert.equal(r.grounding_pass_rate_pct, 25);
  assert.equal(r.router_match_rate_pct, 0);
  assert.ok(r.recommendations.some((x) => /show only 25% claim grounding/.test(x)));
  assert.ok(r.recommendations.some((x) => /Only 0% of 0DTE-Command-tool-calling turns were answered by the deterministic router/.test(x)));
});

test("zerodte tool-call calibration: empty cohort reports null rates, not zero/NaN", () => {
  const r = computeZeroDteToolCallCalibration([], { since: "2026-07-06", through: "2026-07-06" });
  assert.equal(r.n, 0);
  assert.equal(r.router_match_rate_pct, null);
  assert.equal(r.grounding_pass_rate_pct, null);
  assert.equal(r.avg_latency_ms, null);
  assert.match(formatZeroDteToolCallCalibration(r), /no graded claims yet/);
});

test("calibration: combined report can carry all four sections — 0DTE, SPX Slayer outcomes, SPX-tool-calling, and 0DTE-Command-tool-calling turns", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const spx = computeSpxCalibration([spxRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const toolCalls = computeSpxToolCallCalibration([spxToolRow({ tools_used: ["get_spx_play"] })], {
    since: "2026-07-06",
    through: "2026-07-06",
  });
  const zeroDteToolCalls = computeZeroDteToolCallCalibration([zeroDteToolRow({ tools_used: ["get_zerodte_plays"] })], {
    since: "2026-07-06",
    through: "2026-07-06",
  });
  const text = formatCalibration({
    ...zeroDte,
    spx_slayer: spx,
    spx_tool_calls: toolCalls,
    zerodte_tool_calls: zeroDteToolCalls,
  });
  assert.match(text, /0DTE Command calibration/);
  assert.match(text, /SPX Slayer calibration/);
  assert.match(text, /SPX-tool-calling Largo turns/);
  assert.match(text, /0DTE Command tool-calling Largo turns/);
});

test("calibration: without an attached zerodte_tool_calls pass, the report doesn't grow a fourth section", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  assert.equal(zeroDte.zerodte_tool_calls, null);
  assert.doesNotMatch(formatCalibration(zeroDte), /0DTE Command tool-calling Largo turns/);
});

// ── Task #161: market-context-tool-calling cohort within bie_interactions ───────
// market_context is the FOURTH of BIE's deterministic router intents
// (zerodte_plays/ticker_play_state/spx_structure/market_context — see
// src/lib/bie/router.ts's classifyBieIntent) and, until this task, the only one
// of the four without its own tool-calling cohort. Largo's own answer-quality
// cohort for turns where market_context's own composed state was involved,
// either via a real tool dispatch (Claude path) or the router's
// composeMarketContext composer (which reads the same get_market_context state
// internally but never records a real tool name — see
// isMarketContextToolCallingRow's doc comment). Same UNION-membership
// architecture as task #112/#149's SPX/0DTE cohorts, since market_context — like
// those two — IS a real router intent, unlike HELIX/Thermal/Night Hawk.

const marketContextToolRow = (over: Partial<MarketContextToolCallInputRow>): MarketContextToolCallInputRow => ({
  tools_used: ["live_feed_capture", "get_market_context"],
  intent_bucket: "claude_fallback",
  answer_source: "claude",
  claims_total: 4,
  claims_verified: 4,
  latency_ms: 3000,
  ...over,
});

test("market-context tool-call calibration: cohort includes tools_used intersecting MARKET_ENGINE_TOOL_NAMES, excludes generic-only turns", () => {
  const rows: MarketContextToolCallInputRow[] = [
    marketContextToolRow({ tools_used: ["live_feed_capture", "get_market_context"] }), // in cohort
    marketContextToolRow({ tools_used: ["live_feed_capture", "get_quote", "get_gex"] }), // generic-only — NOT in cohort
    marketContextToolRow({ tools_used: ["get_market_context"] }), // in cohort
  ];
  const r = computeMarketContextToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
});

test("market-context tool-call calibration: a router-matched market_context row joins the cohort despite tools_used being the router's sentinel", () => {
  const rows: MarketContextToolCallInputRow[] = [
    marketContextToolRow({
      tools_used: ["blackout_intelligence"],
      intent_bucket: "market_context",
      answer_source: "bie-router",
      claims_total: 5,
      claims_verified: 5,
      latency_ms: 40,
    }),
    // A router match for a DIFFERENT product (SPX structure) never joins this cohort.
    marketContextToolRow({ tools_used: ["blackout_intelligence"], intent_bucket: "spx_structure", answer_source: "bie-router" }),
  ];
  const r = computeMarketContextToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 1);
  assert.equal(r.router_matched_n, 1);
  assert.equal(r.claude_fallback_n, 0);
  assert.equal(r.router_match_rate_pct, 100);
});

test("market-context tool-call calibration: aggregate grounding pass rate, router-match rate, and avg latency over a mixed cohort", () => {
  const rows: MarketContextToolCallInputRow[] = [
    marketContextToolRow({ tools_used: ["get_market_context"], answer_source: "claude", claims_total: 4, claims_verified: 4, latency_ms: 4000 }),
    marketContextToolRow({ tools_used: ["get_market_context"], answer_source: "claude", claims_total: 6, claims_verified: 3, latency_ms: 6000 }),
    marketContextToolRow({
      tools_used: ["blackout_intelligence"],
      intent_bucket: "market_context",
      answer_source: "bie-router",
      claims_total: 5,
      claims_verified: 5,
      latency_ms: 40,
    }),
  ];
  const r = computeMarketContextToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 3);
  assert.equal(r.claude_fallback_n, 2);
  assert.equal(r.router_matched_n, 1);
  assert.equal(r.router_match_rate_pct, 33.3);
  // sum(verified)/sum(total) = (4+3+5)/(4+6+5) = 12/15 = 80% — weighted, not an
  // unweighted average of each row's own ratio.
  assert.equal(r.grounding_pass_rate_pct, 80);
  // (4000 + 6000 + 40) / 3 = 3346.67 → rounds to 3347.
  assert.equal(r.avg_latency_ms, 3347);
});

test("market-context tool-call calibration: turns with zero numeric claims are excluded from the grounding ratio but still counted in n", () => {
  const rows: MarketContextToolCallInputRow[] = [
    marketContextToolRow({ tools_used: ["get_market_context"], claims_total: 0, claims_verified: 0 }),
    marketContextToolRow({ tools_used: ["get_market_context"], claims_total: 4, claims_verified: 2 }),
  ];
  const r = computeMarketContextToolCallCalibration(rows, { since: "2026-06-22", through: "2026-07-06" });
  assert.equal(r.n, 2);
  assert.equal(r.grounding_pass_rate_pct, 50);
});

test("market-context tool-call calibration: refuses to recommend on thin evidence — waits for n≥10, same gate as the other passes", () => {
  const rows = Array.from({ length: 5 }, () =>
    marketContextToolRow({ tools_used: ["get_market_context"], claims_total: 4, claims_verified: 1 })
  );
  const r = computeMarketContextToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.recommendations.length, 0);
  assert.match(formatMarketContextToolCallCalibration(r), /never tunes on noise/);
});

test("market-context tool-call calibration: cites low grounding and low router-match-rate once evidence clears n≥10", () => {
  const rows: MarketContextToolCallInputRow[] = Array.from({ length: 10 }, () =>
    marketContextToolRow({ tools_used: ["get_market_context"], answer_source: "claude", claims_total: 4, claims_verified: 1 })
  );
  const r = computeMarketContextToolCallCalibration(rows, { since: "2026-07-01", through: "2026-07-06" });
  assert.equal(r.n, 10);
  assert.equal(r.grounding_pass_rate_pct, 25);
  assert.equal(r.router_match_rate_pct, 0);
  assert.ok(r.recommendations.some((x) => /show only 25% claim grounding/.test(x)));
  assert.ok(r.recommendations.some((x) => /Only 0% of market-context-tool-calling turns were answered by the deterministic router/.test(x)));
});

test("market-context tool-call calibration: empty cohort reports null rates, not zero/NaN", () => {
  const r = computeMarketContextToolCallCalibration([], { since: "2026-07-06", through: "2026-07-06" });
  assert.equal(r.n, 0);
  assert.equal(r.router_match_rate_pct, null);
  assert.equal(r.grounding_pass_rate_pct, null);
  assert.equal(r.avg_latency_ms, null);
  assert.match(formatMarketContextToolCallCalibration(r), /no graded claims yet/);
});

test("calibration: combined report can carry all five sections — 0DTE, SPX Slayer outcomes, SPX-tool-calling, 0DTE-Command-tool-calling, and market-context-tool-calling turns", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const spx = computeSpxCalibration([spxRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const toolCalls = computeSpxToolCallCalibration([spxToolRow({ tools_used: ["get_spx_play"] })], {
    since: "2026-07-06",
    through: "2026-07-06",
  });
  const zeroDteToolCalls = computeZeroDteToolCallCalibration([zeroDteToolRow({ tools_used: ["get_zerodte_plays"] })], {
    since: "2026-07-06",
    through: "2026-07-06",
  });
  const marketContextToolCalls = computeMarketContextToolCallCalibration(
    [marketContextToolRow({ tools_used: ["get_market_context"] })],
    { since: "2026-07-06", through: "2026-07-06" }
  );
  const text = formatCalibration({
    ...zeroDte,
    spx_slayer: spx,
    spx_tool_calls: toolCalls,
    zerodte_tool_calls: zeroDteToolCalls,
    market_context_tool_calls: marketContextToolCalls,
  });
  assert.match(text, /0DTE Command calibration/);
  assert.match(text, /SPX Slayer calibration/);
  assert.match(text, /SPX-tool-calling Largo turns/);
  assert.match(text, /0DTE Command tool-calling Largo turns/);
  assert.match(text, /Market-context-tool-calling Largo turns/);
});

test("calibration: without an attached market_context_tool_calls pass, the report doesn't grow a fifth section", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  assert.equal(zeroDte.market_context_tool_calls, null);
  assert.doesNotMatch(formatCalibration(zeroDte), /Market-context-tool-calling Largo turns/);
});

test("calibration: combined report can carry five sections — 0DTE, SPX Slayer outcomes, SPX-tool-calling, and Night-Hawk-tool-calling turns", () => {
  const zeroDte = computeCalibration([calRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const spx = computeSpxCalibration([spxRow({})], { since: "2026-07-06", through: "2026-07-06", sessions: 1 });
  const spxToolCalls = computeSpxToolCallCalibration([spxToolRow({ tools_used: ["get_spx_play"] })], {
    since: "2026-07-06",
    through: "2026-07-06",
  });
  const nighthawkToolCalls = computeNighthawkToolCallCalibration(
    [nighthawkToolRow({ tools_used: ["get_nighthawk_edition"] })],
    { since: "2026-07-06", through: "2026-07-06" }
  );
  const text = formatCalibration({
    ...zeroDte,
    spx_slayer: spx,
    spx_tool_calls: spxToolCalls,
    nighthawk_tool_calls: nighthawkToolCalls,
  });
  assert.match(text, /0DTE Command calibration/);
  assert.match(text, /SPX Slayer calibration/);
  assert.match(text, /SPX-tool-calling Largo turns/);
  assert.match(text, /Night-Hawk-tool-calling Largo turns/);
});

// ── Phase 4: telemetry discovery (pure formatting + thresholds) ──────────────────

import { formatDiscovery, type DiscoveryRow } from "./discovery";

test("discovery: findings cite numbers and only fire past thresholds", () => {
  const rows: DiscoveryRow[] = [
    { provider: "uw", endpoint: "/api/darkpool/:t", calls: 120, fail_pct: 12.5, avg_latency_ms: 900, p95_latency_ms: 6200, total_time_s: 108, rate_limited: 14 },
    { provider: "polygon", endpoint: "/v3/snapshot", calls: 800, fail_pct: 0.2, avg_latency_ms: 140, p95_latency_ms: 420, total_time_s: 112, rate_limited: 0 },
  ];
  const text = formatDiscovery("2026-07-06", rows);
  assert.match(text, /12\.5% failures over 120 calls/);
  assert.match(text, /p95 6200ms/);
  assert.match(text, /rate-limited 14×/);
  // The healthy endpoint appears in the cost table but produces NO finding.
  assert.ok(!/polygon \/v3\/snapshot:.*investigate/.test(text));
});

test("discovery: empty telemetry degrades to an honest no-data report", () => {
  assert.match(formatDiscovery("2026-07-06", []), /API telemetry: none recorded/);
});

test("discovery: application errors — elevated count and a dominant source both surface as findings", () => {
  const text = formatDiscovery(
    "2026-07-06",
    [],
    { total: 30, groups: [{ source: "request_error", scope: "/api/market/spx/commentary", count: 22 }, { source: "manual", scope: null, count: 8 }] },
    []
  );
  assert.match(text, /Application errors \(last 24h\): 30 total/);
  assert.match(text, /request_error\/\/api\/market\/spx\/commentary: 22×/);
  assert.match(text, /elevated; review error_events/);
  assert.match(text, /top error source \(22× in 24h\)/);
});

test("discovery: quiet error log produces no findings", () => {
  const text = formatDiscovery("2026-07-06", [], { total: 3, groups: [{ source: "manual", scope: null, count: 3 }] }, []);
  assert.match(text, /Application errors \(last 24h\): 3 total/);
  assert.match(text, /Findings: none crossing thresholds/);
});

// Minimal CronJobHealth fixture — only the fields formatDiscovery reads.
function cronJob(overrides: Partial<import("./discovery").DiscoveryCronJob>): import("./discovery").DiscoveryCronJob {
  return {
    key: "job",
    status: "healthy",
    status_label: "ok",
    market_hours_stale: false,
    last_message: null,
    ...overrides,
  };
}

test("discovery: failed and truly-stalled cron jobs are named in findings", () => {
  const cronJobs = [
    cronJob({ key: "grid-warm", status: "failed", status_label: "last run errored", last_message: "UW timeout" }),
    cronJob({ key: "db-cleanup", status: "stale", status_label: "No run in 400m (limit 360m)" }),
    cronJob({ key: "flow-ingest", status: "healthy", status_label: "ok" }),
  ];
  const text = formatDiscovery("2026-07-06", [], { total: 0, groups: [] }, cronJobs);
  assert.match(text, /3 jobs tracked, 1 failing, 1 stale/);
  assert.match(text, /"grid-warm" is FAILING: UW timeout/);
  assert.match(text, /"db-cleanup" is stale: No run in 400m/);
  assert.ok(!text.includes('"flow-ingest"'));
});

test("discovery: market-hours-only staleness during RTH is flagged high-priority; off-hours quiet is not stale at all", () => {
  // The engine's own schedule-aware logic (admin-cron-health.ts) decides status —
  // formatDiscovery just has to surface market_hours_stale correctly when it IS stale.
  const cronJobs = [
    cronJob({ key: "grid-warm", status: "stale", status_label: "No run in 5m (limit 4m)", market_hours_stale: true }),
    cronJob({ key: "heatmap-warm", status: "healthy", status_label: "off-hours — market closed" }),
  ];
  const text = formatDiscovery("2026-07-06", [], { total: 0, groups: [] }, cronJobs);
  assert.match(text, /"grid-warm" is stale:.*LIVE-DATA WARMER SILENT DURING MARKET HOURS, high priority/);
  assert.ok(!text.includes('"heatmap-warm"'));
});

// ── discovery: data-integrity incidents + data-correctness scorecard ─────────────

test("discovery: every open admin incident is a finding, no threshold — it's already confirmed by the validator", () => {
  const incidents: import("./discovery").DiscoveryIncident[] = [
    { id: "inc-1", severity: "critical", category: "data-integrity", title: "SPY quote vs GEX spot mismatch", detail: "quote=602.10 gex.spot=601.40", opened_at: "2026-07-06T14:00:00Z" },
  ];
  const text = formatDiscovery("2026-07-06", [], { total: 0, groups: [] }, [], incidents);
  assert.match(text, /Open data-integrity incidents: 1\./);
  assert.match(text, /\[critical\/data-integrity\] SPY quote vs GEX spot mismatch/);
  assert.match(text, /Open incident \[critical\].*already confirmed by data-integrity, not a guess/);
});

test("discovery: no open incidents produces no incidents section and no related finding", () => {
  const text = formatDiscovery("2026-07-06", [], { total: 0, groups: [] }, [], []);
  assert.ok(!text.includes("Open data-integrity incidents"));
});

test("discovery: data-correctness FLAGs surface as findings — a real wrong-number verdict, not invented by BIE", () => {
  const correctness: import("./discovery").DataCorrectnessSummary = {
    ran_at: "2026-07-06T14:30:00Z",
    overall_status: "FLAGGED",
    market_open: true,
    flags: [{ layer: "heatmap", metric: "NVDA.gex.sum", detail: "Σ strike_totals -24572.44 != total -24572.45" }],
    independently_confirmed: 12,
    consistency_only: 3,
  };
  const text = formatDiscovery("2026-07-06", [], { total: 0, groups: [] }, [], [], correctness);
  assert.match(text, /Data-correctness scorecard \(2026-07-06T14:30:00Z\): FLAGGED, 1 flag\(s\), 12 independently confirmed, 3 consistency-only\./);
  assert.match(text, /Data-correctness FLAG \[heatmap\/NVDA\.gex\.sum\]: Σ strike_totals.*a displayed number is probably wrong/);
});

test("discovery: zero independently-confirmed metrics during market hours is a coverage-gap finding, not a silent pass", () => {
  const correctness: import("./discovery").DataCorrectnessSummary = {
    ran_at: "2026-07-06T14:30:00Z",
    overall_status: "OK",
    market_open: true,
    flags: [],
    independently_confirmed: 0,
    consistency_only: 5,
  };
  const text = formatDiscovery("2026-07-06", [], { total: 0, groups: [] }, [], [], correctness);
  assert.match(text, /0 independently-confirmed metrics this run during market hours — coverage gap, not a guarantee/);
});

test("discovery: healthy correctness run (confirmed metrics, no flags) produces the summary line but no findings", () => {
  const correctness: import("./discovery").DataCorrectnessSummary = {
    ran_at: "2026-07-06T14:30:00Z",
    overall_status: "OK",
    market_open: true,
    flags: [],
    independently_confirmed: 9,
    consistency_only: 2,
  };
  const text = formatDiscovery("2026-07-06", [], { total: 0, groups: [] }, [], [], correctness);
  assert.match(text, /9 independently confirmed, 2 consistency-only/);
  assert.match(text, /Findings: none crossing thresholds/);
});

// ── knowledge: embed-vs-backfill partition ───────────────────────────────────────

import { partitionForEmbedding } from "./knowledge";

test("knowledge: never-seen chunks are fresh; embedded ones are skipped entirely", () => {
  const all = [
    { chunk: "a", chunk_hash: "h-a" },
    { chunk: "b", chunk_hash: "h-b" },
  ];
  const existing = new Map([["h-b", true]]); // b already stored WITH embedding
  const { fresh, cold } = partitionForEmbedding(all, existing, true);
  assert.deepEqual(fresh.map((c) => c.chunk_hash), ["h-a"]);
  assert.deepEqual(cold, []);
});

test("knowledge: chunks stored cold before the key existed are backfilled once a key lands", () => {
  const all = [
    { chunk: "a", chunk_hash: "h-a" },
    { chunk: "b", chunk_hash: "h-b" },
    { chunk: "c", chunk_hash: "h-c" },
  ];
  // a: never seen; b: stored cold (no embedding); c: already embedded.
  const existing = new Map([
    ["h-b", false],
    ["h-c", true],
  ]);
  const { fresh, cold } = partitionForEmbedding(all, existing, true);
  assert.deepEqual(fresh.map((c) => c.chunk_hash), ["h-a"]);
  assert.deepEqual(cold.map((c) => c.chunk_hash), ["h-b"]);
});

test("knowledge: without a key nothing backfills — cold chunks wait, dedup still holds", () => {
  const all = [
    { chunk: "a", chunk_hash: "h-a" },
    { chunk: "b", chunk_hash: "h-b" },
  ];
  const existing = new Map([["h-b", false]]);
  const { fresh, cold } = partitionForEmbedding(all, existing, false);
  assert.deepEqual(fresh.map((c) => c.chunk_hash), ["h-a"]);
  assert.deepEqual(cold, []);
});

// ── knowledge: new SPX Slayer mechanics doc ingests cleanly ──────────────────────
//
// This is a content-only addition (docs/bie/spx-slayer-mechanics.md) — no ingestion
// code changed, since `ingestBieKnowledge()` already directory-scans `docs/bie` (see
// DOC_DIRS in ./knowledge.ts) rather than reading an explicit file list. What CAN
// regress silently is the doc itself: a future edit could blow past the per-file size
// cap, or pile content into one giant paragraph that only hard-splits instead of
// chunking on natural boundaries. These tests pin both, using the exact same
// `chunkDocument()` the real ingestion path calls.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SPX_MECHANICS_DOC_PATH = join("docs", "bie", "spx-slayer-mechanics.md");

test("knowledge: spx-slayer-mechanics.md exists under docs/bie — a DOC_DIRS-scanned directory, so ingestBieKnowledge() picks it up with no code change", () => {
  const text = readFileSync(join(process.cwd(), SPX_MECHANICS_DOC_PATH), "utf8");
  assert.ok(text.length > 500, "doc should have real content, not a stub");
  assert.ok(text.length < 400_000, "must stay under ingestBieKnowledge()'s per-file size cap");
});

test("knowledge: spx-slayer-mechanics.md chunks on paragraph boundaries — every paragraph fits the 1200-char cap so nothing needs a mid-sentence hard-split", () => {
  const text = readFileSync(join(process.cwd(), SPX_MECHANICS_DOC_PATH), "utf8");
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  assert.ok(paragraphs.length >= 10, "doc should have multiple distinct sections/paragraphs");
  for (const p of paragraphs) {
    assert.ok(p.length <= 1200, `paragraph exceeds chunkDocument's cap and will hard-split: "${p.slice(0, 60)}..."`);
  }
  const chunks = chunkDocument(text);
  assert.ok(chunks.length >= 5, "doc should produce several retrievable chunks, not collapse to one");
  assert.ok(chunks.every((c) => c.length <= 1200));
});

test("knowledge: spx-slayer-mechanics.md actually documents the three-stage engine BIE is meant to ground answers in", () => {
  const text = readFileSync(join(process.cwd(), SPX_MECHANICS_DOC_PATH), "utf8");
  // Confluence scoring stage.
  assert.match(text, /computeSpxConfluence/);
  // Sequential gates stage.
  assert.match(text, /evaluatePlayGates/);
  // AI arbiter stage + its fail-closed behavior.
  assert.match(text, /evaluateClaudePlayApproval/);
  assert.match(text, /fail-closed/i);
  // The numeric-grounding guard on the AI step.
  assert.match(text, /checkNumbersGrounded/);
  // Largo's live-state query surface.
  assert.match(text, /get_spx_play/);
  assert.match(text, /get_spx_confluence/);
});
