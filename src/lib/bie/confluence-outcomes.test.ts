import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketConfluenceRows, mapConfluenceRows, type ConfluenceRow, type RawConfluenceRow } from "./confluence-outcomes";

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
