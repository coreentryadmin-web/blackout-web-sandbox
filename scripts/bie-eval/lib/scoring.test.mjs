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

test("summarize: per-category + honesty aggregates", () => {
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
  assert.deepEqual(s.by_category.concept, { total: 2, pass: 1, soft: 1, fail: 0 });
});
