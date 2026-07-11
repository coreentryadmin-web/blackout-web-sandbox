import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPlaybookVerdictGuards,
  nextArmedPollCounts,
  playbookExitProfile,
} from "./playbook-verdict-guard";
import type { PlaybookMatchVerdict } from "./playbook-shadow-matcher";

function verdict(
  id: string,
  overrides: Partial<PlaybookMatchVerdict> = {}
): PlaybookMatchVerdict {
  return {
    playbook_id: id as PlaybookMatchVerdict["playbook_id"],
    session_window_open: true,
    regime_eligible: true,
    precondition_match: true,
    trigger_fired: true,
    direction: "long",
    detail: "test",
    ...overrides,
  };
}

test("applyPlaybookVerdictGuards: blocks same-tick trigger without armed polls", () => {
  const session = "2026-07-10";
  const guarded = applyPlaybookVerdictGuards(
    session,
    [verdict("PB-01")],
    new Map(),
    new Map()
  );
  assert.equal(guarded[0].trigger_fired, false);
  assert.match(guarded[0].detail, /guard:/);
});

test("applyPlaybookVerdictGuards: allows trigger after min armed polls", () => {
  const session = "2026-07-10";
  const instanceId = `${session}:PB-01`;
  const guarded = applyPlaybookVerdictGuards(
    session,
    [verdict("PB-01")],
    new Map([[instanceId, "armed"]]),
    new Map([[instanceId, 2]])
  );
  assert.equal(guarded[0].trigger_fired, true);
});

test("nextArmedPollCounts: increments precondition_match instances", () => {
  const session = "2026-07-10";
  const next = nextArmedPollCounts(session, [verdict("PB-01", { trigger_fired: false })], new Map());
  assert.equal(next.get(`${session}:PB-01`), 1);
});

test("playbookExitProfile: returns default for unknown id", () => {
  const p = playbookExitProfile(null);
  assert.equal(p.label, "default");
  assert.equal(p.trim_mfe_mult, 1);
});
