import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveInvalidators,
  evaluateInvalidators,
  firedInvalidators,
  killTestPlay,
  coerceInvalidators,
  NEAR_KILL_PCT,
  type Invalidator,
  type MarketSnapshot,
} from "./invalidators";
import type { PlaybookPlay } from "./types";
import type { OvernightInputs, OvernightVerdict } from "./cortex-overnight";

// ── fixtures ──────────────────────────────────────────────────────────────────────────

function play(overrides: Partial<PlaybookPlay> = {}): PlaybookPlay {
  return {
    rank: 1,
    ticker: "SPX",
    direction: "LONG",
    conviction: "A",
    play_type: "stock",
    thesis: "t",
    key_signal: "k",
    entry_range: "$7480-$7500",
    target: "$7550",
    stop: "$7460",
    options_play: "SPX 7500C",
    ...overrides,
  };
}

/** Minimal OvernightInputs with only the surfaces deriveInvalidators reads. */
function inputs(overrides: {
  gammaFlip?: number | null;
  opposingWall?: { strike: number; kind: "call" | "put" } | null;
  bias?: OvernightInputs["darkPool"] extends infer T ? (T extends { bias: infer B } ? B : never) : never;
} = {}): OvernightInputs {
  return {
    ticker: "SPX",
    direction: "long",
    now: "2026-07-14T22:00:00.000Z",
    horizonDate: "2026-07-15",
    catalyst: null,
    wall: {
      asOf: "2026-07-14T22:00:00.000Z",
      spot: null,
      gammaFlip: overrides.gammaFlip === undefined ? 7480 : overrides.gammaFlip,
      regime: "long",
      opposingWall: overrides.opposingWall === undefined ? { strike: 7550, kind: "call" } : overrides.opposingWall,
      target: 7550,
      samples: [],
    },
    darkPool: {
      asOf: "2026-07-14T22:00:00.000Z",
      bias: (overrides.bias as "bullish") ?? "bullish",
      totalPremium: 1,
      callPremium: 1,
      putPremium: 0,
    },
    iv: null,
    sector: null,
    flow: null,
    errors: {},
  };
}

/** A verdict where darkpool-trend is among the supports (so its falsifier is emitted). */
function verdict(supportSources: string[] = ["wall-migration", "darkpool-trend"]): OvernightVerdict {
  return {
    ticker: "SPX",
    direction: "long",
    asOf: "2026-07-14T22:00:00.000Z",
    horizonDate: "2026-07-15",
    verdict: "PASS",
    abstained: false,
    score: 1,
    vetoes: [],
    supports: supportSources.map((source) => ({
      source: source as OvernightVerdict["supports"][number]["source"],
      stance: "supports" as const,
      weight: 1,
      asOf: "2026-07-14T22:00:00.000Z",
      detail: "d",
    })),
    opposes: [],
    absent: [],
    flags: [],
    narrative: [],
  };
}

// ── deriveInvalidators ──────────────────────────────────────────────────────────────

test("deriveInvalidators LONG: flip_break (kill, lt) + opposing call-wall migration + darkpool reversal", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs());
  const ids = inv.map((i) => i.id);
  assert.deepEqual(ids, ["flip_break", "opposing_wall_migrated", "darkpool_reversal"]);

  const flip = inv.find((i) => i.id === "flip_break")!;
  assert.equal(flip.severity, "kill");
  assert.deepEqual(flip.check, { kind: "lt", metric: "spot", level: 7480 });

  const wall = inv.find((i) => i.id === "opposing_wall_migrated")!;
  assert.equal(wall.severity, "kill");
  assert.deepEqual(wall.check, { kind: "metric_lt_metric", left: "call_wall", right: "spot" });

  const dp = inv.find((i) => i.id === "darkpool_reversal")!;
  assert.equal(dp.severity, "degrade");
  assert.deepEqual(dp.check, { kind: "darkpool_reversed", to: ["bearish"] });
});

test("deriveInvalidators SHORT: flip_break uses gt + put-wall migration + bullish-reversal", () => {
  const inv = deriveInvalidators(
    play({ direction: "SHORT" }),
    verdict(),
    inputs({ opposingWall: { strike: 7400, kind: "put" }, bias: "bearish" as never })
  );
  const flip = inv.find((i) => i.id === "flip_break")!;
  assert.deepEqual(flip.check, { kind: "gt", metric: "spot", level: 7480 });
  const wall = inv.find((i) => i.id === "opposing_wall_migrated")!;
  assert.deepEqual(wall.check, { kind: "metric_gt_metric", left: "put_wall", right: "spot" });
  const dp = inv.find((i) => i.id === "darkpool_reversal")!;
  assert.deepEqual(dp.check, { kind: "darkpool_reversed", to: ["bullish"] });
});

test("deriveInvalidators: no darkpool falsifier when dark-pool did not support the play", () => {
  const inv = deriveInvalidators(play(), verdict(["wall-migration"]), inputs());
  assert.ok(!inv.some((i) => i.id === "darkpool_reversal"));
});

test("deriveInvalidators: no darkpool falsifier when the bias was not a tailwind", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs({ bias: "bearish" as never }));
  assert.ok(!inv.some((i) => i.id === "darkpool_reversal"), "bearish dark-pool is not a LONG tailwind");
});

test("deriveInvalidators: empty surfaces yield [] (nothing to falsify)", () => {
  const inv = deriveInvalidators(play(), verdict([]), inputs({ gammaFlip: null, opposingWall: null, bias: "neutral" as never }));
  assert.deepEqual(inv, []);
});

// ── evaluateInvalidators ────────────────────────────────────────────────────────────

const morning = (o: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  spot: null,
  gammaFlip: null,
  callWall: null,
  putWall: null,
  regime: null,
  darkPoolBias: null,
  ...o,
});

