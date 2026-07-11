import test from "node:test";
import assert from "node:assert/strict";
import { rankPrimaryCandidates } from "./playbook-primary-score";
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

test("rankPrimaryCandidates: excludes non-triggered and regime-ineligible", () => {
  const ranked = rankPrimaryCandidates([
    verdict({ playbook_id: "PB-01", trigger_fired: false }),
    verdict({ playbook_id: "PB-03", regime_eligible: false }),
    verdict({ playbook_id: "PB-02" }),
  ]);
  assert.deepEqual(ranked.map((r) => r.playbook_id), ["PB-02"]);
});

test("rankPrimaryCandidates: family conflict penalizes weaker peer", () => {
  const ranked = rankPrimaryCandidates([
    verdict({ playbook_id: "PB-01", direction: "long" }),
    verdict({ playbook_id: "PB-13", direction: "long" }),
  ]);
  const pb13 = ranked.find((r) => r.playbook_id === "PB-13")!;
  assert.equal(pb13.family_conflict_penalty, -6);
  assert.equal(ranked[0]!.playbook_id, "PB-01");
});

test("rankPrimaryCandidates: static priority tie-break only when totals match", () => {
  const priority = { "PB-13": 0, "PB-14": 1, "PB-03": 2 } as const;
  const rows = rankPrimaryCandidates(
    [
      verdict({ playbook_id: "PB-13", direction: "long" }),
      verdict({ playbook_id: "PB-14", direction: "long" }),
    ],
    {},
    priority,
  );
  // PB-14 (high fidelity) outranks PB-13 (mvp) on evidence — not a static-order tie.
  assert.equal(rows[0]!.playbook_id, "PB-14");
  assert.ok(rows[0]!.total > rows[1]!.total);
});

test("rankPrimaryCandidates: sorts by total then static_priority_tiebreak", () => {
  const ranked = rankPrimaryCandidates(
    [
      verdict({ playbook_id: "PB-13", direction: "long" }),
      verdict({ playbook_id: "PB-03", direction: "long" }),
    ],
    { armed_polls_by_pb: new Map([["PB-13", 3], ["PB-03", 3]]) },
  );
  assert.equal(ranked[0]!.playbook_id, "PB-03");
  assert.ok(ranked[0]!.total > ranked[1]!.total);
});
