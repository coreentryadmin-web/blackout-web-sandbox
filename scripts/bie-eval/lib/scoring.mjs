/**
 * BIE eval — PURE scoring primitives + per-answer classifier + aggregation.
 *
 * Kept free of Playwright/AWS/network so it is unit-testable in isolation
 * (scripts/bie-eval/lib/scoring.test.mjs). The runner (run.mjs) feeds it the raw Largo
 * response + the captured ground truth; this module decides pass/soft/fail and the honesty flags.
 *
 * SCORING PHILOSOPHY (honest, not surface). A "soft" verdict exists precisely so a CORRECT answer
 * that a strict token check happens to miss is NOT recorded as a regression: an answered, substantive
 * reply that fails only the keyword expectation is "soft" (eyeball it), while genuine failures —
 * unanswered, HTTP error, a leaked {{grounding}} marker, a fabricated number, a wrong number that
 * contradicts ground truth, or a routing answer that didn't come from BIE — are hard "fail".
 * Every scorecard row carries the full answer so a human can adjudicate the soft ones.
 */

export const lc = (s) => (s || "").toString().toLowerCase();
export const hasAll = (a, toks) => toks.every((t) => lc(a).includes(lc(t)));
export const hasAny = (a, toks) => (toks.length === 0 ? true : toks.some((t) => lc(a).includes(lc(t))));

/** All signed decimals in a string, commas stripped. */
export function extractNums(a) {
  return (String(a).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g) || []).map(parseFloat);
}

/** Does the answer contain a number within `tolAbs` of `target`? */
export function containsNum(a, target, tolAbs) {
  if (target == null || !Number.isFinite(target)) return false;
  return extractNums(a).some((n) => Math.abs(n - target) <= tolAbs);
}

/** Any number in the answer that sits inside [lo, hi]? Used to detect a fabricated value when GT is null. */
export function hasNumberInRange(a, lo, hi) {
  return extractNums(a).some((n) => n >= lo && n <= hi);
}

/** SPX index levels (74xx/75xx/7x,xxx) surfacing when a NON-SPX ticker was asked = cross-instrument bleed. */
export function looksSpx(a) {
  return /\b7[45]\d\d\b/.test(String(a).replace(/,/g, ""));
}

/** A grounding placeholder ({{...}}) that leaked to the user instead of being rendered to a real value. */
export function hasLeak(a) {
  return /\{\{|\}\}/.test(String(a));
}

/** Honest "I don't have that" phrasing — what a correct answer says when the datum is unavailable. */
export function looksLikeNoData(a) {
  return hasAny(a, [
    "no data", "not available", "unavailable", "don't have", "do not have", "can't get",
    "cannot get", "couldn't", "not currently", "off-hours", "off hours", "market is closed",
    "closed", "not forming", "no reading", "isn't available", "not showing", "no upcoming",
  ]);
}

/** Was the answer actually produced (vs empty / HTTP error / bare error string)? */
export function isAnswered(a) {
  const s = String(a || "").trim();
  return s.length > 15 && !/^HTTP\s*\d/i.test(s) && !/^error\b/i.test(s);
}

// ── Flagship scorers (synthesis verdict + diagnostic) — pure, unit-tested ──────────────────────────

/**
 * Distinct evidence DOMAINS a synthesis answer draws on. A real verdict cites SEVERAL (GEX/desk +
 * flow + macro/earnings/breadth…); a one-tool answer is exactly what a synthesis verdict must not be.
 */
const EVIDENCE_DOMAINS = {
  gex: ["gex", "gamma", "flip", "call wall", "put wall", "king", "dealer", "positioning", "max pain"],
  flow: ["flow", "sweep", "premium", "tape", "unusual", "call buying", "put buying"],
  macro: ["macro", "yield", "treasury", "cpi", "inflation", "rates", "fed", "10-year", "10y", "curve"],
  earnings: ["earnings", "the print", "eps", "guidance", "binary event", "into earnings"],
  breadth: ["breadth", "advancing", "declining", "a/d", "advance/decline", "internals", "market-wide"],
  darkpool: ["dark pool", "dark-pool", "darkpool", "off-exchange", "block print"],
  // Chart indicators ONLY — NOT "support"/"resistance"/"trend" (those overlap gex walls and false-match
  // prose like "supportive", which would wrongly bump a single-source verdict to multi-source).
  technicals: ["vwap", "ema20", "ema50", "ema200", " ema ", "rsi", "macd"],
  news: ["news", "headline", "catalyst", "fda", "m&a", "analyst", "price target"],
};