test("evaluateInvalidators: lt fires when the metric is below the level", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs()); // flip lt 7480
  const evals = evaluateInvalidators(inv, morning({ spot: 7475 }));
  const flip = evals.find((e) => e.invalidator.id === "flip_break")!;
  assert.equal(flip.evaluable, true);
  assert.equal(flip.fired, true);
});

test("evaluateInvalidators: lt does NOT fire when spot holds above the level", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs());
  const evals = evaluateInvalidators(inv, morning({ spot: 7490 }));
  assert.equal(evals.find((e) => e.invalidator.id === "flip_break")!.fired, false);
});

test("evaluateInvalidators: a null metric is UNKNOWN (evaluable=false), never fires", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs());
  const evals = evaluateInvalidators(inv, morning({ spot: null }));
  const flip = evals.find((e) => e.invalidator.id === "flip_break")!;
  assert.equal(flip.evaluable, false);
  assert.equal(flip.fired, false);
});

test("evaluateInvalidators: metric_lt_metric fires when call wall migrates below spot", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs());
  const evals = evaluateInvalidators(inv, morning({ spot: 7500, callWall: 7490 }));
  assert.equal(evals.find((e) => e.invalidator.id === "opposing_wall_migrated")!.fired, true);
});

test("evaluateInvalidators: darkpool_reversed UNKNOWN when bias not re-fetched", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs());
  const evals = evaluateInvalidators(inv, morning({ spot: 7490, darkPoolBias: null }));
  const dp = evals.find((e) => e.invalidator.id === "darkpool_reversal")!;
  assert.equal(dp.evaluable, false);
  assert.equal(dp.fired, false);
});

test("evaluateInvalidators: darkpool_reversed fires when bias flipped to bearish", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs());
  const evals = evaluateInvalidators(inv, morning({ spot: 7490, darkPoolBias: "bearish" }));
  assert.equal(evals.find((e) => e.invalidator.id === "darkpool_reversal")!.fired, true);
});

test("firedInvalidators returns only the fired subset", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs());
  const evals = evaluateInvalidators(inv, morning({ spot: 7475 })); // flip fires; others unknown
  const fired = firedInvalidators(evals);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].invalidator.id, "flip_break");
});

// ── killTestPlay ────────────────────────────────────────────────────────────────────

test("killTestPlay: vetoes a LONG whose publish spot is within 0.15% above the flip kill line", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs()); // flip 7480
  // 7480 * (1 + 0.001) = 7487.48 → within 0.15%
  const kt = killTestPlay({ play: play(), invalidators: inv, state: morning({ spot: 7487 }) });
  assert.equal(kt.vetoed, true);
  assert.match(kt.reasons.join(" "), /within 0\.15% of the kill line/);
});

test("killTestPlay: vetoes when publish spot has already broken the kill line", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs());
  const kt = killTestPlay({ play: play(), invalidators: inv, state: morning({ spot: 7470 }) });
  assert.equal(kt.vetoed, true);
  assert.match(kt.reasons.join(" "), /already through the kill line/);
});

test("killTestPlay: does NOT veto a play with comfortable room above the flip", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs());
  const kt = killTestPlay({ play: play(), invalidators: inv, state: morning({ spot: 7530 }) });
  assert.equal(kt.vetoed, false);
  assert.deepEqual(kt.reasons, []);
});

test("killTestPlay: metric-vs-metric kill vetoes only when already true at publish", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs());
  // call wall already below spot at publish
  const kt = killTestPlay({ play: play(), invalidators: inv, state: morning({ spot: 7530, callWall: 7520 }) });
  assert.equal(kt.vetoed, true);
  assert.match(kt.reasons.join(" "), /already true at publish/);
});

test("killTestPlay: degrade invalidators never veto", () => {
  const dpOnly: Invalidator[] = [
    { id: "darkpool_reversal", source: "darkpool-trend", describe: "x", check: { kind: "darkpool_reversed", to: ["bearish"] }, severity: "degrade" },
  ];
  const kt = killTestPlay({ play: play(), invalidators: dpOnly, state: morning({ darkPoolBias: "bearish" }) });
  assert.equal(kt.vetoed, false);
});

test("killTestPlay: unknown publish spot cannot veto (never fabricates a kill)", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs());
  const kt = killTestPlay({ play: play(), invalidators: inv, state: morning({ spot: null }) });
  assert.equal(kt.vetoed, false);
});

test("NEAR_KILL_PCT is 0.15%", () => assert.equal(NEAR_KILL_PCT, 0.0015));

// ── coerceInvalidators (JSONB round-trip safety) ─────────────────────────────────────

test("coerceInvalidators drops malformed/unknown-predicate entries, keeps valid ones", () => {
  const raw = [
    { id: "ok", source: "wall-migration", describe: "d", check: { kind: "lt", metric: "spot", level: 10 }, severity: "kill" },
    { id: "bad-kind", source: "wall-migration", describe: "d", check: { kind: "eval_js", code: "hack()" }, severity: "kill" },
    { id: "bad-severity", source: "wall-migration", describe: "d", check: { kind: "lt", metric: "spot", level: 10 }, severity: "nuke" },
    null,
    42,
  ];
  const out = coerceInvalidators(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "ok");
});

test("coerceInvalidators returns [] for non-array input", () => {
  assert.deepEqual(coerceInvalidators(null), []);
  assert.deepEqual(coerceInvalidators({}), []);
});

test("pinned invalidators round-trip through JSON losslessly (serializable specs)", () => {
  const inv = deriveInvalidators(play(), verdict(), inputs());
  const roundTripped = coerceInvalidators(JSON.parse(JSON.stringify(inv)));
  assert.deepEqual(roundTripped, inv);
});
