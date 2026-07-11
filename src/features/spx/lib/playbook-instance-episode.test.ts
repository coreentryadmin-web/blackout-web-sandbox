import test from "node:test";
import assert from "node:assert/strict";
import {
  isLegacyPlaybookInstanceId,
  parsePlaybookInstanceId,
  playbookInstanceId,
  resolveEpisodeInstance,
} from "./playbook-instance-episode";
import type { PlaybookMatchVerdict } from "./playbook-shadow-matcher";

const NOW = 1_720_000_000_000;

function verdict(overrides: Partial<PlaybookMatchVerdict>): PlaybookMatchVerdict {
  return {
    playbook_id: "PB-01",
    session_window_open: true,
    regime_eligible: true,
    precondition_match: true,
    trigger_fired: false,
    direction: null,
    detail: "",
    ...overrides,
  };
}

test("playbookInstanceId encodes session, playbook, direction, episode start", () => {
  const id = playbookInstanceId("2026-07-10", "PB-01", "long", NOW);
  assert.equal(id, `2026-07-10:PB-01:long:${NOW}`);
  const parsed = parsePlaybookInstanceId(id);
  assert.equal(parsed.legacy, false);
  assert.equal(parsed.playbook_id, "PB-01");
  assert.equal(parsed.episode_direction, "long");
  assert.equal(parsed.episode_start_ms, NOW);
});

test("legacy instance ids parse with legacy flag", () => {
  assert.equal(isLegacyPlaybookInstanceId("2026-07-10:PB-01"), true);
  const parsed = parsePlaybookInstanceId("2026-07-10:PB-01");
  assert.equal(parsed.legacy, true);
});

test("resolveEpisodeInstance spawns after terminal invalidated row", () => {
  const session = "2026-07-10";
  const old = playbookInstanceId(session, "PB-01", "long", NOW - 120_000);
  const resolved = resolveEpisodeInstance(
    session,
    verdict({ precondition_match: true }),
    [
      {
        instance_id: old,
        playbook_id: "PB-01",
        direction: "long",
        state: "invalidated",
        episode_direction: "long",
        episode_start_ms: NOW - 120_000,
      },
    ],
    NOW
  );
  assert.equal(resolved.spawned, true);
  assert.equal(resolved.from_state, "idle");
  assert.equal(resolved.instance_id, playbookInstanceId(session, "PB-01", "undirected", NOW));
});
