import { test } from "node:test";
import assert from "node:assert/strict";
import {
  narrativeBudgetKey,
  isOverNarrativeBudget,
  narrativeDailyBudget,
  NARRATIVE_DAILY_BUDGET,
} from "./narrative-budget";

test("narrativeBudgetKey is GLOBAL (no userId) and ET-day namespaced", () => {
  const k = narrativeBudgetKey(new Date("2026-06-24T18:00:00Z"));
  assert.match(k, /^narrative:budget:\d{4}-\d{2}-\d{2}$/);
  assert.ok(!k.includes("user"), "narrative budget key must not be per-user");
});

test("narrativeBudgetKey rolls over at ET midnight", () => {
  // 03:30Z = 23:30 ET on the 23rd (EDT, UTC-4) → still the 23rd
  const before = narrativeBudgetKey(new Date("2026-06-24T03:30:00Z"));
  // 05:00Z = 01:00 ET on the 24th → rolled over
  const after = narrativeBudgetKey(new Date("2026-06-24T05:00:00Z"));
  assert.notEqual(before, after);
});

test("isOverNarrativeBudget gates at/over the cap", () => {
  assert.equal(isOverNarrativeBudget(NARRATIVE_DAILY_BUDGET - 1), false);
  assert.equal(isOverNarrativeBudget(NARRATIVE_DAILY_BUDGET), true);
  assert.equal(isOverNarrativeBudget(NARRATIVE_DAILY_BUDGET + 5), true);
  // explicit cap override
  assert.equal(isOverNarrativeBudget(4, 5), false);
  assert.equal(isOverNarrativeBudget(5, 5), true);
});

test("narrativeDailyBudget reads env override, falls back on invalid", () => {
  assert.equal(
    narrativeDailyBudget({ NIGHTS_WATCH_NARRATIVE_BUDGET: "750" } as unknown as NodeJS.ProcessEnv),
    750
  );
  assert.equal(narrativeDailyBudget({} as unknown as NodeJS.ProcessEnv), NARRATIVE_DAILY_BUDGET);
  assert.equal(
    narrativeDailyBudget({ NIGHTS_WATCH_NARRATIVE_BUDGET: "0" } as unknown as NodeJS.ProcessEnv),
    NARRATIVE_DAILY_BUDGET
  );
  assert.equal(
    narrativeDailyBudget({ NIGHTS_WATCH_NARRATIVE_BUDGET: "abc" } as unknown as NodeJS.ProcessEnv),
    NARRATIVE_DAILY_BUDGET
  );
});
