import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeShortVolume,
  normalizeShortInterest,
  assembleFundamentalsBundle,
} from "./ticker-fundamentals";
import type { PolygonFinancialRatios, FundamentalSignals } from "@/lib/providers/polygon";

test("summarizeShortVolume: picks the freshest row's ratio + date (bad sort tolerated)", () => {
  const s = summarizeShortVolume([
    { date: "2026-07-01", short_volume: 1, total_volume: 10, short_volume_ratio: 0.1 },
    { date: "2026-07-10", short_volume: 6, total_volume: 10, short_volume_ratio: 0.6 }, // newest, returned 2nd
    { date: "2026-06-15", short_volume: 3, total_volume: 10, short_volume_ratio: 0.3 },
  ]);
  assert.deepEqual(s, { short_volume_ratio: 0.6, short_volume_date: "2026-07-10" });
});

test("summarizeShortVolume: empty rows and zero ratio → null", () => {
  assert.deepEqual(summarizeShortVolume([]), { short_volume_ratio: null, short_volume_date: null });
  const z = summarizeShortVolume([{ date: "2026-07-10", short_volume: 0, total_volume: 0, short_volume_ratio: 0 }]);
  assert.equal(z.short_volume_ratio, null);
  assert.equal(z.short_volume_date, "2026-07-10");
});

test("normalizeShortInterest: maps real reading; 0-coerced numerics become null", () => {
  const si = normalizeShortInterest({
    ticker: "NVDA",
    settlement_date: "2026-06-30",
    short_interest: 12_000_000,
    avg_daily_volume: 3_000_000,
    days_to_cover: 4,
    source: "massive_stocks_v1",
  });
  assert.deepEqual(si, {
    settlement_date: "2026-06-30",
    short_interest: 12_000_000,
    avg_daily_volume: 3_000_000,
    days_to_cover: 4,
  });
});

test("normalizeShortInterest: null passthrough + all-empty reading → null", () => {
  assert.equal(normalizeShortInterest(null), null);
  const empty = normalizeShortInterest({
    ticker: "X",
    settlement_date: "",
    short_interest: 0,
    avg_daily_volume: 0,
    days_to_cover: 0,
    source: "massive_stocks_v1",
  });
  assert.equal(empty, null);
});

test("assembleFundamentalsBundle: as_of prefers ratios → signals → SI → short-vol; slices passthrough", () => {
  const ratios = { as_of: "2026-07-09", pe_ratio: 30 } as unknown as PolygonFinancialRatios;
  const signals = { latest_period_end: "2026-03-31" } as unknown as FundamentalSignals;

  const full = assembleFundamentalsBundle("nvda", {
    ratios,
    signals,
    priceTarget: null,
    shortInterest: { settlement_date: "2026-06-30", short_interest: 1, avg_daily_volume: 2, days_to_cover: 3 },
    shortVolume: { short_volume_ratio: 0.42, short_volume_date: "2026-07-10" },
  });
  assert.equal(full.ticker, "NVDA"); // uppercased
  assert.equal(full.as_of, "2026-07-09"); // ratios wins
  assert.equal(full.short_volume_ratio, 0.42);
  assert.equal(full.short_interest?.days_to_cover, 3);

  // No ratios → falls through to signals' period end.
  const noRatios = assembleFundamentalsBundle("nvda", {
    ratios: null,
    signals,
    priceTarget: null,
    shortInterest: null,
    shortVolume: { short_volume_ratio: null, short_volume_date: null },
  });
  assert.equal(noRatios.as_of, "2026-03-31");

  // Nothing dated anywhere → as_of null.
  const bare = assembleFundamentalsBundle("nvda", {
    ratios: null,
    signals: null,
    priceTarget: null,
    shortInterest: null,
    shortVolume: { short_volume_ratio: null, short_volume_date: null },
  });
  assert.equal(bare.as_of, null);
});
