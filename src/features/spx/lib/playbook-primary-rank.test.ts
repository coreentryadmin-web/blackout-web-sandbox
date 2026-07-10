import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAYBOOK_FLOW_MODIFIER_IDS,
  PLAYBOOK_PRIMARY_PRIORITY,
  pickPrimaryPlaybook,
} from "./playbook-primary-rank";
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

test("pickPrimaryPlaybook: PB-03 beats PB-01 on simultaneous trigger", () => {
  const primary = pickPrimaryPlaybook([
    verdict({ playbook_id: "PB-01", direction: "long" }),
    verdict({ playbook_id: "PB-03", direction: "long" }),
  ]);
  assert.equal(primary, "PB-03");
});

test("pickPrimaryPlaybook: PB-13 beats PB-03 on simultaneous trigger", () => {
  const primary = pickPrimaryPlaybook([
    verdict({ playbook_id: "PB-03", direction: "long" }),
    verdict({ playbook_id: "PB-13", direction: "short" }),
  ]);
  assert.equal(primary, "PB-13");
});

test("pickPrimaryPlaybook: null when only PB-09 fires", () => {
  const primary = pickPrimaryPlaybook([verdict({ playbook_id: "PB-09", direction: "long" })]);
  assert.equal(primary, null);
});
