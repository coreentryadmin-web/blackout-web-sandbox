import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeterministicEditionPlays,
  pickChainContract,
  buildDeterministicThesis,
} from "./deterministic-edition";
import { validatePlayGeometry } from "./play-constraints";
import { parsePlayLevels } from "./play-levels";
import { parseOptionsContract } from "./option-chain-prompt";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "./constants";
import type { ChainStrikeRow, EditionChainData } from "./option-chain-prompt";
import type { ScoredCandidate } from "./scorer";
import type { TickerDossier } from "./dossier";

// ── Synthetic fixtures ────────────────────────────────────────────────────────────────────────
function row(
  strike: number,
  opts: { oi?: number; callAsk?: number; callBid?: number; putAsk?: number; putBid?: number; expiry?: string } = {}
): ChainStrikeRow {
  const oi = opts.oi ?? 5_000;
  return {
    expiry: opts.expiry ?? "2026-12-18",
    strike,
    call_bid: opts.callBid ?? null,
    call_ask: opts.callAsk ?? null,
    call_delta: null,
    call_oi: oi,
    call_iv: null,
    put_bid: opts.putBid ?? null,
    put_ask: opts.putAsk ?? null,
    put_delta: null,
    put_oi: oi,
    put_iv: null,
  };
}

/** A liquid, affordable chain around `spot` with call & put quotes on every strike. */
function chainAround(spot: number, opts: { oi?: number; expiry?: string } = {}): EditionChainData {
  const strikes = [spot - 10, spot - 5, spot, spot + 5, spot + 10];
  return {
    spot,
    rows: strikes.map((s) =>
      row(s, {
        oi: opts.oi,
        expiry: opts.expiry,
        // Cheap, well within the $35/share cap; mid ≈ 4.
        callAsk: 4.2,
        callBid: 3.8,
        putAsk: 4.2,
        putBid: 3.8,
      })
    ),
  };
}

function dossier(ticker: string, spot: number, over: Partial<TickerDossier> = {}): TickerDossier {
  return {
    ticker,
    flows: [],
    flow_streak: { streak_days: 3 } as TickerDossier["flow_streak"],
    iv_rank: 45,
    benzinga_price_target: null,
    tech: {
      ticker,
      price: spot,
      trend: "bullish",
      setup_tags: [],
      support_levels: [spot - 5],
      resistance_levels: [spot + 5],
      gap_zones: [],
      breakout_zones: [],
      prior_day: { high: spot + 6, low: spot - 6, close: spot },
      weekly: { high: null, low: null },
      rsi14: 55,
      rel_volume: 1.6,
      atr14: 3,
      vwap: spot,
      ema20: spot,
      ema50: spot,
      ema200: spot,
      summary: `${ticker} holding above VWAP; bullish MA stack.`,
    },
    ...over,
  } as TickerDossier;
}

function scored(ticker: string, direction: "long" | "short", score: number): ScoredCandidate {
  return {
    ticker,
    score,
    direction,
    flow_score: 18,
    tech_score: 12,
    pos_score: 6,
    news_score: 2,
    smart_money_score: 3,
    conviction: score >= 55 ? "A" : score >= 40 ? "B" : "C",
    trading_halt: false,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────
test("emits N valid plays with correct geometry and direction from the score sign", () => {
  const ranked = [scored("AAA", "long", 68), scored("BBB", "short", 61), scored("CCC", "long", 44)];
  const chains = { AAA: chainAround(120), BBB: chainAround(80), CCC: chainAround(200) };
  const dossierMap = { AAA: dossier("AAA", 120), BBB: dossier("BBB", 80), CCC: dossier("CCC", 200) };

  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 5 });
  assert.equal(plays.length, 3);

  for (const p of plays) {
    // Every published play passes the SAME geometry gate the Claude path enforces.
    assert.equal(validatePlayGeometry(p).ok, true, `${p.ticker} geometry`);
    // Premium respected.
    assert.ok(p.entry_premium != null && p.entry_premium <= MAX_OPTION_PREMIUM_PER_SHARE);
    assert.equal(p.premium_cap_ok, true);
    // Score pinned from the scored candidate, not fabricated.
    assert.ok(p.score != null && p.score > 0);
  }

  // Direction from score sign: long ⇒ LONG + CALL, short ⇒ SHORT + PUT.
  const aaa = plays.find((p) => p.ticker === "AAA")!;
  assert.equal(aaa.direction, "LONG");
  assert.equal(parseOptionsContract(aaa.options_play)?.side, "call");
  const bbb = plays.find((p) => p.ticker === "BBB")!;
  assert.equal(bbb.direction, "SHORT");
  assert.equal(parseOptionsContract(bbb.options_play)?.side, "put");
});

test("SHORT play has target below entry and stop above (correct short geometry)", () => {
  const ranked = [scored("SHT", "short", 60)];
  const chains = { SHT: chainAround(100) };
  const dossierMap = { SHT: dossier("SHT", 100) };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  const p = plays[0]!;
  const { entry_range_low: lo, entry_range_high: hi, target, stop } = parsePlayLevels(p);
  const mid = ((lo ?? 0) + (hi ?? 0)) / 2;
  assert.ok(target! < mid, "short target below entry");
  assert.ok(stop! > mid, "short stop above entry");
});

