import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  composeBiasHeaderLine,
  composeBiasVoice,
  deriveSpxBias,
  deriveTriggerLevels,
  detectPlayVoiceEvents,
  detectSpxVoiceEvents,
  filterFreshVoiceEvents,
  voiceSnapshotFromDesk,
  type SpxVoiceSnapshot,
} from "@/lib/bie/spx-live-voice";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mkSnap(over: Partial<SpxVoiceSnapshot> = {}): SpxVoiceSnapshot {
  return {
    at: 1_800_000_000_000,
    price: null,
    vwap: null,
    gammaFlip: null,
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
    vix: null,
    vixChangePct: null,
    tideBias: null,
    expMove: null,
    rsi: null,
    newsTitles: [],
    gexStale: false,
    feedStalled: false,
    ...over,
  };
}

/** Fully-bearish tape: every signal agrees (4/4). */
function bearishSnap(over: Partial<SpxVoiceSnapshot> = {}): SpxVoiceSnapshot {
  return mkSnap({
    price: 7512.3,
    vwap: 7544.2,
    gammaFlip: 7528,
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
    ],
    ...over,
  });
}

/** Numbers a voice/header/trigger string may cite: fixture inputs + their roundings.
 *  Small bare ints (≤31: vote counts like "4/4") are counts, not claims — same rule as
 *  the BIE Layer-4 verifier. */
function assertGrounded(text: string, snap: SpxVoiceSnapshot): void {
  const known = new Set<number>();
  const add = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return;
    known.add(v);
    known.add(Math.round(v));
  };
  add(snap.price);
  add(snap.vwap);
  add(snap.gammaFlip);
  add(snap.ema20);
  add(snap.ema50);
  add(snap.hod);
  add(snap.lod);
  add(snap.pdh);
  add(snap.pdl);
  add(snap.vix);
  add(snap.kingCall?.strike);
  add(snap.kingPut?.strike);
  add(snap.expMove?.low);
  add(snap.expMove?.high);
  for (const w of snap.walls) add(w.strike);

  // "20/50 EMAs" is an indicator NAME, not a numeric claim.
  const cleaned = text.replace(/20\/50/g, "").replace(/(\d),(\d{3})\b/g, "$1$2");
  const re = /-?\d+(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const n = Number(m[0]);
    if (!Number.isFinite(n)) continue;
    if (!m[0].includes(".") && Math.abs(n) <= 31) continue; // counts (e.g. 4/4, EMA 20/50)
    assert.ok(
      Array.from(known).some((k) => Math.abs(k - n) <= Math.max(Math.abs(k) * 0.005, 0.02)),
      `ungrounded number ${n} in: ${text}`
    );
  }
}

// ---------------------------------------------------------------------------
// Bias derivation + conviction counting
// ---------------------------------------------------------------------------

describe("deriveSpxBias", () => {
  test("4/4 aligned bearish → STRONG", () => {
    const bias = deriveSpxBias(bearishSnap());
    assert.equal(bias.direction, "bearish");
    assert.equal(bias.aligned, 4);
    assert.equal(bias.total, 4);
    assert.equal(bias.conviction, "STRONG");
  });

  test("3/4 aligned (EMA stack mixed) → SOLID", () => {
    const bias = deriveSpxBias(bearishSnap({ emaStack: "mixed" }));
    assert.equal(bias.direction, "bearish");
    assert.equal(bias.aligned, 3);
    assert.equal(bias.total, 4);
    assert.equal(bias.conviction, "SOLID");
  });

  test("2/4 with an opposing vote → LEAN", () => {
    // Above VWAP (bull) + flip bear + EMA mixed + regime bear → sum -1, aligned 2 of 4.
    const bias = deriveSpxBias(bearishSnap({ aboveVwap: true, emaStack: "mixed" }));
    assert.equal(bias.direction, "bearish");
    assert.equal(bias.aligned, 2);
    assert.equal(bias.conviction, "LEAN");
  });

  test("perfect split → NEUTRAL / MIXED", () => {
    const bias = deriveSpxBias(
      bearishSnap({ aboveFlip: true, aboveVwap: false, emaStack: "bullish", regime: "bearish" })
    );
    assert.equal(bias.direction, "neutral");
    assert.equal(bias.conviction, "MIXED");
  });

  test("thin payload (2 computable signals) can never print STRONG", () => {
    const bias = deriveSpxBias(mkSnap({ price: 7500, gammaFlip: 7520, aboveFlip: false, vwap: 7510, aboveVwap: false }));
    assert.equal(bias.direction, "bearish");
    assert.equal(bias.total, 2);
    assert.equal(bias.conviction, "LEAN");
  });

  test("bias key ignores plain price ticks but tracks state flips", () => {
    const a = deriveSpxBias(bearishSnap());
    const b = deriveSpxBias(bearishSnap({ price: 7510.9 }));
    assert.equal(a.key, b.key);
    const c = deriveSpxBias(bearishSnap({ aboveVwap: true }));
    assert.notEqual(a.key, c.key);
  });
});

