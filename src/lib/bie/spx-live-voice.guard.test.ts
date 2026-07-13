// NO-FAKE-NUMBERS GUARD — enforcement of the 2026-07-13 user mandate:
// "Largo should be really strong, no fake numbers, everything validated."
//
// Every string Largo can render (bias voice, header, triggers, watch levels,
// expected-move / session / VWAP / catalyst chips, transition events, play lines)
// is scanned for numeric tokens; each token MUST trace to
//   1. a desk-payload/snapshot input field (or its Math.round / 1-decimal rounding), or
//   2. a DOCUMENTED arithmetic derivation of those inputs — the explicit
//      allowed-derivations set below (point distances |spot−level|, expected-move
//      half-width/midpoint/%-used), or
//   3. a small integer count ≤ 10 (e.g. "4/4 signals"), a documented threshold
//      constant (VIX 20 pivot, RSI 30/70 zones, the "first 30 min" phrase), the
//      "20/50" EMA indicator NAME, or a clock time derived from an input timestamp.
// Anything else fails the suite — a fabricated number can not ship.
//
// Run: npx tsx --test src/lib/bie/spx-live-voice.guard.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  composeBiasHeaderLine,
  composeBiasVoice,
  composeCatalystLine,
  composeExpectedMoveContext,
  composeSessionCharacter,
  composeVwapPosture,
  deriveSpxBias,
  deriveTriggerLevels,
  deriveWatchLevels,
  detectPlayVoiceEvents,
  detectSpxVoiceEvents,
  type SpxVoicePlayState,
  type SpxVoiceSnapshot,
} from "@/lib/bie/spx-live-voice";

// ---------------------------------------------------------------------------
// The allowed-numbers oracle
// ---------------------------------------------------------------------------

/** Documented voice constants: VIX 20 pivot, RSI 30/70 zones, "first 30 min". */
const THRESHOLD_CONSTANTS = [20, 30, 70];

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Every number (and rounding of a number) that a snapshot legitimately puts on the
 * table, PLUS the explicit allowed-derivations set:
 *   D1  point distance  |spot − level|  (raw + 1dp)  for every level field
 *   D2  expected-move half-width  (high − low) / 2   (raw + rounded)
 *   D3  expected-move %-used  |spot − mid| / half · 100  (rounded)
 */
function allowedNumbers(snap: SpxVoiceSnapshot, extra: number[] = []): Set<number> {
  const out = new Set<number>(THRESHOLD_CONSTANTS);
  const add = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return;
    out.add(v);
    out.add(Math.round(v));
    out.add(round1(v));
    out.add(Number(v.toFixed(1))); // toFixed rendering (e.g. VIX "18.5")
    out.add(Number(v.toFixed(2)));
  };

  add(snap.price);
  add(snap.vwap);
  add(snap.gammaFlip);
  add(snap.maxPain);
  add(snap.ema20);
  add(snap.ema50);
  add(snap.hod);
  add(snap.lod);
  add(snap.pdh);
  add(snap.pdl);
  add(snap.vix);
  add(snap.vixChangePct);
  add(snap.rsi);
  add(snap.kingCall?.strike);
  add(snap.kingPut?.strike);
  add(snap.expMove?.low);
  add(snap.expMove?.high);
  add(snap.openingRange?.high);
  add(snap.openingRange?.low);
  for (const w of snap.walls) add(w.strike);

  // D1: point distances from spot to every level already in the set.
  if (snap.price != null) {
    for (const k of Array.from(out)) {
      const d = Math.abs(snap.price - k);
      out.add(d);
      out.add(round1(d));
    }
  }
  // D2 + D3: expected-move geometry.
  if (snap.expMove) {
    const half = (snap.expMove.high - snap.expMove.low) / 2;
    const mid = (snap.expMove.high + snap.expMove.low) / 2;
    if (half > 0) {
      out.add(half);
      out.add(Math.round(half));
      if (snap.price != null) {
        out.add(Math.round((Math.abs(snap.price - mid) / half) * 100));
      }
    }
  }
  for (const v of extra) add(v);
  return out;
}

