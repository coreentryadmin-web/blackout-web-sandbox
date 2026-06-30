import assert from "node:assert/strict";
import test from "node:test";
import { isBeforeOrAtMarketCloseEt } from "./session";

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
