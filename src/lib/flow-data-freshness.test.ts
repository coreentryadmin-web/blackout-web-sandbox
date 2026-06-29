import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markFlowDataFresh,
  newestFlowAgeMsFromBriefs,
  resolveFlowDataAgeMs,
} from "./flow-data-freshness";

test("newestFlowAgeMsFromBriefs uses the newest alerted_at row", () => {
  const now = Date.parse("2026-06-29T16:00:00.000Z");
  const age = newestFlowAgeMsFromBriefs(
    [
      { alerted_at: "2026-06-29T15:30:00.000Z" },
      { alerted_at: "2026-06-29T15:58:00.000Z" },
    ],
    now
  );
  assert.equal(age, 2 * 60_000);
});

test("resolveFlowDataAgeMs prefers fresh tape over stale in-memory stamp", () => {
  markFlowDataFresh(Date.parse("2026-06-29T14:00:00.000Z"));
  const now = Date.parse("2026-06-29T16:00:00.000Z");
  const age = resolveFlowDataAgeMs([{ alerted_at: "2026-06-29T15:58:00.000Z" }], now);
  assert.equal(age, 2 * 60_000);
});
