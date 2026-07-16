import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketWallSampleTime,
  buildWallHistorySample,
  DEFAULT_WALL_TRAIL_SAMPLE_SEC,
} from "./vector-wall-sample";

test("bucketWallSampleTime: snaps to 5s floor", () => {
  assert.equal(bucketWallSampleTime(100, 5), 100);
  assert.equal(bucketWallSampleTime(103, 5), 100);
  assert.equal(bucketWallSampleTime(105, 5), 105);
  assert.equal(bucketWallSampleTime(107, 5), 105);
  assert.equal(bucketWallSampleTime(120, 5), 120);
});

test("DEFAULT_WALL_TRAIL_SAMPLE_SEC is 5", () => {
  assert.equal(DEFAULT_WALL_TRAIL_SAMPLE_SEC, 5);
});

const CALL = [{ strike: 7575, pct: 4, gex: 3_000_000_000 }];
const PUT = [{ strike: 7500, pct: 7, gex: -2_000_000_000 }];

test("buildWallHistorySample: builds a GEX+VEX sample and rounds the float tail", () => {
  const s = buildWallHistorySample({
    time: 1000,
    gexWalls: { callWalls: [{ strike: 7575, pct: 4.0000001, gex: 3e9 }], putWalls: PUT },
    gammaFlip: 7511.360000000001,
    vexWalls: { callWalls: CALL, putWalls: [] },
    vexFlip: 7574.64,
  });
  assert.ok(s);
  assert.equal(s!.time, 1000);
  assert.equal(s!.walls.callWalls[0]!.strike, 7575);
  // roundFloats must tame the precision tail — a same-bucket float delta vs the
  // live SSE path is exactly what fabricates phantom flip events on first merge.
  assert.ok(String(s!.gammaFlip).length <= 8, `flip not rounded: ${s!.gammaFlip}`);
  assert.ok(s!.vexWalls);
});

test("buildWallHistorySample: returns null when NEITHER lens has walls", () => {
  assert.equal(
    buildWallHistorySample({
      time: 1,
      gexWalls: { callWalls: [], putWalls: [] },
      gammaFlip: 7500,
      vexWalls: null,
      vexFlip: null,
    }),
    null
  );
  assert.equal(
    buildWallHistorySample({ time: 1, gexWalls: null, gammaFlip: null, vexWalls: undefined, vexFlip: null }),
    null
  );
});

test("buildWallHistorySample: honest gaps — a lens with no walls records empty/null, never a carry-forward", () => {
  const gexOnly = buildWallHistorySample({
    time: 1,
    gexWalls: { callWalls: CALL, putWalls: PUT },
    gammaFlip: 7511,
    vexWalls: { callWalls: [], putWalls: [] },
    vexFlip: 9999, // must be dropped: no vex walls this bucket
  });
  assert.ok(gexOnly);
  assert.equal(gexOnly!.vexWalls, null);
  assert.equal(gexOnly!.vexFlip, null);

  const vexOnly = buildWallHistorySample({
    time: 1,
    gexWalls: { callWalls: [], putWalls: [] },
    gammaFlip: 8888, // must be dropped: no gex walls this bucket
    vexWalls: { callWalls: CALL, putWalls: PUT },
    vexFlip: 7574,
  });
  assert.ok(vexOnly);
  assert.deepEqual(vexOnly!.walls, { callWalls: [], putWalls: [] });
  assert.equal(vexOnly!.gammaFlip, null);
});
