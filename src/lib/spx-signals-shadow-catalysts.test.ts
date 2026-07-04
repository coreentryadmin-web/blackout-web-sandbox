import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { computeCatalystShadowFactors, type CatalystInput } from "./spx-signals-shadow-catalysts";

const NOW = Date.parse("2026-07-04T18:00:00.000Z");

function deskStub(leaders: Array<{ ticker: string; change_pct: number }> = []): SpxDeskPayload {
  return {
    available: true,
    price: 7420,
    leader_stocks: leaders.map((l) => ({ name: l.ticker, ticker: l.ticker, change_pct: l.change_pct })),
  } as SpxDeskPayload;
}

function catalyst(overrides: Partial<CatalystInput> = {}): CatalystInput {
  return {
    ticker: "NVDA",
    type: "binary",
    title: "FDA grants approval for NVDA-partnered device",
    published: "2026-07-04T17:00:00.000Z", // 1h before NOW — inside the 24h window
    ...overrides,
  };
}

test("computeCatalystShadowFactors: no leader_stocks at all — available:false (cannot scope a check)", () => {
  const obs = computeCatalystShadowFactors(deskStub([]), [catalyst()], true, NOW);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].factor_name, "megacap_catalyst_watch");
  assert.equal(obs[0].available, false);
  assert.equal(obs[0].implied_weight, 0);
  assert.equal(obs[0].direction, "neutral");
});

test("computeCatalystShadowFactors: catalystFetchOk=false — available:false regardless of what `catalysts` contains", () => {
  const withReal = computeCatalystShadowFactors(
    deskStub([{ ticker: "NVDA", change_pct: 2 }]),
    [catalyst()],
    false,
    NOW
  );
  const withEmpty = computeCatalystShadowFactors(deskStub([{ ticker: "NVDA", change_pct: 2 }]), [], false, NOW);
  assert.equal(withReal[0].available, false);
  assert.equal(withReal[0].implied_weight, 0);
  // Guard rule under test: a broken/unconfirmed fetch must never be silently
  // reported as if it were a confirmed "no catalyst" reading — both inputs
  // collapse to the exact same available:false observation.
  assert.deepEqual(withReal, withEmpty);
});

test("computeCatalystShadowFactors: fetch ok, leaders present, no qualifying catalysts — available:true, implied_weight:0, distinct from the fetch-broken case", () => {
  const [obs] = computeCatalystShadowFactors(deskStub([{ ticker: "NVDA", change_pct: 2 }]), [], true, NOW);
  assert.equal(obs.available, true);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
  assert.equal(obs.factor_name, "megacap_catalyst_watch");
  assert.match(obs.detail, /No FDA\/M&A\/guidance catalysts found/);
});

test("computeCatalystShadowFactors: bullish FDA approval agreeing with a positive raw average — positive implied_weight at full binary magnitude", () => {
  const desk = deskStub([
    { ticker: "NVDA", change_pct: 2.0 },
    { ticker: "AAPL", change_pct: 0.5 },
  ]);
  // rawAvg = +1.25% (positive) — the approval's bullish direction agrees.
  const [obs] = computeCatalystShadowFactors(
    desk,
    [catalyst({ ticker: "NVDA", type: "binary", title: "FDA approves NVDA-partnered device" })],
    true,
    NOW
  );
  assert.equal(obs.available, true);
  assert.equal(obs.direction, "bullish");
  assert.equal(obs.implied_weight, 15); // full binary magnitude — agrees with raw avg
  assert.equal(obs.factor_name, "megacap_catalyst_nvda_binary");
  assert.match(obs.detail, /agrees with the mega-cap raw average/);
});

test("computeCatalystShadowFactors: bearish guidance cut complicating a positive raw average — dampened negative implied_weight", () => {
  const desk = deskStub([
    { ticker: "NVDA", change_pct: 2.0 },
    { ticker: "AAPL", change_pct: 1.0 },
  ]);
  // rawAvg = +1.5% (positive) — AAPL's guidance cut is bearish and conflicts.
  const [obs] = computeCatalystShadowFactors(
    desk,
    [catalyst({ ticker: "AAPL", type: "guidance", title: "AAPL lowers full-year guidance" })],
    true,
    NOW
  );
  assert.equal(obs.direction, "bearish");
  // guidance magnitude 6, halved (rounded) for complicating the raw average = -3.
  assert.equal(obs.implied_weight, -3);
  assert.equal(obs.factor_name, "megacap_catalyst_aapl_guidance");
  assert.match(obs.detail, /complicates the mega-cap raw average/);
});

