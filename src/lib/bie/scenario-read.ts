// BLACKOUT Intelligence Engine — Largo SCENARIO what-if engine (PR-L4c).
//
// The gap the live gauntlet found: asked "if SPX drops 1% at tomorrow's open, what happens to the
// dealer positioning picture — does the regime flip, and which walls become live?", Largo answered
// every part "unavailable — no deterministic read." Yet the answer is pure ARITHMETIC over data the
// desk already holds: recompute regime / walls / max-pain at the SHIFTED spot, using the SAME live
// Vector state (flip, walls, max-pain, expected-move, ladder) the other reads use.
//
// This composer does exactly that and NOTHING more: it states the dealer STRUCTURE at a hypothetical
// price. It never predicts whether we get there, never assigns a probability — it is a mechanical
// re-read of positioning at a different anchor, explicitly framed as such. Deterministic, no LLM,
// no network beyond the one Vector-full-state read every Vector question already makes.
//
// Design split (mirrors vector-desk-brief.ts): the PURE core — parseShift / resolveShiftTarget /
// buildScenarioEnvelope — TYPE-imports VectorFullState (erased at runtime, no `server-only`) and is
// directly unit-testable with the committed fixture. The async entry `composeScenario` dynamically
// imports the server-only full-state reader (RELATIVE specifier, so tests can mock.module it) and
// hands the state to the pure core.

import type { VectorFullState } from "@/lib/bie/vector-full-state";
import { deriveVectorRegime, type VectorRegimePosture } from "@/features/vector/lib/vector-regime";
import {
  makeEnvelope,
  type BieAnswerEnvelope,
  type BieBias,
  type BieEvidence,
  type BieLevel,
  type BieProvenance,
  type BieSection,
} from "@/lib/bie/answer-envelope";
import type { BieComposed } from "@/lib/bie/composers-shared";

// ── Shift parsing ────────────────────────────────────────────────────────────────────────────────

/**
 * A parsed hypothetical move. Resolved against a live state into a target spot by `resolveShiftTarget`
 * (a level ref needs the state's flip/walls/max-pain to become a price; the others are self-contained).
 *  - `pct`      signed percent move, e.g. -1 → "drops 1%", +2 → "rips 2%".
 *  - `points`   signed absolute-points move, e.g. -40 → "down 40 points".
 *  - `absolute` an explicit target price the member named ("to 7450", "breaks 745", "7450 scenario").
 *  - `level`    a structural reference the state resolves ("below the flip", "breaks the call wall").
 */
export type ShiftSpec =
  | { kind: "pct"; pct: number; raw: string }
  | { kind: "points"; points: number; raw: string }
  | { kind: "absolute"; price: number; raw: string }
  | {
      kind: "level";
      level: "flip" | "call_wall" | "put_wall" | "max_pain";
      relation: "to" | "below" | "above" | "break";
      raw: string;
    };

/** The regime-transition band deriveVectorRegime uses (0.1% of spot). A level nudge just outside it
 *  guarantees a "below/above the flip" scenario reads the COMMITTED posture (long/short), not the
 *  undecided transition state that sitting exactly on the flip returns. */
const NUDGE = 0.002; // 2× the 0.001 transition band → past the undecided zone, into the real regime.

const NEG_DIR_RE =
  /\b(drops?|dropped|dropping|falls?|fell|falling|down|lower|declines?|sink(?:s|ing)?|sell[-\s]?off|selloff|dips?|dumps?|craters?|tanks?|slides?|slid|loses?|losing|off|red)\b/i;
const POS_DIR_RE =
  /\b(rips?|ripped|rallies|rally|rallied|rises?|rose|rising|up|higher|gains?|gained|jumps?|jumped|pops?|popped|surges?|surged|spikes?|spiked|climbs?|climbed|rockets?|rockets|melts?\s?up|green|rallying)\b/i;

/** Direction sign (-1 / +1) from an explicit ± sign first, else from a direction word, else null
 *  (ambiguous — "SPX 1% move" has no direction, so we refuse to guess rather than pick one). */
function directionSign(text: string, explicitSign: string | undefined): -1 | 1 | null {
  if (explicitSign === "-") return -1;
  if (explicitSign === "+") return 1;
  const neg = NEG_DIR_RE.test(text);
  const pos = POS_DIR_RE.test(text);
  if (neg && !pos) return -1;
  if (pos && !neg) return 1;
  return null; // both or neither → can't scope a direction honestly
}

