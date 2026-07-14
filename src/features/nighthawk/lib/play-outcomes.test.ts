import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildNighthawkAuditRow,
  buildNighthawkRejectedAuditRow,
  buildNighthawkStageRejectedAuditRow,
  nighthawkOutcomesRunHealth,
  outcomeSessionDate,
  parsePlayLevels,
  resolveOutcome,
} from "./play-outcomes";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import type { PlaybookPlay } from "./types";
import type { ScoredCandidate } from "./scorer";

test("outcomeSessionDate resolves the edition date itself, not the next trading day", () => {
  assert.equal(outcomeSessionDate({ edition_for: "2026-06-30" }), "2026-06-30");
});

test("parsePlayLevels extracts entry range, target, and stop", () => {
  const play = {
    entry_range: "$198 - $202",
    target: "$215",
    stop: "$190",
  } as PlaybookPlay;

  assert.deepEqual(parsePlayLevels(play), {
    entry_range_low: 198,
    entry_range_high: 202,
    target: 215,
    stop: 190,
  });
});

test("resolveOutcome marks long target hit using session high", () => {
  const row = {
    direction: "LONG",
    entry_range_low: 198,
    entry_range_high: 202,
    target: 215,
    stop: 190,
    next_day_open: 201,
    next_day_close: 211,
    session_high: 216,
    session_low: 199,
  } as NighthawkPlayOutcomeRow;

  const outcome = resolveOutcome(row);

  assert.equal(outcome.outcome, "target");
  assert.equal(outcome.hit_target, true);
  assert.equal(outcome.hit_stop, false);
});

// ── fillability (grading-honesty, 2026-07-02 audit) ─────────────────────────────

test("LONG that gapped ABOVE its entry band and ran grades 'unfilled', not a win", () => {
  const row = {
    direction: "LONG",
    entry_range_low: 198,
    entry_range_high: 202,
    target: 215,
    stop: 190,
    next_day_open: 208, // gapped over the band
    next_day_close: 216,
    session_high: 217,
    session_low: 206, // never traded back into reach of the band
  } as NighthawkPlayOutcomeRow;

  const outcome = resolveOutcome(row);
  assert.equal(outcome.outcome, "unfilled");
  assert.equal(outcome.hit_target, false);
});

test("SHORT that gapped BELOW its entry band grades 'unfilled' (mirror)", () => {
  const row = {
    direction: "SHORT",
    entry_range_low: 198,
    entry_range_high: 202,
    target: 185,
    stop: 210,
    next_day_open: 192,
    next_day_close: 184,
    session_high: 193, // never back up into the band
    session_low: 183,
  } as NighthawkPlayOutcomeRow;

  assert.equal(resolveOutcome(row).outcome, "unfilled");
});

test("a gap-open that RETRACES into the band still grades normally", () => {
  const row = {
    direction: "LONG",
    entry_range_low: 198,
    entry_range_high: 202,
    target: 215,
    stop: 190,
    next_day_open: 208,
    next_day_close: 216,
    session_high: 217,
    session_low: 201, // dipped back into the band — fillable
  } as NighthawkPlayOutcomeRow;

  assert.equal(resolveOutcome(row).outcome, "target");
});

test("rows without an entry band skip the fillability gate", () => {
  const row = {
    direction: "LONG",
    entry_range_low: null,
    entry_range_high: null,
    target: 215,
    stop: 190,
    next_day_open: 208,
    next_day_close: 216,
    session_high: 217,
    session_low: 206,
  } as NighthawkPlayOutcomeRow;

  assert.equal(resolveOutcome(row).outcome, "target");
});

// ── Stage 4 audit trail (buildNighthawkAuditRow) ─────────────────────────────────
// Fixture-driven, no database required — same pattern as zerodte/board.test.ts's
// buildZeroDteAuditRow coverage.

test("audit row: a normal play with parseable levels passes the geometry check", () => {
  const play = {
    ticker: "nvda",
    direction: "LONG",
    conviction: "a",
    score: 91,
    thesis: "Breakout continuation over prior-day high.",
    key_signal: "Call sweep + dark pool print",
    entry_range: "$198 - $202",
    target: "$215",
    stop: "$190",
    options_play: "NVDA 220C 7/10, entry prem ~$4.20",
  } as PlaybookPlay;

  const audit = buildNighthawkAuditRow(play, "2026-07-06", "Technology");

  assert.equal(audit.alert_type, "nighthawk");
  assert.equal(audit.source_table, "nighthawk_play_outcomes");
  assert.deepEqual(audit.source_key, { edition_for: "2026-07-06", ticker: "NVDA" });
  assert.equal(audit.ticker, "NVDA");
  assert.equal(audit.direction, "LONG");
  assert.equal(audit.confidence_score, 91);
  assert.equal(audit.confidence_label, "A");
  assert.equal(audit.decision_trace.length, 1);
  assert.equal(audit.decision_trace[0]!.passed, true);
  assert.deepEqual((audit.input_snapshot as { target: number | null }).target, 215);
  assert.equal(audit.final_output.options_play, "NVDA 220C 7/10, entry prem ~$4.20");
});

