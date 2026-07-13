// BIE cross-tool VERDICT synthesis — the PURE core (task #59). Side-effect-free so the
// relevance-gating (depth matches merit) and the envelope assembly are exhaustively unit-testable.
//
// The flagship question — "is SPX 7500 0DTE good today", "should I hold NVDA into earnings",
// "is the market risk-on today" — is answered by fanning out to the RELEVANT engines only, then
// synthesizing ONE BieAnswerEnvelope: a headline + bias, one section per surface, evidence tagged
// fact/calc/inference with provenance, a calibrated confidence, an invalidation, optional scenarios,
// and — per master-spec §4 — every requested-but-thin source surfaced in unavailableSources[], never
// fabricated.

import {
  makeEnvelope,
  type BieAnswerEnvelope,
  type BieBias,
  type BieConfidence,
  type BieEvidence,
  type BieSection,
  type BieScenario,
  type BieUnavailableSource,
  type BieLevel,
} from "@/lib/bie/answer-envelope";

/** Which engine legs a verdict question warrants — depth matches merit; don't fan out needlessly. */
export type VerdictLegPlan = {
  /** Dealer gamma / positioning + Vector structure — the core read; always on for a ticker verdict. */
  gamma: boolean;
  /** Options-flow tape. */
  flow: boolean;
  /** Next earnings date (event risk). */
  earnings: boolean;
  /** Fundamentals + short interest / short-volume (squeeze/hold context). */
  fundamentals: boolean;
  /** Macro backdrop (yields curve + CPI). */
  macro: boolean;
  /** Market breadth + movers. */
  breadth: boolean;
  /** Peer/related companies. */
  related: boolean;
  /** True for an index/ETF-level verdict (SPX/SPY/QQQ/market) — no single-name fundamentals. */
  isIndex: boolean;
  /** The horizon the verdict is about. */
  horizon: "0dte" | "swing" | "position" | "unspecified";
};

const INDEX_RE = /\b(spx|spxw|spy|qqq|ndx|es|iwm|dia|vix|market|indices?)\b/i;

/**
 * RELEVANCE GATE. Decide which legs a verdict question warrants:
 *  - a 0DTE strike/level verdict on an index → gamma + flow + market backdrop (macro/breadth); NOT
 *    single-name fundamentals/earnings.
 *  - "hold X into earnings" / a swing hold on a single name → gamma + flow + earnings + fundamentals
 *    (+ light macro).
 *  - "is the market risk-on" → macro + breadth (+ index gamma).
 */
export function planVerdictLegs(question: string, ticker: string): VerdictLegPlan {
  const q = question.toLowerCase();
  const isIndex = INDEX_RE.test(ticker) || INDEX_RE.test(q);
  const mentionsEarnings = /\bearnings?\b|\binto (the )?(print|report|earnings)\b|\bpre[- ]?earnings\b/.test(q);
  const isHold = /\bhold\b|\bswing\b|\bovernight\b|\binto (tomorrow|next week|the (close|week))\b|\bposition\b/.test(q);
  const marketWide = /\brisk[- ]?(on|off)\b|\bbackdrop\b|\bmacro\b|\bbreadth\b|\brisk appetite\b|\bmarket (doing|risk|tone|regime)\b/.test(q);
  const wantsPeers = /\bpeers?\b|\bsector\b|\bcompare\b|\bvs\b|\brelated\b/.test(q);

  const horizon: VerdictLegPlan["horizon"] = /\b0\s*dte\b|\btoday\b|\bscalp\b|\bintraday\b/.test(q)
    ? "0dte"
    : mentionsEarnings || isHold || /\bswing\b/.test(q)
      ? "swing"
      : /\bweeks?\b|\bmonths?\b|\blong[- ]?term\b/.test(q)
        ? "position"
        : "unspecified";

  return {
    gamma: true, // the dealer read anchors every verdict
    flow: true,
    // Single-name event/hold context — never for a pure index 0DTE strike verdict.
    earnings: !isIndex && (mentionsEarnings || isHold || horizon === "swing" || horizon === "position"),
    fundamentals: !isIndex && (mentionsEarnings || isHold || horizon === "swing" || horizon === "position"),
    // Market backdrop — for index verdicts, market-wide questions, or a same-day (0DTE) read.
    macro: isIndex || marketWide || horizon === "0dte",
    breadth: isIndex || marketWide,
    related: wantsPeers,
    isIndex,
    horizon,
  };
}

