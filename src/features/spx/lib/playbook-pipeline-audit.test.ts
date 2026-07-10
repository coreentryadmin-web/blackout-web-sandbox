import test from "node:test";
import assert from "node:assert/strict";
import { computePlaybookPipelineAudit } from "./playbook-pipeline-audit";
import type { PlaybookMatchVerdict } from "./playbook-shadow-matcher";

function verdict(
  overrides: Partial<PlaybookMatchVerdict> & Pick<PlaybookMatchVerdict, "playbook_id">
): PlaybookMatchVerdict {
  return {
    session_window_open: true,
    regime_eligible: true,
    precondition_match: false,
    trigger_fired: false,
    direction: null,
    detail: "",
    ...overrides,
  };
}

test("computePlaybookPipelineAudit: PB-02 short funnel", () => {
  const audit = computePlaybookPipelineAudit([
    verdict({
      playbook_id: "PB-02",
      precondition_match: true,
      trigger_fired: true,
      direction: "short",
    }),
  ]);
  assert.equal(audit.eligible_short, 1);
  assert.equal(audit.armed_short, 1);
  assert.equal(audit.triggered_short, 1);
  assert.equal(audit.triggered_long, 0);
});

test("computePlaybookPipelineAudit: gate block increments blocked_*", () => {
  const audit = computePlaybookPipelineAudit([], {
    gate_blocks: ["Unknown regime"],
    primary_direction: "short",
  });
  assert.equal(audit.blocked_short, 1);
  assert.equal(audit.blocked_long, 0);
});