test("audit row: SHORT direction and an unparseable target/stop are recorded honestly, not guessed", () => {
  const play = {
    ticker: "TSLA",
    direction: "SHORT",
    conviction: "b",
    entry_range: "Break below 240",
    target: "see levels",
    stop: "-",
    options_play: "-",
  } as PlaybookPlay;

  const audit = buildNighthawkAuditRow(play, "2026-07-06", null);
  assert.equal(audit.direction, "SHORT");
  assert.equal(audit.decision_trace[0]!.passed, false);
  assert.equal((audit.input_snapshot as { target: number | null }).target, null);
});

// ── Stage 4 audit trail, rejected half (buildNighthawkRejectedAuditRow) ──────────
// Fixture-driven, no database required — same pattern as the published-row tests above
// and zerodte/board.test.ts's buildZeroDteAuditRow coverage.

test("rejected audit row: cites the real drop reasons, one decision_trace entry per reason", () => {
  const play = {
    ticker: "sndk",
    direction: "SHORT",
    conviction: "b",
    score: 62,
    entry_range: "$1880-$1900",
    target: "$1950",
    stop: "$1723",
    options_play: "SNDK 1880P, entry prem ~$3.10",
  } as PlaybookPlay;
  const drops = ["SHORT stop 1723 is not above entry mid 1890.00", "SHORT target 1950 is not below entry mid 1890.00"];

  const audit = buildNighthawkRejectedAuditRow({ ticker: "SNDK", drops, play }, "2026-07-06");

  assert.equal(audit.alert_type, "nighthawk_rejected");
  assert.equal(audit.source_table, "claude_edition_synthesis");
  assert.deepEqual(audit.source_key, { edition_for: "2026-07-06", ticker: "SNDK" });
  assert.equal(audit.ticker, "SNDK");
  assert.equal(audit.direction, "SHORT");
  assert.equal(audit.confidence_score, 62);
  assert.match(audit.trigger_reason, /trade-geometry gate/);
  assert.equal(audit.decision_trace.length, 2);
  for (const check of audit.decision_trace) assert.equal(check.passed, false);
  assert.equal(audit.decision_trace[0]!.value, drops[0]);
  assert.equal(audit.decision_trace[1]!.value, drops[1]);
  // A rejected play was never shown to a member — no fabricated final_output.
  assert.equal(audit.final_output, null);
});

test("rejected audit row: LONG direction and a corrupt entry-range are recorded honestly", () => {
  const play = {
    ticker: "AAPL",
    direction: "LONG",
    conviction: "a",
    entry_range: "$17-$452",
    target: "$470",
    stop: "$440",
    options_play: "-",
  } as PlaybookPlay;
  const drops = ["entry range 17-452 corrupt (non-positive bound or width > 20% of mid)"];

  const audit = buildNighthawkRejectedAuditRow({ ticker: "AAPL", drops, play }, "2026-07-06");
  assert.equal(audit.direction, "LONG");
  assert.equal(audit.decision_trace.length, 1);
  assert.equal(audit.decision_trace[0]!.value, drops[0]);
  assert.equal((audit.input_snapshot as { raw_entry_range: string }).raw_entry_range, "$17-$452");
});

// ── Stage 4 audit trail, LATER-stage rejections (task #141) ──────────────────────
// buildNighthawkStageRejectedAuditRow is the generalized sibling of
// buildNighthawkRejectedAuditRow (geometry-only, above) — one builder shared by the 4
// later-funnel rejection stages that used to be console.warn-only: premium-cap,
// illiquid-strike, ungrounded, and sector-concentration. Same fixture-driven, no-database
// pattern as the geometry tests above.

