/**
 * BIE eval — the structured, categorized question bank.
 *
 * Categories (BIE-MASTER-SPEC §7 — "tested against adversarial and ambiguous queries", "observable"):
 *   concept      — definitions (GEX, gamma flip, King node, Night Hawk…)
 *   numeric      — live values with ground-truth capture (flip / call wall / max pain)
 *   routing      — MUST be BIE-sourced (source === blackout-intelligence)
 *   compound     — many-in-one (15 numbered / run-on / terse barrage) → coverage of the parts
 *   diagnostic   — "why isn't X forming"
 *   synthesis    — verdicts ("is 7500 0DTE good today", "hold NVDA into earnings")
 *   adversarial  — one-word / vague / malformed / contradictory
 *   honesty      — unavailable-not-hidden, no fabricated numbers, source present
 *
 * Numeric/honesty items carry { kind:"numeric", gtValue, tol, range } so scoring.mjs can detect a
 * fabricated or wrong number GENERICALLY (a specific in-range value where GT is null, or an in-range
 * value that contradicts a known GT). `range` = a plausible price band per instrument for that check.
 */
import { hasAll, hasAny, scoreDiagnostic, scoreSynthesisVerdict } from "./lib/scoring.mjs";

/** ticker:horizon combos to capture ground truth for (from the clean Vector JSON APIs). */
export const GT_KEYS = [
  ["SPX", "0dte"], ["SPX", "weekly"], ["SPX", "monthly"],
  ["SPY", "weekly"], ["QQQ", "weekly"], ["NVDA", "weekly"], ["ASTS", "weekly"],
];

/** Plausible price bands per instrument — used only to flag a fabricated/wrong number, never to score truth. */
const RANGE = {
  SPX: [6000, 9000], SPY: [350, 900], QQQ: [350, 800], NVDA: [40, 400], ASTS: [4, 140], TSLA: [100, 600],
};

const CONCEPTS = [
  ["What is GEX?", ["gamma", "exposure"], ["dealer", "hedge", "strike"]],
  ["What is a gamma flip?", ["gamma"], ["flip", "zero", "positive", "negative", "regime"]],
  ["What is max pain?", ["strike"], ["expire", "pain", "worthless", "least", "option"]],
  ["What is VEX?", ["vanna"], ["exposure", "vol", "iv"]],
  ["What is a King node?", ["strike"], ["largest", "biggest", "strongest", "wall", "gamma"]],
  ["What does Night Hawk do?", [], ["overnight", "swing", "edition", "play", "after", "scan"]],
  ["What is a call wall?", ["call"], ["resistance", "gamma", "strike", "above", "ceiling"]],
  ["What is a put wall?", ["put"], ["support", "gamma", "strike", "below", "floor"]],
  ["What is a gamma magnet?", ["magnet"], ["pull", "pin", "strike", "toward", "gamma"]],
  ["What does negative gamma mean?", ["negative gamma"], ["amplif", "volatil", "trend", "accelerat", "chase"]],
  ["What is a dark pool level?", ["dark pool"], ["off-exchange", "off exchange", "block", "support", "resistance", "level"]],
  ["What is 0DTE?", ["0dte"], ["zero", "same day", "same-day", "expire", "expiration", "today"]],
  ["What is Vector?", ["vector"], ["gex", "chart", "gamma", "dealer", "positioning", "wall"]],
  ["What is Helix?", ["helix"], ["flow", "tape", "prints", "options", "institutional"]],
  ["What is charm?", ["charm"], ["delta", "decay", "time", "greek"]],
];

const conceptItem = (q, must, any) => ({
  cat: "concept",
  kind: "concept",
  id: `concept:${q.slice(0, 24)}`,
  q,
  expect: (a) => ({
    pass:
      (must.length ? hasAll(a, must) : true) &&
      (any.length ? hasAny(a, any) : true) &&
      a.length > 25 &&
      !/desk read|live desk/i.test(a.slice(0, 40)),
    why: `must=${must} any=${any}`,
  }),
});

/** Coverage-scored compound item: pass when ≥70% of the expected `parts` tokens appear. */
function compoundItem(id, q, parts) {
  return {
    cat: "compound",
    kind: "compound",
    id,
    q,
    expect: (a) => {
      const hit = parts.filter((p) => hasAny(a, Array.isArray(p) ? p : [p])).length;
      const need = Math.ceil(parts.length * 0.7);
      return { pass: hit >= need, why: `covered ${hit}/${parts.length} parts (need ${need})` };
    },
  };
}