// ---------------------------------------------------------------------------
// Voice + header — exact output, emoji, no {{}} leaks, grounded numbers
// ---------------------------------------------------------------------------

describe("composeBiasVoice / composeBiasHeaderLine", () => {
  test("bearish fixture → exact multi-sentence read", () => {
    const snap = bearishSnap();
    const voice = composeBiasVoice(snap, deriveSpxBias(snap));
    assert.equal(
      voice,
      "🔥 Sellers pressing — SPX 7,512 is below VWAP 7,544 and below the γ-flip 7,528 with the 20/50 EMAs stacked down (4/4 signals bearish). " +
        "Dealers are short gamma down here — they chase this move, not fade it, so drops feed themselves. " +
        "7,495 put wall is the line — lose it and the tape accelerates lower; pops into 7,528 are supply. " +
        "PUTS on rallies or stand aside — no chasing extended candles. ⚠️"
    );
  });

  test("bearish header line → direction · conviction · mechanism → posture", () => {
    const snap = bearishSnap();
    const header = composeBiasHeaderLine(snap, deriveSpxBias(snap));
    assert.equal(
      header,
      "BEARISH · 4/4 aligned · below VWAP & γ-flip · short gamma amplifies moves → favor PUTS on rallies into 7,528"
    );
  });

  test("neutral pinned tape → WAIT posture between the walls", () => {
    const snap = bearishSnap({
      price: 7521,
      aboveFlip: false,
      aboveVwap: true,
      emaStack: "bullish",
      regime: "bearish",
    });
    const bias = deriveSpxBias(snap);
    assert.equal(bias.direction, "neutral");
    const voice = composeBiasVoice(snap, bias);
    assert.match(voice, /⚖️ No edge yet/);
    assert.match(voice, /pinned between the 7,495 put wall and the 7,550 call wall/);
    assert.match(voice, /WAIT for the break/);
    const header = composeBiasHeaderLine(snap, bias);
    assert.match(header, /^NEUTRAL · /);
    assert.match(header, /WAIT for a break or sell the chop$/);
  });

  test("voice: 3–5 sentences, has emoji, no {{}} markers, every number grounded", () => {
    for (const snap of [
      bearishSnap(),
      bearishSnap({ aboveFlip: true, aboveVwap: true, emaStack: "bullish", regime: "bullish", price: 7560 }),
      bearishSnap({ aboveFlip: true, aboveVwap: false, emaStack: "bullish", regime: "bearish" }),
    ]) {
      const bias = deriveSpxBias(snap);
      const voice = composeBiasVoice(snap, bias);
      const header = composeBiasHeaderLine(snap, bias);
      assert.ok(!voice.includes("{{") && !voice.includes("}}"), "voice must not leak {{}} markers");
      assert.ok(!header.includes("{{"), "header must not leak {{}} markers");
      assert.match(voice, /[🔥🚀⚖️]/u, "voice opens with heat emoji");
      const sentences = voice.split(/(?<=[.!])\s+(?=[^a-z])/).filter(Boolean);
      assert.ok(sentences.length >= 3 && sentences.length <= 5, `sentence count ${sentences.length}`);
      assertGrounded(voice, snap);
      assertGrounded(header, snap);
    }
  });

  test("stale positioning appends the data-honesty warning", () => {
    const snap = bearishSnap({ gexStale: true });
    const voice = composeBiasVoice(snap, deriveSpxBias(snap));
    assert.match(voice, /stale right now — treat walls and flip as approximate/);
  });
});