test("stage-rejected audit row: premium-cap cites the actual premium and the cap threshold", () => {
  const play = {
    ticker: "tsla",
    direction: "LONG",
    conviction: "a",
    score: 88,
    entry_range: "$300-$305",
    target: "$330",
    stop: "$290",
    options_play: "TSLA 320C 08/21, entry prem ~$27.50",
    entry_premium: 27.5,
    entry_cost_per_contract: 2750,
  } as PlaybookPlay;

  const audit = buildNighthawkStageRejectedAuditRow(
    {
      ticker: "TSLA",
      play,
      detail: {
        stage: "premium_cap",
        entry_premium: 27.5,
        cap_per_share: 20,
        entry_cost_per_contract: 2750,
        cap_per_contract: 2000,
      },
    },
    "2026-07-06"
  );

  assert.equal(audit.alert_type, "nighthawk_rejected");
  assert.equal(audit.source_table, "claude_edition_synthesis");
  assert.deepEqual(audit.source_key, { edition_for: "2026-07-06", ticker: "TSLA" });
  assert.equal(audit.ticker, "TSLA");
  assert.match(audit.trigger_reason, /premium|afford/i);
  assert.deepEqual(audit.decision_trace, [
    { check: "premium_within_cap", passed: false, value: 27.5, threshold: 20 },
  ]);
  assert.equal((audit.input_snapshot as { entry_premium: number }).entry_premium, 27.5);
  assert.equal((audit.input_snapshot as { cap_per_share: number }).cap_per_share, 20);
  // A rejected play was never shown to a member — no fabricated final_output (same
  // convention as the geometry builder).
  assert.equal(audit.final_output, null);
});

test("stage-rejected audit row: illiquid-strike cites the strike, the actual OI, and the floor it missed", () => {
  const play = {
    ticker: "SNDK",
    direction: "LONG",
    conviction: "b",
    score: 65,
    entry_range: "$180-$184",
    target: "$200",
    stop: "$172",
    options_play: "SNDK 190C 09/18",
  } as PlaybookPlay;

  const audit = buildNighthawkStageRejectedAuditRow(
    {
      ticker: "SNDK",
      play,
      detail: {
        stage: "illiquid_strike",
        strike: 190,
        side: "call",
        expiry: "2026-09-18",
        open_interest: 220,
        min_open_interest: 500,
      },
    },
    "2026-07-06"
  );

  assert.match(audit.trigger_reason, /illiquid|open interest/i);
  assert.deepEqual(audit.decision_trace, [
    { check: "strike_open_interest", passed: false, value: 220, threshold: 500 },
  ]);
  assert.equal((audit.input_snapshot as { strike: number }).strike, 190);
  assert.equal((audit.input_snapshot as { open_interest: number }).open_interest, 220);
  assert.equal((audit.input_snapshot as { min_open_interest: number }).min_open_interest, 500);
});

test("stage-rejected audit row: ungrounded cites which claimed level/contract failed and against what", () => {
  const play = {
    ticker: "AVGO",
    direction: "SHORT",
    conviction: "a",
    score: 80,
    entry_range: "$1900-$1920",
    target: "$1800",
    stop: "$1960",
    options_play: "AVGO 1850P 08/21",
  } as PlaybookPlay;
  const issues = [
    { check: "strike", detail: "AVGO strike 1850 call present on-chain but OI 120 < 500 (illiquid/off-chain)." },
  ];

  const audit = buildNighthawkStageRejectedAuditRow(
    { ticker: "AVGO", play, detail: { stage: "ungrounded", issues } },
    "2026-07-06"
  );

  assert.match(audit.trigger_reason, /ground/i);
  assert.equal(audit.decision_trace.length, 1);
  assert.equal(audit.decision_trace[0]!.value, issues[0]!.detail);
  assert.deepEqual((audit.input_snapshot as { ungrounded_issues: typeof issues }).ungrounded_issues, issues);
});

test("stage-rejected audit row: sector-concentration cites the sector and how many tickers already filled it", () => {
  const play = {
    ticker: "AMD",
    direction: "LONG",
    conviction: "b",
    score: 70,
    entry_range: "$150-$154",
    target: "$168",
    stop: "$142",
    options_play: "AMD 160C 08/21",
  } as PlaybookPlay;

  const audit = buildNighthawkStageRejectedAuditRow(
    {
      ticker: "AMD",
      play,
      detail: { stage: "sector_concentration", sector: "semis", already_filled: 2, max_per_sector: 2 },
    },
    "2026-07-06"
  );

  assert.match(audit.trigger_reason, /sector-concentration/i);
  assert.deepEqual(audit.decision_trace, [
    { check: "sector_concentration_cap", passed: false, value: 2, threshold: 2 },
  ]);
  assert.equal((audit.input_snapshot as { sector: string }).sector, "semis");
  assert.equal((audit.input_snapshot as { already_filled: number }).already_filled, 2);
});