/** Numeric tokens inside free-text INPUTS (headline titles) are inputs, not claims. */
function numbersInInputText(snap: SpxVoiceSnapshot): number[] {
  const found: number[] = [];
  const scan = (t: string | undefined | null) => {
    if (!t) return;
    for (const m of t.matchAll(/-?\d+(?:\.\d+)?/g)) found.push(Number(m[0]));
  };
  scan(snap.latestHeadline?.title);
  for (const t of snap.newsTitles) scan(t);
  return found;
}

const FORBIDDEN = ["undefined", "NaN", "null", "Infinity", "{{", "}}"];

/**
 * The guard itself. Throws when `text` contains a numeric token that traces to
 * nothing in the allowed set, or any forbidden placeholder substring.
 */
function assertNoFakeNumbers(text: string, allowed: Set<number>): void {
  for (const bad of FORBIDDEN) {
    assert.ok(!text.includes(bad), `forbidden token "${bad}" in: ${text}`);
  }

  const cleaned = text
    // Clock times ("9:45 AM ET") derive from input timestamps, not numeric claims.
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    // "20/50 EMA" is an indicator NAME.
    .replace(/20\/50/g, " ")
    // Thousands separators: 7,528 → 7528.
    .replace(/(\d),(\d{3})\b/g, "$1$2");

  for (const m of cleaned.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const raw = m[0];
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    // Small bare integers are counts ("4/4 aligned", "±1σ"), never price claims.
    if (!raw.includes(".") && Math.abs(n) <= 10) continue;
    assert.ok(
      Array.from(allowed).some((k) => Math.abs(k - n) < 1e-9),
      `UNGROUNDED number ${raw} in: "${text}"`
    );
  }
}

// ---------------------------------------------------------------------------
// Fixtures — representative rich/sparse/stale tapes
// ---------------------------------------------------------------------------

function base(over: Partial<SpxVoiceSnapshot> = {}): SpxVoiceSnapshot {
  return {
    at: 1_800_000_000_000,
    price: null,
    vwap: null,
    vwapVolumeWeighted: false,
    gammaFlip: null,
    maxPain: null,
    aboveFlip: null,
    aboveVwap: null,
    ema20: null,
    ema50: null,
    emaStack: null,
    regime: null,
    kingCall: null,
    kingPut: null,
    walls: [],
    hod: null,
    lod: null,
    pdh: null,
    pdl: null,
    openingRange: null,
    vix: null,
    vixChangePct: null,
    tideBias: null,
    expMove: null,
    rsi: null,
    newsTitles: [],
    latestHeadline: null,
    gexStale: false,
    feedStalled: false,
    ...over,
  };
}

/** Rich bearish tape — every field a Largo string can cite is populated. */
function richBear(over: Partial<SpxVoiceSnapshot> = {}): SpxVoiceSnapshot {
  return base({
    price: 7512.3,
    vwap: 7544.2,
    vwapVolumeWeighted: true,
    gammaFlip: 7528,
    maxPain: 7519.5,
    aboveFlip: false,
    aboveVwap: false,
    ema20: 7520.1,
    ema50: 7535.4,
    emaStack: "bearish",
    regime: "bearish",
    kingCall: { strike: 7550, netGex: 3_200_000 },
    kingPut: { strike: 7495, netGex: -2_800_000 },
    walls: [
      { strike: 7550, netGex: 3_200_000, kind: "resistance" },
      { strike: 7495, netGex: -2_800_000, kind: "support" },
      { strike: 7470, netGex: -900_000, kind: "support" },
    ],
    hod: 7538.6,
    lod: 7502.4,
    pdh: 7560.9,
    pdl: 7490.2,
    openingRange: { high: 7531.2, low: 7509.8, break: "below", forming: false },
    vix: 18.53,
    vixChangePct: 4.2,
    tideBias: "bearish",
    expMove: { low: 7464, high: 7616 },
    rsi: 41.7,
    newsTitles: ["Fed's Waller: 2 cuts on the table"],
    latestHeadline: {
      title: "Fed's Waller: 2 cuts on the table",
      publishedAt: Date.parse("2026-07-13T13:45:00Z"),
    },
    ...over,
  });
}

