import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePlaybookSessionRisk } from "./playbook-session-risk";

test("evaluatePlaybookSessionRisk: blocks at session trigger cap", () => {
  const result = evaluatePlaybookSessionRisk({
    playbook_id: "PB-01",
    triggers_today_by_pb: new Map([["PB-01", 3]]),
    desk: { vix: 16 },
  });
  assert.ok(result.block);
  assert.equal(result.size_multiplier, 0);
});

test("evaluatePlaybookSessionRisk: passes under cap", () => {
  const result = evaluatePlaybookSessionRisk({
    playbook_id: "PB-02",
    triggers_today_by_pb: new Map([["PB-02", 1]]),
    desk: { vix: 16 },
  });
  assert.equal(result.block, null);
  assert.equal(result.size_multiplier, 1);
});
