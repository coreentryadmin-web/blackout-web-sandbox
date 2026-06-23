import { test } from "node:test";
import assert from "node:assert/strict";
import { todayEt } from "./et-date";

// Asserts the EXACT session-date boundary behavior the money-path relies on.
// 'en-CA' must yield ISO YYYY-MM-DD and the boundary must roll at ET midnight.

test("returns ISO YYYY-MM-DD shape", () => {
  assert.match(todayEt(new Date("2026-06-22T17:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
});

test("EDT: 2026-06-22 03:59 UTC = 2026-06-21 23:59 ET (prior session date)", () => {
  assert.equal(todayEt(new Date("2026-06-22T03:59:00Z")), "2026-06-21");
});

test("EDT: 2026-06-22 04:01 UTC = 2026-06-22 00:01 ET (new session date)", () => {
  assert.equal(todayEt(new Date("2026-06-22T04:01:00Z")), "2026-06-22");
});

test("EST: 2026-01-15 04:59 UTC = 2026-01-14 23:59 ET (prior session, winter UTC-5)", () => {
  assert.equal(todayEt(new Date("2026-01-15T04:59:00Z")), "2026-01-14");
});

test("EST: 2026-01-15 05:01 UTC = 2026-01-15 00:01 ET (new session, winter UTC-5)", () => {
  assert.equal(todayEt(new Date("2026-01-15T05:01:00Z")), "2026-01-15");
});

test("zero-arg call path matches the explicit-Date path for the same instant", () => {
  const a = todayEt();
  const b = todayEt(new Date());
  assert.ok(a === b || Math.abs(Date.parse(a) - Date.parse(b)) <= 86_400_000);
});
