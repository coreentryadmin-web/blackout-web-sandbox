// NO-FAKE-NUMBERS GUARD for the Cortex — the same 2026-07-13 mandate the Largo
// guard enforces ("no fake numbers, everything validated"), applied to every string
// a CortexVerdict can put in front of a member (narrative lines = evidence details
// + the composed header/absent lines). Pattern: src/lib/bie/spx-live-voice.guard.test.ts.
//
// Every numeric token in every narrative line MUST trace to
//   1. a number present in the CortexInputs snapshot (including numbers inside
//      input text like headlines — inputs, not claims), or its 0/1/2-dp rounding;
//   2. a DOCUMENTED arithmetic derivation of those inputs (the closure below):
//      D1 pairwise point distances |a−b| between price-like inputs (spot, strikes,
//         walls, dark-pool levels, king node, bar OHLC, prior close);
//      D2 expected-move fractions em × {0.1, 0.25, 0.3, 0.5} (the named EM-frac
//         constants) and ratios d/em for any D1 distance d (the "0.67x EM" class);
//      D3 flow-cluster premium totals via the SAME findFlowCluster the sources use,
//         rendered as $X.XM (v/1e6, 1 dp), plus per-level premiums /1e6;
//      D4 the wall-trend least-squares slope via the SAME railSlopePctPerHour and
//         the window span in minutes ((last−first)/60);
//      D5 the verdict's own computed numbers (score, decayed item weights) — they
//         are deterministic functions of the inputs the calibration loop persists;
//   3. a small bare-integer count ≤ 10 (e.g. "2 prints", "3 half-lives") or a
//      documented threshold constant (15-min window, 45-min rail window, 24h
//      catalyst age, 14:30 charm clock — clock times are stripped like the Largo
//      guard does).
// Anything else fails the suite — a fabricated number cannot ship.
//
// Run: node --import tsx --experimental-test-module-mocks --test src/lib/nighthawk/cortex/narrative.guard.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { composeCortexEvidence } from "./compose";
import { QQQ_SHORT_2026_07_13, SPY_LONG_2026_07_13 } from "./fixtures-2026-07-13";
import { findFlowCluster } from "./sources/flow-quality";
import { railSlopePctPerHour } from "./sources/wall-trend";
import { baseInputs } from "./test-helpers";
import type { CortexInputs, CortexVerdict } from "./types";

// ---------------------------------------------------------------------------
// The allowed-numbers oracle
// ---------------------------------------------------------------------------

/** Documented narrative constants: the 15-min flow window, the 45-min rail window,
 *  the 24h catalyst age, and the EM-fraction thresholds 0.5/0.25/0.3/0.1. */
const THRESHOLD_CONSTANTS = [15, 45, 24, 0.5, 0.25, 0.3, 0.1];

function addWithRoundings(out: Set<number>, v: number | null | undefined): void {
  if (v == null || !Number.isFinite(v)) return;
  out.add(v);
  out.add(Math.round(v));
  out.add(Number(v.toFixed(1)));
  out.add(Number(v.toFixed(2)));
}

/** Recursively harvest every finite number in the snapshot — including numbers
 *  embedded in input STRINGS (headlines are inputs, not claims). */
function harvest(out: Set<number>, node: unknown): void {
  if (typeof node === "number") {
    addWithRoundings(out, node);
    return;
  }
  if (typeof node === "string") {
    for (const m of node.matchAll(/-?\d+(?:\.\d+)?/g)) addWithRoundings(out, Number(m[0]));
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) harvest(out, v);
    return;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node)) harvest(out, v);
  }
}

