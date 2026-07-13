import assert from "node:assert/strict";
import test from "node:test";
import {
  hasAll,
  hasAny,
  extractNums,
  containsNum,
  hasNumberInRange,
  looksSpx,
  hasLeak,
  looksLikeNoData,
  isAnswered,
  scoreResult,
  summarize,
  evidenceDomainsCited,
  hasConfidence,
  hasInvalidation,
  scoreSynthesisVerdict,
  looksLikeDiagnosticChecklist,
  scoreDiagnostic,
} from "./scoring.mjs";

test("primitives: token + number helpers", () => {
  assert.equal(hasAll("gamma exposure at strike", ["gamma", "exposure"]), true);
  assert.equal(hasAny("dealer hedging", ["strike", "dealer"]), true);
  assert.equal(hasAny("anything", []), true); // empty required-set passes
  assert.deepEqual(extractNums("SPX flip 7,499.36 vs 7500"), [7499.36, 7500]);
  assert.equal(containsNum("flip near 7501", 7500, 3), true);
  assert.equal(containsNum("flip near 7520", 7500, 3), false);
  assert.equal(hasNumberInRange("call wall 620", 600, 640), true);
  assert.equal(looksSpx("levels at 7480 and 7520"), true);
  assert.equal(looksSpx("NVDA near 121"), false);
  assert.equal(hasLeak("hit {{72}}% target"), true);
  assert.equal(looksLikeNoData("I don't have that off-hours"), true);
  assert.equal(isAnswered("HTTP 500"), false);
  assert.equal(isAnswered("a real substantive answer here"), true);
});

test("numeric: correct value → pass", () => {
  const r = scoreResult(
    { cat: "numeric", kind: "numeric", ticker: "SPY", gtValue: 620, tol: 6, range: [400, 800] },
    { answer: "SPY's top call wall this week sits at 621.", source: "blackout-intelligence" }
  );
  assert.equal(r.severity, "pass");
  assert.equal(r.flags.bie, true);
});

test("numeric: GT present but a conflicting in-range number → hard fail (wrong number)", () => {
  const r = scoreResult(
    { cat: "numeric", kind: "numeric", ticker: "SPY", gtValue: 620, tol: 6, range: [400, 800] },
    { answer: "SPY's call wall is 655.", source: "blackout-intelligence" }
  );
  assert.equal(r.severity, "fail");
  assert.equal(r.pass, false);
});

test("numeric: GT null + a fabricated in-range number (no caveat) → fabricated hard fail", () => {
  const r = scoreResult(
    { cat: "numeric", kind: "numeric", ticker: "QQQ", gtValue: null, range: [400, 700] },
    { answer: "QQQ max pain is 545.", source: "blackout-intelligence" }
  );
  assert.equal(r.flags.fabricated, true);
  assert.equal(r.severity, "fail");
});

test("numeric: GT null + honest no-data → pass", () => {
  const r = scoreResult(
    { cat: "numeric", kind: "numeric", ticker: "QQQ", gtValue: null, range: [400, 700] },
    { answer: "I don't have QQQ max pain right now — off-hours.", source: "blackout-intelligence" }
  );
  assert.equal(r.flags.fabricated, false);
  assert.equal(r.severity, "pass");
});

test("honesty: {{leak}} is always a hard fail even with a correct value", () => {
  const r = scoreResult(
    { cat: "numeric", kind: "numeric", gtValue: 7500, tol: 5, range: [7000, 8000] },
    { answer: "flip 7500 with {{72}}% precedent", source: "blackout-intelligence" }
  );
  assert.equal(r.flags.leak, true);
  assert.equal(r.severity, "fail");
});

test("routing: answered but NOT bie-sourced → sourceMissing hard fail", () => {
  const r = scoreResult(
    { cat: "routing", id: "r1", expect: () => ({ pass: true, why: "" }) },
    { answer: "Here is a substantive vector regime read with walls and support.", source: "claude" }
  );
  assert.equal(r.flags.sourceMissing, true);
  assert.equal(r.severity, "fail");
});

test("spx bleed: SPX levels for a non-SPX numeric ask → bleed flag", () => {
  const r = scoreResult(
    { cat: "numeric", kind: "numeric", ticker: "NVDA", gtValue: 121, tol: 2, range: [50, 300] },
    { answer: "NVDA flip; also SPX is at 7480/7520.", source: "blackout-intelligence" }
  );
  assert.equal(r.flags.spxBleed, true);
});

test("soft: substantive concept answer that misses the keyword is soft, not fail", () => {
  const long = "A ".repeat(60) + "detailed explanation of the mechanic without the exact keyword.";
  const r = scoreResult(
    { cat: "concept", id: "c1", expect: () => ({ pass: false, why: "keyword miss" }) },
    { answer: long, source: "blackout-intelligence" }
  );
  assert.equal(r.severity, "soft");
  assert.equal(r.pass, false); // soft is not a pass, but not a regression fail either
});