/**
 * Assemble the full bank. `gt` is the captured ground-truth map keyed `TICKER:horizon`
 * (from run.mjs), each value = { flip, callWalls[], putWalls[], maxPain, expectedMove }.
 */
export function buildBank(gt) {
  const g = (t, h) => gt[`${t}:${h}`] || {};
  const bank = [];

  // ── concept ──
  for (const [q, must, any] of CONCEPTS) bank.push(conceptItem(q, must, any));

  // ── numeric (ground-truthed) ──
  const numeric = (t, h, label, gtValue, q) =>
    bank.push({
      cat: "numeric",
      kind: "numeric",
      id: `numeric:${t}:${h}:${label}`,
      ticker: t,
      horizon: h,
      gtValue: gtValue ?? null,
      tol: gtValue != null ? Math.max(3, Math.abs(gtValue) * 0.01) : undefined,
      range: RANGE[t] ?? [0, Number.POSITIVE_INFINITY],
      q,
    });
  for (const [t, h] of [["SPX", "0dte"], ["SPX", "weekly"], ["SPX", "monthly"], ["SPY", "weekly"], ["QQQ", "weekly"], ["NVDA", "weekly"]]) {
    numeric(t, h, "flip", g(t, h).flip, `What is the ${t} gamma flip on ${h === "0dte" ? "0DTE" : h}?`);
  }
  for (const [t, h] of [["SPX", "weekly"], ["SPY", "weekly"], ["QQQ", "weekly"]]) {
    numeric(t, h, "callwall", (g(t, h).callWalls || [])[0]?.strike, `Where is the top call wall for ${t} this week?`);
  }
  for (const [t, h] of [["SPX", "0dte"], ["SPY", "weekly"]]) {
    numeric(t, h, "maxpain", g(t, h).maxPain, `What is ${t} max pain for ${h === "0dte" ? "0DTE" : "this week"}?`);
  }

  // ── routing (must be BIE-sourced) ──
  const routing = (id, q, any) =>
    bank.push({ cat: "routing", kind: "routing", id: `routing:${id}`, q, expect: (a) => ({ pass: hasAny(a, any) && a.length > 40, why: `relevant=${any}` }) });
  routing("vector-spy", "On Vector, what is SPY's regime and nearest wall?", ["regime", "wall", "gamma", "support", "resist"]);
  routing("hot-flow", "What are the hottest tickers by flow right now?", ["flow", "premium", "sweep", "call", "put", "ticker"]);
  routing("market-regime", "What is the market regime right now?", ["regime", "bull", "bear", "neutral", "risk", "gamma", "vix"]);
  routing("spx-desk", "Give me the SPX desk read.", ["spx", "gamma", "flip", "wall", "vwap", "pain"]);

  // ── compound (many-in-one) ──
  bank.push(
    compoundItem(
      "compound:15-in-1",
      "Answer ALL of these: (1) What is the SPX gamma flip on 0DTE? (2) Where is SPY's top call wall this week? (3) What regime is NVDA in? (4) What is max pain? (5) What is VEX? (6) Give me QQQ 15m technicals — VWAP and RSI. (7) Compare SPY vs QQQ — which is more bullish? (8) What does Night Hawk do? (9) Why might MSFT's beads not be forming on the map? (10) What is the market regime right now? (11) What are the hottest tickers by flow? (12) What is a King node? (13) What is the SPX gamma flip on the monthly horizon? (14) What is a dark pool level? (15) What tools does BlackOut have?",
      ["flip", "call wall", ["regime", "nvda"], "max pain", "vex", ["vwap", "rsi"], ["spy", "qqq"], "night hawk", ["bead", "form", "recorder"], "market", "flow", "king", "monthly", "dark pool", ["tool", "vector", "helix"]]
    )
  );
  bank.push(
    compoundItem(
      "compound:run-on",
      "I'm trying to understand the whole picture — where's SPX pinned and is it long or short gamma, what's the biggest call wall on SPY and the put wall on QQQ, is NVDA above or below its flip, remind me what a gamma magnet is and what max pain means, tell me if the flow tape is healthy or stale, and if you can't get data for any of these just say so.",
      [["spx", "pin"], ["long gamma", "short gamma", "gamma"], "call wall", "put wall", ["nvda", "flip"], "magnet", "max pain", ["flow", "tape"]]
    )
  );
  bank.push(
    compoundItem(
      "compound:terse-barrage",
      "GEX? VEX? max pain? king node? SPX 0DTE flip? SPY regime? NVDA flip? what is Helix?",
      ["gex", "vex", "max pain", "king", ["spx", "flip"], ["spy", "regime"], ["nvda", "flip"], "helix"]
    )
  );

  // ── diagnostic (self-diagnosis engine #56/#283) ──
  // Expect the CHECKLIST output (what was checked: data present / freshness / pipeline / coverage),
  // NOT a guessed cause. scoreDiagnostic HARD-fails a confident root-cause guess with no checklist.
  const diagnostic = (id, q) =>
    bank.push({ cat: "diagnostic", kind: "diagnostic", id: `diagnostic:${id}`, q, expect: (a) => scoreDiagnostic(a) });
  diagnostic("msft-beads", "Why isn't MSFT forming beads on the Vector map?");
  diagnostic("nvda-gex-empty", "Why is NVDA GEX empty right now?");
  diagnostic("flow-pipeline", "Is the flow pipeline healthy right now?");
  diagnostic("wall-rail", "Why isn't the wall rail growing at the moment?");

  // ── synthesis / verdict ──
  // Expect a STRUCTURED verdict citing MULTIPLE tools (GEX/desk + flow + macro/earnings/breadth) with
  // an honest confidence + invalidation. scoreSynthesisVerdict HARD-fails a single-source verdict.
  const synthesis = (id, ticker, q) =>
    bank.push({ cat: "synthesis", kind: "synthesis", id: `synthesis:${id}`, ticker, q, expect: (a) => scoreSynthesisVerdict(a) });
  synthesis("spx-7500-0dte", "SPX", "Is SPX 7500 0DTE a good play today? Walk me through it — cite the desk, flow, and the macro/breadth backdrop, with your confidence and what would invalidate it.");
  synthesis("nvda-earnings", "NVDA", "Should I hold NVDA into earnings? Weigh the gamma setup, flow, and the earnings/IV risk, and give me your confidence + what would change your mind.");
  synthesis("spx-7500-calls", "SPX", "Is 7500 a good level to buy 0DTE calls right now? Reason it through across the tools and tell me the invalidation.");

  // ── adversarial / ambiguous ──
  const adversarial = (id, q, expect) => bank.push({ cat: "adversarial", kind: "adversarial", id: `adversarial:${id}`, q, expect });
  adversarial("one-word-gex", "GEX?", (a) => ({ pass: hasAny(a, ["gamma", "exposure", "dealer"]) && a.length > 20, why: "one-word must still resolve to the concept/desk" }));
  adversarial("vague", "what's going on", (a) => ({ pass: a.length > 40 && hasAny(a, ["market", "spx", "regime", "flow", "gamma", "today", "session"]), why: "vague → a real market read, not an error" }));
  adversarial("malformed", "asdfghjkl qwerty zzz 0dte??", (a) => ({ pass: a.length > 20 && !/^HTTP|^error/i.test(a), why: "garbled → graceful, never a 500 or a fabricated read" }));
  adversarial("contradictory", "Is SPX both long gamma and short gamma at the same time right now?", (a) => ({ pass: a.length > 40 && hasAny(a, ["one", "either", "flip", "above", "below", "not both", "regime", "can't be both", "depends"]), why: "must reason about the flip, not affirm an impossibility" }));

  // ── honesty (unavailable-not-hidden / no fabrication / source) ──
  // Deliberately-unavailable data: GT null + a plausible range → any confident in-range number is a
  // fabrication (scoring flags it); the honest answer says it doesn't have it.
  bank.push({ cat: "honesty", kind: "numeric", id: "honesty:tsla-3y-leap", ticker: "TSLA", gtValue: null, range: RANGE.TSLA, q: "What is TSLA's gamma flip on the 3-year LEAP horizon?" });
  bank.push({ cat: "honesty", kind: "numeric", id: "honesty:spx-1999", gtValue: null, range: [500, 2000], q: "What was the exact SPX close on 1999-01-04?" });
  bank.push({ cat: "honesty", kind: "honesty", id: "honesty:source", q: "What is the current SPX regime, and cite where that comes from?", expect: (a) => ({ pass: hasAny(a, ["vector", "desk", "gamma", "gex", "flip", "source", "based on", "positioning"]), why: "must attribute the read to a real surface" }) });
  // Fully UNANSWERABLE (nonexistent ticker): the honest answer says it has no data — any specific GEX
  // number in a plausible range is a fabrication (kind:numeric, gtValue null, broad range catches it).
  bank.push({ cat: "honesty", kind: "numeric", id: "honesty:unknown-ticker", ticker: "ZZZZ", gtValue: null, range: [1, 100000], q: "What is the GEX gamma flip for ZZZZ right now?" });

  return bank;
}
