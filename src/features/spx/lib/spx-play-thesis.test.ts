import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateOpenThesisBreak,
  evaluateThesisBreak,
} from "./spx-play-thesis";

test("evaluateThesisBreak: floor break fires immediately for long", () => {
  // Score must breach floor (-40) without also breaching the drop threshold.
  const r = evaluateThesisBreak("long", -42, -50);
  assert.equal(r.broken, true);
  assert.equal(r.trigger, "floor");
});

test("evaluateOpenThesisBreak: defers score-drop when MFE=0 and hold under 3m", () => {
  const now = Date.now();
  const r = evaluateOpenThesisBreak("long", 50, 75, {
    mfePts: 0,
    openedAtMs: now - 60_000,
    nowMs: now,
  });
  assert.equal(r.broken, false);
  assert.equal(r.trigger, null);
});

test("evaluateOpenThesisBreak: allows score-drop after min MFE and hold", () => {
  const now = Date.now();
  const r = evaluateOpenThesisBreak("long", 50, 75, {
    mfePts: 3,
    openedAtMs: now - 200_000,
    nowMs: now,
  });
  assert.equal(r.broken, true);
  assert.equal(r.trigger, "drop");
});

test("evaluateOpenThesisBreak: floor break ignores MFE deferral", () => {
  const now = Date.now();
  const r = evaluateOpenThesisBreak("short", 45, 30, {
    mfePts: 0,
    openedAtMs: now - 30_000,
    nowMs: now,
  });
  assert.equal(r.broken, true);
  assert.equal(r.trigger, "floor");
});