test("unanswered / HTTP error → hard fail", () => {
  const r = scoreResult({ cat: "concept", expect: () => ({ pass: true }) }, { answer: "HTTP 502" });
  assert.equal(r.flags.unanswered, true);
  assert.equal(r.severity, "fail");
});

test("summarize: per-category pass_rate + gate verdict", () => {
  const rows = [
    { cat: "concept", severity: "pass", flags: { bie: true } },
    { cat: "concept", severity: "soft", flags: { bie: true } },
    { cat: "numeric", severity: "fail", flags: { bie: true, fabricated: true } },
    { cat: "numeric", severity: "pass", flags: { bie: false } },
  ];
  const s = summarize(rows);
  assert.equal(s.total, 4);
  assert.equal(s.pass, 2);
  assert.equal(s.soft, 1);
  assert.equal(s.fail, 1);
  assert.equal(s.fabrications, 1);
  assert.equal(s.bie_source_rate, 75);
  assert.equal(s.gate, "FAIL"); // a hard fail trips the gate
  assert.deepEqual(s.by_category.concept, { total: 2, pass: 1, soft: 1, fail: 0, pass_rate: 50 });
  assert.equal(s.by_category.numeric.pass_rate, 50);
  // No hard fails → gate PASS (soft misses don't trip it).
  const clean = summarize([
    { cat: "concept", severity: "pass", flags: {} },
    { cat: "concept", severity: "soft", flags: {} },
  ]);
  assert.equal(clean.gate, "PASS");
});

// ── flagship scorers ──────────────────────────────────────────────────────────────────────────
test("evidenceDomainsCited: distinct domains from a multi-tool answer", () => {
  const a = "The SPX desk shows gamma flip at 7500 with a call wall above; flow is buying calls; the macro backdrop (10y yield) is calm and breadth is 2:1 positive.";
  const d = evidenceDomainsCited(a);
  assert.ok(d.includes("gex"));
  assert.ok(d.includes("flow"));
  assert.ok(d.includes("macro"));
  assert.ok(d.includes("breadth"));
  assert.ok(d.length >= 4);
  assert.deepEqual(evidenceDomainsCited("just a plain sentence"), []);
});

test("hasConfidence / hasInvalidation detect the honest-verdict parts", () => {
  assert.equal(hasConfidence("moderate conviction here"), true);
  assert.equal(hasConfidence("nothing stated"), false);
  assert.equal(hasInvalidation("invalidation is a break below 7480"), true);
  assert.equal(hasInvalidation("no risk line at all"), false);
});

test("scoreSynthesisVerdict: multi-source + confidence + invalidation → PASS", () => {
  const a = "Verdict: lean long 0DTE calls. The desk has SPX above the gamma flip (long-gamma, pinning), flow is net call-buying, and macro/breadth are supportive. Confidence: moderate. Invalidation: a break below the 7480 flip flips it short.";
  const r = scoreSynthesisVerdict(a);
  assert.equal(r.pass, true);
  assert.ok(r.domains.length >= 2);
});

test("scoreSynthesisVerdict: single-source substantive verdict → HARD fail", () => {
  const a = "Yes, 7500 0DTE calls look good today because gamma is supportive and the flip is below and the dealers are long gamma so it should pin higher into the close, a solid setup overall.";
  const r = scoreSynthesisVerdict(a);
  assert.equal(r.hardFail, true);
  assert.equal(r.pass, false);
});

test("scoreSynthesisVerdict: multi-source but no confidence/invalidation → soft (not hard fail)", () => {
  const a = "SPX desk shows the gamma flip nearby and flow is buying calls and breadth is positive across the tape today, a reasonable backdrop for the index right now overall.";
  const r = scoreSynthesisVerdict(a);
  assert.equal(r.pass, false);
  assert.notEqual(r.hardFail, true);
});

test("looksLikeDiagnosticChecklist + scoreDiagnostic", () => {
  const good = "I checked the pipeline: the recorder is idle off-hours and there's no fresh data / no prints this session, so beads aren't forming — the feed coverage is empty, not broken.";
  assert.equal(looksLikeDiagnosticChecklist(good), true);
  assert.equal(scoreDiagnostic(good).pass, true);

  const guessed = "MSFT isn't forming beads because investors are not interested in the stock right now.";
  const r = scoreDiagnostic(guessed);
  assert.equal(r.hardFail, true); // guessed root cause, no checklist
  assert.equal(r.pass, false);
});

test("scoreResult: an expect returning hardFail forces a FAIL even when substantive", () => {
  const long = "x ".repeat(60);
  const r = scoreResult(
    { cat: "synthesis", id: "s", expect: () => ({ pass: false, hardFail: true, why: "single-source" }) },
    { answer: long + "gamma only", source: "blackout-intelligence" }
  );
  assert.equal(r.severity, "fail");
  assert.equal(r.flags.hardExpect, true);
});
