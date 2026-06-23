import { test } from "node:test";
import assert from "node:assert/strict";
import {
  largoBudgetKey,
  largoDailyQueryBudget,
  secondsUntilEtMidnight,
  isOverLargoBudget,
  DEFAULT_LARGO_DAILY_QUERY_BUDGET,
} from "./largo-budget";
import { etDayKey } from "./ai-spend";

// Pure unit tests for the per-user daily Largo budget module. Alias-free (imports only
// sibling ./ai-spend), runnable via `npx tsx --test` — no Redis, no Next boot.

test("key format is largo:budget:{userId}:{etDayKey}", () => {
  const now = new Date("2026-06-22T15:00:00Z"); // 11:00 ET, same calendar day
  assert.equal(largoBudgetKey("user_42", now), `largo:budget:user_42:${etDayKey(now)}`);
  assert.equal(largoBudgetKey("user_42", now), "largo:budget:user_42:2026-06-22");
});

test("day component buckets by ET, not UTC (rollover across ET midnight)", () => {
  const lateNightEt = new Date("2026-06-23T03:30:00Z"); // 23:30 ET on the 22nd
  const afterEtMidnight = new Date("2026-06-23T04:30:00Z"); // 00:30 ET on the 23rd
  assert.equal(largoBudgetKey("u", lateNightEt), "largo:budget:u:2026-06-22");
  assert.equal(largoBudgetKey("u", afterEtMidnight), "largo:budget:u:2026-06-23");
});

test("env cap: unset falls back to default 100", () => {
  assert.equal(largoDailyQueryBudget({} as NodeJS.ProcessEnv), 100);
  assert.equal(largoDailyQueryBudget({} as NodeJS.ProcessEnv), DEFAULT_LARGO_DAILY_QUERY_BUDGET);
});

test("env cap: valid integer string parsed", () => {
  assert.equal(largoDailyQueryBudget({ LARGO_DAILY_QUERY_BUDGET: "250" } as NodeJS.ProcessEnv), 250);
});

test("env cap: zero, negative, non-numeric fall back to default", () => {
  assert.equal(largoDailyQueryBudget({ LARGO_DAILY_QUERY_BUDGET: "0" } as NodeJS.ProcessEnv), 100);
  assert.equal(largoDailyQueryBudget({ LARGO_DAILY_QUERY_BUDGET: "-5" } as NodeJS.ProcessEnv), 100);
  assert.equal(largoDailyQueryBudget({ LARGO_DAILY_QUERY_BUDGET: "abc" } as NodeJS.ProcessEnv), 100);
});

test("env cap: fractional value is floored", () => {
  assert.equal(largoDailyQueryBudget({ LARGO_DAILY_QUERY_BUDGET: "12.9" } as NodeJS.ProcessEnv), 12);
});

test("over-cap predicate: at/over cap is true, below is false", () => {
  assert.equal(isOverLargoBudget(0, 100), false);
  assert.equal(isOverLargoBudget(99, 100), false);
  assert.equal(isOverLargoBudget(100, 100), true);
  assert.equal(isOverLargoBudget(101, 100), true);
});

test("secondsUntilEtMidnight ≈ 86400 - elapsed ET seconds at a known wall-clock", () => {
  const now = new Date("2026-06-22T16:00:00Z"); // 12:00:00 ET (EDT) -> 43200 elapsed
  const remaining = secondsUntilEtMidnight(now);
  assert.ok(Math.abs(remaining - (86_400 - 43_200)) <= 2, `got ${remaining}`);
});

test("floors at 60s just before ET midnight", () => {
  const now = new Date("2026-06-23T03:59:50Z"); // 23:59:50 ET on the 22nd -> ~10s
  assert.equal(secondsUntilEtMidnight(now), 60);
});

test("result is always within [60, 26*3600] across many instants", () => {
  for (let h = 0; h < 24; h++) {
    const now = new Date(`2026-06-22T${String(h).padStart(2, "0")}:17:33Z`);
    const s = secondsUntilEtMidnight(now);
    assert.ok(s >= 60 && s <= 26 * 3600, `h=${h} -> ${s} out of range`);
  }
});