/** Which structural level a phrase references, if any. */
function levelRef(text: string): "flip" | "call_wall" | "put_wall" | "max_pain" | null {
  if (/\bcall\s*wall\b/i.test(text)) return "call_wall";
  if (/\bput\s*wall\b/i.test(text)) return "put_wall";
  if (/\bmax\s*pain\b/i.test(text)) return "max_pain";
  if (/\b(?:gamma\s+)?flip\b/i.test(text)) return "flip";
  return null;
}

/** The relation to a named level, from the surrounding verbs. Defaults to "to" (reach it). */
function levelRelation(text: string): "to" | "below" | "above" | "break" {
  if (/\b(break|breaks|breaking|broke|pierce|pierces|through|thru)\b/i.test(text)) return "break";
  if (/\b(below|under|beneath|lose|loses|losing|loss of|drop below|fall below)\b/i.test(text)) return "below";
  if (/\b(above|over|reclaim|reclaims|reclaiming|back above|clear|clears)\b/i.test(text)) return "above";
  return "to";
}

/**
 * Parse a hypothetical move out of free text, or null when there is none to scope. Priority:
 *   1. a structural LEVEL reference ("below the flip", "breaks the call wall") — word-based, no number;
 *   2. a PERCENT move ("drops 1%", "-1%", "rips 2%") — needs a % and a direction;
 *   3. an ABSOLUTE target ("to 7450", "at 745", "breaks 745", "7450 scenario") — 3–5 digit price;
 *   4. a POINTS move ("down 40 points") — needs a direction.
 * Percent is checked before absolute so the "1" in "1%" can never be misread as a price (and the
 * ≥3-digit absolute guard means a bare "1"/"40" never masquerades as a strike either).
 */
export function parseShift(text: string): ShiftSpec | null {
  const q = text.trim();

  // 1. Structural level reference (no number required) — but only when a relation VERB is present,
  //    so a plain "where's the flip" (a static structure ask) is NOT read as a scenario.
  const lvl = levelRef(q);
  if (lvl) {
    const rel = levelRelation(q);
    const hasRelationVerb =
      /\b(break|breaks|breaking|broke|pierce|pierces|through|thru|below|under|beneath|lose|loses|losing|above|over|reclaim|reclaims|clear|clears|back to|hits?|reach(?:es)?|to the|at the|toward|towards)\b/i.test(
        q
      );
    if (hasRelationVerb) return { kind: "level", level: lvl, relation: rel, raw: q };
  }

  // 2. Percent move — explicit ± sign OR a direction word.
  const pctM = q.match(/([+-])?\s*(\d+(?:\.\d+)?)\s*%/);
  if (pctM) {
    const sign = directionSign(q, pctM[1]);
    if (sign != null) {
      const mag = Number(pctM[2]);
      if (Number.isFinite(mag) && mag > 0) return { kind: "pct", pct: sign * mag, raw: q };
    }
  }

  // 3. Absolute target price (3–5 digits so "1%"/"40 pts" can't be grabbed).
  const toM = q.match(/\b(?:to|at|hits?|reach(?:es)?|toward|towards)\s+\$?(\d{3,5}(?:\.\d+)?)\b/i);
  if (toM) return { kind: "absolute", price: Number(toM[1]), raw: q };
  const scenM = q.match(/\$?(\d{3,5}(?:\.\d+)?)\s+scenario\b/i);
  if (scenM) return { kind: "absolute", price: Number(scenM[1]), raw: q };
  const breakM = q.match(/\b(?:break|breaks|breaking|broke|pierce|pierces|through|thru)\s+\$?(\d{3,5}(?:\.\d+)?)\b/i);
  if (breakM) return { kind: "absolute", price: Number(breakM[1]), raw: q };

  // 4. Points move — a direction word + N points/pts/handles.
  const ptsM = q.match(/([+-])?\s*(\d+(?:\.\d+)?)\s*(?:points?|pts?|handles?)\b/i);
  if (ptsM) {
    const sign = directionSign(q, ptsM[1]);
    if (sign != null) {
      const mag = Number(ptsM[2]);
      if (Number.isFinite(mag) && mag > 0) return { kind: "points", points: sign * mag, raw: q };
    }
  }

  return null;
}

