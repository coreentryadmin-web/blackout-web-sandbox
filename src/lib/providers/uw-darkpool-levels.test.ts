import assert from "node:assert/strict";
import test from "node:test";
import { aggregateDarkPoolLevels, fetchDarkPoolLevels } from "./uw-darkpool-levels";
import type { DarkPoolPrint } from "./unusual-whales";

// DarkPoolPrint.strike = bucketed PRICE the size printed at (per fetchUwDarkPool).
function print(strike: number, premium: number, side = "unknown", executed_at = "2026-07-13T14:00:00"): DarkPoolPrint {
  return { strike, premium, side, executed_at };
}

test("aggregate: groups by price, sums notional, ranks by notional, computes pct", () => {
  const levels = aggregateDarkPoolLevels([
    print(600, 3_000_000),
    print(600, 1_000_000), // same level → merged (4M total at 600)
    print(610, 6_000_000), // biggest
    print(590, 1_000_000),
  ]);
  // Total = 11M. Ranked by notional: 610 (6M), 600 (4M), 590 (1M).
  assert.deepEqual(levels.map((l) => l.price), [610, 600, 590]);
  assert.equal(levels[0].notional, 6_000_000);
  assert.equal(levels[1].notional, 4_000_000);
  assert.equal(levels[0].pct, Number(((6 / 11) * 100).toFixed(1)));
});

test("aggregate: zone = support/resistance/at vs spot; null with no spot", () => {
  const prints = [print(590, 1_000_000), print(600, 1_000_000), print(610, 1_000_000)];
  const withSpot = aggregateDarkPoolLevels(prints, { spot: 600 });
  const byPrice = Object.fromEntries(withSpot.map((l) => [l.price, l.zone]));
  assert.equal(byPrice[590], "support");
  assert.equal(byPrice[610], "resistance");
  assert.equal(byPrice[600], "at"); // within 0.15% of spot
  // No spot → every zone null.
  assert.ok(aggregateDarkPoolLevels(prints).every((l) => l.zone === null));
});

test("aggregate: dominant side from buy/sell notional split", () => {
  const [buyHeavy] = aggregateDarkPoolLevels([print(600, 8_000_000, "buy"), print(600, 1_000_000, "sell")]);
  assert.equal(buyHeavy.side, "buy");
  const [mixed] = aggregateDarkPoolLevels([print(700, 5_000_000, "buy"), print(700, 5_000_000, "sell")]);
  assert.equal(mixed.side, "mixed");
  const [unknown] = aggregateDarkPoolLevels([print(700, 5_000_000, "unknown")]);
  assert.equal(unknown.side, "unknown");
});

test("aggregate: drops junk (non-finite/≤0 price or notional); empty in → empty out", () => {
  assert.deepEqual(aggregateDarkPoolLevels([]), []);
  assert.deepEqual(aggregateDarkPoolLevels(null), []);
  const levels = aggregateDarkPoolLevels([
    print(0, 1_000_000), // price ≤ 0 → dropped
    print(600, 0), // notional ≤ 0 → dropped
    print(605, 2_000_000),
  ]);
  assert.equal(levels.length, 1);
  assert.equal(levels[0].price, 605);
});

test("aggregate: respects maxLevels", () => {
  const prints = Array.from({ length: 12 }, (_, i) => print(500 + i, (i + 1) * 100_000));
  assert.equal(aggregateDarkPoolLevels(prints, { maxLevels: 3 }).length, 3);
});

// Fail-open: with UW_API_KEY unset the reader returns the fail-open envelope and never throws.
test("fetchDarkPoolLevels: unconfigured → fail-open, never throws", async () => {
  const saved = process.env.UW_API_KEY;
  delete process.env.UW_API_KEY;
  try {
    const r = await fetchDarkPoolLevels("NVDA");
    assert.deepEqual(r.levels, []);
    assert.equal(r.ticker, "NVDA");
    assert.match(r.unavailable ?? "", /UW_API_KEY not set/);
    assert.equal(typeof r.asOf, "string");
  } finally {
    if (saved !== undefined) process.env.UW_API_KEY = saved;
  }
});
