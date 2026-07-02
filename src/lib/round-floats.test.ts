import { test } from "node:test";
import assert from "node:assert/strict";
import { roundFloats } from "./round-floats";

test("rounds spurious float noise to 2dp by default", () => {
  assert.equal(roundFloats(7499.360000000001), 7499.36);
  assert.equal(roundFloats(-12701691969.618551), -12701691969.62);
});

test("leaves integers untouched (timestamps, counts, IDs)", () => {
  assert.equal(roundFloats(1751000000000), 1751000000000);
  assert.equal(roundFloats(0), 0);
  assert.equal(roundFloats(-42), -42);
});

test("leaves NaN/Infinity untouched rather than producing garbage", () => {
  assert.equal(roundFloats(NaN), NaN);
  assert.equal(roundFloats(Infinity), Infinity);
  assert.equal(roundFloats(-Infinity), -Infinity);
});

test("walks nested objects and arrays", () => {
  const input = {
    price: 7529.650000000001,
    meta: { vwap: 7514.418974358975, count: 12 },
    rows: [{ entry: 7430.900000000001, id: 9007199254740 }, { entry: null }],
  };
  assert.deepEqual(roundFloats(input), {
    price: 7529.65,
    meta: { vwap: 7514.42, count: 12 },
    rows: [{ entry: 7430.9, id: 9007199254740 }, { entry: null }],
  });
});

test("supports a custom decimal-place count", () => {
  assert.equal(roundFloats(1.23456, 4), 1.2346);
});

test("passes through non-numeric leaves unchanged", () => {
  assert.deepEqual(roundFloats({ a: "text", b: true, c: null, d: undefined }), {
    a: "text",
    b: true,
    c: null,
    d: undefined,
  });
});
