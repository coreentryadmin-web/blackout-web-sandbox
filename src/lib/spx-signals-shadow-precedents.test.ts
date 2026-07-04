import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import {
  buildPrecedentSearchQuery,
  computePrecedentShadowFactor,
  parsePrecedentDirection,
  parsePrecedentOutcome,
  MIN_TOTAL_PRECEDENTS,
  PRECEDENT_SEARCH_K,
  PRECEDENT_AGREEMENT_FACTOR,
  type PrecedentHit,
} from "./spx-signals-shadow-precedents";

// ---- parsePrecedentDirection / parsePrecedentOutcome (text parsed back out
// of describeAuditRow()'s deterministic template — precedent-search.ts) ----

test("parsePrecedentDirection: reads 'long'/'short' (the real platform-wide vocabulary) as bullish/bearish", () => {
  assert.equal(parsePrecedentDirection("spx_claude_play alert on SPX, long, A conviction (score 78)."), "bullish");
  assert.equal(parsePrecedentDirection("0DTE Command alert on SPY, short, high conviction (score 55)."), "bearish");
});

test("parsePrecedentDirection: 'bullish'/'bearish' matched defensively too", () => {
  assert.equal(parsePrecedentDirection("Night Hawk alert on QQQ, bullish."), "bullish");
  assert.equal(parsePrecedentDirection("Night Hawk alert on QQQ, bearish."), "bearish");
});

test("parsePrecedentDirection: 'no stated direction' and unrecognized text both stay neutral, never fabricated", () => {
  assert.equal(parsePrecedentDirection("Night Hawk alert on QQQ, no stated direction. Outcome: ambiguous."), "neutral");
  assert.equal(parsePrecedentDirection("totally unrelated text"), "neutral");
});

test("parsePrecedentOutcome: parses all four terminal outcomes out of the trailing 'Outcome: X.' clause", () => {
  assert.equal(parsePrecedentOutcome("... Outcome: target."), "target");
  assert.equal(parsePrecedentOutcome("... Outcome: stop."), "stop");
  assert.equal(parsePrecedentOutcome("... Outcome: ambiguous."), "ambiguous");
  assert.equal(parsePrecedentOutcome("... Outcome: unfilled."), "unfilled");
});

test("parsePrecedentOutcome: 'not yet graded' and malformed text both return null, never crash", () => {
  assert.equal(parsePrecedentOutcome("... Outcome: not yet graded."), null);
  assert.equal(parsePrecedentOutcome("no outcome clause at all"), null);
});

// ---- buildPrecedentSearchQuery ----

test("buildPrecedentSearchQuery: composes ticker/direction/grade/score, omits gamma regime when unknown", () => {
  const q = buildPrecedentSearchQuery({ gamma_regime: "unknown" }, "long", "B", 61.7);
  assert.equal(q, "SPX 0DTE setup, long, B conviction (score 62)");
});

test("buildPrecedentSearchQuery: includes a real gamma regime as a structural fact", () => {
  const q = buildPrecedentSearchQuery({ gamma_regime: "mean_revert" }, "short", "A+", 88);
  assert.equal(q, "SPX 0DTE setup, short, A+ conviction (score 88), mean_revert gamma regime");
});

test("buildPrecedentSearchQuery: null direction reads as 'no stated direction'", () => {
  const q = buildPrecedentSearchQuery({ gamma_regime: "unknown" }, null, "C", 10);
  assert.match(q, /no stated direction/);
});

// ---- computePrecedentShadowFactor ----

function hit(chunk: string, similarity = 0.5): PrecedentHit {
  return { chunk, similarity };
}

function longTarget(): PrecedentHit {
  return hit("spx_claude_play alert on SPX, long, A conviction (score 70). Outcome: target.");
}
function longStop(): PrecedentHit {
  return hit("spx_claude_play alert on SPX, long, B conviction (score 55). Outcome: stop.");
}
function shortTarget(): PrecedentHit {
  return hit("0DTE Command alert on SPY, short, high conviction (score 80). Outcome: target.");
}
function ambiguousLong(): PrecedentHit {
  return hit("Night Hawk alert on QQQ, long, moderate conviction (score 60). Outcome: ambiguous.");
}

test("computePrecedentShadowFactor: search not confirmed available — available:false regardless of precedents content", () => {
  const obs = computePrecedentShadowFactor([longTarget(), longTarget(), longTarget()], false, "long");
  assert.equal(obs.length, 1);
  assert.equal(obs[0].factor_name, PRECEDENT_AGREEMENT_FACTOR);
  assert.equal(obs[0].available, false);
  assert.equal(obs[0].implied_weight, 0);
  assert.equal(obs[0].direction, "neutral");
  assert.match(obs[0].detail, /not confirmed available/);
});

test("computePrecedentShadowFactor: fewer than MIN_TOTAL_PRECEDENTS returned — available:false, 'not enough precedents yet', not treated as a bug", () => {
  assert.equal(MIN_TOTAL_PRECEDENTS, 3);
  const obs = computePrecedentShadowFactor([longTarget(), longTarget()], true, "long");
  assert.equal(obs[0].available, false);
  assert.equal(obs[0].implied_weight, 0);
  assert.match(obs[0].detail, /Only 2\/5/);
  assert.match(obs[0].detail, /near-empty/);
});

