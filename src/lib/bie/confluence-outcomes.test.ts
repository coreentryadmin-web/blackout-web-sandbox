import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketConfluenceRows,
  bucketShadowFactorEvidence,
  classifyShadowFactorAgreement,
  mapConfluenceRows,
  mapShadowFactorEvidenceRows,
  type ConfluenceRow,
  type RawConfluenceRow,
  type RawShadowFactorEvidenceRow,
  type ShadowFactorEvidenceRow,
} from "./confluence-outcomes";

function row(overrides: Partial<ConfluenceRow>): ConfluenceRow {
  return {
    ticker: "AAPL",
    session_date: "2026-07-02",
    zerodte_direction: "long",
    direction_hit: true,
    move_pct: 1.2,
    nighthawk_edition_for: null,
    nighthawk_direction: null,
    ...overrides,
  };
}

test("bucketConfluenceRows: rows with no prior Night Hawk take go to no_echo", () => {
  const stats = bucketConfluenceRows([row({})]);
  const noEcho = stats.find((s) => s.bucket === "no_echo")!;
  assert.equal(noEcho.n, 1);
  assert.equal(stats.find((s) => s.bucket === "agree")!.n, 0);
  assert.equal(stats.find((s) => s.bucket === "disagree")!.n, 0);
});

test("bucketConfluenceRows: matching direction across LONG/long casing buckets as agree, not disagree", () => {
  const stats = bucketConfluenceRows([
    row({ zerodte_direction: "long", nighthawk_direction: "LONG", nighthawk_edition_for: "2026-06-30" }),
  ]);
  assert.equal(stats.find((s) => s.bucket === "agree")!.n, 1);
  assert.equal(stats.find((s) => s.bucket === "disagree")!.n, 0);
});

test("bucketConfluenceRows: opposite direction buckets as disagree", () => {
  const stats = bucketConfluenceRows([
    row({ zerodte_direction: "long", nighthawk_direction: "SHORT", nighthawk_edition_for: "2026-06-30" }),
  ]);
  assert.equal(stats.find((s) => s.bucket === "disagree")!.n, 1);
  assert.equal(stats.find((s) => s.bucket === "agree")!.n, 0);
});

test("bucketConfluenceRows: hit_rate_pct only counts graded rows, ignores nulls in the denominator", () => {
  const stats = bucketConfluenceRows([
    row({ direction_hit: true }),
    row({ direction_hit: false }),
    row({ direction_hit: null }),
  ]);
  const noEcho = stats.find((s) => s.bucket === "no_echo")!;
  assert.equal(noEcho.n, 3);
  assert.equal(noEcho.hit_rate_pct, 50);
});

test("bucketConfluenceRows: empty bucket reports null hit_rate_pct/avg_move_pct, not 0 or NaN", () => {
  const stats = bucketConfluenceRows([]);
  for (const s of stats) {
    assert.equal(s.n, 0);
    assert.equal(s.hit_rate_pct, null);
    assert.equal(s.avg_move_pct, null);
  }
});

test("bucketConfluenceRows: insufficient_sample flags buckets under the MIN_SAMPLE threshold", () => {
  const stats = bucketConfluenceRows([row({})]);
  assert.equal(stats.find((s) => s.bucket === "no_echo")!.insufficient_sample, true);
});

test("bucketConfluenceRows: insufficient_sample clears once a bucket reaches 10", () => {
  const rows = Array.from({ length: 10 }, () => row({}));
  const stats = bucketConfluenceRows(rows);
  assert.equal(stats.find((s) => s.bucket === "no_echo")!.insufficient_sample, false);
});

test("bucketConfluenceRows: avg_move_pct averages only rows with a non-null move_pct", () => {
  const stats = bucketConfluenceRows([row({ move_pct: 2 }), row({ move_pct: 4 }), row({ move_pct: null })]);
  assert.equal(stats.find((s) => s.bucket === "no_echo")!.avg_move_pct, 3);
});

function rawRow(overrides: Partial<RawConfluenceRow>): RawConfluenceRow {
  return {
    ticker: "AAPL",
    session_date: "2026-07-02",
    zerodte_direction: "long",
    direction_hit: true,
    move_pct: "1.20",
    nighthawk_edition_for: null,
    nighthawk_direction: null,
    ...overrides,
  };
}

