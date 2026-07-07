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

test("spyVolumeForMinuteBar: caches within the same minute bar", async () => {
  _resetSpyVolumeCacheForTest();
  let calls = 0;
  const fetchSpy = async () => {
    calls++;
    return [{ t: 1_750_000_000_000, o: 1, h: 1, l: 1, c: 1, v: 99 }];
  };
  const t = 1_750_000_000;
  assert.equal(await spyVolumeForMinuteBar(t, 1_750_000_010_000, fetchSpy), 99);
  assert.equal(await spyVolumeForMinuteBar(t, 1_750_000_020_000, fetchSpy), 99);
  assert.equal(calls, 1);
});
