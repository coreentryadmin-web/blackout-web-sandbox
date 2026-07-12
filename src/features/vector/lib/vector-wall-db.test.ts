import { test } from "node:test";
import assert from "node:assert/strict";
// Import the mapper from the side-effect-free module, NOT vector-wall-db.ts: the latter is
// `import "server-only"`, which THROWS on a plain `tsx --test` import ("cannot be imported from
// a Client Component"). vector-wall-db.ts re-exports rowToWallSample, so the runtime surface is
// identical — this just avoids tripping the server-only guard in the test runner.
import { rowToWallSample } from "./vector-wall-db-row";

// The DB is unreachable from this sandbox (raw TCP blocked), so we only exercise the PURE
// row → sample mapper. The persist/load functions are thin wrappers around dbQuery and are
// covered by the guard behaviour (return false / [] without DATABASE_URL) at the type level.

const GEX = { callWalls: [{ strike: 6800, pct: 10 }], putWalls: [{ strike: 6700, pct: 8 }] };
const VEX = { callWalls: [{ strike: 6820, pct: 5 }], putWalls: [{ strike: 6680, pct: 4 }] };

test("rowToWallSample coerces a bigint-as-string bucket_time to a number", () => {
  const sample = rowToWallSample({
    bucket_time: "1700000000",
    walls: GEX,
    gamma_flip: 6750,
    vex_walls: null,
    vex_flip: null,
  });
  assert.equal(typeof sample.time, "number");
  assert.equal(sample.time, 1700000000);
  assert.deepEqual(sample.walls, GEX);
  assert.equal(sample.gammaFlip, 6750);
});

test("rowToWallSample maps null gamma_flip / vex_walls / vex_flip to nulls", () => {
  const sample = rowToWallSample({
    bucket_time: 1700000015,
    walls: GEX,
    gamma_flip: null,
    vex_walls: null,
    vex_flip: null,
  });
  assert.equal(sample.gammaFlip, null);
  assert.equal(sample.vexWalls, null);
  assert.equal(sample.vexFlip, null);
});

test("rowToWallSample carries a populated vex row through", () => {
  const sample = rowToWallSample({
    bucket_time: 1700000030,
    walls: GEX,
    gamma_flip: 6750,
    vex_walls: VEX,
    vex_flip: 6710,
  });
  assert.deepEqual(sample.vexWalls, VEX);
  assert.equal(sample.vexFlip, 6710);
});

test("rowToWallSample parses jsonb handed back as a string", () => {
  const sample = rowToWallSample({
    bucket_time: 1700000045,
    walls: JSON.stringify(GEX),
    gamma_flip: null,
    vex_walls: JSON.stringify(VEX),
    vex_flip: null,
  });
  assert.deepEqual(sample.walls, GEX);
  assert.deepEqual(sample.vexWalls, VEX);
});