// ---------------------------------------------------------------------------
// Trigger levels
// ---------------------------------------------------------------------------

describe("deriveTriggerLevels", () => {
  test("bearish → reclaim / lose put wall / chop-range, max 3, grounded", () => {
    const snap = bearishSnap();
    const triggers = deriveTriggerLevels(snap, deriveSpxBias(snap));
    assert.equal(triggers.length, 3);
    // Reclaim level = the HIGHER of VWAP/flip (flips both structure votes).
    assert.equal(triggers[0]!.line, "reclaim 7,544 → bias flips — calls window opens");
    assert.equal(triggers[0]!.tone, "bull");
    assert.equal(triggers[1]!.line, "lose 7,495 put wall → acceleration lower — press puts");
    assert.equal(triggers[1]!.tone, "bear");
    assert.equal(triggers[2]!.line, "inside 7,495–7,528 = chop — scalp small or wait");
    for (const t of triggers) assertGrounded(t.line, snap);
  });

  test("bullish → lose-level / break call wall / chop-range", () => {
    const snap = bearishSnap({
      price: 7540,
      aboveFlip: true,
      aboveVwap: true,
      emaStack: "bullish",
      regime: "bullish",
      vwap: 7530,
      gammaFlip: 7528,
    });
    const triggers = deriveTriggerLevels(snap, deriveSpxBias(snap));
    assert.equal(triggers.length, 3);
    assert.equal(triggers[0]!.line, "lose 7,528 → bias flips — puts window opens");
    assert.equal(triggers[1]!.line, "break 7,550 call wall → squeeze fuel above — press calls");
    assert.match(triggers[2]!.line, /= chop — scalp small or wait$/);
  });

  test("neutral → breakout / breakdown / stand down", () => {
    const snap = bearishSnap({ price: 7521, aboveVwap: true, emaStack: "bullish" });
    const bias = deriveSpxBias(snap);
    assert.equal(bias.direction, "neutral");
    const triggers = deriveTriggerLevels(snap, bias);
    assert.deepEqual(
      triggers.map((t) => t.line),
      [
        "above 7,550 call wall → breakout — calls window",
        "below 7,495 put wall → breakdown — puts window",
        "inside the walls = chop — stand down, let it pick a side",
      ]
    );
  });

  test("no price → no triggers", () => {
    const snap = mkSnap();
    assert.deepEqual(deriveTriggerLevels(snap, deriveSpxBias(snap)), []);
  });
});

// ---------------------------------------------------------------------------
// Transition events
// ---------------------------------------------------------------------------

