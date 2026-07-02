import assert from "node:assert/strict";
import test from "node:test";
import {
  isBeforeOrAtMarketCloseEt,
  isTradingDayEt,
  nextTradingDayEt,
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
