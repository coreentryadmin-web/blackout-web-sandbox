// Largo SCENARIO engine tests (PR-L4c) — mostly PURE (parseShift / resolveShiftTarget /
// buildScenarioEnvelope over the committed VECTOR_FULL_STATE_FIXTURE, no IO), plus a hermetic
// composeScenario slice that mock.modules the server-only full-state reader + gap-log with the SAME
// RELATIVE specifiers scenario-read.ts imports (this file lives in the same directory, so the URLs
// resolve identically and intercept — matching the cortex-read.test.ts pattern). The CI tsx loader
// requires those relative specifiers.

import { before, beforeEach, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import { VECTOR_FULL_STATE_FIXTURE } from "./vector-full-state-fixture";
import { parseShift, resolveShiftTarget, buildScenarioEnvelope } from "./scenario-read";

// A deep-ish clone so a per-test spot/flip tweak never leaks into the shared fixture.
function state(overrides: Partial<VectorFullState> = {}): VectorFullState {
  return { ...structuredClone(VECTOR_FULL_STATE_FIXTURE), ...overrides };
}

// Fixture anchors: spot 7560, flip 7520, call walls 7600/7650, put walls 7500/7450, max pain 7550,
// 1σ = movePct 0.0073 → 0.73%.

describe("parseShift", () => {
  test("signed percent: -1% and +2%", () => {
    assert.deepEqual(parseShift("-1%"), { kind: "pct", pct: -1, raw: "-1%" });
    const up = parseShift("+2%");
    assert.equal(up?.kind, "pct");
    assert.equal((up as { pct: number }).pct, 2);
  });

  test("direction words: 'drops 1%' → -1, 'rips 2%' → +2", () => {
    assert.equal((parseShift("if SPX drops 1%") as { pct: number }).pct, -1);
    assert.equal((parseShift("what if QQQ rips 2%") as { pct: number }).pct, 2);
  });

  test("absolute 'to 7450' and 'SPX at 7450 scenario'", () => {
    assert.deepEqual(parseShift("to 7450"), { kind: "absolute", price: 7450, raw: "to 7450" });
    assert.equal((parseShift("SPX at 7450 scenario") as { price: number }).price, 7450);
  });

  test("'breaks 745' → absolute 745", () => {
    assert.equal((parseShift("what happens if SPY breaks 745") as { price: number }).price, 745);
  });

  test("structural 'below the flip' → level flip/below", () => {
    assert.deepEqual(parseShift("if we lose the flip"), { kind: "level", level: "flip", relation: "below", raw: "if we lose the flip" });
    assert.deepEqual(parseShift("below the flip"), { kind: "level", level: "flip", relation: "below", raw: "below the flip" });
  });

  test("structural 'breaks the call wall' → level call_wall/break", () => {
    const s = parseShift("what if SPX breaks the call wall");
    assert.equal(s?.kind, "level");
    assert.equal((s as { level: string }).level, "call_wall");
    assert.equal((s as { relation: string }).relation, "break");
  });

  test("points: 'down 40 points' → -40", () => {
    assert.equal((parseShift("SPX down 40 points") as { points: number }).points, -40);
  });

  test("no scopeable move → null (static asks, ambiguous %, bare level)", () => {
    assert.equal(parseShift("what's the SPX setup right now"), null);
    assert.equal(parseShift("where is the gamma flip"), null); // level word but no relation verb
    assert.equal(parseShift("SPX 1% move today"), null); // % but no direction/sign → refuse to guess
    assert.equal(parseShift("is SPX 7500 0DTE a good play"), null); // 7500 not a scoped target
  });

  // REGRESSION (task #83 fold-in): the canonical question incidentally mentions "regime flip" and
  // "walls" AND the relation phrase "to the" — which the old level-first parser matched as a level
  // reference, snapping the shift to the flip and dropping the −1%. The explicit percentage must win.
  test("canonical full question keeps the explicit −1% (not snapped to a mentioned level)", () => {
    const s = parseShift(
      "If SPX drops 1% at tomorrow's open, what happens to the dealer positioning picture — does the regime flip, and which walls become live?"
    );
    assert.equal(s?.kind, "pct");
    assert.equal((s as { pct: number }).pct, -1);
  });
});

describe("resolveShiftTarget (fixture: spot 7560, flip 7520)", () => {
  test("percent shifts the spot", () => {
    assert.equal(resolveShiftTarget({ kind: "pct", pct: -1, raw: "" }, state())?.targetSpot, 7484.4);
    assert.equal(resolveShiftTarget({ kind: "pct", pct: 2, raw: "" }, state())?.targetSpot, 7711.2);
  });

  test("absolute is the target directly", () => {
    assert.equal(resolveShiftTarget({ kind: "absolute", price: 7450, raw: "" }, state())?.targetSpot, 7450);
  });

  test("'below the flip' nudges just under the flip (commits the regime)", () => {
    const r = resolveShiftTarget({ kind: "level", level: "flip", relation: "below", raw: "" }, state());
    assert.ok(r != null && r.targetSpot < 7520 && r.targetSpot > 7500, `expected just below 7520, got ${r?.targetSpot}`);
  });

  test("unresolvable level (no live flip) → null", () => {
    const r = resolveShiftTarget({ kind: "level", level: "flip", relation: "below", raw: "" }, state({ gammaFlip: null }));
    assert.equal(r, null);
  });
});

describe("buildScenarioEnvelope — cross-flip detection", () => {
  test("drop 1% CROSSES the flip (long → short) — the key regime event", () => {
    const env = buildScenarioEnvelope(state(), { kind: "pct", pct: -1, raw: "" });
    assert.equal(env.intent, "scenario");
    assert.match(env.headline, /CROSSES the flip/);
    assert.match(env.headline, /short gamma/);
    const regime = env.sections.find((s) => s.title === "Regime at the shifted spot");
    assert.match(regime!.body, /CROSSES the gamma flip/);
    assert.match(regime!.body, /short gamma/);
  });

  test("a small drop that does NOT cross stays same-regime (long)", () => {
    // 0.3% of 7560 = ~22.7 pts → 7537.3, still above the 7520 flip → long gamma, no cross.
    const env = buildScenarioEnvelope(state(), { kind: "pct", pct: -0.3, raw: "" });
    assert.doesNotMatch(env.headline, /CROSSES/);
    const regime = env.sections.find((s) => s.title === "Regime at the shifted spot");
    assert.match(regime!.body, /STAYS long gamma|doesn't cross/);
  });

  test("cross the OTHER way: base below flip, a rise crosses up (short → long)", () => {
    // Spot 7510 < flip 7520 → base short. +1% → 7585 > 7520 → long. Crosses up.
    const env = buildScenarioEnvelope(state({ spot: 7510, regime: { posture: "short" } }), { kind: "pct", pct: 1, raw: "" });
    assert.match(env.headline, /CROSSES the flip/);
    assert.match(env.headline, /long gamma/);
  });

  // REGRESSION (task #83 fold-in): end-to-end from the canonical text through parseShift →
  // buildScenarioEnvelope. Fixture spot 7560, flip 7520 → 0.99×7560 = 7484.4 < 7520 < 7560, so the
  // −1% MUST (a) land at spot×0.99, (b) report a flip CROSS, (c) NOT be snapped to the flip level.
  test("canonical −1% question shifts to spot×0.99 and reports a flip cross (not snapped to the flip)", () => {
    const spec = parseShift(
      "If SPX drops 1% at tomorrow's open, what happens to the dealer positioning picture — does the regime flip, and which walls become live?"
    );
    const env = buildScenarioEnvelope(state(), spec);
    const move = env.sections.find((s) => s.title === "The move")!;
    assert.match(move.body, /7,?484(\.4)?/); // 7560 × 0.99 = 7484.4, within rounding
    assert.doesNotMatch(move.body, /7,?520/); // NOT snapped to the flip level
    assert.match(env.headline, /CROSSES the flip/);
    assert.match(env.headline, /short gamma/);
  });
});

describe("buildScenarioEnvelope — walls become live", () => {
  test("drop 1% pierces the 7500 put wall (was support → broken)", () => {
    // 7484.4 < 7500 → the put wall spot was above is now pierced.
    const env = buildScenarioEnvelope(state(), { kind: "pct", pct: -1, raw: "" });
    const walls = env.sections.find((s) => s.title === "Which walls become live");
    assert.match(walls!.body, /PIERCED/);
    assert.match(walls!.body, /put wall 7,?500/);
  });

  test("rip 2% pierces the call walls overhead (7600, 7650)", () => {
    const env = buildScenarioEnvelope(state(), { kind: "pct", pct: 2, raw: "" });
    const walls = env.sections.find((s) => s.title === "Which walls become live");
    assert.match(walls!.body, /PIERCED/);
    assert.match(walls!.body, /call wall 7,?600/);
  });

  test("bracketing walls named when the move pierces nothing", () => {
    // +0.3% → 7582.7, still between put wall 7500 (below) and call wall 7600 (above), no pierce.
    const env = buildScenarioEnvelope(state(), { kind: "pct", pct: 0.3, raw: "" });
    const walls = env.sections.find((s) => s.title === "Which walls become live");
    assert.match(walls!.body, /No walls are pierced/);
    assert.match(walls!.body, /resistance above: call wall 7,?600/);
    assert.match(walls!.body, /support below: put wall 7,?500/);
  });
});

describe("buildScenarioEnvelope — max-pain pull direction", () => {
  test("below max pain → pull UP; above max pain → pull DOWN", () => {
    // max pain 7550. Drop 1% → 7484.4 (below) → up. Rip 2% → 7711.2 (above) → down.
    const down = buildScenarioEnvelope(state(), { kind: "pct", pct: -1, raw: "" });
    assert.match(down.sections.find((s) => s.title === "Max-pain pull")!.body, /pulls UP toward/);
    const up = buildScenarioEnvelope(state(), { kind: "pct", pct: 2, raw: "" });
    assert.match(up.sections.find((s) => s.title === "Max-pain pull")!.body, /pulls DOWN toward/);
  });
});

describe("buildScenarioEnvelope — magnitude honesty (vs 1σ = 0.73%)", () => {
  test("a 0.5% move is a WITHIN-1σ wiggle", () => {
    const env = buildScenarioEnvelope(state(), { kind: "pct", pct: -0.5, raw: "" });
    assert.match(env.sections.find((s) => s.title === "The move")!.body, /WITHIN-1σ wiggle/);
  });

  test("a 2% move is a TAIL move (>2σ)", () => {
    const env = buildScenarioEnvelope(state(), { kind: "pct", pct: 2, raw: "" });
    assert.match(env.sections.find((s) => s.title === "The move")!.body, /TAIL move/);
  });

  test("gauntlet 1% drop is beyond 1σ but inside 2σ (1.37σ)", () => {
    const env = buildScenarioEnvelope(state(), { kind: "pct", pct: -1, raw: "" });
    assert.match(env.sections.find((s) => s.title === "The move")!.body, /beyond 1σ but inside 2σ/);
  });

  test("no expected move → honest 'can't size vs implied vol' (still gives structure)", () => {
    const env = buildScenarioEnvelope(state({ expectedMove: null }), { kind: "pct", pct: -1, raw: "" });
    assert.match(env.sections.find((s) => s.title === "The move")!.body, /can't size the move against implied vol/);
    // Structure sections still present.
    assert.ok(env.sections.some((s) => s.title === "Which walls become live"));
  });
});

describe("buildScenarioEnvelope — honesty guards", () => {
  test("unparseable shift (null spec) → honest 'can't scope', insufficient confidence", () => {
    const env = buildScenarioEnvelope(state(), null);
    assert.match(env.headline, /Can't scope/);
    assert.equal(env.confidence.level, "insufficient");
    assert.ok(env.sections[0]!.unavailable);
  });

  test("framing section always states 'structure, not a forecast'", () => {
    const env = buildScenarioEnvelope(state(), { kind: "pct", pct: -1, raw: "" });
    const framing = env.sections.find((s) => /structure, not a forecast/i.test(s.title));
    assert.ok(framing, "framing section present");
    assert.match(framing!.body, /NOT a prediction/);
    // The scenario evidence is tagged as a mechanical re-read (scenario kind), never a forecast.
    assert.ok(framing!.evidence?.some((e) => e.kind === "scenario" && /no probability assigned/i.test(e.text)));
  });

  test("every cited level traces to a live value on the state", () => {
    const env = buildScenarioEnvelope(state(), { kind: "pct", pct: -1, raw: "" });
    const labels = (env.levels ?? []).map((l) => l.label);
    assert.ok(labels.includes("gamma flip"));
    assert.ok(labels.includes("call wall"));
    assert.ok(labels.includes("max pain"));
    assert.ok(labels.includes("shifted spot"));
  });
});

// ── Hermetic composeScenario slice ─────────────────────────────────────────────────────────────────

let fullState: VectorFullState | null = null;
let fetchCalls: Array<{ ticker: string; horizon: string }> = [];
let gapCalls: Array<{ reason: string }> = [];

mock.module("./vector-full-state", {
  namedExports: {
    fetchVectorFullState: async (ticker: string, horizon: string) => {
      fetchCalls.push({ ticker, horizon });
      return fullState;
    },
  },
});

mock.module("./gap-log", {
  namedExports: {
    recordBieGap: async (row: { reason: string }) => {
      gapCalls.push(row);
    },
  },
});

/** Poll until the fire-and-forget (void) gap log has recorded `reason`, or a generous deadline — so
 *  the assertion never races the un-awaited recordGap microtask (a fixed sleep flaked under load). */
async function waitForGap(reason: string, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (gapCalls.some((g) => g.reason === reason)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

let mod: typeof import("./scenario-read");
before(async () => {
  mod = await import("./scenario-read");
});
beforeEach(() => {
  fullState = null;
  fetchCalls = [];
  gapCalls = [];
});

describe("composeScenario (hermetic)", () => {
  test("live state + parseable shift → full scenario envelope", async () => {
    fullState = state();
    const out = await mod.composeScenario("SPX", "if SPX drops 1% at tomorrow's open", { horizon: "all" });
    assert.ok(out.envelope);
    assert.equal(out.envelope!.intent, "scenario");
    assert.match(out.envelope!.headline, /CROSSES the flip/);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]!.ticker, "SPX");
  });

  test("absent live state → honest no-scenario envelope + gap logged", async () => {
    fullState = null;
    const out = await mod.composeScenario("SPY", "if SPY breaks 745", { horizon: "all" });
    assert.match(out.envelope!.headline, /Can't scope/);
    assert.equal(out.envelope!.confidence.level, "insufficient");
    await waitForGap("no_live_state");
    assert.ok(gapCalls.some((g) => g.reason === "no_live_state"));
  });

  test("unparseable shift → honest envelope WITHOUT hitting the data layer", async () => {
    fullState = state();
    const out = await mod.composeScenario("SPX", "what's the SPX setup right now", { horizon: "all" });
    assert.match(out.envelope!.headline, /Can't scope/);
    assert.equal(fetchCalls.length, 0, "must not fetch when there's no shift to scope");
    await waitForGap("unparseable_shift");
    assert.ok(gapCalls.some((g) => g.reason === "unparseable_shift"));
  });
});