describe("detectSpxVoiceEvents", () => {
  test("identical snapshots → zero events (nothing restated)", () => {
    const a = bearishSnap();
    assert.deepEqual(detectSpxVoiceEvents(a, bearishSnap()), []);
  });

  test("no previous snapshot → zero events (no fake initial burst)", () => {
    assert.deepEqual(detectSpxVoiceEvents(null, bearishSnap()), []);
  });

  test("γ-flip cross downward → SHORT GAMMA warning with implication", () => {
    const prev = bearishSnap({ price: 7530, aboveFlip: true });
    const next = bearishSnap({ price: 7526, aboveFlip: false });
    const events = detectSpxVoiceEvents(prev, next);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, "flip-cross");
    assert.equal(events[0]!.tone, "bear");
    assert.equal(
      events[0]!.line,
      "⚡ crossed γ-flip 7,528 downward — SHORT GAMMA now, dealers amplify moves → trade momentum, respect breaks"
    );
  });

  test("king call migration down → resistance stepped DOWN", () => {
    const prev = bearishSnap();
    const next = bearishSnap({
      kingCall: { strike: 7525, netGex: 3_400_000 },
      walls: [
        { strike: 7525, netGex: 3_400_000, kind: "resistance" },
        { strike: 7495, netGex: -2_800_000, kind: "support" },
      ],
    });
    const events = detectSpxVoiceEvents(prev, next);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, "king-migrate");
    assert.equal(events[0]!.tone, "bear");
    assert.equal(
      events[0]!.line,
      "⚑ king call 7,550→7,525 — resistance stepped DOWN → rallies capped sooner"
    );
  });

  test("king put stepping UP is bullish (dips bought sooner)", () => {
    const prev = bearishSnap();
    const next = bearishSnap({
      kingPut: { strike: 7505, netGex: -3_000_000 },
      walls: [
        { strike: 7550, netGex: 3_200_000, kind: "resistance" },
        { strike: 7505, netGex: -3_000_000, kind: "support" },
      ],
    });
    const events = detectSpxVoiceEvents(prev, next);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.tone, "bull");
    assert.match(events[0]!.line, /king put 7,495→7,505 — support stepped UP/);
  });

  test("wall building / fading lifecycle (≥35% |net_gex| change, matched by strike)", () => {
    const prev = bearishSnap({
      walls: [
        { strike: 7480, netGex: -1_000_000, kind: "support" },
        { strike: 7600, netGex: 2_000_000, kind: "resistance" },
      ],
      kingCall: null,
      kingPut: null,
    });
    const next = bearishSnap({
      walls: [
        { strike: 7480, netGex: -1_600_000, kind: "support" }, // +60% → building
        { strike: 7600, netGex: 1_100_000, kind: "resistance" }, // −45% → fading
      ],
      kingCall: null,
      kingPut: null,
    });
    const events = detectSpxVoiceEvents(prev, next);
    const lines = events.map((e) => e.line);
    assert.ok(lines.some((l) => l.startsWith("▲ 7,480P building fast")), lines.join(" | "));
    assert.ok(lines.some((l) => l.startsWith("▽ 7,600C fading — upside cap weakening")), lines.join(" | "));
  });

  test("small-node wall noise below the $ floor is ignored", () => {
    const prev = bearishSnap({ walls: [{ strike: 7470, netGex: -50_000, kind: "support" }], kingCall: null, kingPut: null });
    const next = bearishSnap({ walls: [{ strike: 7470, netGex: -120_000, kind: "support" }], kingCall: null, kingPut: null });
    assert.deepEqual(detectSpxVoiceEvents(prev, next), []);
  });

  test("VWAP reject prints once, on the transition only", () => {
    const prev = bearishSnap({ aboveVwap: true });
    const next = bearishSnap({ aboveVwap: false });
    const events = detectSpxVoiceEvents(prev, next);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.line, "⛔ lost VWAP 7,544 — sellers own the session average, pops are supply");
    // Steady state after the cross: nothing.
    assert.deepEqual(detectSpxVoiceEvents(next, bearishSnap({ aboveVwap: false })), []);
  });

  test("EMA stack flip fires on arrival, not on mixed", () => {
    const toMixed = detectSpxVoiceEvents(bearishSnap({ emaStack: "bullish" }), bearishSnap({ emaStack: "mixed" }));
    assert.deepEqual(toMixed, []);
    const toBear = detectSpxVoiceEvents(bearishSnap({ emaStack: "mixed" }), bearishSnap({ emaStack: "bearish" }));
    assert.equal(toBear.length, 1);
    assert.match(toBear[0]!.line, /^📉 20\/50 EMA stack flipped bearish/);
  });

  test("structure: new session low + prior-day-low break", () => {
    const prev = bearishSnap({ price: 7500, lod: 7498, pdl: 7496 });
    const next = bearishSnap({ price: 7494, lod: 7494, pdl: 7496 });
    const lines = detectSpxVoiceEvents(prev, next).map((e) => e.line);
    assert.ok(lines.some((l) => l.startsWith("▼ new session low 7,494")), lines.join(" | "));
    assert.ok(lines.some((l) => l.startsWith("🚨 broke prior-day low 7,496")), lines.join(" | "));
  });

  test("expected-move −1σ tag is regime-aware", () => {
    const band = { low: 7503, high: 7590 };
    const posGamma = detectSpxVoiceEvents(
      bearishSnap({ price: 7506, expMove: band, aboveFlip: true }),
      bearishSnap({ price: 7502, expMove: band, aboveFlip: true })
    );
    assert.equal(posGamma.length, 1);
    assert.equal(
      posGamma[0]!.line,
      "🎯 at −1σ (7,503) — edge of the expected move in positive gamma → mean-reversion zone"
    );
    const negGamma = detectSpxVoiceEvents(
      bearishSnap({ price: 7506, expMove: band }),
      bearishSnap({ price: 7502, expMove: band })
    );
    assert.match(negGamma[0]!.line, /short gamma can break the band → don't knife-catch/);
  });

  test("RSI extreme entered/exited (transition only)", () => {
    const enter = detectSpxVoiceEvents(bearishSnap({ rsi: 28 }), bearishSnap({ rsi: 26 }));
    assert.deepEqual(enter, []); // already oversold — no re-print
    const cross = detectSpxVoiceEvents(bearishSnap({ rsi: 34 }), bearishSnap({ rsi: 29 }));
    assert.equal(cross.length, 1);
    assert.match(cross[0]!.line, /RSI 29 — oversold zone entered/);
    const exit = detectSpxVoiceEvents(bearishSnap({ rsi: 29 }), bearishSnap({ rsi: 33 }));
    assert.match(exit[0]!.line, /oversold pressure released/);
  });

  test("data-health transitions print stale + recovery once", () => {
    const stale = detectSpxVoiceEvents(bearishSnap(), bearishSnap({ gexStale: true }));
    assert.equal(stale.length, 1);
    assert.match(stale[0]!.line, /dealer positioning went stale/);
    const back = detectSpxVoiceEvents(bearishSnap({ gexStale: true }), bearishSnap());
    assert.match(back[0]!.line, /positioning refreshed/);
  });

  test("burst is capped at 5 events, priority order preserved", () => {
    const prev = bearishSnap({
      aboveFlip: true,
      aboveVwap: true,
      emaStack: "bullish",
      regime: "bullish",
      tideBias: "bullish",
      vix: 18,
      hod: 7560,
      lod: 7500,
      price: 7530,
    });
    const next = bearishSnap({
      aboveFlip: false,
      aboveVwap: false,
      emaStack: "bearish",
      regime: "bearish",
      tideBias: "bearish",
      vix: 21,
      hod: 7560,
      lod: 7490,
      price: 7492,
      kingCall: { strike: 7525, netGex: 3_000_000 },
      kingPut: { strike: 7475, netGex: -2_500_000 },
      walls: [
        { strike: 7525, netGex: 3_000_000, kind: "resistance" },
        { strike: 7475, netGex: -2_500_000, kind: "support" },
      ],
    });
    const events = detectSpxVoiceEvents(prev, next);
    assert.equal(events.length, 5);
    assert.equal(events[0]!.kind, "flip-cross"); // highest priority leads the burst
  });
});

