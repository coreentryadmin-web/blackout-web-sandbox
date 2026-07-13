import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pruneDynamicUniverse,
  DYNAMIC_UNIVERSE_CAP,
} from "./vector-dynamic-universe";

const DAY = 24 * 3600 * 1000;

test("pruneDynamicUniverse: drops entries older than retention, keeps fresh ones", () => {
  const now = 1_000 * DAY;
  const map = { HOOD: now - 1 * DAY, PLTR: now - 13 * DAY, OLD: now - 15 * DAY };
  const pruned = pruneDynamicUniverse(map, now);
  assert.deepEqual(Object.keys(pruned).sort(), ["HOOD", "PLTR"]);
});

test("pruneDynamicUniverse: caps at newest N by last-view", () => {
  const now = 1_000 * DAY;
  const map: Record<string, number> = {};
  for (let i = 0; i < DYNAMIC_UNIVERSE_CAP + 10; i++) map[`T${i}`] = now - i * 60_000;
  const pruned = pruneDynamicUniverse(map, now);
  assert.equal(Object.keys(pruned).length, DYNAMIC_UNIVERSE_CAP);
  assert.ok(pruned["T0"], "newest kept");
  assert.equal(pruned[`T${DYNAMIC_UNIVERSE_CAP + 5}`], undefined, "oldest evicted");
});

test("pruneDynamicUniverse: garbage timestamps dropped, empty map stays empty", () => {
  const now = 1_000 * DAY;
  assert.deepEqual(pruneDynamicUniverse({ BAD: NaN as unknown as number }, now), {});
  assert.deepEqual(pruneDynamicUniverse({}, now), {});
});
