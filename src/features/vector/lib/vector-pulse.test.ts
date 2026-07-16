import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPulseSnapshot,
  detectPulseSignals,
  filterFreshPulseSignals,
  wallEventToPulseSignal,
  type PulseSnapshot,
  type PulseSignal,
} from "./vector-pulse";
import type { VectorRegime } from "./vector-regime";
import type { WallProximity } from "./vector-wall-proximity";
import type { GammaMagnet } from "./vector-gamma-magnet";
import type { WallIntegrity } from "./vector-wall-integrity";
import type { VectorWallEvent } from "./vector-wall-events";

const BASE_REGIME: VectorRegime = {
  posture: "long",
  headline: "LONG GAMMA",
  read: "Spot above flip.",
  tone: "calm",
};

const BASE_PROXIMITY: WallProximity = {
  strike: 7500,
  side: "call",
  distancePct: 0.15,
  nearness: "near",
  callout: "Testing 7,500 call wall.",
};

const BASE_MAGNET: GammaMagnet = {
  strike: 7480,
  distancePct: -0.003,
  pull: "down",
  posture: "long",
  callout: "gamma magnet 7480 — long-gamma hedging pulls spot down",
};

const BASE_INTEGRITY: { call: WallIntegrity | null; put: WallIntegrity | null } = {
  call: {
    strike: 7500,
    side: "call",
    score: 72,
    tier: "firm",
    factors: { strength: 0.8, persistence: 0.7, isolation: 0.5 },
    note: "7500C firm — held 70% of session, dominant",
  },
  put: {
    strike: 7400,
    side: "put",
    score: 48,
    tier: "moderate",
    factors: { strength: 0.5, persistence: 0.5, isolation: 0.3 },
    note: "7400P moderate — held 50% of session, clustered",
  },
};