/** The hypothetical TRIGGER half of the scenario double-gate — "if / what if / suppose / imagine /
 *  assume / were to / scenario / hypothetical(ly)". Exported as the single source of truth so the
 *  router (scenarioRoute) and the compound decomposer (which must NOT split a coherent scenario ask)
 *  agree on exactly what a scenario question looks like. */
export const SCENARIO_TRIGGER_RE =
  /\b(if|what\s+if|suppose|imagine|assume|were\s+to|scenario|hypothetical(?:ly)?)\b/i;

/**
 * True when a message is a single scenario what-if: it carries BOTH a hypothetical trigger AND a
 * parseable price shift (percent / points / absolute level / structural "the flip"|"the wall").
 * This is the exact double-gate scenarioRoute enforces. The decomposer consults it so a coherent
 * scenario question expressed with sub-clauses ("if SPX drops 1% … does the regime flip, and which
 * walls become live?") is routed WHOLE to the scenario engine rather than run-on-split into fragments
 * whose sub-intents can't reassemble the hypothetical (the shift + trigger live only in one clause).
 */
export function isScenarioQuestion(text: string): boolean {
  return SCENARIO_TRIGGER_RE.test(text) && parseShift(text) != null;
}

// ── Shift resolution (spec + live state → a concrete target spot) ──────────────────────────────────

function fin(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** The resolved target of a shift against a state: the shifted spot + how it was arrived at. */
export type ResolvedShift = {
  targetSpot: number;
  /** Human basis of the target (e.g. "−1% of 7,560", "just below the gamma flip 7,520"). */
  basis: string;
};

const nfmt = (n: number, d = 2): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: d === 0 ? 0 : 0, maximumFractionDigits: d });

/**
 * Resolve a parsed shift to a concrete target spot given the live state, or null when it can't be
 * scoped (a level ref whose level the state doesn't currently have — e.g. "below the flip" with no
 * live flip). The nudge on directional level refs pushes the target just past the transition band so
 * the regime read commits to long/short rather than reporting the undecided on-the-flip state.
 */
export function resolveShiftTarget(spec: ShiftSpec, state: VectorFullState): ResolvedShift | null {
  const spot = fin(state.spot);
  if (spot == null) return null;

  switch (spec.kind) {
    case "pct": {
      const target = spot * (1 + spec.pct / 100);
      const sign = spec.pct >= 0 ? "+" : "−";
      return { targetSpot: target, basis: `${sign}${Math.abs(spec.pct)}% of spot ${nfmt(spot)}` };
    }
    case "points": {
      const target = spot + spec.points;
      const sign = spec.points >= 0 ? "+" : "−";
      return { targetSpot: target, basis: `${sign}${Math.abs(spec.points)} pts from spot ${nfmt(spot)}` };
    }
    case "absolute":
      return { targetSpot: spec.price, basis: `explicit price ${nfmt(spec.price)}` };
    case "level": {
      const levelPrice =
        spec.level === "flip"
          ? fin(state.gammaFlip)
          : spec.level === "call_wall"
            ? fin(state.gexWalls?.callWalls?.[0]?.strike)
            : spec.level === "put_wall"
              ? fin(state.gexWalls?.putWalls?.[0]?.strike)
              : fin(state.maxPain);
      if (levelPrice == null) return null; // level not live → honestly unresolvable
      const label = LEVEL_LABEL[spec.level];
      let relation = spec.relation;
      // A bare "break" resolves to a DIRECTION from where spot sits vs the level (and wall semantics):
      // a call wall breaks to the UPSIDE, a put wall to the DOWNSIDE, the flip/max-pain in whichever
      // direction spot must travel to cross it.
      if (relation === "break") {
        if (spec.level === "call_wall") relation = "above";
        else if (spec.level === "put_wall") relation = "below";
        else relation = spot > levelPrice ? "below" : "above";
      }
      if (relation === "to") return { targetSpot: levelPrice, basis: `at the ${label} ${nfmt(levelPrice)}` };
      const target = relation === "below" ? levelPrice * (1 - NUDGE) : levelPrice * (1 + NUDGE);
      return { targetSpot: target, basis: `just ${relation} the ${label} ${nfmt(levelPrice)}` };
    }
  }
}

const LEVEL_LABEL: Record<"flip" | "call_wall" | "put_wall" | "max_pain", string> = {
  flip: "gamma flip",
  call_wall: "call wall",
  put_wall: "put wall",
  max_pain: "max pain",
};

// ── Envelope composition ───────────────────────────────────────────────────────────────────────────