// ---------------------------------------------------------------------------
// Dedupe discipline
// ---------------------------------------------------------------------------

describe("filterFreshVoiceEvents", () => {
  const ev = (key: string, at: number) => ({
    key,
    kind: "vwap-cross" as const,
    tone: "bear" as const,
    line: "x",
    at,
  });

  test("same key within cooldown is suppressed; re-emits after cooldown", () => {
    const t0 = 1_000_000;
    const first = filterFreshVoiceEvents([ev("k", t0)], {}, t0, 60_000);
    assert.equal(first.fresh.length, 1);
    const second = filterFreshVoiceEvents([ev("k", t0 + 30_000)], first.seen, t0 + 30_000, 60_000);
    assert.equal(second.fresh.length, 0);
    const third = filterFreshVoiceEvents([ev("k", t0 + 61_000)], second.seen, t0 + 61_000, 60_000);
    assert.equal(third.fresh.length, 1);
  });

  test("distinct keys pass through together and seen-map prunes stale entries", () => {
    const t0 = 1_000_000;
    const res = filterFreshVoiceEvents([ev("a", t0), ev("b", t0)], { old: t0 - 10_000_000 }, t0, 60_000);
    assert.equal(res.fresh.length, 2);
    assert.ok(!("old" in res.seen), "ancient keys pruned");
  });
});

// ---------------------------------------------------------------------------
// Play lifecycle
// ---------------------------------------------------------------------------

