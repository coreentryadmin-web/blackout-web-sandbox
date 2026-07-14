import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  splitCompoundQuestion,
  isCompoundQuestion,
  synthesizeCompoundAnswer,
  labelForSubQuestion,
  MAX_SUB_QUESTIONS,
  type CompoundPart,
} from "@/lib/bie/decompose";

// The exact probe strings from scratchpad/compound-probe.mjs.
const Q15 =
  "Answer ALL of these: (1) What is the SPX gamma flip on 0DTE? (2) Where is SPY's top call wall this week? " +
  "(3) What regime is NVDA in? (4) What is max pain? (5) What is VEX? (6) Give me QQQ 15m technicals — VWAP and RSI. " +
  "(7) Compare SPY vs QQQ — which is more bullish? (8) What does Night Hawk do? (9) Why might MSFT's beads not be forming on the map? " +
  "(10) What is the market regime right now? (11) What are the hottest tickers by flow? (12) What is a King node? " +
  "(13) What is the SPX gamma flip on the monthly horizon? (14) What is a dark pool level? (15) What tools does BlackOut have?";
const QTERSE = "GEX? VEX? max pain? king node? SPX 0DTE flip? SPY regime? NVDA flip? what is Helix? what is Thermal?";
const QRUN =
  "I'm trying to understand the whole picture right now — where's SPX pinned and is it long or short gamma, " +
  "what's the biggest call wall on SPY and the put wall on QQQ, is NVDA above or below its flip, remind me what a gamma magnet is " +
  "and what max pain means, tell me if the flow tape is healthy or stale, which names are hottest, and honestly if you can't get " +
  "data for any of these just say so.";

describe("splitCompoundQuestion — detectors", () => {
  test("numbered list (1)…(15) → 15 sub-questions", () => {
    const parts = splitCompoundQuestion(Q15);
    assert.equal(parts.length, 15);
    assert.match(parts[0]!, /SPX gamma flip on 0DTE/);
    assert.match(parts[14]!, /What tools does BlackOut have/);
    assert.ok(!parts[0]!.startsWith("Answer ALL"), "preamble before (1) is dropped");
  });

  test("terse '?' barrage → one sub-question per '?'", () => {
    const parts = splitCompoundQuestion(QTERSE);
    assert.equal(parts.length, 9);
    assert.deepEqual(parts.slice(0, 3), ["GEX", "VEX", "max pain"]);
    assert.match(parts[8]!, /what is Thermal/);
  });

  test("long run-on with commas/and → ≥3 sub-questions", () => {
    const parts = splitCompoundQuestion(QRUN);
    assert.ok(parts.length >= 6, `expected several run-on clauses, got ${parts.length}`);
    assert.ok(parts.some((p) => /SPX pinned/i.test(p)));
    assert.ok(parts.some((p) => /call wall on SPY/i.test(p)));
  });

  test("caps at MAX_SUB_QUESTIONS", () => {
    const many = Array.from({ length: 40 }, (_, i) => `(${i + 1}) q${i + 1}?`).join(" ");
    assert.ok(splitCompoundQuestion(many).length <= MAX_SUB_QUESTIONS);
  });
});

describe("splitCompoundQuestion — SINGLE-question no-regression gate (critical)", () => {
  test("a plain single question returns [itself] — never split", () => {
    for (const q of [
      "What is the SPX gamma flip?",
      "Where is SPY's call wall right now",
      "Compare SPY and QQQ — which is more bullish?",
      "What is GEX?",
      "Pull /api/market/gex-positioning?ticker=SPY",
      "Should I hold my NVDA play into the close?",
      "what's going on with AAPL",
    ]) {
      const parts = splitCompoundQuestion(q);
      assert.equal(parts.length, 1, `"${q}" must NOT be treated as compound (got ${parts.length})`);
      assert.equal(isCompoundQuestion(q), false);
    }
  });

  test("a short two-clause 'and' comparison is NOT over-split (length gate)", () => {
    // "compare SPY and QQQ" is one comparison, not two questions.
    assert.equal(isCompoundQuestion("compare SPY and QQQ which is more bullish"), false);
  });
});