/** Regime posture as a member-facing phrase. */
function postureWord(p: VectorRegimePosture): string {
  return p === "long"
    ? "long gamma (pin / mean-revert)"
    : p === "short"
      ? "short gamma (amplify / trend)"
      : p === "transition"
        ? "at the flip (undecided — sharpest moves)"
        : "unknown";
}

/** Which side of the flip a price sits on: +1 above, -1 below, 0 on it (null flip → 0). */
function flipSide(price: number, flip: number | null): -1 | 0 | 1 {
  if (flip == null) return 0;
  if (price > flip) return 1;
  if (price < flip) return -1;
  return 0;
}

const signedPts = (n: number): string => `${n >= 0 ? "+" : "−"}${nfmt(Math.abs(n), 0)}`;
const signedPct = (n: number): string => `${n >= 0 ? "+" : "−"}${nfmt(Math.abs(n), 2)}%`;

/** Honest envelope for a shift we could not scope (unparseable, or an unresolvable level). Never a
 *  guess — states plainly what it needs, offers concrete forms it does understand. */
function cannotScopeEnvelope(ticker: string, reason: string): BieAnswerEnvelope {
  return makeEnvelope({
    headline: `Can't scope that ${ticker} scenario`,
    bias: "neutral",
    intent: "scenario",
    sections: [
      {
        title: "Scenario",
        body:
          `I can only read the dealer structure at a price move I can pin down. ${reason} ` +
          `Give me a concrete shift — a percent ("if ${ticker} drops 1%"), points ("${ticker} down 40 points"), ` +
          `an absolute level ("${ticker} at 7450", "breaks 745"), or a structural one ("below the flip", ` +
          `"breaks the call wall") — and I'll recompute regime, walls and max-pain there.`,
        unavailable: { reason },
      },
    ],
    evidence: [],
    confidence: { level: "insufficient", why: "No scopeable price move in the question." },
  });
}

/**
 * The PURE scenario composer: recompute the dealer structure at the shifted spot from a live Vector
 * state. Returns an honest "can't scope" envelope when the shift is unparseable or a referenced level
 * isn't live. Every number traces to a live value on `state` plus the stated arithmetic; NOTHING here
 * predicts an outcome or a probability — it is the mechanical structure at that price.
 */