describe("detectPlayVoiceEvents", () => {
  const at = 1_800_000_000_000;

  test("armed → fired → closed, one line each", () => {
    const armed = detectPlayVoiceEvents({ action: "SCANNING", direction: null, open_play: null }, { action: "BUY", direction: "short", open_play: null }, at);
    assert.equal(armed.length, 1);
    assert.equal(armed[0]!.line, "🎯 play ARMED — SHORT setup triggered, engine wants the entry");

    const fired = detectPlayVoiceEvents(
      { action: "BUY", direction: "short", open_play: null },
      { action: "HOLD", direction: "short", open_play: { direction: "short", entry_price: 7512, stop: 7530, target: 7480 } },
      at
    );
    assert.equal(fired.length, 1);
    assert.equal(fired[0]!.line, "🔫 play FIRED — SHORT from 7,512, stop 7,530, target 7,480");
    assert.equal(fired[0]!.tone, "bear");

    const closed = detectPlayVoiceEvents(
      { action: "HOLD", direction: "short", open_play: { direction: "short", entry_price: 7512, stop: 7530, target: 7480 } },
      { action: "SCANNING", direction: null, open_play: null },
      at
    );
    assert.equal(closed.length, 1);
    assert.equal(closed[0]!.line, "🏁 play CLOSED — SHORT from 7,512 is done, back to scanning");
  });

  test("steady states emit nothing", () => {
    const open = { action: "HOLD", direction: "long" as const, open_play: { direction: "long" as const, entry_price: 7500, stop: 7490, target: 7530 } };
    assert.deepEqual(detectPlayVoiceEvents(open, open, at), []);
    assert.deepEqual(detectPlayVoiceEvents(null, { action: "SCANNING", direction: null, open_play: null }, at), []);
  });
});

// ---------------------------------------------------------------------------
// Snapshot extraction from the desk payload
// ---------------------------------------------------------------------------

describe("voiceSnapshotFromDesk", () => {
  test("kings = argmax |net_gex| per side; EMA stack + expected move derived", () => {
    const desk = {
      available: true,
      price: 7512.3,
      vwap: 7544.2,
      gamma_flip: 7528,
      ema20: 7520.1,
      ema50: 7535.4,
      prior_close: 7540,
      vix: 16,
      regime: "bearish",
      gex_walls: [
        { strike: 7550, net_gex: 3_200_000, kind: "resistance", distance_pts: 37.7 },
        { strike: 7560, net_gex: 900_000, kind: "resistance", distance_pts: 47.7 },
        { strike: 7495, net_gex: -2_800_000, kind: "support", distance_pts: -17.3 },
        { strike: 7480, net_gex: -1_000_000, kind: "support", distance_pts: -32.3 },
      ],
      news_headlines: [{ title: "Fed speaker at 2pm", published: "", tickers: [] }],
      polled_at: "2026-07-13T14:30:00.000Z",
    } as unknown as SpxDeskPayload;

    const snap = voiceSnapshotFromDesk(desk);
    assert.equal(snap.kingCall?.strike, 7550);
    assert.equal(snap.kingPut?.strike, 7495);
    assert.equal(snap.aboveFlip, false);
    assert.equal(snap.aboveVwap, false);
    assert.equal(snap.emaStack, "bearish");
    // 1σ = 7540 · 0.16 / √252 ≈ 75.99 → band [7464, 7616]
    assert.equal(snap.expMove?.low, 7464);
    assert.equal(snap.expMove?.high, 7616);
    assert.deepEqual(snap.newsTitles, ["Fed speaker at 2pm"]);
    assert.equal(snap.at, Date.parse("2026-07-13T14:30:00.000Z"));
  });

  test("missing inputs degrade to null — never fabricated", () => {
    const snap = voiceSnapshotFromDesk({ available: true, price: 7500 } as unknown as SpxDeskPayload, { at: 1 });
    assert.equal(snap.vwap, null);
    assert.equal(snap.aboveVwap, null);
    assert.equal(snap.emaStack, null);
    assert.equal(snap.expMove, null);
    assert.equal(snap.kingCall, null);
  });
});