// ── Confluence-factor context on rejection rows (task #142) ──────────────────────
// The ORIGINAL gap this task closed: decision_trace/input_snapshot for a rejected play
// carried only the failed gate's own numbers (target/stop, premium/cap, OI/floor, ...) —
// never the confluence-factor breakdown scoreCandidate() (scorer.ts) computed for that
// same ticker this run (flow/tech/pos/news/smart-money/fundamental/short-interest/
// catalyst sub-scores). Re-investigated post-#129/#141: a DB join against
// nighthawk_scoring_history at rejection-build time would find NOTHING for tonight's
// edition (that table only archives post-publish — see claude-edition.ts's
// geometryRejected push-site comment) — so the fix threads the caller's already-in-memory
// ScoredCandidate through instead, via a new optional `scored` field, folded into
// input_snapshot.confluence by every stage (not just geometry) since the fold happens in
// the shared `base` object all 5 stages already share.

const FULL_SCORED_FIXTURE: ScoredCandidate = {
  ticker: "TSLA",
  score: 88,
  direction: "long",
  flow_score: 30,
  tech_score: 22,
  pos_score: 14,
  news_score: 10,
  smart_money_score: 8,
  fundamental_score: 3,
  catalyst_score: 2,
  catalyst_flags: ["binary FDA event ahead"],
  short_interest_score: 5,
  earnings_risk: true,
  conviction: "A",
  regime_multiplier: 1.15,
  fundamental_block: false,
  fundamental_flags: ["strong margins"],
  trading_halt: false,
};

test("rejected audit row (geometry): scored candidate's confluence breakdown is folded into input_snapshot, never re-derived", () => {
  const play = {
    ticker: "TSLA",
    direction: "LONG",
    conviction: "a",
    score: 88,
    entry_range: "$300-$305",
    target: "$330",
    stop: "$290",
    options_play: "TSLA 320C 08/21, entry prem ~$27.50",
  } as PlaybookPlay;
  const drops = ["LONG target 330 is not above entry mid 302.50 by enough margin"];

  const audit = buildNighthawkRejectedAuditRow(
    { ticker: "TSLA", drops, play, scored: FULL_SCORED_FIXTURE },
    "2026-07-06"
  );

  const confluence = (audit.input_snapshot as { confluence: Record<string, unknown> }).confluence;
  assert.deepEqual(confluence, {
    total_score: 88,
    direction: "long",
    conviction: "A",
    flow_score: 30,
    tech_score: 22,
    pos_score: 14,
    news_score: 10,
    smart_money_score: 8,
    fundamental_score: 3,
    catalyst_score: 2,
    catalyst_flags: ["binary FDA event ahead"],
    short_interest_score: 5,
    earnings_risk: true,
    regime_multiplier: 1.15,
    fundamental_block: false,
    fundamental_flags: ["strong margins"],
    trading_halt: false,
  });
  // The pre-existing geometry fields are untouched by this addition (additive-only fold).
  assert.equal((audit.input_snapshot as { raw_target: string }).raw_target, "$330");
});

test("rejected audit row (geometry): confluence is null (not fabricated) when no scored candidate is available", () => {
  const play = {
    ticker: "SNDK",
    direction: "SHORT",
    conviction: "b",
    entry_range: "$1880-$1900",
    target: "$1950",
    stop: "$1723",
  } as PlaybookPlay;

  // `scored` omitted entirely — mirrors a caller on the mechanical-fallback path, or a
  // ticker Claude named outside this run's scored candidate set (dossierMap miss).
  const audit = buildNighthawkRejectedAuditRow({ ticker: "SNDK", drops: ["x"], play }, "2026-07-06");
  assert.equal((audit.input_snapshot as { confluence: unknown }).confluence, null);
});