export function buildScenarioEnvelope(
  state: VectorFullState,
  spec: ShiftSpec | null,
  opts?: { horizon?: string }
): BieAnswerEnvelope {
  const ticker = state.ticker ?? "SPX";
  const horizonLabel = (opts?.horizon ?? state.horizon ?? "all").toUpperCase();
  const prov: BieProvenance = { source: `Vector ${ticker} ${horizonLabel}`, asOf: state.asOf, freshness: "recent" };

  if (spec == null) return cannotScopeEnvelope(ticker, "I couldn't read a price move in that.");

  const baseSpot = fin(state.spot);
  if (baseSpot == null) return cannotScopeEnvelope(ticker, `No live ${ticker} spot to move from.`);

  const resolved = resolveShiftTarget(spec, state);
  if (resolved == null) {
    return cannotScopeEnvelope(
      ticker,
      `That references the ${spec.kind === "level" ? LEVEL_LABEL[spec.level] : "level"}, which isn't live for ${ticker} right now.`
    );
  }

  const target = resolved.targetSpot;
  const flip = fin(state.gammaFlip);
  const movePts = target - baseSpot;
  const movePct = (movePts / baseSpot) * 100;

  // Regime at base vs at the shifted spot — the SAME deriver the chart/desk render, so the scenario
  // can never describe a regime a member wouldn't see if price were actually there.
  const topCallWall = fin(state.gexWalls?.callWalls?.[0]?.strike);
  const topPutWall = fin(state.gexWalls?.putWalls?.[0]?.strike);
  const baseRegime = deriveVectorRegime({ spot: baseSpot, gammaFlip: flip, topCallWall, topPutWall });
  const shiftedRegime = deriveVectorRegime({ spot: target, gammaFlip: flip, topCallWall, topPutWall });

  const baseSide = flipSide(baseSpot, flip);
  const shiftedSide = flipSide(target, flip);
  const crossesFlip = flip != null && baseSide !== 0 && shiftedSide !== 0 && baseSide !== shiftedSide;
  const reachesFlip = flip != null && shiftedSide === 0; // lands in the transition band
  const regimeChanged = baseRegime.posture !== shiftedRegime.posture;

  const evidence: BieEvidence[] = [];
  const sections: BieSection[] = [];
  const levels: BieLevel[] = [];

  // ── The move ───────────────────────────────────────────────────────────────
  const sigma1Pct = state.expectedMove ? state.expectedMove.movePct * 100 : null;
  let magnitudeLine: string;
  if (sigma1Pct != null && sigma1Pct > 0) {
    const mult = Math.abs(movePct) / sigma1Pct;
    const klass = mult <= 1 ? "a WITHIN-1σ wiggle" : mult <= 2 ? "beyond 1σ but inside 2σ" : "a TAIL move (>2σ)";
    magnitudeLine = `That is ${mult.toFixed(2)}× the options-implied 1σ (${signedPct(sigma1Pct).replace(/^[+−]/, "±")}) — ${klass}.`;
    evidence.push({
      kind: "calc",
      text: `|${signedPct(movePct)}| ÷ 1σ ${sigma1Pct.toFixed(2)}% = ${mult.toFixed(2)}σ (${klass}).`,
      provenance: prov,
    });
  } else {
    magnitudeLine = "Expected-move (1σ) isn't live for this horizon, so I can't size the move against implied vol.";
  }
  sections.push({
    title: "The move",
    body:
      `${ticker} ${nfmt(baseSpot)} → ${nfmt(target)} (${signedPts(movePts)} pts, ${signedPct(movePct)}), ` +
      `basis ${resolved.basis}. ${magnitudeLine}`,
    evidence: [
      { kind: "fact", text: `Live ${ticker} spot ${nfmt(baseSpot)}.`, provenance: prov },
      { kind: "calc", text: `Shifted spot ${nfmt(target)} = ${resolved.basis}.`, provenance: prov },
    ],
    provenance: prov,
  });
  levels.push({ label: "spot (now)", price: round2(baseSpot), provenance: prov });
  levels.push({ label: "shifted spot", price: round2(target), note: resolved.basis });

  // ── Regime at the shifted spot (the key event) ───────────────────────────────
  let regimeBody: string;
  if (flip == null) {
    regimeBody = `No live gamma flip for ${ticker}, so I can't state the regime at ${nfmt(target)} — walls and max-pain below still recompute.`;
  } else {
    const crossPhrase = crossesFlip
      ? `**This CROSSES the gamma flip ${nfmt(flip)}** — the regime FLIPS from ${postureWord(baseRegime.posture)} to ${postureWord(shiftedRegime.posture)}. That is the event the question turns on: dealer hedging reverses direction.`
      : reachesFlip
        ? `This lands right ON the gamma flip ${nfmt(flip)} — the undecided, highest-volatility state where dealers are about to flip hedging direction.`
        : regimeChanged
          ? `Regime shifts from ${postureWord(baseRegime.posture)} to ${postureWord(shiftedRegime.posture)} without a clean flip cross.`
          : `Regime STAYS ${postureWord(shiftedRegime.posture)} — the move doesn't cross the flip ${nfmt(flip)}, so dealer hedging behavior is unchanged in kind.`;
    regimeBody = `At ${nfmt(target)}: ${shiftedRegime.read} ${crossPhrase}`;
    evidence.push({
      kind: "inference",
      text: `Spot ${nfmt(target)} vs flip ${nfmt(flip)} → ${shiftedRegime.posture} gamma (${crossesFlip ? "crosses flip" : reachesFlip ? "reaches flip" : "same side"}).`,
      provenance: prov,
    });
    levels.push({ label: "gamma flip", price: round2(flip), provenance: prov });
  }
  sections.push({
    title: "Regime at the shifted spot",
    body: regimeBody,
    bias: shiftedRegime.posture === "long" ? "neutral" : "mixed",
    provenance: prov,
  });

  // ── Which walls become live ──────────────────────────────────────────────────
  const walls = collectWalls(state);
  let wallsBody: string;
  if (walls.length === 0) {
    wallsBody = `No live gamma walls for ${ticker} to place ${nfmt(target)} against.`;
  } else {
    const below = walls.filter((w) => w.strike <= target).sort((a, b) => b.strike - a.strike)[0] ?? null;
    const above = walls.filter((w) => w.strike >= target).sort((a, b) => a.strike - b.strike)[0] ?? null;
    const pierced = walls.filter((w) => {
      const b = Math.sign(baseSpot - w.strike);
      const s = Math.sign(target - w.strike);
      return b !== 0 && s !== 0 && b !== s;
    });

    const parts: string[] = [];
    if (below)
      parts.push(
        `support below: ${below.label} ${nfmt(below.strike)} (${signedPts(below.strike - target)} pts)`
      );
    if (above)
      parts.push(
        `resistance above: ${above.label} ${nfmt(above.strike)} (${signedPts(above.strike - target)} pts)`
      );
    let body = `At ${nfmt(target)} the shifted spot sits between ${parts.join(" and ") || "no bracketing walls"}.`;
    if (pierced.length) {
      const pl = pierced
        .map((w) => {
          const roleFlip =
            w.side === "call"
              ? "was overhead resistance → now pierced (broken; flips toward support)"
              : "was underlying support → now pierced (broken; flips toward resistance)";
          return `${w.label} ${nfmt(w.strike)} (${roleFlip})`;
        })
        .join("; ");
      body += ` PIERCED by the move: ${pl}.`;
      evidence.push({
        kind: "inference",
        text: `Walls pierced (spot crosses strike): ${pierced.map((w) => `${w.label} ${nfmt(w.strike)}`).join(", ")}.`,
        provenance: prov,
      });
    } else {
      body += " No walls are pierced — the move stays within the current wall bracket.";
    }
    wallsBody = body;
    for (const w of walls.slice(0, 4)) levels.push({ label: w.label, price: round2(w.strike), provenance: prov });
    if (below)
      evidence.push({ kind: "fact", text: `Nearest wall below ${nfmt(target)}: ${w2(below)}.`, provenance: prov });
    if (above)
      evidence.push({ kind: "fact", text: `Nearest wall above ${nfmt(target)}: ${w2(above)}.`, provenance: prov });
  }
  sections.push({ title: "Which walls become live", body: wallsBody, provenance: prov });

  // ── Max-pain pull at the shifted spot ────────────────────────────────────────
  const mp = fin(state.maxPain);
  if (mp != null) {
    const pullPts = mp - target;
    const pullPct = (pullPts / target) * 100;
    const dir = Math.abs(pullPts) < 0.5 ? "sits right at" : pullPts > 0 ? "pulls UP toward" : "pulls DOWN toward";
    sections.push({
      title: "Max-pain pull",
      body: `From ${nfmt(target)}, max pain ${nfmt(mp)} ${dir} it (${signedPts(pullPts)} pts, ${signedPct(pullPct)}). In long gamma this pull firms into expiry; in short gamma it's weaker than the trend.`,
      provenance: prov,
    });
    evidence.push({
      kind: "calc",
      text: `Max pain ${nfmt(mp)} − shifted spot ${nfmt(target)} = ${signedPts(pullPts)} pts pull.`,
      provenance: prov,
    });
    levels.push({ label: "max pain", price: round2(mp), provenance: prov });
  } else {
    sections.push({
      title: "Max-pain pull",
      body: `No live max-pain for ${ticker} to measure the pull at ${nfmt(target)}.`,
      unavailable: { reason: "max pain not live" },
    });
  }

  // ── Honest framing ───────────────────────────────────────────────────────────
  sections.push({
    title: "Read this as structure, not a forecast",
    body:
      `This is the dealer STRUCTURE at ${nfmt(target)} — where the flip, walls and max-pain would put ` +
      `positioning IF ${ticker} were there. It is mechanical arithmetic over the current live surface, ` +
      `NOT a prediction that we get to ${nfmt(target)} or a probability of any outcome.`,
    evidence: [{ kind: "scenario", text: `Mechanical re-read of live positioning at ${nfmt(target)}; no probability assigned.` }],
  });

  const bias: BieBias = shiftedRegime.posture === "long" ? "neutral" : shiftedRegime.posture === "unknown" ? "neutral" : "mixed";
  const headline = crossesFlip
    ? `${ticker} → ${nfmt(target)}: CROSSES the flip — regime flips to ${shiftedRegime.posture} gamma`
    : `${ticker} → ${nfmt(target)}: ${shiftedRegime.posture === "unknown" ? "structure" : shiftedRegime.posture + " gamma"} (no flip cross)`;

  const confidence =
    flip == null || walls.length === 0
      ? { level: "low" as const, why: "Core structure (flip/walls) partially unavailable; scenario is partial." }
      : {
          level: "moderate" as const,
          why: "Exact arithmetic over live dealer positioning; the price move is hypothetical, not a forecast.",
        };

  return makeEnvelope({
    headline,
    bias,
    intent: "scenario",
    sections,
    evidence,
    confidence,
    levels: dedupeLevels(levels),
    invalidation:
      flip != null
        ? `Structure re-reads the moment real spot crosses the flip ${nfmt(flip)} — that's the regime-change trigger.`
        : null,
    followups: [
      `What if ${ticker} moves the other way?`,
      `What's the ${ticker} setup right now?`,
      `Which walls are building vs fading on ${ticker}?`,
    ],
  });
}

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────