test("mapConfluenceRows: converts a Postgres NUMERIC string move_pct to a real number", () => {
  const [mapped] = mapConfluenceRows([rawRow({ move_pct: "1.20" })]);
  assert.equal(mapped.move_pct, 1.2);
  assert.equal(typeof mapped.move_pct, "number");
});

test("mapConfluenceRows: null move_pct stays null, not the string \"null\" or 0", () => {
  const [mapped] = mapConfluenceRows([rawRow({ move_pct: null })]);
  assert.equal(mapped.move_pct, null);
});

test("mapConfluenceRows + bucketConfluenceRows: string move_pct values sum correctly instead of concatenating", () => {
  // Regression test for the exact bug found in review: without Number() conversion,
  // ["1.20", "-0.50", "2.00"].reduce((a,b) => a+b, 0) produces the STRING
  // "01.20-0.502.00" (JS string concatenation), which coerces to NaN on division
  // and silently serializes to null — every avg_move_pct looked like "no data."
  const raw: RawConfluenceRow[] = [
    rawRow({ move_pct: "1.20" }),
    rawRow({ move_pct: "-0.50" }),
    rawRow({ move_pct: "2.00" }),
  ];
  const stats = bucketConfluenceRows(mapConfluenceRows(raw));
  const noEcho = stats.find((s) => s.bucket === "no_echo")!;
  assert.equal(noEcho.avg_move_pct, 0.9);
});

// ── SPX Slayer shadow-factor evidence (task #122) ──

function shadowRow(overrides: Partial<ShadowFactorEvidenceRow>): ShadowFactorEvidenceRow {
  return {
    factor_name: "risk_reversal_skew",
    factor_direction: "bullish",
    play_direction: "long",
    play_outcome: "win",
    pnl_pts: 4.5,
    ...overrides,
  };
}

test("classifyShadowFactorAgreement: bullish factor + long play agrees", () => {
  assert.equal(classifyShadowFactorAgreement("bullish", "long"), "agree");
});

test("classifyShadowFactorAgreement: bullish factor + short play disagrees", () => {
  assert.equal(classifyShadowFactorAgreement("bullish", "short"), "disagree");
});

test("classifyShadowFactorAgreement: bearish factor + short play agrees", () => {
  assert.equal(classifyShadowFactorAgreement("bearish", "short"), "agree");
});

test("classifyShadowFactorAgreement: bearish factor + long play disagrees", () => {
  assert.equal(classifyShadowFactorAgreement("bearish", "long"), "disagree");
});

test("classifyShadowFactorAgreement: a neutral factor reading is never agree or disagree, regardless of play direction", () => {
  assert.equal(classifyShadowFactorAgreement("neutral", "long"), "neutral");
  assert.equal(classifyShadowFactorAgreement("neutral", "short"), "neutral");
});

function rawShadowRow(overrides: Partial<RawShadowFactorEvidenceRow>): RawShadowFactorEvidenceRow {
  return {
    factor_name: "risk_reversal_skew",
    factor_direction: "bullish",
    play_direction: "long",
    play_outcome: "win",
    pnl_pts: "4.50",
    ...overrides,
  };
}

test("mapShadowFactorEvidenceRows: converts a Postgres NUMERIC string pnl_pts to a real number", () => {
  const [mapped] = mapShadowFactorEvidenceRows([rawShadowRow({ pnl_pts: "4.50" })]);
  assert.equal(mapped.pnl_pts, 4.5);
  assert.equal(typeof mapped.pnl_pts, "number");
});

test("mapShadowFactorEvidenceRows: null pnl_pts stays null, not the string \"null\" or 0", () => {
  const [mapped] = mapShadowFactorEvidenceRows([rawShadowRow({ pnl_pts: null })]);
  assert.equal(mapped.pnl_pts, null);
});

test("mapShadowFactorEvidenceRows: an unrecognized factor_direction narrows to neutral rather than crashing or miscounting", () => {
  const [mapped] = mapShadowFactorEvidenceRows([rawShadowRow({ factor_direction: "sideways" })]);
  assert.equal(mapped.factor_direction, "neutral");
});

