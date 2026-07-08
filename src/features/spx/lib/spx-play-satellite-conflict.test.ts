import assert from "node:assert/strict";
import { test } from "node:test";
import {
  satelliteConflictsMain,
  satelliteConflictLabel,
} from "./spx-play-satellite-conflict";

test("satelliteConflictsMain: flags opposite direction when both active", () => {
  assert.equal(
    satelliteConflictsMain(
      { direction: "long", action: "BUY" },
      { direction: "short", phase: "WATCH" }
    ),
    true
  );
});

test("satelliteConflictsMain: ignores SCANNING main", () => {
  assert.equal(
    satelliteConflictsMain(
      { direction: "long", action: "SCANNING" },
      { direction: "short", phase: "WATCH" }
    ),
    false
  );
});

test("satelliteConflictLabel", () => {
  assert.equal(satelliteConflictLabel("short", "long"), "PUT vs main CALL");
});
