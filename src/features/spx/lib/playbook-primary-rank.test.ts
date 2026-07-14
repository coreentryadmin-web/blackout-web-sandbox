import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAYBOOK_FLOW_MODIFIER_IDS,
  PLAYBOOK_PRIMARY_PRIORITY,
  pickPrimaryPlaybook,
  pickPrimaryWithBreakdown,
  primaryPriorityIndex,
} from "./playbook-primary-rank";
import {
  rankPrimaryCandidates,
  type PrimaryRankContext,
} from "./playbook-primary-score";
import type { PlaybookMatchVerdict } from "./playbook-shadow-matcher";

function verdict(
  overrides: Partial<PlaybookMatchVerdict> & Pick<PlaybookMatchVerdict, "playbook_id">
): PlaybookMatchVerdict {
  return {
    session_window_open: true,
    regime_eligible: true,
    precondition_match: true,
    trigger_fired: true,
    direction: "long",
    detail: "",
    ...overrides,
  };
}

test("PLAYBOOK_PRIMARY_PRIORITY excludes PB-09", () => {
  assert.ok(!PLAYBOOK_PRIMARY_PRIORITY.includes("PB-09"));
  assert.ok(PLAYBOOK_FLOW_MODIFIER_IDS.has("PB-09"));
});

test("pickPrimaryPlaybook: PB-09 never wins when other playbooks fire", () => {
  const primary = pickPrimaryPlaybook([
    verdict({ playbook_id: "PB-09", direction: "long" }),
    verdict({ playbook_id: "PB-01", direction: "long" }),
  ]);
  assert.equal(primary, "PB-01");
});

test("pickPrimaryPlaybook: high-fidelity PB-01 beats mvp PB-13 on equal triggers", () => {
  const primary = pickPrimaryPlaybook([
    verdict({ playbook_id: "PB-13", direction: "short" }),
    verdict({ playbook_id: "PB-01", direction: "long" }),
  ]);
  assert.equal(primary, "PB-01");
});

test("pickPrimaryPlaybook: static priority tie-break when composite scores equal", () => {
  const ctx: PrimaryRankContext = {
    armed_polls_by_pb: new Map([
      ["PB-13", 3],
      ["PB-03", 3],
    ]),
  };
  const ranked = rankPrimaryCandidates(
    [
      verdict({ playbook_id: "PB-13", direction: "long" }),
      verdict({ playbook_id: "PB-03", direction: "long" }),
    ],
    ctx,
    Object.fromEntries(PLAYBOOK_PRIMARY_PRIORITY.map((id, i) => [id, i])),
  );
  const primary = pickPrimaryPlaybook(
    [
      verdict({ playbook_id: "PB-13", direction: "long" }),
      verdict({ playbook_id: "PB-03", direction: "long" }),
    ],
    ctx,
  );
  // PB-03 (high fidelity) outscores PB-13 (mvp) — evidence beats static order.
  assert.equal(primary, "PB-03");
  assert.equal(ranked[0]!.playbook_id, "PB-03");
  assert.ok(primaryPriorityIndex("PB-13") < primaryPriorityIndex("PB-03"));
});

test("pickPrimaryWithBreakdown: exposes composite breakdown for evidence winner", () => {
  const { primary, breakdown } = pickPrimaryWithBreakdown([
    verdict({ playbook_id: "PB-13", direction: "long" }),
    verdict({ playbook_id: "PB-02", direction: "long" }),
  ]);
  assert.equal(primary, "PB-02");
  assert.equal(breakdown?.playbook_id, "PB-02");
  assert.equal(breakdown?.fidelity_tier, 12);
});

test("pickPrimaryPlaybook: null when only PB-09 fires", () => {
  const primary = pickPrimaryPlaybook([verdict({ playbook_id: "PB-09", direction: "long" })]);
  assert.equal(primary, null);
});