/** Which evidence domains the answer touches (deduped domain keys). */
export function evidenceDomainsCited(a) {
  const out = [];
  for (const [domain, toks] of Object.entries(EVIDENCE_DOMAINS)) {
    if (hasAny(a, toks)) out.push(domain);
  }
  return out;
}

/** Does the answer state a confidence / conviction (an honest verdict owns its uncertainty)? */
export function hasConfidence(a) {
  return hasAny(a, [
    "confidence", "conviction", "grade", "high conviction", "low conviction", "likely",
    "probability", "odds", "lean", "moderate", "strong", "weak", "%",
  ]);
}

/** Does the answer state an invalidation / what-would-flip-it / risk line? */
export function hasInvalidation(a) {
  return hasAny(a, [
    "invalidat", "stop", "if it breaks", "breaks below", "breaks above", "would flip", "would negate",
    "watch for", "risk is", "invalid if", "fails if", "loses", "negated if", "flips if",
  ]);
}

/**
 * Score a synthesis / verdict answer. PASS = substantive AND cites ≥2 evidence domains AND states a
 * confidence AND an invalidation/risk. A substantive answer that leans on ≤1 domain is a HARD fail —
 * a single-source verdict is precisely the failure mode synthesis must avoid. An answer that is
 * multi-source but missing confidence/invalidation is not a hard fail (→ soft: substantive but thin).
 */
export function scoreSynthesisVerdict(a) {
  const domains = evidenceDomainsCited(a);
  const substantive = String(a).trim().length >= 80;
  if (substantive && domains.length <= 1) {
    return { pass: false, hardFail: true, why: `single-source verdict (domains: ${domains.join(",") || "none"})`, domains };
  }
  const pass = substantive && domains.length >= 2 && hasConfidence(a) && hasInvalidation(a);
  return { pass, why: `domains=${domains.length}[${domains.join(",")}] conf=${hasConfidence(a)} inval=${hasInvalidation(a)}`, domains };
}

/** Diagnostic self-check tokens — the #56/#283 engine reports what it CHECKED, not a guessed cause. */
const DIAGNOSTIC_TOKENS = [
  "check", "checked", "pipeline", "data", "fresh", "stale", "recorder", "coverage", "available",
  "missing", "off-hours", "off hours", "session", "no prints", "not enough", "liquidity", "empty",
  "not forming", "healthy", "feed", "ingest", "last update", "as of", "snapshot", "expir",
];

/** Confident single-cause guesses with no diagnostic backing — a fabricated root cause. */
const GUESSED_CAUSE_PHRASES = [
  "because the stock", "due to low interest", "investors are", "the market doesn't care",
  "nobody is trading", "it's just not popular", "probably because traders", "since no one",
];

export function looksLikeDiagnosticChecklist(a) {
  const s = lc(a);
  return DIAGNOSTIC_TOKENS.filter((t) => s.includes(t)).length >= 2;
}

/**
 * Score a diagnostic answer. PASS = substantive AND reads like a grounded checklist (reports what it
 * checked: data present / freshness / pipeline / coverage). HARD fail = a confident guessed root cause
 * with NO diagnostic structure (fabrication). Otherwise soft (substantive but thin).
 */
export function scoreDiagnostic(a) {
  const substantive = String(a).trim().length >= 60;
  const checklist = looksLikeDiagnosticChecklist(a);
  const guessed = GUESSED_CAUSE_PHRASES.some((p) => lc(a).includes(p));
  if (guessed && !checklist) {
    return { pass: false, hardFail: true, why: "guessed root cause with no diagnostic checklist" };
  }
  return { pass: substantive && checklist, why: `checklist=${checklist} guessed=${guessed}` };
}

/**
 * Classify one fired question.
 * @param item  bank item: { cat, id, ticker?, kind?, gtValue?, tol?, range?, expect? }
 * @param resp  { answer, source, tools } from the Largo response
 * @returns { pass, severity: "pass"|"soft"|"fail", why, flags }
 */
