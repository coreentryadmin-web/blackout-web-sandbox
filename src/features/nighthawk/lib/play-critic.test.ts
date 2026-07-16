import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PlaybookPlay } from "./types";
import type { MarketWideContext } from "./market-wide";
import type { ScoredCandidate } from "./scorer";
import { critiquePlays } from "./play-critic";

function fakePlay(overrides: Partial<PlaybookPlay> = {}): PlaybookPlay {
  return {
    rank: 1,
    ticker: "NBIS",
    direction: "LONG",
    conviction: "A",
    play_type: "stock",
    thesis: "NBIS breaking out above 300 on call flow",
    key_signal: "Call flow building",
    entry_range: "Breakout above 300",
    target: "330",
    stop: "285",
    options_play: "NBIS 300C 2026-09-18",
    ...overrides,
  };
}

function fakeScored(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    ticker: "NBIS",
    score: 48,
    direction: "long",
    flow_score: 15,
    tech_score: 12,
    pos_score: 8,
    news_score: 4,
    smart_money_score: 3,
    confirming_signals: 3,
    conviction: "A",
    ...overrides,
  };
}

function fakeCtx(overrides: Partial<MarketWideContext> = {}): MarketWideContext {
  return {
    today: "2026-07-04",
    tomorrow: "2026-07-05",
    tide: null,
    stock_flows: [],
    hot_chains: [],
    index_flows: {},
    spx_bars: [],
    spx_intraday_5m: [],
    spx_gap: null,
    vix_bars: [],
    market_news: [],
    macro_events: [],
    tomorrow_earnings: [],
    sector_performance: [],
    after_hours_catalysts: [],
    top_net_impact: [],
    market_breadth: null,
    predictions_consensus: [],
    mag7_greek_flow: null,
    macro_indicators: [],
    ...overrides,
  } as unknown as MarketWideContext;
}

describe("play-critic: deterministic rule-based critic", () => {
  test("passes a well-scored play with confirming signals", async () => {
    const play = fakePlay();
    const scored = fakeScored();
    const result = await critiquePlays({
      plays: [play],
      dossiers: {},
      ranked: [scored],
      ctx: fakeCtx(),
    });
    assert.equal(result.plays.length, 1);
    assert.equal(result.plays[0].ticker, "NBIS");
    assert.equal(result.plays[0].conviction, "A");
  });

  test("CUT: score below floor (25)", async () => {
    const play = fakePlay();
    const scored = fakeScored({ score: 20, conviction: "C" });
    const result = await critiquePlays({
      plays: [play],
      dossiers: {},
      ranked: [scored],
      ctx: fakeCtx(),
    });
    assert.equal(result.plays.length, 0);
    assert.ok(result.notes.some((n) => n.includes("CUT") && n.includes("score 20")));
  });

  test("CUT: direction inconsistency (play LONG, scored short)", async () => {
    const play = fakePlay({ direction: "LONG" });
    const scored = fakeScored({ direction: "short" });
    const result = await critiquePlays({
      plays: [play],
      dossiers: {},
      ranked: [scored],
      ctx: fakeCtx(),
    });
    assert.equal(result.plays.length, 0);
    assert.ok(result.notes.some((n) => n.includes("CUT") && n.includes("direction")));
  });

  test("CUT: trading halt", async () => {
    const play = fakePlay();
    const scored = fakeScored({ trading_halt: true });
    const result = await critiquePlays({
      plays: [play],
      dossiers: {},
      ranked: [scored],
      ctx: fakeCtx(),
    });
    assert.equal(result.plays.length, 0);
    assert.ok(result.notes.some((n) => n.includes("CUT") && n.includes("halt")));
  });

  test("DOWNGRADE: conviction inflation (play A+, tier engine warrants C)", async () => {
    const play = fakePlay({ conviction: "A+" });
    const scored = fakeScored({ score: 30, confirming_signals: 1, conviction: "C" });
    const result = await critiquePlays({
      plays: [play],
      dossiers: {},
      ranked: [scored],
      ctx: fakeCtx(),
    });
    assert.equal(result.plays.length, 1);
    assert.equal(result.plays[0].conviction, "C");
    assert.ok(result.notes.some((n) => n.includes("DOWNGRADE") && n.includes("A+") && n.includes("C")));
  });

  test("DOWNGRADE: thin signal confirmation (tier engine caps at B)", async () => {
    const play = fakePlay({ conviction: "A" });
    const scored = fakeScored({
      score: 48,
      conviction: "A",
      confirming_signals: 1,
      flow_score: 20,
      tech_score: 0,
      pos_score: -2,
      news_score: 0,
      smart_money_score: 0,
    });
    const result = await critiquePlays({
      plays: [play],
      dossiers: {},
      ranked: [scored],
      ctx: fakeCtx(),
    });
    assert.equal(result.plays.length, 1);
    assert.equal(result.plays[0].conviction, "B");
    assert.ok(result.notes.some((n) => n.includes("DOWNGRADE") && n.includes("→ B")));
  });

  test("NOTE + DOWNGRADE: regime contradiction (bearish tide + LONG play)", async () => {
    const play = fakePlay({ direction: "LONG", conviction: "A" });
    const scored = fakeScored({ direction: "long", score: 48, confirming_signals: 3 });
    const result = await critiquePlays({
      plays: [play],
      dossiers: {},
      ranked: [scored],
      ctx: fakeCtx({ tide: "bearish" as any }),
    });
    assert.equal(result.plays.length, 1);
    assert.equal(result.plays[0].conviction, "B");
    assert.ok(result.notes.some((n) => n.includes("NOTE") && n.includes("tide")));
    assert.ok(result.notes.some((n) => n.includes("DOWNGRADE") && n.includes("regime")));
  });

  test("no scored data → play passes through unchanged", async () => {
    const play = fakePlay({ ticker: "UNKNOWN" });
    const result = await critiquePlays({
      plays: [play],
      dossiers: {},
      ranked: [],
      ctx: fakeCtx(),
    });
    assert.equal(result.plays.length, 1);
    assert.equal(result.plays[0].conviction, "A");
  });

  test("re-ranks surviving plays 1..N after cuts", async () => {
    const plays = [
      fakePlay({ rank: 1, ticker: "AAA" }),
      fakePlay({ rank: 2, ticker: "BBB" }),
      fakePlay({ rank: 3, ticker: "CCC" }),
    ];
    const ranked = [
      fakeScored({ ticker: "AAA", score: 60 }),
      fakeScored({ ticker: "BBB", score: 10, conviction: "C" }),
      fakeScored({ ticker: "CCC", score: 50 }),
    ];
    const result = await critiquePlays({
      plays,
      dossiers: {},
      ranked,
      ctx: fakeCtx(),
    });
    assert.equal(result.plays.length, 2);
    assert.equal(result.plays[0].ticker, "AAA");
    assert.equal(result.plays[0].rank, 1);
    assert.equal(result.plays[1].ticker, "CCC");
    assert.equal(result.plays[1].rank, 2);
  });
});
