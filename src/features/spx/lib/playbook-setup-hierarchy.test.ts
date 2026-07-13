import test from "node:test";
import assert from "node:assert/strict";
import {
  formatPlaybookHierarchyPath,
  playbookSubtypeGroups,
  PLAYBOOK_HIERARCHY,
} from "./playbook-setup-hierarchy";
import { instanceSchemaCoverageSummary } from "./playbook-implementation-status";

test("playbookSubtypeGroups: mean_reversion splits level_rejection vs gravitation", () => {
  const groups = playbookSubtypeGroups();
  const levelReject = groups.find(
    (g) => g.setup_family === "mean_reversion" && g.structural_subtype === "level_rejection"
  );
  const gravitation = groups.find(
    (g) => g.setup_family === "mean_reversion" && g.structural_subtype === "price_gravitation"
  );
  assert.ok(levelReject);
  assert.deepEqual(levelReject!.playbook_ids.sort(), ["PB-02", "PB-04"]);
  assert.ok(gravitation);
  assert.deepEqual(gravitation!.playbook_ids, ["PB-07"]);
});

test("playbookSubtypeGroups: reversal_failure is not one homogeneous bucket", () => {
  const subtypes = playbookSubtypeGroups()
    .filter((g) => g.setup_family === "reversal_failure")
    .map((g) => g.structural_subtype);
  assert.ok(subtypes.length >= 4);
  assert.ok(subtypes.includes("level_reclaim"));
  assert.ok(subtypes.includes("failed_break_reversal"));
});

test("formatPlaybookHierarchyPath: includes parameter version", () => {
  const path = formatPlaybookHierarchyPath("PB-01");
  assert.match(path, /reversal_failure → level_reclaim → PB-01 → v1_default/);
});

test("PLAYBOOK_HIERARCHY: every PB-01..14 mapped", () => {
  for (let i = 1; i <= 14; i++) {
    const id = `PB-${String(i).padStart(2, "0")}` as keyof typeof PLAYBOOK_HIERARCHY;
    assert.ok(PLAYBOOK_HIERARCHY[id]);
  }
});

test("instanceSchemaCoverageSummary: 19 implemented, 1 partial, 0 not_started", () => {
  const c = instanceSchemaCoverageSummary();
  assert.equal(c.total, 20);
  assert.equal(c.implemented, 19);
  assert.equal(c.partial, 1);
  assert.equal(c.not_started, 0);
});
