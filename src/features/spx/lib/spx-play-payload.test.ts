import test from "node:test";
import assert from "node:assert/strict";
import { confirmationsForAction } from "./spx-play-payload";

const sampleConfirmations = {
  passed: true,
  passed_count: 7,
  total: 7,
  checks: [{ id: "flow", label: "Flow", passed: true }],
};

test("confirmationsForAction strips checks on SCANNING", () => {
  assert.equal(confirmationsForAction("SCANNING", sampleConfirmations), null);
});

test("confirmationsForAction keeps checks on WATCHING and BUY", () => {
  assert.equal(confirmationsForAction("WATCHING", sampleConfirmations), sampleConfirmations);
  assert.equal(confirmationsForAction("BUY", sampleConfirmations), sampleConfirmations);
});
