import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSpyVolumeRows } from "./vector-spy-volume-merge";

// mergeSpyVolumeRows regression: VectorChart.tsx polls /api/market/vector/spy-volume on an
// interval (SPY_VOLUME_BACKFILL_MS) rather than once at mount, because Polygon only ever
// returns CLOSED minute bars — a one-shot fetch permanently misses the volume for every bar
// that closes after that single call, which is exactly what was observed live: the volume
// histogram silently stopped updating for the rest of the session after initial page load.
// These tests lock in the property the periodic-poll fix depends on: repeated merges with a
// growing/refreshed row set are safe (idempotent, never clobber, always pick up new rows).

test("mergeSpyVolumeRows: fills in volume for bars matching a fetched row's minute bucket", () => {
  const bars = [
    { time: 100, open: 1, high: 1, low: 1, close: 1 },
    { time: 160, open: 2, high: 2, low: 2, close: 2 },
  ];
  const merged = mergeSpyVolumeRows(bars, [{ time: 100, volume: 55_000 }]);
  assert.equal(merged[0].volume, 55_000);
  assert.equal(merged[1].volume, undefined);
});

test("mergeSpyVolumeRows: repeated calls with the same rows are idempotent (safe to poll)", () => {
  const bars = [{ time: 100, open: 1, high: 1, low: 1, close: 1 }];
  const rows = [{ time: 100, volume: 55_000 }];
  const once = mergeSpyVolumeRows(bars, rows);
  const twice = mergeSpyVolumeRows(once, rows);
  assert.equal(twice[0].volume, 55_000);
});

test("mergeSpyVolumeRows: a later poll with newly-closed bars fills in volume that an earlier poll couldn't have had", () => {
  const bars = [
    { time: 100, open: 1, high: 1, low: 1, close: 1, volume: 55_000 }, // already filled by an earlier poll
    { time: 160, open: 2, high: 2, low: 2, close: 2 }, // just closed since the last poll
  ];
  // The new poll's response only carries the newly-closed bar's row (100 already applied).
  const merged = mergeSpyVolumeRows(bars, [{ time: 160, volume: 61_000 }]);
  assert.equal(merged[0].volume, 55_000, "earlier fill must survive an unrelated later poll");
  assert.equal(merged[1].volume, 61_000, "newly-closed bar picks up its volume on this poll");
});
