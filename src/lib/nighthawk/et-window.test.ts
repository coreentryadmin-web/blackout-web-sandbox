import { test } from "node:test";
import assert from "node:assert/strict";
import { inEtWindow } from "./et-window";

// Behavioral spec for the REAL DST-aware ET-window helper (imported, not copied),
// asserted against the America/New_York tz database. The outcomes cron targets
// 16:30 ET with a 90-minute catch-up (16:30-18:00 ET).
const OUTCOME = { targetHour: 16, targetMinute: 30, catchupMin: 90 };

test("EST root-cause: 20:30 UTC = 15:30 ET (winter) is OUT of window", () => {
  // Proves the OLD single 20:30 UTC fire missed every winter weekday.
  assert.equal(inEtWindow(OUTCOME, new Date("2026-01-15T20:30:00Z")), false);
});

test("EST fix: 21:30 UTC = 16:30 ET (winter) is IN window", () => {
  // Proves the ADDED 21:30 UTC fire lands exactly on target under EST.
  assert.equal(inEtWindow(OUTCOME, new Date("2026-01-15T21:30:00Z")), true);
});

test("EDT: 20:30 UTC = 16:30 ET (summer) is IN window", () => {
  assert.equal(inEtWindow(OUTCOME, new Date("2026-07-15T20:30:00Z")), true);
});

test("EDT second fire: 21:30 UTC = 17:30 ET (summer) still IN window (within 90m catchup)", () => {
  assert.equal(inEtWindow(OUTCOME, new Date("2026-07-15T21:30:00Z")), true);
});

test("catchup upper bound: 18:00 ET exactly is IN, 18:01 ET is OUT (EST)", () => {
  assert.equal(inEtWindow(OUTCOME, new Date("2026-01-15T23:00:00Z")), true);
  assert.equal(inEtWindow(OUTCOME, new Date("2026-01-15T23:01:00Z")), false);
});

test("weekend rejection: Saturday in-window-by-clock returns false", () => {
  // 2026-01-17 is a Saturday; 21:30 UTC = 16:30 ET but weekdaysOnly default rejects it.
  assert.equal(inEtWindow(OUTCOME, new Date("2026-01-17T21:30:00Z")), false);
});

test("edition cron: 21:00 UTC = 17:00 ET (EDT) is OUT — before 5:30 window", () => {
  assert.equal(inEtWindow({ targetHour: 17, targetMinute: 30, catchupMin: 120 }, new Date("2026-06-29T21:00:00Z")), false);
});

test("edition cron: 21:30 UTC = 17:30 ET (EDT) is IN window", () => {
  assert.equal(inEtWindow({ targetHour: 17, targetMinute: 30, catchupMin: 120 }, new Date("2026-06-29T21:30:00Z")), true);
});

test("edition cron step 30/15: 21:45 UTC = 17:45 ET (EDT) is IN window", () => {
  assert.equal(inEtWindow({ targetHour: 17, targetMinute: 30, catchupMin: 120 }, new Date("2026-06-29T21:45:00Z")), true);
});
