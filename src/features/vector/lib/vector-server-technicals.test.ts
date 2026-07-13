import assert from "node:assert/strict";
import { describe, test } from "node:test";
// Import the pure core (side-effect-free) NOT vector-server-technicals.ts: the latter is
// `import "server-only"`, which throws on a plain `tsx --test` import — same pattern as
// vector-dte-walls-server.test.ts importing vector-dte-walls-core.
import {
  playTechnicalsFromSummary,
  computeTechnicalsFromBars,
} from "./vector-server-technicals-core";
import type { TechnicalsSummary } from "./vector-technicals";
import type { VectorSeedBar } from "./vector-seed-bars";

function summary(overrides: Partial<TechnicalsSummary> = {}): TechnicalsSummary {
  return {
    spot: 7560,
    vwap: 7558,
    vwapDeltaPct: 0.03,
    ema9: 7561,
    ema21: 7555,
    ema50: 7550,
    emaStack: "bullish",
    rsi: 61.4,
    rsiZone: "neutral",
    macd: 1.2,
    macdSignal: 0.8,
    macdHist: 0.4,
    macdState: "bullish",
    goldenPocket: { low: 7540, high: 7548 },
    structure: { index: 40, time: 1_752_000_000, level: 7562, type: "BOS", direction: "up" },
    ...overrides,
  };
}

describe("playTechnicalsFromSummary", () => {
  test("maps the summarizer vocabulary to the PlayTechnicals shape", () => {
    const t = playTechnicalsFromSummary(summary());
    assert.equal(t.vwap, 7558);
    assert.equal(t.emaStack, "up"); // bullish → up
    assert.equal(t.rsi, 61.4);
    assert.equal(t.macd, "bull"); // bullish → bull
    assert.deepEqual(t.goldenPocket, { low: 7540, high: 7548 });
    assert.deepEqual(t.structure, { type: "BOS", direction: "up", level: 7562 });
  });

  test("bearish stack + macd map to down / bear", () => {
    const t = playTechnicalsFromSummary(summary({ emaStack: "bearish", macdState: "bearish" }));
    assert.equal(t.emaStack, "down");
    assert.equal(t.macd, "bear");
  });

  test("null studies stay null (never fabricated)", () => {
    const t = playTechnicalsFromSummary(
      summary({ emaStack: null, macdState: null, goldenPocket: null, structure: null, rsi: null, vwap: null })
    );
    assert.equal(t.emaStack, null);
    assert.equal(t.macd, null);
    assert.equal(t.goldenPocket, null);
    assert.equal(t.structure, null);
    assert.equal(t.rsi, null);
    assert.equal(t.vwap, null);
  });
});

describe("computeTechnicalsFromBars", () => {
  function risingBars(count: number): VectorSeedBar[] {
    const bars: VectorSeedBar[] = [];
    let price = 100;
    for (let i = 0; i < count; i++) {
      price += 0.5;
      bars.push({
        time: (1_752_000_000 + i * 60) as VectorSeedBar["time"],
        open: price - 0.2,
        high: price + 0.3,
        low: price - 0.3,
        close: price,
        volume: 1000,
      });
    }
    return bars;
  }

  test("computes VWAP / EMA stack / RSI over a monotonic uptrend (1m timeframe)", () => {
    const t = computeTechnicalsFromBars(risingBars(60), 1, 130);
    assert.ok(t);
    assert.ok(t!.vwap != null && t!.vwap > 0, "VWAP computed");
    assert.equal(t!.emaStack, "up", "rising bars → EMA stacked up");
    assert.ok(t!.rsi != null && t!.rsi > 60, "rising bars → high RSI");
  });

  test("aggregates to the timeframe before summarizing (5m buckets 1m bars)", () => {
    // 60 1m bars → 12 5m buckets; ema50 can't compute on 12 bars, so emaStack degrades to null
    // (honest) rather than throwing — proves the aggregation path runs.
    const t = computeTechnicalsFromBars(risingBars(60), 5, 130);
    assert.ok(t);
    assert.equal(t!.emaStack, null);
  });

  test("returns null when there are no bars", () => {
    assert.equal(computeTechnicalsFromBars([], 5, null), null);
  });
});