test("computeCatalystShadowFactors: bearish M&A collapse — negative implied_weight, full magnitude when no aggregate lean to compare against", () => {
  const desk = deskStub([{ ticker: "TSLA", change_pct: 0 }]);
  const [obs] = computeCatalystShadowFactors(
    desk,
    [catalyst({ ticker: "TSLA", type: "m&a", title: "TSLA deal terminated after regulatory block" })],
    true,
    NOW
  );
  assert.equal(obs.direction, "bearish");
  assert.equal(obs.implied_weight, -12); // full m&a magnitude — avgSign is 0 (flat), nothing to complicate
  assert.equal(obs.factor_name, "megacap_catalyst_tsla_mna");
  assert.match(obs.detail, /no aggregate lean to compare against/);
});

test("computeCatalystShadowFactors: catalyst older than the 24h window is excluded — falls back to the no-catalyst reading", () => {
  const desk = deskStub([{ ticker: "NVDA", change_pct: 2 }]);
  const stale = catalyst({ published: "2026-07-03T10:00:00.000Z" }); // >24h before NOW
  const [obs] = computeCatalystShadowFactors(desk, [stale], true, NOW);
  assert.equal(obs.available, true);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.factor_name, "megacap_catalyst_watch");
});

test("computeCatalystShadowFactors: catalyst on a ticker outside the current leader list is ignored", () => {
  const desk = deskStub([{ ticker: "NVDA", change_pct: 2 }]);
  const [obs] = computeCatalystShadowFactors(desk, [catalyst({ ticker: "GME" })], true, NOW);
  assert.equal(obs.factor_name, "megacap_catalyst_watch");
  assert.equal(obs.implied_weight, 0);
});

test("computeCatalystShadowFactors: out-of-scope catalyst types (insider/buyback/etc) are ignored even when in-window and on a leader ticker", () => {
  const desk = deskStub([{ ticker: "NVDA", change_pct: 2 }]);
  const [obs] = computeCatalystShadowFactors(
    desk,
    [catalyst({ type: "insider", title: "NVDA CEO buys shares" })],
    true,
    NOW
  );
  assert.equal(obs.factor_name, "megacap_catalyst_watch");
  assert.equal(obs.implied_weight, 0);
});

test("computeCatalystShadowFactors: multiple leader tickers each get their own observation, sorted by ticker, highest-weight type wins per ticker", () => {
  const desk = deskStub([
    { ticker: "TSLA", change_pct: -1 },
    { ticker: "AAPL", change_pct: 1 },
  ]);
  const obs = computeCatalystShadowFactors(
    desk,
    [
      catalyst({ ticker: "TSLA", type: "guidance", title: "TSLA raises delivery guidance" }),
      catalyst({ ticker: "AAPL", type: "m&a", title: "AAPL announces acquisition" }),
      // Second, lower-weight catalyst on AAPL in the same window — guidance (6) < m&a (12), m&a should win.
      catalyst({ ticker: "AAPL", type: "guidance", title: "AAPL raises guidance" }),
    ],
    true,
    NOW
  );
  assert.equal(obs.length, 2);
  assert.equal(obs[0].factor_name, "megacap_catalyst_aapl_mna");
  assert.equal(obs[1].factor_name, "megacap_catalyst_tsla_guidance");
});

test("computeCatalystShadowFactors: neutral-read title (no bullish/bearish keywords) is available:true with implied_weight 0, distinct from 'no catalyst found'", () => {
  const desk = deskStub([{ ticker: "NVDA", change_pct: 2 }]);
  const [obs] = computeCatalystShadowFactors(
    desk,
    [catalyst({ type: "binary", title: "FDA reviews NVDA-partnered device application" })],
    true,
    NOW
  );
  assert.equal(obs.available, true);
  assert.equal(obs.implied_weight, 0);
  assert.equal(obs.direction, "neutral");
  // Distinct from the true "no catalyst found" factor_name — this IS a
  // confirmed detection, just a non-directional one.
  assert.equal(obs.factor_name, "megacap_catalyst_nvda_binary");
});

test("computeCatalystShadowFactors: detail flags when the catalyst doesn't clearly track the ticker's own move", () => {
  const desk = deskStub([{ ticker: "NVDA", change_pct: -0.5 }]); // NVDA is red
  const [obs] = computeCatalystShadowFactors(
    desk,
    [catalyst({ ticker: "NVDA", type: "binary", title: "FDA approves NVDA-partnered device" })], // bullish catalyst
    true,
    NOW
  );
  assert.match(obs.detail, /does not clearly track its own -0\.50% move/);
});
