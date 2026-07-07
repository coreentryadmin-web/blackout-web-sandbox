import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketWallSampleTime, DEFAULT_WALL_TRAIL_SAMPLE_SEC } from "./vector-wall-sample";

test("bucketWallSampleTime: snaps to 15s floor", () => {
  assert.equal(bucketWallSampleTime(100, 15), 90);
  assert.equal(bucketWallSampleTime(105, 15), 105);
  assert.equal(bucketWallSampleTime(107, 15), 105);
  assert.equal(bucketWallSampleTime(120, 15), 120);
});

test("DEFAULT_WALL_TRAIL_SAMPLE_SEC is 15", () => {
  assert.equal(DEFAULT_WALL_TRAIL_SAMPLE_SEC, 15);
});