function richBull(): SpxVoiceSnapshot {
  return richBear({
    price: 7556.8,
    aboveFlip: true,
    aboveVwap: true,
    emaStack: "bullish",
    regime: "bullish",
    openingRange: { high: 7531.2, low: 7509.8, break: "above", forming: false },
    tideBias: "bullish",
  });
}

function richNeutral(): SpxVoiceSnapshot {
  return richBear({
    price: 7521,
    aboveFlip: false,
    aboveVwap: true,
    emaStack: "bullish",
    regime: "bearish",
    openingRange: { high: 7531.2, low: 7509.8, break: "inside", forming: false },
  });
}

/** Everything Largo can print for one snapshot, in one list. */
function allComposedStrings(snap: SpxVoiceSnapshot): string[] {
  const bias = deriveSpxBias(snap);
  return [
    composeBiasVoice(snap, bias),
    composeBiasHeaderLine(snap, bias),
    ...deriveTriggerLevels(snap, bias).map((t) => t.line),
    ...deriveWatchLevels(snap).map((w) => w.line),
    composeExpectedMoveContext(snap),
    composeSessionCharacter(snap),
    composeVwapPosture(snap),
    composeCatalystLine(snap),
  ].filter((s): s is string => s != null);
}

// ---------------------------------------------------------------------------
// The guard suites
// ---------------------------------------------------------------------------

describe("guard: the checker itself catches fabricated numbers (self-test)", () => {
  test("an invented level fails; a real one passes", () => {
    const allowed = allowedNumbers(richBear());
    assert.throws(() => assertNoFakeNumbers("SPX ripping to 8,123.4", allowed));
    assert.throws(() => assertNoFakeNumbers("watch 9999 next", allowed));
    assert.doesNotThrow(() => assertNoFakeNumbers("SPX 7,512 below VWAP 7,544", allowed));
  });

  test("forbidden placeholders fail regardless of numbers", () => {
    const allowed = allowedNumbers(richBear());
    for (const bad of ["price is undefined", "gap NaN pts", "flip null", "{{price}}"]) {
      assert.throws(() => assertNoFakeNumbers(bad, allowed), bad);
    }
  });
});

describe("guard: every composer output is grounded (bearish / bullish / neutral)", () => {
  for (const [name, mk] of [
    ["bearish", richBear],
    ["bullish", richBull],
    ["neutral", richNeutral],
  ] as const) {
    test(`${name} tape — voice/header/triggers/watch/chips all trace to inputs`, () => {
      const snap = mk();
      const allowed = allowedNumbers(snap, numbersInInputText(snap));
      const strings = allComposedStrings(snap);
      assert.ok(strings.length >= 6, `expected a full read, got ${strings.length} strings`);
      for (const s of strings) assertNoFakeNumbers(s, allowed);
    });
  }

  test("stale-GEX tape — outputs still grounded AND stale warning present", () => {
    const snap = richBear({ gexStale: true });
    const allowed = allowedNumbers(snap, numbersInInputText(snap));
    const strings = allComposedStrings(snap);
    for (const s of strings) assertNoFakeNumbers(s, allowed);
    const voice = composeBiasVoice(snap, deriveSpxBias(snap));
    assert.match(voice, /stale right now — treat walls and flip as approximate/);
  });
});

