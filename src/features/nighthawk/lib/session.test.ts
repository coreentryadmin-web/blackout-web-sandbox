import assert from "node:assert/strict";
import test from "node:test";
import {
  isBeforeOrAtMarketCloseEt,
  isTradingDayEt,
  mostRecentTradingDayEt,
  nextTradingDayEt,
  previousTradingDayEt,
} from "./session";

// The 2026-07-03 (July 4th observed) scenario that motivated the morning-confirm
// holiday guard: Thursday's evening edition must target Monday, and the holiday
// Friday must not read as a trading day.
test("2026-07-03 (July 4th observed) is not a trading day", () => {
  assert.equal(isTradingDayEt("2026-07-03"), false);
  assert.equal(isTradingDayEt("2026-07-02"), true);
  assert.equal(isTradingDayEt("2026-07-06"), true);
});

test("nextTradingDayEt skips the holiday weekend: Thu 07-02 -> Mon 07-06", () => {
  assert.equal(nextTradingDayEt("2026-07-02"), "2026-07-06");
  // From the holiday itself and the weekend, still Monday.
  assert.equal(nextTradingDayEt("2026-07-03"), "2026-07-06");
  assert.equal(nextTradingDayEt("2026-07-05"), "2026-07-06");
});

test("plain weekend skip: Fri -> Mon", () => {
  assert.equal(nextTradingDayEt("2026-07-10"), "2026-07-13");
});

test("previousTradingDayEt skips weekends: Mon -> Fri", () => {
  assert.equal(previousTradingDayEt("2026-07-13"), "2026-07-10");
});

test("previousTradingDayEt skips July-4th observed holiday: Mon 07-06 -> Thu 07-02", () => {
  assert.equal(previousTradingDayEt("2026-07-06"), "2026-07-02");
});

test("previousTradingDayEt is inverse of nextTradingDayEt across a holiday weekend", () => {
  assert.equal(previousTradingDayEt(nextTradingDayEt("2026-07-02")), "2026-07-02");
});

// task #173 (market_regime staleness): mostRecentTradingDayEt is the boundary
// /api/market/regime's GET compares a captured_at against to decide `stale`.
test("mostRecentTradingDayEt returns today when today is itself a trading day", () => {
  assert.equal(mostRecentTradingDayEt(new Date("2026-07-02T14:00:00Z")), "2026-07-02");
});

test("mostRecentTradingDayEt walks back over the July-4th-observed holiday weekend: Sun 07-05 -> Thu 07-02", () => {
  // 07-05 (Sun) -> 07-04 (Sat) -> 07-03 (Fri, holiday) -> 07-02 (Thu, trading day).
  assert.equal(mostRecentTradingDayEt(new Date("2026-07-05T16:00:00Z")), "2026-07-02");
});

test("mostRecentTradingDayEt walks back over a plain weekend: Sat -> Fri", () => {
  assert.equal(mostRecentTradingDayEt(new Date("2026-07-11T16:00:00Z")), "2026-07-10");
});

test("isBeforeOrAtMarketCloseEt keeps an edition active through its session close", () => {
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-06-30", new Date("2026-06-30T19:59:00Z")),
    true
  );
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-06-30", new Date("2026-06-30T20:00:00Z")),
    true
  );
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-06-30", new Date("2026-06-30T20:01:00Z")),
    false
  );
});

test("isBeforeOrAtMarketCloseEt does not carry a different session", () => {
  assert.equal(
    isBeforeOrAtMarketCloseEt("2026-07-01", new Date("2026-06-30T19:00:00Z")),
    false
  );
});