test("computePrecedentShadowFactor: zero precedents returned at all (brand-new, near-empty corpus) — available:false, honestly represented", () => {
  const obs = computePrecedentShadowFactor([], true, "long");
  assert.equal(obs[0].available, false);
  assert.match(obs[0].detail, /Only 0\/5/);
});

test("computePrecedentShadowFactor: enough total precedents but engine has no directional bias — available:true, neutral, not fabricated", () => {
  const obs = computePrecedentShadowFactor([longTarget(), longStop(), shortTarget()], true, null);
  assert.equal(obs[0].available, true);
  assert.equal(obs[0].implied_weight, 0);
  assert.equal(obs[0].direction, "neutral");
  assert.match(obs[0].detail, /no directional bias/);
});

test("computePrecedentShadowFactor: enough total precedents, but none same-direction+resolved-cleanly — available:true, weight 0", () => {
  const obs = computePrecedentShadowFactor([shortTarget(), ambiguousLong(), ambiguousLong()], true, "long");
  assert.equal(obs[0].available, true);
  assert.equal(obs[0].implied_weight, 0);
  assert.equal(obs[0].direction, "neutral");
  assert.match(obs[0].detail, /none were both same-direction/);
});

test("computePrecedentShadowFactor: 3 same-direction precedents, all target — near-unanimous FOR, STRONG tier (+8)", () => {
  const obs = computePrecedentShadowFactor([longTarget(), longTarget(), longTarget()], true, "long");
  assert.equal(obs[0].available, true);
  assert.equal(obs[0].implied_weight, 8);
  assert.equal(obs[0].direction, "bullish");
  assert.match(obs[0].detail, /3\/3 same-direction \(long\) precedents resolved target/);
});

test("computePrecedentShadowFactor: 3 same-direction precedents, all stop — near-unanimous AGAINST, STRONG tier (-8)", () => {
  const obs = computePrecedentShadowFactor([longStop(), longStop(), longStop()], true, "long");
  assert.equal(obs[0].implied_weight, -8);
  assert.equal(obs[0].direction, "bearish");
});

test("computePrecedentShadowFactor: 2-for/1-against (usable=3, ratio 0.33) — MODERATE threshold not met, WEAK tier (+3)", () => {
  const obs = computePrecedentShadowFactor([longTarget(), longTarget(), longStop()], true, "long");
  assert.equal(obs[0].implied_weight, 3);
  assert.equal(obs[0].direction, "bullish");
});

test("computePrecedentShadowFactor: usable=1 (single directionally-informative precedent) never earns above the WEAK floor, even at ratio 1.0", () => {
  const obs = computePrecedentShadowFactor([longTarget(), ambiguousLong(), ambiguousLong()], true, "long");
  assert.equal(obs[0].implied_weight, 3); // ratio would read as 1.0, but usable=1 caps it at the floor
  assert.equal(obs[0].direction, "bullish");
});

test("computePrecedentShadowFactor: tied for/against (net 0) reads as neutral, weight 0 — a real, if unhelpful, reading", () => {
  const obs = computePrecedentShadowFactor(
    [longTarget(), longStop(), longTarget(), longStop()],
    true,
    "long"
  );
  assert.equal(obs[0].implied_weight, 0);
  assert.equal(obs[0].direction, "neutral");
  assert.equal(obs[0].available, true);
});

test("computePrecedentShadowFactor: opposite-direction precedents are counted in total but never tallied for/against", () => {
  // 3 precedents total (clears MIN_TOTAL_PRECEDENTS), but all 3 are short-direction
  // while the engine is long — none should count as usable evidence either way.
  const obs = computePrecedentShadowFactor([shortTarget(), shortTarget(), shortTarget()], true, "long");
  assert.equal(obs[0].available, true);
  assert.equal(obs[0].implied_weight, 0);
  assert.match(obs[0].detail, /none were both same-direction/);
});

test("computePrecedentShadowFactor: short (bearish) engine bias + same-direction precedents resolving target -> NEGATIVE weight (reinforces bearish), not positive", () => {
  // 3 short-direction precedents, all resolved "target" (their own short thesis was
  // correct) = strong evidence FOR continuing the current short bias. Continuing SHORT
  // is a BEARISH lean, so this must be a negative implied_weight, matching the engine's
  // own signed-score convention (spx-signals.ts: positive = bullish, negative = bearish)
  // — the exact bug this test guards against is naively using net-count sign as the
  // weight sign regardless of which direction is actually being reinforced.
  const obs = computePrecedentShadowFactor([shortTarget(), shortTarget(), shortTarget()], true, "short");
  assert.equal(obs[0].implied_weight, -8);
  assert.equal(obs[0].direction, "bearish");
});

test("computePrecedentShadowFactor: PRECEDENT_SEARCH_K matches Largo's own get_similar_precedents call shape (k=5)", () => {
  assert.equal(PRECEDENT_SEARCH_K, 5);
});

test("computePrecedentShadowFactor: always returns exactly one observation", () => {
  const cases: Array<[PrecedentHit[], boolean, "long" | "short" | null]> = [
    [[], false, null],
    [[], true, null],
    [[longTarget(), longTarget(), longTarget()], true, "long"],
  ];
  for (const [precedents, available, dir] of cases) {
    assert.equal(computePrecedentShadowFactor(precedents, available, dir).length, 1);
  }
});
