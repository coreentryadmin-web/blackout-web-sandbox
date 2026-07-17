import { test } from "node:test";
import assert from "node:assert/strict";
import { uwSocketGateOpen } from "./uw-socket";

test("uwSocketGateOpen: non-leader always false", () => {
  assert.equal(uwSocketGateOpen(false), false);
});

test("uwSocketGateOpen: leader always true (24/7 for spot prices)", () => {
  assert.equal(uwSocketGateOpen(true), true);
});
