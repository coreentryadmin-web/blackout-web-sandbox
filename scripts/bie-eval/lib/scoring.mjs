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

  // Domain expectation (keyword/shape) for non-numeric-generic items.
  const exp = typeof item.expect === "function" ? item.expect(answer) : { pass: true, why: "" };
  const domainPass = numericVerdict ? numericVerdict.pass : exp.pass;
  const why = numericVerdict ? numericVerdict.why : exp.why;

  // Hard-fail conditions — genuine problems, regardless of keyword match.
  const hardFail =
    flags.unanswered ||
    flags.leak ||
    flags.fabricated ||
    flags.sourceMissing ||
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
    by_category: cats,
  };
}
