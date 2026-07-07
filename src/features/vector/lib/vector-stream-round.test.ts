import { test } from "node:test";
import assert from "node:assert/strict";
import { roundFloats } from "@/lib/round-floats";

test("vector stream payload shape rounds SPX candle OHLC and flip levels at the wire boundary", () => {
  const rounded = roundFloats({
    candle: {
      time: 1_750_000_000,
      open: 7486.400000000001,
      high: 7490.129999999999,
      low: 7484.830000000001,
      close: 7485.180000000001,
    },
    walls: {
      callWalls: [{ strike: 7550.000000000001, pct: 12.3456789 }],
      putWalls: [{ strike: 7475.999999999999, pct: 8.1 }],
    },
    gammaFlip: 7509.87654321,
    vexFlip: 7486.460000000001,
    t: 1_750_000_123_456,
    gexAsOf: 1_750_000_120_000,
    vexAsOf: 1_750_000_112_000,
  });

  assert.equal(rounded.candle.close, 7485.18);
  assert.equal(rounded.gammaFlip, 7509.88);
  assert.equal(rounded.vexFlip, 7486.46);
  assert.equal(rounded.walls.callWalls[0].strike, 7550);
  assert.equal(rounded.t, 1_750_000_123_456);
});