test("premium cap: expensive strike still shows a contract with caveat (PR-N23)", () => {
  const expensive: EditionChainData = {
    spot: 500,
    rows: [row(500, { oi: 5_000, callAsk: 60, callBid: 58 })], // mid 59 > $35 cap
  };
  const ranked = [scored("EXP", "long", 65), scored("OK", "long", 60)];
  const chains = { EXP: expensive, OK: chainAround(120) };
  const dossierMap = { EXP: dossier("EXP", 500), OK: dossier("OK", 120) };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  assert.equal(plays.length, 2);
  const exp = plays.find((p) => p.ticker === "EXP")!;
  assert.ok(exp, "EXP should be included with caveated contract");
  assert.ok(exp.entry_premium != null, "caveated contract still shows premium");
  assert.match(exp.options_play, /premium above/);
  assert.ok(parseOptionsContract(exp.options_play) != null, "caveated contract is parseable");
  const ok = plays.find((p) => p.ticker === "OK")!;
  assert.ok(ok.entry_premium != null && ok.entry_premium <= MAX_OPTION_PREMIUM_PER_SHARE);
});

test("OI floor: illiquid strike still shows a contract with liquidity caveat (PR-N23)", () => {
  const illiquid: EditionChainData = {
    spot: 120,
    rows: [row(120, { oi: 100, callAsk: 4, callBid: 3.6 })], // OI 100 < 500 floor
  };
  const ranked = [scored("ILQ", "long", 66), scored("LIQ", "long", 55)];
  const chains = { ILQ: illiquid, LIQ: chainAround(90) };
  const dossierMap = { ILQ: dossier("ILQ", 120), LIQ: dossier("LIQ", 90) };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  assert.equal(plays.length, 2);
  const ilq = plays.find((p) => p.ticker === "ILQ")!;
  assert.ok(ilq, "ILQ should be included with caveated contract");
  assert.ok(ilq.entry_premium != null, "caveated contract still shows premium");
  assert.match(ilq.options_play, /thin liquidity/);
  assert.ok(parseOptionsContract(ilq.options_play) != null, "caveated contract is parseable");
});

test("no chain for a candidate builds stock-only play with no-data message (PR-N23)", () => {
  const ranked = [scored("NOCH", "long", 70), scored("HAS", "long", 50)];
  const chains = { HAS: chainAround(150) };
  const dossierMap = { NOCH: dossier("NOCH", 150), HAS: dossier("HAS", 150) };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  assert.equal(plays.length, 2);
  const noch = plays.find((p) => p.ticker === "NOCH")!;
  assert.ok(noch, "NOCH should be included as stock-only");
  assert.equal(noch.entry_premium, undefined, "stock-only play has no entry_premium");
  assert.match(noch.options_play, /no options data/);
  const has = plays.find((p) => p.ticker === "HAS")!;
  assert.ok(has.entry_premium != null, "HAS should have a contract");
});

test("respects the target count and re-ranks 1..N", () => {
  const ranked = ["A", "B", "C", "D", "E", "F"].map((t, i) => scored(t, "long", 65 - i));
  const chains = Object.fromEntries(ranked.map((s) => [s.ticker, chainAround(100 + Number(s.score))]));
  const dossierMap = Object.fromEntries(ranked.map((s) => [s.ticker, dossier(s.ticker, 100 + Number(s.score))]));
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 4 });
  assert.equal(plays.length, 4);
  assert.deepEqual(
    plays.map((p) => p.rank),
    [1, 2, 3, 4]
  );
});

test("ties deterministic: identical inputs yield byte-identical output across runs", () => {
  const build = () => {
    const ranked = [scored("AAA", "long", 68), scored("BBB", "short", 61)];
    const chains = { AAA: chainAround(120), BBB: chainAround(80) };
    const dossierMap = { AAA: dossier("AAA", 120), BBB: dossier("BBB", 80) };
    return buildDeterministicEditionPlays({ ranked, dossierMap, chains }).plays;
  };
  assert.deepEqual(build(), build());
});

test("pickChainContract picks the most ATM strike among eligible, deterministically", () => {
  const chain: EditionChainData = {
    spot: 100,
    rows: [
      row(90, { oi: 5_000, callAsk: 12, callBid: 11 }),
      row(100, { oi: 5_000, callAsk: 4, callBid: 3.6 }), // ATM
      row(110, { oi: 5_000, callAsk: 1.2, callBid: 1.0 }),
    ],
  };
  const c = pickChainContract(chain, "long");
  assert.equal(c?.strike, 100);
  assert.equal(c?.side, "call");
  assert.equal(c?.caveat, undefined, "strict pick has no caveat");
});

test("pickChainContract returns best-effort contract with caveat when strict gates fail", () => {
  const chain: EditionChainData = { spot: 100, rows: [row(100, { oi: 50, callAsk: 999, callBid: 998 })] };
  const result = pickChainContract(chain, "long");
  assert.ok(result != null, "returns best-effort instead of null");
  assert.equal(result!.strike, 100);
  assert.equal(result!.caveat, "premium_high_low_liquidity");
});

test("pickChainContract returns null only when no rows have any quotes", () => {
  const chain: EditionChainData = { spot: 100, rows: [row(100, { oi: 50 })] };
  assert.equal(pickChainContract(chain, "long"), null);
});

test("thesis is grounded in the score breakdown and cites the leading driver", () => {
  const s = scored("XYZ", "long", 66);
  const { thesis, key_signal } = buildDeterministicThesis(s, dossier("XYZ", 120));
  assert.match(thesis, /XYZ/);
  assert.match(key_signal, /score 66/);
  assert.match(key_signal, /flow/);
});