export function scoreResult(item, resp) {
  const answer = String(resp?.answer ?? "");
  const source = String(resp?.source ?? "");
  const tools = resp?.tools ?? [];
  const bieSourced = source === "blackout-intelligence" || (Array.isArray(tools) && tools.includes("blackout_intelligence"));

  const flags = {
    leak: hasLeak(answer),
    spxBleed: !!item.ticker && item.ticker !== "SPX" && item.kind !== "concept" && looksSpx(answer),
    fabricated: false,
    unanswered: !isAnswered(answer),
    sourceMissing: false,
    bie: bieSourced,
  };

  // Routing questions MUST be served by BIE (not Claude / not a raw tool dump).
  if (item.cat === "routing" && isAnswered(answer) && !bieSourced) flags.sourceMissing = true;

  // Numeric fabrication / correctness handled generically when the bank supplies gtValue + tol.
  let numericVerdict = null;
  if (item.kind === "numeric") {
    const range = item.range ?? [0, Number.POSITIVE_INFINITY];
    if (item.gtValue == null) {
      // No ground truth → a specific in-range number presented as the value (without a no-data caveat)
      // is a fabrication; the honest answer says it's unavailable.
      if (isAnswered(answer) && hasNumberInRange(answer, range[0], range[1]) && !looksLikeNoData(answer)) {
        flags.fabricated = true;
      }
      numericVerdict = { pass: looksLikeNoData(answer), why: "GT null → honest no-data expected" };
    } else {
      const tol = item.tol ?? Math.max(3, Math.abs(item.gtValue) * 0.01);
      const matched = containsNum(answer, item.gtValue, tol) && !flags.spxBleed;
      // A confidently-stated DIFFERENT in-range number (no match, but a plausible value present) is a wrong number.
      const conflicting = !matched && hasNumberInRange(answer, range[0], range[1]) && !looksLikeNoData(answer);
      numericVerdict = { pass: matched, why: `GT=${item.gtValue}±${tol}`, conflicting };
    }
  }

  // Domain expectation (keyword/shape) for non-numeric-generic items. An expect may return
  // `hardFail:true` (e.g. a single-source synthesis verdict, or a guessed diagnostic root cause) to
  // force a hard FAIL rather than the default substantive→soft treatment.
  const exp = typeof item.expect === "function" ? item.expect(answer) : { pass: true, why: "" };
  const domainPass = numericVerdict ? numericVerdict.pass : exp.pass;
  const why = numericVerdict ? numericVerdict.why : exp.why;
  const expHardFail = !numericVerdict && exp && exp.hardFail === true && !domainPass;
  flags.hardExpect = !!expHardFail; // observability: a category-specific hard fail fired

  // Hard-fail conditions — genuine problems, regardless of keyword match.
  const hardFail =
    flags.unanswered ||
    flags.leak ||
    flags.fabricated ||
    flags.sourceMissing ||
    expHardFail ||
    (numericVerdict && numericVerdict.conflicting);

  let severity;
  if (hardFail) severity = "fail";
  else if (domainPass) severity = "pass";
  else if (String(answer).trim().length >= 60) severity = "soft"; // substantive but keyword-missed → eyeball
  else severity = "fail";

  return { pass: severity === "pass", severity, why, flags };
}

/** Aggregate scored rows into a per-category + overall scorecard summary. */
export function summarize(rows) {
  const cats = {};
  for (const r of rows) {
    const c = (cats[r.cat] ??= { total: 0, pass: 0, soft: 0, fail: 0 });
    c.total++;
    c[r.severity]++;
  }
  // Per-category pass-rate (pass / total) so the scorecard table + before→after deploy diff is clear.
  for (const c of Object.values(cats)) {
    c.pass_rate = c.total ? Number(((c.pass / c.total) * 100).toFixed(1)) : 0;
  }
  const total = rows.length;
  const pass = rows.filter((r) => r.severity === "pass").length;
  const soft = rows.filter((r) => r.severity === "soft").length;
  const fail = rows.filter((r) => r.severity === "fail").length;
  const bie = rows.filter((r) => r.flags?.bie).length;
  const leaks = rows.filter((r) => r.flags?.leak).length;
  const fabrications = rows.filter((r) => r.flags?.fabricated).length;
  const spxBleed = rows.filter((r) => r.flags?.spxBleed).length;
  const unanswered = rows.filter((r) => r.flags?.unanswered).length;
  const routingMisrouted = rows.filter((r) => r.flags?.sourceMissing).length;
  return {
    total,
    pass,
    soft,
    fail,
    pass_rate: total ? Number(((pass / total) * 100).toFixed(1)) : 0,
    bie_source_rate: total ? Number(((bie / total) * 100).toFixed(1)) : 0,
    leaks,
    fabrications,
    spx_bleed: spxBleed,
    unanswered,
    routing_misrouted: routingMisrouted,
    // Overall gate verdict: any hard FAIL trips the gate (soft misses never do).
    gate: fail > 0 ? "FAIL" : "PASS",
    by_category: cats,
  };
}