describe("synthesizeCompoundAnswer — labeled, honest, never dropped", () => {
  function part(o: Partial<CompoundPart> & { index: number }): CompoundPart {
    return { label: `q${o.index}`, ok: true, text: "answer", intent: "vector_read", ms: 10, ...o };
  }

  test("labels every part; unavailable parts are shown, not dropped", () => {
    const parts: CompoundPart[] = [
      part({ index: 1, label: "SPX 0DTE flip", text: "SPX flip 7,520", ok: true }),
      part({ index: 2, label: "MSFT beads", ok: false, text: "unavailable — timed out", intent: "vector_read" }),
      part({ index: 3, label: "What is GEX", text: "GEX is dealer gamma…", ok: true, intent: "concept_read" }),
    ];
    const out = synthesizeCompoundAnswer(parts);
    assert.match(out, /Answering 3 parts \(2 with live data, 1 unavailable\)/);
    assert.match(out, /\*\*1\) SPX 0DTE flip:\*\*\nSPX flip 7,520/);
    assert.match(out, /\*\*2\) MSFT beads:\*\* unavailable — timed out/);
    assert.match(out, /\*\*3\) What is GEX:\*\*/);
    // The timed-out part is present and honest — NOT fabricated, NOT dropped.
    assert.ok(out.includes("unavailable — timed out"));
  });

  test("header reflects all-answered when nothing is unavailable", () => {
    const out = synthesizeCompoundAnswer([part({ index: 1 }), part({ index: 2 })]);
    assert.match(out, /Answering 2 parts \(2 with live data\):/);
    assert.ok(!out.includes("unavailable"));
  });
});

describe("labelForSubQuestion", () => {
  test("truncates long sub-questions", () => {
    const long = "x".repeat(200);
    assert.ok(labelForSubQuestion(long).length <= 72);
    assert.ok(labelForSubQuestion(long).endsWith("…"));
  });
});

// ── PR-L4e-2 / scenario-routing (coordinator's highest-priority deployed bug): a coherent scenario
// what-if FRAMED as a hypothetical must route WHOLE to the scenario engine, never be run-on-split
// into fragments whose sub-intents can't reassemble the shift + trigger (deployed: 3/3 unavailable).
describe("splitCompoundQuestion — coherent-scenario guard (PR-L4e-2)", () => {
  // The exact deployed gauntlet question the scenario engine (#340) never reached.
  const SCENARIO_Q =
    "If SPX drops 1% at tomorrow's open, what happens to the dealer positioning picture — does the " +
    "regime flip, and which walls become live?";

  test("the deployed gauntlet scenario is NOT decomposed — it routes as ONE unit", () => {
    assert.deepEqual(splitCompoundQuestion(SCENARIO_Q), [SCENARIO_Q]);
    assert.equal(isCompoundQuestion(SCENARIO_Q), false);
  });

  test("scenario-framed variants (leading hypothetical + shift + sub-clauses) stay whole", () => {
    const wholes = [
      "What happens if SPY breaks 745 at the open, does the regime flip, and which walls become live?",
      "Suppose NVDA falls 3% tomorrow — does its flip give way, and do the call walls become magnets?",
      "If we lose the flip, does the regime turn negative, and which dealer walls come alive?",
    ];
    for (const q of wholes) {
      assert.equal(isCompoundQuestion(q), false, `must stay whole: ${q}`);
    }
  });

  test("a genuine multi-topic run-on with a BURIED throwaway 'if' still decomposes (no over-suppression)", () => {
    // The exact regression risk: a 15-topic run-on ending "…just say so if you can't get data" both
    // trips SCENARIO_TRIGGER_RE ('if') and parseShift ('above or below its flip'), yet is NOT framed
    // as a scenario (the trigger is late) — it must still split.
    const QRUN =
      "I'm trying to understand the whole picture right now — where's SPX pinned and is it long or short gamma, " +
      "what's the biggest call wall on SPY and the put wall on QQQ, is NVDA above or below its flip, remind me what a gamma magnet is " +
      "and what max pain means, tell me if the flow tape is healthy or stale, which names are hottest, and honestly if you can't get " +
      "data for any of these just say so.";
    assert.ok(splitCompoundQuestion(QRUN).length >= 3, "buried-if run-on must still split");
  });
});