test("confluenceSnapshot defaults every optional ScoredCandidate field honestly (null/empty/false, never fabricated)", () => {
  // A minimal ScoredCandidate missing every optional sub-score/flag field — the shape
  // scoreCandidate() actually produces when e.g. no catalyst/short-interest signal fired.
  const minimal: ScoredCandidate = {
    ticker: "AMD",
    score: 70,
    direction: "long",
    flow_score: 25,
    tech_score: 20,
    pos_score: 15,
    news_score: 5,
    smart_money_score: 5,
    conviction: "B",
  };
  const play = {
    ticker: "AMD",
    direction: "LONG",
    conviction: "b",
    entry_range: "$150-$154",
    target: "$168",
    stop: "$142",
    options_play: "AMD 160C 08/21",
  } as PlaybookPlay;

  const audit = buildNighthawkStageRejectedAuditRow(
    {
      ticker: "AMD",
      play,
      detail: { stage: "sector_concentration", sector: "semis", already_filled: 2, max_per_sector: 2 },
      scored: minimal,
    },
    "2026-07-06"
  );

  assert.deepEqual((audit.input_snapshot as { confluence: Record<string, unknown> }).confluence, {
    total_score: 70,
    direction: "long",
    conviction: "B",
    flow_score: 25,
    tech_score: 20,
    pos_score: 15,
    news_score: 5,
    smart_money_score: 5,
    fundamental_score: null,
    catalyst_score: null,
    catalyst_flags: [],
    short_interest_score: null,
    earnings_risk: false,
    regime_multiplier: null,
    fundamental_block: false,
    fundamental_flags: [],
    trading_halt: false,
  });
});

test("stage-rejected audit row (premium-cap): confluence breakdown folds in identically to the geometry stage — proves the shared `base` fold, not a per-stage special case", () => {
  const play = {
    ticker: "TSLA",
    direction: "LONG",
    conviction: "a",
    score: 88,
    entry_range: "$300-$305",
    target: "$330",
    stop: "$290",
    options_play: "TSLA 320C 08/21, entry prem ~$27.50",
    entry_premium: 27.5,
    entry_cost_per_contract: 2750,
  } as PlaybookPlay;

  const audit = buildNighthawkStageRejectedAuditRow(
    {
      ticker: "TSLA",
      play,
      detail: {
        stage: "premium_cap",
        entry_premium: 27.5,
        cap_per_share: 20,
        entry_cost_per_contract: 2750,
        cap_per_contract: 2000,
      },
      scored: FULL_SCORED_FIXTURE,
    },
    "2026-07-06"
  );

  const confluence = (audit.input_snapshot as { confluence: Record<string, unknown> }).confluence;
  assert.equal(confluence.total_score, 88);
  assert.equal(confluence.flow_score, 30);
  assert.equal(confluence.smart_money_score, 8);
  // Stage-specific fields still present alongside the new confluence key (additive, not a
  // replacement of premium_cap's own established input_snapshot fields).
  assert.equal((audit.input_snapshot as { entry_premium: number }).entry_premium, 27.5);
});

// ── Cron honesty (PR-N1, docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §0.1) ─────────────
// The outcomes cron used to log `ok: true` unconditionally on its happy path while the
// per-row grade failures sat in meta.errors — the 12 H-1 constraint violations stayed
// green in cron-health for four days. Rule under test: errors with content ⇒ NOT ok.

test("nighthawkOutcomesRunHealth: clean run (even with skips) is ok", () => {
  assert.deepEqual(nighthawkOutcomesRunHealth({ resolved: 5, skipped: 2, errors: [] }), {
    ok: true,
  });
});

test("nighthawkOutcomesRunHealth: any per-row error means the run is NOT ok, even when others resolved", () => {
  const health = nighthawkOutcomesRunHealth({
    resolved: 3,
    skipped: 0,
    errors: ['AAPL@2026-07-06: new row for relation "nighthawk_play_outcomes" violates check constraint'],
  });
  assert.equal(health.ok, false);
  assert.match(health.error ?? "", /1 grade write\(s\) failed/);
  assert.match(health.error ?? "", /AAPL@2026-07-06/);
});

test("nighthawkOutcomesRunHealth: many errors summarize with an honest overflow count", () => {
  const health = nighthawkOutcomesRunHealth({
    resolved: 0,
    skipped: 0,
    errors: ["a: x", "b: x", "c: x", "d: x", "e: x"],
  });
  assert.equal(health.ok, false);
  assert.match(health.error ?? "", /5 grade write\(s\) failed/);
  assert.match(health.error ?? "", /\(\+2 more\)/);
});

// Wiring pin (same source-inspection idiom as db.test.ts): the cron route must derive
// its health verdict from the error ledger — an unconditional `ok: true` in the
// happy-path logCronRun call is exactly the bug this fixed.
test("cron/nighthawk-outcomes route derives ok from nighthawkOutcomesRunHealth, not a literal", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../../app/api/cron/nighthawk-outcomes/route.ts", import.meta.url)),
    "utf8"
  );
  assert.match(src, /nighthawkOutcomesRunHealth\(result\)/);
  assert.match(src, /ok:\s*health\.ok/);
  assert.ok(
    !/logCronRun\("nighthawk-outcomes",\s*started,\s*\{\s*ok:\s*true/.test(src),
    "the success-path health record must never hardcode ok: true"
  );
});
