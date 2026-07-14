import assert from "node:assert/strict";
import test from "node:test";
import {
  detectThesisDrift,
  overnightAxisStatus,
  type PublishedThesisContext,
} from "./thesis-drift";
import { evaluateInvalidators, type MarketSnapshot, type Invalidator } from "./invalidators";

// A pinned publish_context slice: cortex verdict (per-source supports/opposes) + the pinned
// invalidators the morning check re-runs. Mirrors the JSONB the builder pins at publish.
function ctx(opts: {
  supports?: Array<{ source: string; weight: number }>;
  opposes?: Array<{ source: string; weight: number }>;
  invalidators?: Invalidator[];
} = {}): PublishedThesisContext {
  return {
    cortex_overnight: {
      direction: "long",
      supports: opts.supports ?? [{ source: "wall-migration", weight: 2 }, { source: "darkpool-trend", weight: 1 }],
      opposes: opts.opposes ?? [],
      absent: [],
    },
    invalidators: opts.invalidators ?? [
      { id: "flip_break", source: "wall-migration", describe: "opens below flip 7480", check: { kind: "lt", metric: "spot", level: 7480 }, severity: "kill" },
      { id: "darkpool_reversal", source: "darkpool-trend", describe: "dark-pool reverses to bearish", check: { kind: "darkpool_reversed", to: ["bearish"] }, severity: "degrade" },
    ],
  };
}

const morning = (o: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  spot: null,
  gammaFlip: null,
  callWall: null,
  putWall: null,
  regime: null,
  darkPoolBias: null,
  ...o,
});

// ── detectThesisDrift ────────────────────────────────────────────────────────────────

test("core source FLIPPED (flip broke) ⇒ thesis INVALIDATED regardless of price", () => {
  // wall-migration is the core (weight 2 > darkpool 1). Spot below flip ⇒ flip_break fires.
  const res = detectThesisDrift(ctx(), morning({ spot: 7470 }));
  assert.equal(res.coreSource, "wall-migration");
  assert.equal(res.thesisVerdict, "INVALIDATED");
  const wall = res.perSource.find((d) => d.source === "wall-migration")!;
  assert.equal(wall.drift, "flipped");
  assert.equal(wall.morning, "opposes");
  assert.equal(wall.delta, -10); // 7470 - 7480
});

test("all re-read sources HOLD ⇒ thesis HELD", () => {
  // spot above flip (held); darkpool unknown (not re-fetched) ⇒ only wall-migration re-read.
  const res = detectThesisDrift(ctx(), morning({ spot: 7495 }));
  assert.equal(res.thesisVerdict, "HELD");
  assert.equal(res.perSource.find((d) => d.source === "wall-migration")!.drift, "held");
  const dp = res.perSource.find((d) => d.source === "darkpool-trend")!;
  assert.equal(dp.drift, "held");
  assert.equal(dp.morning, "unknown");
  assert.equal(dp.note, "not re-read this morning");
});

test("WEAKENED majority (non-core degrade fires, core holds) ⇒ thesis WEAKENED", () => {
  // Make wall-migration the ONLY re-readable holder and darkpool the fired degrade so the
  // re-readable set is {wall(held), darkpool(weakened)} — 1/2 weakened = majority (≥ half).
  const res = detectThesisDrift(ctx(), morning({ spot: 7495, darkPoolBias: "bearish" }));
  assert.equal(res.thesisVerdict, "WEAKENED");
  assert.equal(res.perSource.find((d) => d.source === "darkpool-trend")!.drift, "weakened");
  // core (wall) held, so not invalidated
  assert.equal(res.perSource.find((d) => d.source === "wall-migration")!.drift, "held");
});

test("a non-core source flip still only WEAKENS when the CORE held", () => {
  // Swap weights: darkpool is core (weight 3); wall-migration weight 1. Fire the wall flip
  // (spot below flip) but hold darkpool — core held, one of two re-read flipped ⇒ WEAKENED.
  const c = ctx({ supports: [{ source: "wall-migration", weight: 1 }, { source: "darkpool-trend", weight: 3 }] });
  const res = detectThesisDrift(c, morning({ spot: 7470, darkPoolBias: "bullish" }));
  assert.equal(res.coreSource, "darkpool-trend");
  assert.equal(res.perSource.find((d) => d.source === "wall-migration")!.drift, "flipped");
  assert.equal(res.perSource.find((d) => d.source === "darkpool-trend")!.drift, "held");
  assert.equal(res.thesisVerdict, "WEAKENED");
});

test("no morning spot ⇒ nothing re-readable ⇒ HELD (never invalidate on missing data)", () => {
  const res = detectThesisDrift(ctx(), morning({ spot: null }));
  assert.equal(res.thesisVerdict, "HELD");
  assert.ok(res.perSource.every((d) => d.morning === "unknown"));
  assert.match(res.reason, /no source re-readable/);
});

test("pre-N7 play (no pinned invalidators) ⇒ HELD, all sources unknown", () => {
  const c: PublishedThesisContext = {
    cortex_overnight: { supports: [{ source: "wall-migration", weight: 2 }], opposes: [], absent: [] },
    invalidators: undefined,
  };
  const res = detectThesisDrift(c, morning({ spot: 7470 }));
  assert.equal(res.thesisVerdict, "HELD");
});

test("empty/absent publish context ⇒ HELD, no core source, no throw", () => {
  assert.equal(detectThesisDrift(null, morning({ spot: 7470 })).thesisVerdict, "HELD");
  assert.equal(detectThesisDrift({}, morning({ spot: 7470 })).coreSource, null);
});

// ── overnightAxisStatus (axis → status mapping) ──────────────────────────────────────

test("overnightAxisStatus: thesis INVALIDATED ⇒ INVALIDATED", () => {
  assert.equal(overnightAxisStatus("INVALIDATED", []).status, "INVALIDATED");
});

test("overnightAxisStatus: a fired KILL invalidator ⇒ INVALIDATED even if thesis only WEAKENED", () => {
  const inv: Invalidator[] = [
    { id: "flip_break", source: "wall-migration", describe: "x", check: { kind: "lt", metric: "spot", level: 7480 }, severity: "kill" },
  ];
  const evals = evaluateInvalidators(inv, morning({ spot: 7470 }));
  const res = overnightAxisStatus("WEAKENED", evals);
  assert.equal(res.status, "INVALIDATED");
  assert.match(res.reasons.join(" "), /fired \(kill\)/);
});

test("overnightAxisStatus: thesis WEAKENED or a fired DEGRADE ⇒ DEGRADED", () => {
  assert.equal(overnightAxisStatus("WEAKENED", []).status, "DEGRADED");
  const inv: Invalidator[] = [
    { id: "darkpool_reversal", source: "darkpool-trend", describe: "x", check: { kind: "darkpool_reversed", to: ["bearish"] }, severity: "degrade" },
  ];
  const evals = evaluateInvalidators(inv, morning({ darkPoolBias: "bearish" }));
  assert.equal(overnightAxisStatus("HELD", evals).status, "DEGRADED");
});

test("overnightAxisStatus: nothing drifted ⇒ null (no downgrade)", () => {
  assert.equal(overnightAxisStatus("HELD", []).status, null);
});