describe("guard: transition events are grounded (numbers from prev∪next only)", () => {
  test("a max-burst transition emits only traceable numbers", () => {
    const prev = richBear({
      price: 7530,
      aboveFlip: true,
      aboveVwap: true,
      emaStack: "bullish",
      regime: "bullish",
      tideBias: "bullish",
      vix: 18.53,
      rsi: 34,
      hod: 7538.6,
      lod: 7502.4,
    });
    const next = richBear({
      price: 7488.9,
      aboveFlip: false,
      aboveVwap: false,
      emaStack: "bearish",
      regime: "bearish",
      tideBias: "bearish",
      vix: 21.4,
      rsi: 28.2,
      lod: 7488.9,
      kingCall: { strike: 7525, netGex: 3_000_000 },
      kingPut: { strike: 7475, netGex: -2_500_000 },
      walls: [
        { strike: 7525, netGex: 3_000_000, kind: "resistance" },
        { strike: 7475, netGex: -2_500_000, kind: "support" },
      ],
    });
    const allowed = new Set<number>([
      ...allowedNumbers(prev, numbersInInputText(prev)),
      ...allowedNumbers(next, numbersInInputText(next)),
    ]);
    const events = detectSpxVoiceEvents(prev, next);
    assert.ok(events.length > 0, "transition must produce events");
    for (const ev of events) assertNoFakeNumbers(ev.line, allowed);
  });

  test("play lifecycle lines cite only the play's own entry/stop/target", () => {
    const armed: SpxVoicePlayState = { action: "BUY", direction: "short", open_play: null };
    const fired: SpxVoicePlayState = {
      action: "HOLD",
      direction: "short",
      open_play: { direction: "short", entry_price: 7512, stop: 7530.5, target: 7480 },
    };
    const allowed = allowedNumbers(base(), [7512, 7530.5, 7480]);
    const at = 1_800_000_000_000;
    for (const ev of [
      ...detectPlayVoiceEvents(null, armed, at),
      ...detectPlayVoiceEvents(armed, fired, at),
      ...detectPlayVoiceEvents(fired, { action: "SCANNING", direction: null, open_play: null }, at),
    ]) {
      assertNoFakeNumbers(ev.line, allowed);
    }
  });
});

describe("guard: null-honesty — missing/stale inputs mean saying LESS, never guessing", () => {
  const sparseCases: Array<[string, SpxVoiceSnapshot]> = [
    ["everything null", base()],
    ["price only", base({ price: 7500 })],
    ["price+flip only", base({ price: 7500, gammaFlip: 7520, aboveFlip: false })],
    ["feed stalled", richBear({ feedStalled: true })],
    ["gex stale", richBear({ gexStale: true })],
    ["no expected move (VIX missing)", richBear({ expMove: null, vix: null })],
    ["no max pain", richBear({ maxPain: null })],
    ["no opening range", richBear({ openingRange: null })],
  ];

  for (const [name, snap] of sparseCases) {
    test(`${name} → no undefined/NaN/null leaks, all remaining numbers grounded`, () => {
      const allowed = allowedNumbers(snap, numbersInInputText(snap));
      for (const s of allComposedStrings(snap)) assertNoFakeNumbers(s, allowed);
    });
  }

  test("missing fields silence their composer instead of degrading it", () => {
    const snap = base({ price: 7500 });
    assert.equal(composeExpectedMoveContext(snap), null);
    assert.equal(composeSessionCharacter(snap), null);
    assert.equal(composeVwapPosture(snap), null);
    assert.equal(composeCatalystLine(snap), null);
    assert.deepEqual(deriveWatchLevels(snap), []);
  });

  test("stale GEX: watch levels drop dealer-positioning levels entirely", () => {
    const labels = deriveWatchLevels(richBear({ gexStale: true })).map((l) => l.label);
    for (const gexLabel of ["γ-flip", "max pain", "call wall", "put wall"]) {
      assert.ok(!labels.includes(gexLabel), `stale GEX leaked "${gexLabel}"`);
    }
  });

  test("voice keeps the 3–5 sentence cap even on the richest tape", () => {
    for (const snap of [richBear(), richBull(), richNeutral(), richBear({ gexStale: true })]) {
      const voice = composeBiasVoice(snap, deriveSpxBias(snap));
      const sentences = voice.split(/(?<=[.!])\s+(?=[^a-z])/).filter(Boolean);
      assert.ok(sentences.length >= 3 && sentences.length <= 5, `sentence count ${sentences.length}`);
    }
  });
});
