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

import { computeCalibration, formatCalibration, type CalibrationInputRow } from "./calibration";

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
    cronJob({ key: "nights-watch-warm", status: "healthy", status_label: "off-hours — market closed" }),
  ];
  const text = formatDiscovery("2026-07-06", [], { total: 0, groups: [] }, cronJobs);
  assert.match(text, /"grid-warm" is stale:.*LIVE-DATA WARMER SILENT DURING MARKET HOURS, high priority/);
  assert.ok(!text.includes('"nights-watch-warm"'));
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
