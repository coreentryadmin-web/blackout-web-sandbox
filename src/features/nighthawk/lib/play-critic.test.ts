import assert from "node:assert/strict";
import { before, describe, test, mock } from "node:test";
import type { PlaybookPlay } from "./types";
import type { MarketWideContext } from "./market-wide";

// Regression: critiquePlays() cut/downgraded plays based solely on Claude's self-reported
// "reason" with no check that the cited contradiction is real against the play's own data —
// a hallucinated reason could silently zero a real play. mock.module the Anthropic provider so
// we control exactly what the "critic" returns and assert the grounding guard's behavior.

let mockRaw: string | null = null;

mock.module("../../../lib/providers/anthropic", {
  namedExports: {
    anthropicConfigured: () => true,
    anthropicText: async () => mockRaw,
  },
});

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

function fakeCtx(): MarketWideContext {
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
  } as unknown as MarketWideContext;
}

describe("play-critic: grounding guard on cut/downgrade reasons", () => {
  let critiquePlays: typeof import("./play-critic").critiquePlays;

  before(async () => {
    ({ critiquePlays } = await import("./play-critic"));
  });

  test("a cut backed by a grounded reason (cites a real level) is applied", async () => {
    mockRaw = JSON.stringify([
      { rank: 1, verdict: "cut", reason: "Entry 300 contradicts put-heavy flow at 285.", corrected_conviction: "C" },
    ]);
    const play = fakePlay();
    const result = await critiquePlays({ plays: [play], dossiers: {}, ranked: [], ctx: fakeCtx() });
    assert.equal(result.plays.length, 0);
    assert.ok(result.notes.some((n) => n.includes("cut")));
  });

  test("a cut backed by an ungrounded reason (hallucinated level) is rejected — play kept", async () => {
    mockRaw = JSON.stringify([
      { rank: 1, verdict: "cut", reason: "Contradicts resistance at 812, a level not in the data.", corrected_conviction: "C" },
    ]);
    const play = fakePlay();
    const result = await critiquePlays({ plays: [play], dossiers: {}, ranked: [], ctx: fakeCtx() });
    assert.equal(result.plays.length, 1);
    assert.equal(result.plays[0].rank, 1);
    assert.equal(result.plays[0].conviction, "A"); // unchanged
    assert.ok(result.notes.some((n) => n.includes("REJECTED")));
  });

  test("a downgrade backed by an ungrounded reason is rejected — conviction unchanged", async () => {
    mockRaw = JSON.stringify([
      { rank: 1, verdict: "downgrade", reason: "IV rank spiked to 999, well above normal.", corrected_conviction: "C" },
    ]);
    const play = fakePlay();
    const result = await critiquePlays({ plays: [play], dossiers: {}, ranked: [], ctx: fakeCtx() });
    assert.equal(result.plays.length, 1);
    assert.equal(result.plays[0].conviction, "A");
  });

  test("a keep verdict is never gated by the grounding guard", async () => {
    mockRaw = JSON.stringify([
      { rank: 1, verdict: "keep", reason: "Aligns with resistance at 999, an ungrounded aside.", corrected_conviction: "A" },
    ]);
    const play = fakePlay();
    const result = await critiquePlays({ plays: [play], dossiers: {}, ranked: [], ctx: fakeCtx() });
    assert.equal(result.plays.length, 1);
  });
});
