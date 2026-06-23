import { test } from "node:test";
import assert from "node:assert/strict";
import { freshestFeedAgeMs, classifyFeedStaleness } from "./feed-staleness";

test("freshestFeedAgeMs: empty -> null", () => {
  assert.equal(freshestFeedAgeMs([]), null);
});

test("freshestFeedAgeMs: all null/undefined -> null", () => {
  assert.equal(freshestFeedAgeMs([null, undefined, null]), null);
});

test("freshestFeedAgeMs: returns the minimum (freshest) age", () => {
  assert.equal(freshestFeedAgeMs([90_000, 5_000, 40_000]), 5_000);
});

test("freshestFeedAgeMs: ignores nulls but keeps numeric min", () => {
  assert.equal(freshestFeedAgeMs([null, 12_000, undefined]), 12_000);
});

test("freshestFeedAgeMs: ignores non-finite", () => {
  assert.equal(freshestFeedAgeMs([Infinity, NaN, 7_000]), 7_000);
});

test("classifyFeedStaleness: null -> never", () => {
  assert.equal(classifyFeedStaleness(null, 30_000, 120_000), "never");
});

test("classifyFeedStaleness: within warn -> fresh", () => {
  assert.equal(classifyFeedStaleness(10_000, 30_000, 120_000), "fresh");
});

test("classifyFeedStaleness: above warn, below critical -> stale", () => {
  assert.equal(classifyFeedStaleness(60_000, 30_000, 120_000), "stale");
});

test("classifyFeedStaleness: above critical -> critical", () => {
  assert.equal(classifyFeedStaleness(200_000, 30_000, 120_000), "critical");
});

test("classifyFeedStaleness: boundary == warn -> fresh (strict >)", () => {
  assert.equal(classifyFeedStaleness(30_000, 30_000, 120_000), "fresh");
});

test("classifyFeedStaleness: boundary == critical -> stale (strict >)", () => {
  assert.equal(classifyFeedStaleness(120_000, 30_000, 120_000), "stale");
});
