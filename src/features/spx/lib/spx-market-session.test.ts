import test from "node:test";
import assert from "node:assert/strict";
import { isSpxRthActive, marketStatusLabel } from "./spx-market-session";

// 2026-07-03 (Fri) is Independence Day observed (2026-07-04 is a Saturday) — a
// weekday on the clock but not a trading session. Confirmed live: isSpxRthActive
// was missing this gate, so a Polygon status of "open" (or a failed/unavailable
// status call falling through to the naive weekday+time check) reported RTH as
// active on the holiday, which fed a false "GEX SPY cold during RTH" P0 into
// data-integrity.

test("isSpxRthActive: false on a holiday even when Polygon reports the market open", () => {
  const holidayRth = new Date("2026-07-03T15:00:00.000Z"); // 11:00 ET
  assert.equal(isSpxRthActive(holidayRth, { market: "open", earlyHours: false, afterHours: false, serverTime: "" }), false);
});

test("isSpxRthActive: false on a holiday with no Polygon status at all (fallback path)", () => {
  const holidayRth = new Date("2026-07-03T15:00:00.000Z"); // 11:00 ET
  assert.equal(isSpxRthActive(holidayRth, null), false);
});

test("isSpxRthActive: true on a real trading day at the same clock time/status", () => {
  const tradingDayRth = new Date("2026-07-06T15:00:00.000Z"); // Mon 11:00 ET
  assert.equal(isSpxRthActive(tradingDayRth, { market: "open", earlyHours: false, afterHours: false, serverTime: "" }), true);
});

test("marketStatusLabel: CLOSED on a holiday, not RTH OPEN", () => {
  const holidayRth = new Date("2026-07-03T15:00:00.000Z"); // 11:00 ET
  assert.equal(marketStatusLabel(holidayRth, { market: "open", earlyHours: false, afterHours: false, serverTime: "" }), "CLOSED");
});
