import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNighthawkPublishContext,
  buildNighthawkPublishContexts,
  earningsTomorrowForTicker,
  PUBLISH_CONTEXT_VERSION,
  type PublishContextMarket,
} from "./publish-context";
import type { PlaybookPlay } from "./types";
import type { ScoredCandidate } from "./scorer";
import type { TickerDossier } from "./dossier";

// PR-N4 (docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §3.5 / C-2): the publish-time pin.
// Contract under test: (a) every pinned number is either the value the builder actually
// computed or null — never a guess; (b) the band/target/stop geometry is signed % of
// spot with the N-3 "detached band" signature visible; (c) the plural builder is
// fail-soft — a broken play pins null and the rest of the edition still pins.

function play(overrides: Partial<PlaybookPlay> = {}): PlaybookPlay {
  return {
    rank: 1,
    ticker: "AMD",
    direction: "LONG",
    conviction: "A+",
    play_type: "stock",
    thesis: "t",
    key_signal: "k",
    entry_range: "$100.00-$102.00",
    target: "$110.00",
    stop: "$95.00",
    options_play: "AMD 110C",
    score: 72,
    entry_premium: 3.5,
    ...overrides,
  };
}

function scored(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    ticker: "AMD",
    score: 72,
    direction: "long",
    flow_score: 30,
    tech_score: 12,
    pos_score: 10,
    news_score: 4,
    smart_money_score: 3,
    fundamental_score: 2,
    catalyst_score: -1,
    catalyst_flags: ["analyst PT raised within 7 days (Firm)"],
    short_interest_score: 0,
    earnings_risk: false,
    conviction: "A",
    regime_multiplier: 1.05,
    ...overrides,
  };
}

/** Only tech/scored/sector are read by the pin — a partial cast keeps the fixture honest
 *  about that (the builder must not silently grow dossier dependencies). */
function dossier(overrides: { price?: number | null; priorClose?: number | null; atr14?: number | null; scored?: ScoredCandidate } = {}): TickerDossier {
  return {
    ticker: "AMD",
    sector: "Technology",
    scored: overrides.scored,
    tech: {
      ticker: "AMD",
      price: overrides.price ?? 108,
      trend: "up",
      setup_tags: [],
      support_levels: [],
      resistance_levels: [],
      gap_zones: [],
      breakout_zones: [],
      prior_day: { high: 109, low: 105, close: overrides.priorClose ?? 107.5 },
      weekly: { high: null, low: null },
      rsi14: null,
      rel_volume: null,
      atr14: overrides.atr14 ?? 4.2,
      vwap: null,
      ema20: null,
      ema50: null,
      ema200: null,
      summary: "",
    },
  } as unknown as TickerDossier;
}

function market(overrides: Partial<PublishContextMarket> = {}): PublishContextMarket {
  return {
    regime: {
      vix_iv_rank: 42,
      tide_bias: "BEARISH",
      advance_pct: 30.5,
      composite_regime: "BEARISH",
      anomaly_tickers: [],
    },
    market_breadth: {
      advance_decline_ratio: 0.44,
      pct_above_vwap: 28,
      pct_advancing: 30.5,
      closed_near_high: 12,
      closed_near_low: 88,
      volume_leaders: [],
      sample_size: 5000,
    },
    tomorrow_earnings: [{ ticker: "NVDA" }, { symbol: "amd" }],
    tomorrow: "2026-07-15",
    vix_close: 15.84,
    spx_close: 6243.7,
    ...overrides,
  };
}

test("pin captures spot/prior-close/geometry the builder saw — the AMD 7/07 shape becomes reconstructable", () => {
  const ctx = buildNighthawkPublishContext({
    play: play(),
    scored: scored(),
    dossier: dossier(),
    market: market(),
    builtAt: "2026-07-14T21:35:00.000Z",
  });

  assert.equal(ctx.context_version, PUBLISH_CONTEXT_VERSION);
  assert.equal(ctx.pinned_at, "2026-07-14T21:35:00.000Z");
  assert.equal(ctx.direction, "LONG");
  assert.equal(ctx.conviction, "A+");
  assert.equal(ctx.spot_at_publish, 108);
  assert.equal(ctx.prior_close, 107.5);
  assert.equal(ctx.atr14, 4.2);
  assert.equal(ctx.entry_range_low, 100);
  assert.equal(ctx.entry_range_high, 102);
  assert.equal(ctx.target, 110);
  assert.equal(ctx.stop, 95);
  // LONG fill edge = band TOP (102). Spot 108 → band sits 5.5556% BELOW spot: the
  // signed negative distance IS the N-3 detached-band signature the N3 gate thresholds.
  assert.equal(ctx.band_distance_pct, -5.5556);
  // Target 110 from spot 108 = +1.8519%; stop 95 = −12.037% (uncapped gap risk, visible).
  assert.equal(ctx.target_distance_pct, 1.8519);
  assert.equal(ctx.stop_distance_pct, -12.037);
});

