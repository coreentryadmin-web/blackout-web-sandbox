import { test } from "node:test";
import assert from "node:assert/strict";
import { isUwErrorFrame } from "./uw-frame";

test("non-empty string error is an error frame", () => {
  assert.equal(isUwErrorFrame({ error: "unauthorized" }), true);
});

test("empty/whitespace string error is NOT an error frame", () => {
  assert.equal(isUwErrorFrame({ error: "" }), false);
  assert.equal(isUwErrorFrame({ error: "   " }), false);
});

test("error:false is NOT an error frame", () => {
  assert.equal(isUwErrorFrame({ error: false }), false);
});

test("non-empty object error is an error frame; empty object is not", () => {
  assert.equal(isUwErrorFrame({ error: { code: 1 } }), true);
  assert.equal(isUwErrorFrame({ error: {} }), false);
});

test("plain data row is NOT an error frame", () => {
  assert.equal(isUwErrorFrame({ price: 1, size: 2 }), false);
});

test("status:ok frame is NOT an error frame (handled before isUwErrorFrame)", () => {
  assert.equal(isUwErrorFrame({ status: "ok" }), false);
});

test("non-object / array / primitive payloads are NOT error frames", () => {
  assert.equal(isUwErrorFrame(null), false);
  assert.equal(isUwErrorFrame(undefined), false);
  assert.equal(isUwErrorFrame(42), false);
  assert.equal(isUwErrorFrame([]), false);
  assert.equal(isUwErrorFrame([{ error: "x" }]), false);
});
