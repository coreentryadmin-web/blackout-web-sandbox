import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAYBOOK_OOS_START_DATE,
  PLAYBOOK_TRAIN_CUTOFF_DATE,
  isPlaybookOosSessionDate,
} from "./playbook-evidence-config";
import { computeCounterfactualExcursion } from "./playbook-instance-events";

test("OOS firewall dates", () => {
  assert.equal(isPlaybookOosSessionDate(PLAYBOOK_OOS_START_DATE), true);
  assert.equal(isPlaybookOosSessionDate(PLAYBOOK_TRAIN_CUTOFF_DATE), false);
});

test("computeCounterfactualExcursion: long favorable move", () => {
  const r = computeCounterfactualExcursion("long", 7400, 7410, 0, 0);
  assert.equal(r.mfe_pts, 10);
  assert.equal(r.mae_pts, 0);
});

test("computeCounterfactualExcursion: short adverse move", () => {
  const r = computeCounterfactualExcursion("short", 7400, 7410, 0, 0);
  assert.equal(r.mfe_pts, 0);
  assert.equal(r.mae_pts, 10);
});
