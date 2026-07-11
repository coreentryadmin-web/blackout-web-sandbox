import { test } from "node:test";
import assert from "node:assert/strict";
import {
  _resetSpyVolumeCacheForTest,
  fetchSpyVolumeByMinute,
  spyVolumeForMinuteBar,
} from "./vector-spy-volume";

test("fetchSpyVolumeByMinute: maps minute epoch to share volume", async () => {
  const map = await fetchSpyVolumeByMinute(
    "2026-07-07",
    async () => [
      { t: 1_783_431_000_000, o: 1, h: 1, l: 1, c: 1, v: 55_000 },
      { t: 1_783_431_060_000, o: 1, h: 1, l: 1, c: 1, v: 12_000 },
    ],
    1
  );
  assert.equal(map.get(1_783_431_000), 55_000);
  assert.equal(map.get(1_783_431_060), 12_000);
});

test("spyVolumeForMinuteBar: returns SPY volume for matching minute bucket", async () => {
  _resetSpyVolumeCacheForTest();
  const barTime = 1_750_000_000;
  const vol = await spyVolumeForMinuteBar(
    barTime,
    1_750_000_500_000,
    async () => [{ t: barTime * 1000, o: 1, h: 1, l: 1, c: 1, v: 1_234_567 }]
  );
  assert.equal(vol, 1_234_567);
});

test("spyVolumeForMinuteBar: forming-bar lookups inside the day-bars window share one fetch", async () => {
  _resetSpyVolumeCacheForTest();
  let calls = 0;
  const fetchSpy = async () => {
    calls++;
    return [{ t: 1_750_000_000_000, o: 1, h: 1, l: 1, c: 1, v: 99 }];
  };
  const t = 1_750_000_000;
  // bar is still forming (now < bar close) — served from the 10s day-bars cache
  assert.equal(await spyVolumeForMinuteBar(t, 1_750_000_010_000, fetchSpy), 99);
  assert.equal(await spyVolumeForMinuteBar(t, 1_750_000_019_000, fetchSpy), 99);
  assert.equal(calls, 1);
});

test("spyVolumeForMinuteBar: a CLOSED bar long-caches past the day-bars window", async () => {
  _resetSpyVolumeCacheForTest();
  let calls = 0;
  const fetchSpy = async () => {
    calls++;
    return [{ t: 1_750_000_000_000, o: 1, h: 1, l: 1, c: 1, v: 99 }];
  };
  const t = 1_750_000_000;
  const afterClose = (t + 61) * 1000;
  assert.equal(await spyVolumeForMinuteBar(t, afterClose, fetchSpy), 99);
  // 30s later — outside the 10s day-bars window, inside the 55s positive cache
  assert.equal(await spyVolumeForMinuteBar(t, afterClose + 30_000, fetchSpy), 99);
  assert.equal(calls, 1);
});

test("spyVolumeForMinuteBar: MISSES are negative-cached — no per-tick full-day refetch", async () => {
  // The regression this pins: the caller asks for the currently-forming minute
  // every ~1s and Polygon has no row until it closes; without a negative cache
  // every miss refetched the entire day (~60 Polygon calls/min, all session).
  _resetSpyVolumeCacheForTest();
  let calls = 0;
  const fetchSpy = async () => {
    calls++;
    return []; // Polygon has not published the forming bar yet
  };
  const t = 1_750_000_000;
  assert.equal(await spyVolumeForMinuteBar(t, 1_750_000_010_000, fetchSpy), undefined);
  assert.equal(await spyVolumeForMinuteBar(t, 1_750_000_011_000, fetchSpy), undefined);
  assert.equal(await spyVolumeForMinuteBar(t, 1_750_000_015_000, fetchSpy), undefined);
  assert.equal(calls, 1, "misses within the window must not refetch");
  // window expiry → exactly one more fetch
  assert.equal(await spyVolumeForMinuteBar(t, 1_750_000_021_000, fetchSpy), undefined);
  assert.equal(calls, 2);
});
