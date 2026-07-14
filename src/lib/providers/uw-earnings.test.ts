import assert from "node:assert/strict";
import test from "node:test";
import {
  parseNextEarnings,
  parseReportTime,
  daysBetweenYmd,
} from "./uw-earnings";

test("parseReportTime: maps UW timing hints to a session bucket", () => {
  assert.equal(parseReportTime("bmo"), "premarket");
  assert.equal(parseReportTime("Before Market Open"), "premarket");
  assert.equal(parseReportTime("amc"), "afterhours");
  assert.equal(parseReportTime("After Market Close"), "afterhours");
  assert.equal(parseReportTime("time-not-supplied"), "unknown");
  assert.equal(parseReportTime(null), null);
});

test("daysBetweenYmd: whole-day diff; null on junk", () => {
  assert.equal(daysBetweenYmd("2026-07-13", "2026-07-16"), 3);
  assert.equal(daysBetweenYmd("2026-07-13", "2026-07-13"), 0);
  assert.equal(daysBetweenYmd("2026-07-13", "not-a-date"), null);
});

test("parseNextEarnings: full row → typed shape with days_until + report_time + confirmed", () => {
  const e = parseNextEarnings(
    "nvda",
    { earnings_date: "2026-07-16T00:00:00Z", report_time: "amc", is_confirmed: true },
    "2026-07-13"
  );
  assert.deepEqual(e, {
    ticker: "NVDA",
    earnings_date: "2026-07-16",
    days_until: 3,
    report_time: "afterhours",
    is_confirmed: true,
  });
});

test("parseNextEarnings: 'into earnings tomorrow' — days_until 1", () => {
  const e = parseNextEarnings("AAPL", { report_date: "2026-07-14", timing: "bmo" }, "2026-07-13");
  assert.equal(e.days_until, 1);
  assert.equal(e.report_time, "premarket");
  assert.equal(e.is_confirmed, null); // absent flag → null, never guessed
});

test("parseNextEarnings: null row and unparseable/missing date → empty (null date)", () => {
  assert.equal(parseNextEarnings("X", null, "2026-07-13").earnings_date, null);
  assert.equal(parseNextEarnings("X", { earnings_date: "soon" }, "2026-07-13").earnings_date, null);
  assert.equal(parseNextEarnings("X", {}, "2026-07-13").earnings_date, null);
});

test("parseNextEarnings: a stale PAST date is not surfaced as upcoming", () => {
  const e = parseNextEarnings("X", { earnings_date: "2026-07-01" }, "2026-07-13");
  assert.equal(e.earnings_date, null);
  assert.equal(e.days_until, null);
});

test("parseNextEarnings: is_confirmed accepts stringly/numeric truthiness", () => {
  assert.equal(parseNextEarnings("X", { date: "2026-07-20", confirmed: "false" }, "2026-07-13").is_confirmed, false);
  assert.equal(parseNextEarnings("X", { date: "2026-07-20", is_confirmed: 1 }, "2026-07-13").is_confirmed, true);
});