type LiveWall = { strike: number; side: "call" | "put"; pct: number; label: string };

/** Every live gamma wall (call + put) as a flat, finite-strike list with a member label. */
function collectWalls(state: VectorFullState): LiveWall[] {
  const out: LiveWall[] = [];
  for (const w of state.gexWalls?.callWalls ?? []) {
    if (Number.isFinite(w.strike)) out.push({ strike: w.strike, side: "call", pct: w.pct, label: "call wall" });
  }
  for (const w of state.gexWalls?.putWalls ?? []) {
    if (Number.isFinite(w.strike)) out.push({ strike: w.strike, side: "put", pct: w.pct, label: "put wall" });
  }
  return out;
}

const w2 = (w: LiveWall): string => `${w.label} ${nfmt(w.strike)} (${w.pct.toFixed(0)}% gamma)`;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Drop duplicate (label, price) level rows so the UI table isn't noisy. */
function dedupeLevels(levels: BieLevel[]): BieLevel[] {
  const seen = new Set<string>();
  const out: BieLevel[] = [];
  for (const l of levels) {
    const key = `${l.label}@${l.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

// ── Async entry point (server) ─────────────────────────────────────────────────────────────────────

/**
 * Compose the scenario read for a ticker + a shift parsed from `shiftText` (the member's question),
 * over the live Vector full state for the horizon. Returns a `BieComposed` whose envelope IS the
 * structured answer; never null — an unparseable shift, an absent state, or an unresolvable level all
 * yield an honest envelope (recorded via the gap log), never a fabricated read.
 *
 * The full-state reader is a server-only module, dynamically imported with a RELATIVE specifier so
 * the hermetic test can mock.module it (matching cortex-read.ts).
 */
export async function composeScenario(
  ticker: string,
  shiftText: string,
  opts?: { horizon?: string }
): Promise<BieComposed> {
  const t = (ticker || "SPX").toUpperCase();
  const spec = parseShift(shiftText);

  // Unparseable shift: honest no-scenario envelope immediately (no need to hit the data layer).
  if (spec == null) {
    void recordGap(shiftText, "unparseable_shift");
    const env = cannotScopeEnvelope(t, "I couldn't read a price move in that.");
    return { answer: env.markdown, context: { ticker: t, reason: "unparseable_shift" }, envelope: env };
  }

  const { fetchVectorFullState } = await import("./vector-full-state");
  // RELATIVE specifier (not the "@/" alias): a "@/…" DYNAMIC import fails to resolve under the CI
  // tsx ESM loader while the local CJS transformer resolves it — the documented divergence (see the
  // attachLiveMarkMeta note in zerodte-service.ts). Static "@/" imports at the top of this file are
  // fine; only dynamic ones must be relative.
  const { normalizeDteHorizon } = await import("../../features/vector/lib/vector-dte-horizon");
  const horizon = opts?.horizon ?? "all";
  const state = await fetchVectorFullState(t, normalizeDteHorizon(horizon)).catch(() => null);

  if (!state) {
    void recordGap(shiftText, "no_live_state");
    const env = cannotScopeEnvelope(t, `No live Vector state for ${t} right now (markets closed or cold matrix).`);
    return { answer: env.markdown, context: { ticker: t, reason: "no_live_state" }, envelope: env };
  }

  const env = buildScenarioEnvelope(state, spec, { horizon });
  return { answer: env.markdown, context: { ticker: t, horizon, shift: spec, state }, envelope: env };
}

/** Fire-and-forget gap log — a scenario we couldn't scope is a signal the parser/data should grow. */
async function recordGap(question: string, reason: string): Promise<void> {
  try {
    const { recordBieGap } = await import("./gap-log");
    await recordBieGap({ question, intent: "scenario", reason });
  } catch {
    /* gap logging is best-effort */
  }
}