// ── Envelope assembly ──────────────────────────────────────────────────────

export type VerdictPositioning = {
  spot: number | null;
  flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  max_pain: number | null;
  gamma_posture: "long" | "short" | null;
};

export type VerdictFlow = {
  count: number;
  total_premium: number;
  call_premium: number;
  put_premium: number;
};

export type VerdictEarnings = {
  earnings_date: string | null;
  days_until: number | null;
  report_time: string | null;
  is_confirmed: boolean;
};

export type VerdictFundamentals = {
  days_to_cover: number | null;
  short_volume_ratio: number | null;
  price_target: number | null;
  as_of: string | null;
};

export type VerdictMacro = {
  yield_10_year: number | null;
  curve_10y_1y_spread: number | null;
  cpi: number | null;
  date: string | null;
};

export type VerdictBreadth = { tone: string | null; summary: string | null; as_of: string | null };

/** All gathered data (already summarized by the server) — the pure assembler's input. */
export type VerdictInputs = {
  ticker: string;
  question: string;
  plan: VerdictLegPlan;
  positioning: VerdictPositioning | null;
  regime: "long" | "short" | "transition" | "unknown" | null;
  flow: VerdictFlow | null;
  earnings: VerdictEarnings | null;
  fundamentals: VerdictFundamentals | null;
  macro: VerdictMacro | null;
  breadth: VerdictBreadth | null;
  related: string[] | null;
  /** Legs that were REQUESTED (per plan) but came back null/thin — surfaced, never omitted. */
  unavailable: BieUnavailableSource[];
};

function fmt(n: number | null | undefined, d = 2): string {
  return n != null && Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d }) : "—";
}

function biasFromRegime(regime: VerdictInputs["regime"], pos: VerdictPositioning | null): BieBias {
  if (!pos || pos.spot == null || pos.flip == null) return "neutral";
  if (regime === "long") return "neutral"; // long gamma = range/mean-revert → two-way
  if (regime === "short") return pos.spot >= pos.flip ? "bullish" : "bearish"; // momentum with the side
  return "neutral";
}

/**
 * Assemble the verdict envelope from gathered data — PURE. Builds sections only for legs that
 * returned data, tags evidence with kind + provenance, calibrates confidence from confluence + leg
 * coverage, and lists every requested-but-thin leg in unavailableSources.
 */