test("mapShadowFactorEvidenceRows + bucketShadowFactorEvidence: string pnl_pts values sum correctly instead of concatenating", () => {
  // Regression-shaped test mirroring mapConfluenceRows' own move_pct proof above —
  // without Number() conversion this would silently serialize every avg_pnl_pts to
  // null instead of throwing, so the only way to catch it is asserting the real value.
  const raw: RawShadowFactorEvidenceRow[] = [
    rawShadowRow({ pnl_pts: "4.50" }),
    rawShadowRow({ pnl_pts: "-1.50" }),
    rawShadowRow({ pnl_pts: "2.00" }),
  ];
  const stats = bucketShadowFactorEvidence(["risk_reversal_skew"], mapShadowFactorEvidenceRows(raw));
  const agree = stats.find((s) => s.factor_name === "risk_reversal_skew" && s.agreement === "agree")!;
  assert.equal(agree.avg_pnl_pts, 1.67);
});

test("bucketShadowFactorEvidence: a factor with 10+ correlated outcomes computes a real win-rate/avg-pnl stat and clears insufficient_sample", () => {
  const rows: ShadowFactorEvidenceRow[] = [
    ...Array.from({ length: 7 }, () => shadowRow({ play_outcome: "win", pnl_pts: 5 })),
    ...Array.from({ length: 3 }, () => shadowRow({ play_outcome: "loss", pnl_pts: -3 })),
  ];
  const stats = bucketShadowFactorEvidence(["risk_reversal_skew"], rows);
  const agree = stats.find((s) => s.factor_name === "risk_reversal_skew" && s.agreement === "agree")!;
  assert.equal(agree.n, 10);
  assert.equal(agree.win_rate_pct, 70);
  assert.equal(agree.avg_pnl_pts, 2.6); // (7*5 + 3*-3) / 10 = 2.6
  assert.equal(agree.insufficient_sample, false);
});

test("bucketShadowFactorEvidence: a factor_name with zero correlated outcomes yet reports an honest insufficient-evidence state, never a fabricated number", () => {
  // "macro_prediction_consensus" is passed in factorNames (it HAS been observed —
  // spx_confluence_shadow_observations has rows for it) but never appears in the
  // evidence rows (no graded SPX Slayer play was ever open within 30min of one of
  // its observations) — exactly the brand-new-factor / never-matched-yet case.
  const stats = bucketShadowFactorEvidence(["macro_prediction_consensus"], []);
  const forFactor = stats.filter((s) => s.factor_name === "macro_prediction_consensus");
  assert.equal(forFactor.length, 3); // agree + disagree + neutral, all present
  for (const s of forFactor) {
    assert.equal(s.n, 0);
    assert.equal(s.win_rate_pct, null);
    assert.equal(s.avg_pnl_pts, null);
    assert.equal(s.insufficient_sample, true);
  }
});

test("bucketShadowFactorEvidence: agree and disagree buckets for the same factor are tracked independently", () => {
  const rows: ShadowFactorEvidenceRow[] = [
    shadowRow({ factor_direction: "bullish", play_direction: "long", play_outcome: "win" }),
    shadowRow({ factor_direction: "bullish", play_direction: "short", play_outcome: "loss" }),
  ];
  const stats = bucketShadowFactorEvidence(["risk_reversal_skew"], rows);
  const agree = stats.find((s) => s.factor_name === "risk_reversal_skew" && s.agreement === "agree")!;
  const disagree = stats.find((s) => s.factor_name === "risk_reversal_skew" && s.agreement === "disagree")!;
  assert.equal(agree.n, 1);
  assert.equal(agree.win_rate_pct, 100);
  assert.equal(disagree.n, 1);
  assert.equal(disagree.win_rate_pct, 0);
});

test("bucketShadowFactorEvidence: a factor_name appearing only in evidence rows (not the factorNames list) is still reported, not dropped", () => {
  const rows: ShadowFactorEvidenceRow[] = [shadowRow({ factor_name: "ecosystem_zerodte_agreement" })];
  const stats = bucketShadowFactorEvidence([], rows);
  assert.ok(stats.some((s) => s.factor_name === "ecosystem_zerodte_agreement" && s.agreement === "agree" && s.n === 1));
});

test("bucketShadowFactorEvidence: breakeven outcomes count in the denominator but never as a win", () => {
  const rows: ShadowFactorEvidenceRow[] = [
    shadowRow({ play_outcome: "win" }),
    shadowRow({ play_outcome: "breakeven" }),
  ];
  const stats = bucketShadowFactorEvidence(["risk_reversal_skew"], rows);
  const agree = stats.find((s) => s.factor_name === "risk_reversal_skew" && s.agreement === "agree")!;
  assert.equal(agree.n, 2);
  assert.equal(agree.win_rate_pct, 50);
});