test("pin carries the evening regime/breadth bundle and the scorer's own confluence, un-recomputed", () => {
  const s = scored();
  const ctx = buildNighthawkPublishContext({
    play: play(),
    scored: s,
    dossier: dossier({ scored: s }),
    market: market(),
    builtAt: "2026-07-14T21:35:00.000Z",
  });

  const m = ctx.market as Record<string, unknown>;
  assert.equal(m.composite_regime, "BEARISH");
  assert.equal(m.tide_bias, "BEARISH");
  assert.equal(m.vix_iv_rank, 42);
  assert.equal(m.vix_close, 15.84);
  assert.equal(m.spx_close, 6243.7);
  const breadth = m.breadth as Record<string, unknown>;
  assert.equal(breadth.pct_advancing, 30.5);
  assert.equal(breadth.advance_decline_ratio, 0.44);

  // Confluence = the exact sub-scores scoreCandidate computed (shared shape with the
  // rejection audit rows) — spot-check the passthrough, no re-derivation.
  const conf = ctx.confluence as Record<string, unknown>;
  assert.equal(conf.total_score, 72);
  assert.equal(conf.flow_score, 30);
  assert.equal(conf.regime_multiplier, 1.05);
});

test("SHORT geometry mirrors: fill edge is the band LOW and signs flip with the tape", () => {
  const ctx = buildNighthawkPublishContext({
    play: play({ direction: "SHORT", entry_range: "$110.00-$112.00", target: "$100.00", stop: "$118.00" }),
    scored: scored({ direction: "short" }),
    dossier: dossier({ price: 108 }),
    market: market(),
    builtAt: "2026-07-14T21:35:00.000Z",
  });
  assert.equal(ctx.direction, "SHORT");
  // SHORT fill edge = band LOW (110): +1.8519% ABOVE spot.
  assert.equal(ctx.band_distance_pct, 1.8519);
  assert.equal(ctx.target_distance_pct, -7.4074);
});

test("earnings knowledge at publish: calendar hit pins earnings_tomorrow + the date; miss pins false + null", () => {
  assert.equal(earningsTomorrowForTicker("AMD", [{ symbol: "amd" }]), true);
  assert.equal(earningsTomorrowForTicker("AMD", [{ ticker: "NVDA" }]), false);

  const hit = buildNighthawkPublishContext({
    play: play(),
    scored: scored({ earnings_risk: true, catalyst_flags: ["earnings tomorrow — binary risk, expiry into event"] }),
    dossier: dossier(),
    market: market(),
    builtAt: "2026-07-14T21:35:00.000Z",
  });
  const cat = hit.catalysts as Record<string, unknown>;
  assert.equal(cat.earnings_tomorrow, true);
  assert.equal(cat.earnings_date, "2026-07-15");
  assert.equal(cat.earnings_risk, true);
  assert.deepEqual(cat.catalyst_flags, ["earnings tomorrow — binary risk, expiry into event"]);

  const miss = buildNighthawkPublishContext({
    play: play({ ticker: "WFC" }),
    scored: null,
    dossier: null,
    market: market(),
    builtAt: "2026-07-14T21:35:00.000Z",
  });
  const missCat = miss.catalysts as Record<string, unknown>;
  assert.equal(missCat.earnings_tomorrow, false);
  assert.equal(missCat.earnings_date, null);
});

test("never backfill-guess: missing dossier/tech/regime pins nulls, not fabricated numbers", () => {
  const ctx = buildNighthawkPublishContext({
    play: play(),
    scored: null,
    dossier: null,
    market: market({ regime: null, market_breadth: null, vix_close: null, spx_close: null }),
    builtAt: "2026-07-14T21:35:00.000Z",
  });
  assert.equal(ctx.spot_at_publish, null);
  assert.equal(ctx.prior_close, null);
  assert.equal(ctx.atr14, null);
  // No spot ⇒ no distance math — null, never a division fallback.
  assert.equal(ctx.band_distance_pct, null);
  assert.equal(ctx.target_distance_pct, null);
  assert.equal(ctx.stop_distance_pct, null);
  const m = ctx.market as Record<string, unknown>;
  assert.equal(m.composite_regime, null);
  assert.equal(m.breadth, null);
  assert.equal(ctx.confluence, null);
  // The published geometry itself is still pinned (it comes from the play, not the tape).
  assert.equal(ctx.target, 110);
});

test("plural builder pins every play by UPPERCASED ticker and is FAIL-SOFT per play", () => {
  const good = play({ ticker: "amd" });
  // A play whose accessor explodes — the plural builder must pin null for it and
  // still pin its siblings (a pinning failure never blocks the edition/sync).
  const bomb = play({ ticker: "BOOM" });
  Object.defineProperty(bomb, "entry_range", {
    get() {
      throw new Error("synthetic accessor failure");
    },
  });

  const out = buildNighthawkPublishContexts({
    plays: [good, bomb],
    dossiers: { AMD: dossier() },
    market: market(),
    builtAt: "2026-07-14T21:35:00.000Z",
  });

  assert.ok(out.AMD, "healthy play pinned under its uppercased ticker");
  assert.equal((out.AMD as Record<string, unknown>).spot_at_publish, 108);
  assert.equal(out.BOOM, null, "broken play degrades to a null pin, never a throw");
});

test("plural builder tolerates garbage input wholesale (returns {} rather than throwing)", () => {
  const out = buildNighthawkPublishContexts({
    plays: undefined as unknown as PlaybookPlay[],
    dossiers: {},
    market: market(),
    builtAt: "2026-07-14T21:35:00.000Z",
  });
  assert.deepEqual(out, {});
});