function snap(overrides: Partial<Parameters<typeof buildPulseSnapshot>[0]> = {}) {
  return buildPulseSnapshot({
    at: 1000,
    regime: BASE_REGIME,
    proximity: BASE_PROXIMITY,
    magnet: BASE_MAGNET,
    wallIntegrity: BASE_INTEGRITY,
    wallEventCount: 0,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// buildPulseSnapshot
// ---------------------------------------------------------------------------

test("buildPulseSnapshot: extracts structured fields from typed inputs", () => {
  const s = snap();
  assert.equal(s.regimePosture, "long");
  assert.equal(s.proximityStrike, 7500);
  assert.equal(s.proximitySide, "call");
  assert.equal(s.proximityNearness, "near");
  assert.equal(s.magnetPull, "down");
  assert.equal(s.magnetStrike, 7480);
  assert.equal(s.callIntegrityTier, "firm");
  assert.equal(s.putIntegrityTier, "moderate");
});

test("buildPulseSnapshot: null inputs produce null snapshot fields", () => {
  const s = snap({ proximity: null, magnet: null, wallIntegrity: { call: null, put: null } });
  assert.equal(s.proximityStrike, null);
  assert.equal(s.proximityNearness, null);
  assert.equal(s.magnetPull, null);
  assert.equal(s.callIntegrityTier, null);
});

// ---------------------------------------------------------------------------
// detectPulseSignals
// ---------------------------------------------------------------------------

test("detectPulseSignals: no prev → no signals (first tick is silent)", () => {
  assert.deepEqual(detectPulseSignals(null, snap()), []);
});

test("detectPulseSignals: identical snapshots → no signals", () => {
  const s = snap();
  assert.deepEqual(detectPulseSignals(s, s), []);
});

test("detectPulseSignals: regime flip long→short emits bear signal", () => {
  const prev = snap();
  const next = snap({ regime: { ...BASE_REGIME, posture: "short", headline: "SHORT GAMMA" } });
  const sigs = detectPulseSignals(prev, next);
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0]!.kind, "regime-flip");
  assert.equal(sigs[0]!.tone, "bear");
  assert.ok(sigs[0]!.line.includes("SHORT GAMMA"));
});

test("detectPulseSignals: regime flip to transition emits warn", () => {
  const prev = snap();
  const next = snap({ regime: { ...BASE_REGIME, posture: "transition", headline: "AT GAMMA FLIP" } });
  const sigs = detectPulseSignals(prev, next);
  assert.equal(sigs[0]!.tone, "warn");
});

test("detectPulseSignals: regime flip to unknown is suppressed", () => {
  const prev = snap();
  const next = snap({ regime: { ...BASE_REGIME, posture: "unknown", headline: "REGIME —" } });
  assert.deepEqual(detectPulseSignals(prev, next), []);
});

test("detectPulseSignals: new level entering proximity", () => {
  const prev = snap({ proximity: null });
  const next = snap();
  const sigs = detectPulseSignals(prev, next);
  const prox = sigs.find((s) => s.kind === "proximity");
  assert.ok(prox, "proximity signal emitted");
  assert.ok(prox!.line.includes("call wall"));
  assert.ok(prox!.line.includes("7,500"));
});

test("detectPulseSignals: nearness escalation near→at", () => {
  const prev = snap();
  const next = snap({
    proximity: { ...BASE_PROXIMITY, nearness: "at" },
  });
  const sigs = detectPulseSignals(prev, next);
  const prox = sigs.find((s) => s.kind === "proximity");
  assert.ok(prox);
  assert.equal(prox!.tone, "warn");
  assert.ok(prox!.line.includes("AT"));
});

test("detectPulseSignals: nearness de-escalation emits no signal", () => {
  const prev = snap({ proximity: { ...BASE_PROXIMITY, nearness: "at" } });
  const next = snap({ proximity: { ...BASE_PROXIMITY, nearness: "testing" } });
  const sigs = detectPulseSignals(prev, next);
  assert.equal(sigs.filter((s) => s.kind === "proximity").length, 0);
});

test("detectPulseSignals: proximity cleared", () => {
  const prev = snap();
  const next = snap({ proximity: null });
  const sigs = detectPulseSignals(prev, next);
  const cleared = sigs.find((s) => s.kind === "proximity");
  assert.ok(cleared);
  assert.ok(cleared!.line.includes("open space"));
});

test("detectPulseSignals: magnet pull direction change", () => {
  const prev = snap();
  const next = snap({ magnet: { ...BASE_MAGNET, pull: "up", distancePct: 0.003 } });
  const sigs = detectPulseSignals(prev, next);
  const mag = sigs.find((s) => s.kind === "magnet-shift");
  assert.ok(mag);
  assert.equal(mag!.tone, "bull");
  assert.ok(mag!.line.includes("above"));
});

test("detectPulseSignals: integrity tier degradation emits warn", () => {
  const prev = snap();
  const next = snap({
    wallIntegrity: {
      ...BASE_INTEGRITY,
      call: { ...BASE_INTEGRITY.call!, tier: "thin", score: 30 },
    },
  });
  const sigs = detectPulseSignals(prev, next);
  const integ = sigs.find((s) => s.kind === "integrity");
  assert.ok(integ);
  assert.equal(integ!.tone, "warn");
  assert.ok(integ!.line.includes("firm → thin"));
});

test("detectPulseSignals: max signals per tick capped", () => {
  const prev = snap({
    proximity: null,
    magnet: { ...BASE_MAGNET, pull: "at" },
    wallIntegrity: {
      call: { ...BASE_INTEGRITY.call!, tier: "thin", score: 20 },
      put: { ...BASE_INTEGRITY.put!, tier: "thin", score: 20 },
    },
  });
  const next = snap({
    regime: { ...BASE_REGIME, posture: "short", headline: "SHORT GAMMA" },
    proximity: { ...BASE_PROXIMITY, nearness: "at", side: "flip", strike: 7450 },
    magnet: { ...BASE_MAGNET, pull: "up" },
    wallIntegrity: {
      call: { ...BASE_INTEGRITY.call!, tier: "firm", score: 80 },
      put: { ...BASE_INTEGRITY.put!, tier: "firm", score: 80 },
    },
  });
  const sigs = detectPulseSignals(prev, next);
  assert.ok(sigs.length <= 6, `capped at 6, got ${sigs.length}`);
});

// ---------------------------------------------------------------------------
// filterFreshPulseSignals
// ---------------------------------------------------------------------------

test("filterFreshPulseSignals: first-time signals pass through", () => {
  const signals: PulseSignal[] = [
    { key: "a", kind: "regime-flip", tone: "bull", line: "test", at: 1000 },
    { key: "b", kind: "proximity", tone: "info", line: "test2", at: 1000 },
  ];
  const { fresh, seen } = filterFreshPulseSignals(signals, {}, 1000);
  assert.equal(fresh.length, 2);
  assert.ok("a" in seen);
  assert.ok("b" in seen);
});

test("filterFreshPulseSignals: same key within cooldown is suppressed", () => {
  const signals: PulseSignal[] = [
    { key: "a", kind: "regime-flip", tone: "bull", line: "test", at: 2000 },
  ];
  const { fresh } = filterFreshPulseSignals(signals, { a: 1000 }, 2000, 240_000);
  assert.equal(fresh.length, 0);
});

test("filterFreshPulseSignals: same key after cooldown passes", () => {
  const signals: PulseSignal[] = [
    { key: "a", kind: "regime-flip", tone: "bull", line: "test", at: 300_000 },
  ];
  const { fresh } = filterFreshPulseSignals(signals, { a: 1000 }, 300_000, 240_000);
  assert.equal(fresh.length, 1);
});

test("filterFreshPulseSignals: stale seen-map entries pruned", () => {
  const { seen } = filterFreshPulseSignals(
    [],
    { old: 1, recent: 900_000 },
    1_000_000,
    240_000
  );
  assert.ok(!("old" in seen), "entry older than 4× cooldown pruned");
  assert.ok("recent" in seen, "recent entry kept");
});

// ---------------------------------------------------------------------------
// wallEventToPulseSignal
// ---------------------------------------------------------------------------

test("wallEventToPulseSignal: call_wall_shift → bull tone", () => {
  const ev: VectorWallEvent = {
    time: 100,
    lens: "gex",
    kind: "call_wall_shift",
    message: "call wall shifted 7500→7550",
    severity: "info",
  };
  const sig = wallEventToPulseSignal(ev);
  assert.equal(sig.kind, "wall-structure");
  assert.equal(sig.tone, "bull");
  assert.equal(sig.line, ev.message);
  assert.equal(sig.at, 100_000);
});

test("wallEventToPulseSignal: spot_crossed_flip → warn tone", () => {
  const ev: VectorWallEvent = {
    time: 200,
    lens: "gex",
    kind: "spot_crossed_flip",
    message: "spot crossed gamma flip",
    severity: "warn",
  };
  const sig = wallEventToPulseSignal(ev);
  assert.equal(sig.tone, "warn");
});

test("wallEventToPulseSignal: put_wall_fading → bear tone", () => {
  const ev: VectorWallEvent = {
    time: 300,
    lens: "gex",
    kind: "put_wall_fading",
    message: "7400P fading",
    severity: "info",
  };
  const sig = wallEventToPulseSignal(ev);
  assert.equal(sig.tone, "bear");
});