export function assembleVerdictEnvelope(inp: VerdictInputs): BieAnswerEnvelope {
  const T = inp.ticker.toUpperCase();
  const sections: BieSection[] = [];
  const evidence: BieEvidence[] = [];
  const levels: BieLevel[] = [];
  const pos = inp.positioning;
  const bias = biasFromRegime(inp.regime, pos);

  // Gamma / positioning — the anchor section.
  if (pos && pos.spot != null) {
    const parts: string[] = [`Spot ${fmt(pos.spot)}`];
    if (pos.flip != null) parts.push(`γflip ${fmt(pos.flip)} (${pos.spot >= pos.flip ? "long-gamma / range" : "short-gamma / momentum"})`);
    if (pos.call_wall != null) parts.push(`call wall ${fmt(pos.call_wall)}`);
    if (pos.put_wall != null) parts.push(`put wall ${fmt(pos.put_wall)}`);
    if (pos.max_pain != null) parts.push(`max pain ${fmt(pos.max_pain)}`);
    sections.push({
      title: "Dealer positioning",
      body: parts.join(" · "),
      bias,
      provenance: { source: "Vector / Thermal GEX", freshness: "live" },
    });
    evidence.push({ kind: "fact", text: `${T} spot ${fmt(pos.spot)}${pos.flip != null ? ` vs γflip ${fmt(pos.flip)}` : ""}`, provenance: { source: "GEX positioning", freshness: "live" } });
    if (pos.flip != null) evidence.push({ kind: "inference", text: pos.spot >= pos.flip ? "Long gamma → dealers fade moves, range-bound" : "Short gamma → dealers amplify, momentum" });
    if (pos.call_wall != null) levels.push({ label: "call wall", price: pos.call_wall });
    if (pos.put_wall != null) levels.push({ label: "put wall", price: pos.put_wall });
    if (pos.flip != null) levels.push({ label: "gamma flip", price: pos.flip });
    if (pos.max_pain != null) levels.push({ label: "max pain", price: pos.max_pain });
  }

  // Flow.
  if (inp.flow && inp.flow.count > 0) {
    const skew = inp.flow.call_premium >= inp.flow.put_premium ? "call-led" : "put-led";
    sections.push({
      title: "Options flow",
      body: `${inp.flow.count} prints · $${fmt(inp.flow.total_premium, 0)} premium · ${skew}`,
      provenance: { source: "HELIX flow tape", freshness: "recent" },
    });
    evidence.push({ kind: "fact", text: `Flow ${skew} ($${fmt(inp.flow.total_premium, 0)} across ${inp.flow.count} prints)`, provenance: { source: "HELIX flow", freshness: "recent" } });
  }

  // Earnings (event risk).
  if (inp.earnings && inp.earnings.earnings_date) {
    const when = inp.earnings.days_until != null ? `${inp.earnings.days_until}d` : inp.earnings.earnings_date;
    sections.push({
      title: "Earnings",
      body: `Next earnings ${inp.earnings.earnings_date} (${when}${inp.earnings.report_time && inp.earnings.report_time !== "unknown" ? `, ${inp.earnings.report_time}` : ""})${inp.earnings.is_confirmed ? " — confirmed" : ""}.`,
      provenance: { source: "UW earnings", asOf: inp.earnings.earnings_date },
    });
    evidence.push({
      kind: "fact",
      text: `Earnings ${inp.earnings.days_until != null ? `in ${inp.earnings.days_until}d` : `on ${inp.earnings.earnings_date}`} — event risk / IV crush`,
      provenance: { source: "UW earnings", asOf: inp.earnings.earnings_date },
    });
    if (inp.earnings.days_until != null && inp.earnings.days_until <= 3) {
      evidence.push({ kind: "inference", text: "Earnings within 3 sessions — holding through the print is a binary event, not a technical trade." });
    }
  }

  // Fundamentals / short interest.
  if (inp.fundamentals && (inp.fundamentals.days_to_cover != null || inp.fundamentals.short_volume_ratio != null)) {
    const f = inp.fundamentals;
    const bits: string[] = [];
    if (f.days_to_cover != null) bits.push(`days-to-cover ${fmt(f.days_to_cover, 1)}`);
    if (f.short_volume_ratio != null) bits.push(`short-vol ${fmt(f.short_volume_ratio * 100, 0)}%`);
    if (f.price_target != null) bits.push(`analyst PT ${fmt(f.price_target)}`);
    sections.push({ title: "Short interest / fundamentals", body: bits.join(" · "), provenance: { source: "Polygon / Benzinga", asOf: f.as_of } });
    if (f.days_to_cover != null && f.days_to_cover >= 5) evidence.push({ kind: "inference", text: `High days-to-cover (${fmt(f.days_to_cover, 1)}) → squeeze fuel if it runs`, provenance: { source: "Polygon short interest", asOf: f.as_of } });
  }

  // Macro backdrop.
  if (inp.macro && (inp.macro.yield_10_year != null || inp.macro.cpi != null)) {
    const m = inp.macro;
    const bits: string[] = [];
    if (m.yield_10_year != null) bits.push(`10y ${fmt(m.yield_10_year, 2)}%`);
    if (m.curve_10y_1y_spread != null) bits.push(`10y-1y ${fmt(m.curve_10y_1y_spread, 2)}${m.curve_10y_1y_spread < 0 ? " (inverted)" : ""}`);
    if (m.cpi != null) bits.push(`CPI ${fmt(m.cpi, 1)}`);
    sections.push({ title: "Macro backdrop", body: bits.join(" · "), provenance: { source: "Polygon macro", asOf: m.date } });
  }

  // Breadth.
  if (inp.breadth && inp.breadth.tone && inp.breadth.tone !== "unknown") {
    sections.push({ title: "Market breadth", body: inp.breadth.summary ?? `Breadth ${inp.breadth.tone}`, provenance: { source: "Polygon breadth", asOf: inp.breadth.as_of } });
    evidence.push({ kind: "fact", text: `Breadth ${inp.breadth.tone}`, provenance: { source: "Polygon breadth", asOf: inp.breadth.as_of } });
  }

  // Related peers.
  if (inp.related && inp.related.length > 0) {
    sections.push({ title: "Peers", body: inp.related.slice(0, 6).join(", "), provenance: { source: "Polygon related", freshness: "recent" } });
  }

  // Confidence: evidence quality + coverage. High needs ≥3 substantive sections + a regime read.
  const substantive = sections.filter((s) => !s.unavailable).length;
  const confidence: BieConfidence =
    pos && pos.spot != null && substantive >= 4
      ? { level: "high", why: `Multiple engines agree (${substantive} live surfaces) with a decisive regime read.` }
      : pos && pos.spot != null && substantive >= 2
        ? { level: "moderate", why: `${substantive} live surfaces; ${inp.unavailable.length ? "some legs thin/unavailable" : "limited confluence"}.` }
        : substantive >= 1
          ? { level: "low", why: "Only a partial read available this turn." }
          : { level: "insufficient", why: "No live data returned for this verdict — can't grade it." };

  // Invalidation — the flip is the honest "go flat" line.
  const invalidation =
    pos && pos.flip != null
      ? `${T} losing the ${fmt(pos.flip)} gamma flip flips the regime — thesis off below it (long) / above it (short).`
      : null;

  // Scenarios — only when we have a positioning anchor (avoid fabricating structure).
  const scenarios: BieScenario[] | undefined =
    pos && pos.spot != null && pos.flip != null
      ? [
          { kind: "bull", thesis: `Holds above ${fmt(pos.flip)}${pos.call_wall != null ? `, presses ${fmt(pos.call_wall)}` : ""}`, trigger: `reclaim/hold ${fmt(pos.flip)}`, invalidation: `close back below ${fmt(pos.flip)}` },
          { kind: "base", thesis: pos.spot >= pos.flip ? `Range/pin between the walls${pos.max_pain != null ? ` toward max pain ${fmt(pos.max_pain)}` : ""}` : `Chop around the flip until it resolves`, confirm: "no decisive wall break" },
          { kind: "bear", thesis: `Loses ${fmt(pos.flip)}${pos.put_wall != null ? `, tests ${fmt(pos.put_wall)}` : ""}`, trigger: `break below ${fmt(pos.flip)}`, invalidation: `reclaim ${fmt(pos.flip)}` },
        ]
      : undefined;

  const headline = buildVerdictHeadline(T, inp, bias, confidence.level);

  return makeEnvelope({
    headline,
    bias,
    intent: "verdict",
    sections,
    evidence,
    confidence,
    invalidation,
    scenarios,
    levels,
    unavailableSources: inp.unavailable,
    followups: ["What would flip this read?", "Show the flow tape", "What is the gamma flip?"],
  });
}

function buildVerdictHeadline(T: string, inp: VerdictInputs, bias: BieBias, conf: string): string {
  const anchor = inp.positioning?.spot != null ? `${fmt(inp.positioning.spot)}` : "";
  const earn = inp.earnings?.days_until != null && inp.earnings.days_until <= 5 ? ` · earnings in ${inp.earnings.days_until}d` : "";
  const regimeWord = inp.regime === "long" ? "long-γ range" : inp.regime === "short" ? "short-γ momentum" : "mixed";
  return `${T} verdict${anchor ? ` ${anchor}` : ""}: ${regimeWord}, ${bias}${earn} — ${conf} confidence`;
}
