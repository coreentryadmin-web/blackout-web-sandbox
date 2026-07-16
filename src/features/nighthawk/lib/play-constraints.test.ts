import assert from "node:assert/strict";
import test from "node:test";
import { canonicalTicker, deduplicateTickerFamilies } from "./play-constraints";

// ── canonicalTicker ─────────────────────────────────────────────────────────

test("canonicalTicker: GOOG maps to GOOGL", () => {
  assert.equal(canonicalTicker("GOOG"), "GOOGL");
  assert.equal(canonicalTicker("goog"), "GOOGL");
});

test("canonicalTicker: GOOGL stays GOOGL", () => {
  assert.equal(canonicalTicker("GOOGL"), "GOOGL");
});

test("canonicalTicker: BRK variants map to BRK.A", () => {
  assert.equal(canonicalTicker("BRK.B"), "BRK.A");
  assert.equal(canonicalTicker("BRK/B"), "BRK.A");
  assert.equal(canonicalTicker("BRKB"), "BRK.A");
});

test("canonicalTicker: unknown ticker passes through", () => {
  assert.equal(canonicalTicker("AAPL"), "AAPL");
  assert.equal(canonicalTicker("NVDA"), "NVDA");
});

// ── deduplicateTickerFamilies ───────────────────────────────────────────────

test("deduplicateTickerFamilies: GOOGL + GOOG keeps only the first", () => {
  const items = [
    { ticker: "GOOGL", score: 67 },
    { ticker: "GOOG", score: 63 },
  ];
  const { kept, dropped } = deduplicateTickerFamilies(items);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.ticker, "GOOGL");
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0]!.item.ticker, "GOOG");
  assert.equal(dropped[0]!.canonical, "GOOGL");
  assert.equal(dropped[0]!.kept_ticker, "GOOGL");
});

test("deduplicateTickerFamilies: unrelated tickers all pass through", () => {
  const items = [
    { ticker: "FHN", score: 77 },
    { ticker: "COF", score: 72 },
    { ticker: "ZETA", score: 63 },
  ];
  const { kept, dropped } = deduplicateTickerFamilies(items);
  assert.equal(kept.length, 3);
  assert.equal(dropped.length, 0);
});

test("deduplicateTickerFamilies: BRK.A + BRK.B keeps only the first", () => {
  const items = [
    { ticker: "BRK.A", score: 80 },
    { ticker: "BRK.B", score: 75 },
  ];
  const { kept, dropped } = deduplicateTickerFamilies(items);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.ticker, "BRK.A");
  assert.equal(dropped.length, 1);
});

test("deduplicateTickerFamilies: order matters — higher-ranked (first) member wins", () => {
  const items = [
    { ticker: "GOOG", score: 80 },
    { ticker: "GOOGL", score: 67 },
  ];
  const { kept, dropped } = deduplicateTickerFamilies(items);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.ticker, "GOOG");
  assert.equal(dropped[0]!.item.ticker, "GOOGL");
});