/** Price-like inputs for the D1 pairwise-distance closure. */
function priceLikeNumbers(input: CortexInputs): number[] {
  const prices: number[] = [];
  const push = (v: number | null | undefined) => {
    if (v != null && Number.isFinite(v)) prices.push(v);
  };
  push(input.spot);
  if (input.gex) {
    push(input.gex.spot);
    push(input.gex.gammaFlip);
    for (const w of [...input.gex.callWalls, ...input.gex.putWalls]) push(w.strike);
  }
  for (const s of input.wallTrend?.samples ?? []) {
    for (const w of [...s.callWalls, ...s.putWalls]) push(w.strike);
  }
  for (const l of input.darkPool?.levels ?? []) push(l.price);
  push(input.vex?.kingStrike);
  if (input.opening) {
    push(input.opening.priorClose);
    for (const b of input.opening.bars) {
      push(b.open);
      push(b.high);
      push(b.low);
      push(b.close);
    }
  }
  return prices;
}

function allowedNumbers(input: CortexInputs, verdict: CortexVerdict): Set<number> {
  const out = new Set<number>(THRESHOLD_CONSTANTS);
  harvest(out, input);

  const em = input.expectedMovePts;
  const prices = priceLikeNumbers(input);

  // D1 + D2: pairwise distances and their EM ratios.
  const distances: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    for (let j = i + 1; j < prices.length; j++) {
      const d = Math.abs(prices[i] - prices[j]);
      distances.push(d);
      addWithRoundings(out, d);
    }
  }
  if (em != null && em > 0) {
    for (const frac of [0.1, 0.25, 0.3, 0.5]) addWithRoundings(out, em * frac);
    for (const d of distances) addWithRoundings(out, d / em);
  }

  // D3: flow-cluster totals (same helper as the sources) + per-item premiums, in $M.
  const nowMs = Date.parse(input.now);
  for (const side of ["bullish", "bearish"] as const) {
    const cluster = input.flow ? findFlowCluster(input.flow.prints, side, nowMs) : null;
    if (cluster) {
      addWithRoundings(out, cluster.totalPremium / 1_000_000);
      out.add(cluster.prints);
      out.add(cluster.sweeps);
      out.add(cluster.blocks);
    }
  }
  for (const l of input.darkPool?.levels ?? []) addWithRoundings(out, l.premium / 1_000_000);

  // D4: the wall-trend slope + window minutes over the rail, for the last sample's
  // dominant wall on EACH side (mirrors the source's own documented derivation).
  const samples = [...(input.wallTrend?.samples ?? [])].sort((a, b) => a.time - b.time);
  if (samples.length >= 2) {
    const last = samples[samples.length - 1];
    addWithRoundings(out, (last.time - samples[0].time) / 60);
    for (const side of ["callWalls", "putWalls"] as const) {
      const wall = last[side][0];
      if (!wall) continue;
      const points = samples.map((s) => ({
        timeSec: s.time,
        pct: s[side].find((w) => w.strike === wall.strike)?.pct ?? 0,
      }));
      addWithRoundings(out, railSlopePctPerHour(points));
    }
  }

  // D5: the verdict's own computed numbers (score + decayed weights).
  addWithRoundings(out, verdict.score);
  for (const item of [...verdict.vetoes, ...verdict.supports, ...verdict.opposes]) {
    addWithRoundings(out, item.weight);
  }
  out.add(verdict.vetoes.length);

  return out;
}

const FORBIDDEN = ["undefined", "NaN", "null", "Infinity", "{{", "}}"];

function assertNoFakeNumbers(text: string, allowed: Set<number>): void {
  for (const bad of FORBIDDEN) {
    assert.ok(!text.includes(bad), `forbidden token "${bad}" in: ${text}`);
  }
  const cleaned = text
    // Clock times ("14:30 ET", "9:45") derive from the input clock, not claims.
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    // Thousands separators: 7,528 -> 7528.
    .replace(/(\d),(\d{3})\b/g, "$1$2");

  for (const m of cleaned.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const raw = m[0];
    const n = Math.abs(Number(raw));
    if (!Number.isFinite(n)) continue;
    // Small bare integers are counts ("2 prints", "3 half-lives"), never price claims.
    if (!raw.includes(".") && n <= 10) continue;
    assert.ok(
      Array.from(allowed).some((k) => Math.abs(Math.abs(k) - n) < 1e-9),
      `UNGROUNDED number ${raw} in: "${text}"`
    );
  }
}

function checkVerdict(input: CortexInputs): CortexVerdict {
  const verdict = composeCortexEvidence(input);
  const allowed = allowedNumbers(input, verdict);
  for (const line of verdict.narrative) assertNoFakeNumbers(line, allowed);
  // Details ARE the narrative body, but guard them independently too so a future
  // narrative reshuffle can't silently exempt them.
  for (const item of [...verdict.vetoes, ...verdict.supports, ...verdict.opposes]) {
    assertNoFakeNumbers(item.detail, allowed);
  }
  return verdict;
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe("guard: the checker itself catches fabricated numbers (self-test)", () => {
  test("an invented level fails; a real one passes", () => {
    const verdict = composeCortexEvidence(QQQ_SHORT_2026_07_13);
    const allowed = allowedNumbers(QQQ_SHORT_2026_07_13, verdict);
    assert.throws(() => assertNoFakeNumbers("QQQ ripping to 8123.4", allowed));
    assert.throws(() => assertNoFakeNumbers("watch 9999 next", allowed));
    assert.doesNotThrow(() => assertNoFakeNumbers("put wall 606 under spot 612.4", allowed));
  });

  test("forbidden placeholders fail regardless of numbers", () => {
    const verdict = composeCortexEvidence(QQQ_SHORT_2026_07_13);
    const allowed = allowedNumbers(QQQ_SHORT_2026_07_13, verdict);
    for (const bad of ["strike is undefined", "gap NaN pts", "flip null", "{{spot}}"]) {
      assert.throws(() => assertNoFakeNumbers(bad, allowed), bad);
    }
  });
});

describe("guard: every narrative line traces to inputs (rich fixtures)", () => {
  test("QQQ short 7/13 — all lines grounded", () => {
    const v = checkVerdict(QQQ_SHORT_2026_07_13);
    assert.ok(v.narrative.length >= 9, `expected a full evidence table, got ${v.narrative.length} lines`);
  });

  test("SPY long 7/13 — veto/oppose/absent lines grounded", () => {
    const v = checkVerdict(SPY_LONG_2026_07_13);
    assert.ok(v.vetoes.length >= 2);
  });
});

describe("guard: null-honesty — sparse/stale snapshots say LESS, never guess", () => {
  test("all-null snapshot: absent-only narrative, no leaks", () => {
    const v = checkVerdict(baseInputs());
    assert.equal(v.supports.length + v.opposes.length + v.vetoes.length, 0);
  });

  test("reader-error snapshot: error classes render without fake numbers", () => {
    checkVerdict(
      baseInputs({
        errors: {
          "gex-walls": "CortexSourceTimeout",
          "flow-quality": "TypeError",
          "opening-harvest": "CortexSourceTimeout",
        },
      })
    );
  });

  test("stale-everything variant of the QQQ fixture: self-silenced, still grounded", () => {
    // Push the clock 6 hours past the snapshot: every half-life is blown, every
    // source must demote to absent — and the absent lines must stay clean.
    const stale: CortexInputs = { ...QQQ_SHORT_2026_07_13, now: "2026-07-13T20:20:00.000Z" };
    const v = checkVerdict(stale);
    assert.equal(v.supports.length, 0);
    assert.ok(v.absent.length >= 6);
  });

  test("partial snapshot (gex only) stays grounded", () => {
    checkVerdict(
      baseInputs({
        direction: "long",
        spot: 100,
        expectedMovePts: 4,
        gex: QQQ_SHORT_2026_07_13.gex ? { ...QQQ_SHORT_2026_07_13.gex, spot: 100 } : null,
      })
    );
  });
});
