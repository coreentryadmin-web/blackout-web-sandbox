import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { playbookInstanceId } from "./playbook-instance-episode";

mock.module("server-only", { namedExports: {} });

const SESSION = "2026-07-11";
const NOW = Date.parse("2026-07-11T15:00:00.000Z");
const armedAt = NOW - 10_000;
const instanceId = playbookInstanceId(SESSION, "PB-01", "long", armedAt);

let instanceStateLoad = 0;

const baseRow = {
  instance_id: instanceId,
  playbook_id: "PB-01",
  direction: "long" as const,
  armed_poll_count: 2,
  triggered_at_ms: null as number | null,
  armed_at_ms: armedAt,
  invalidated_at_ms: null as number | null,
  trigger_count: 0,
};

mock.module("../../../lib/db", {
  namedExports: {
    dbConfigured: () => true,
    loadPlaybookInstanceStates: async () => {
      instanceStateLoad += 1;
      if (instanceStateLoad === 1) {
        return [{ ...baseRow, state: "armed" as const }];
      }
      return [{ ...baseRow, state: "idle" as const }];
    },
    loadPlaybookArmedPollCounts: async () => new Map([[instanceId, 2]]),
    loadPlaybookTriggerCountsByPb: async () => new Map<string, number>(),
  },
});

mock.module("./playbook-shadow-matcher", {
  namedExports: {
    matchPlaybooksShadow: () => ({
      verdicts: [
        {
          playbook_id: "PB-01",
          session_window_open: true,
          regime_eligible: true,
          precondition_match: true,
          trigger_fired: true,
          direction: "long",
          detail: "test trigger",
        },
      ],
      primary_playbook_id: "PB-01",
    }),
  },
});

const desk = { available: true, price: 6000 } as SpxDeskPayload;
const technicals = { available: true, price: 6000 } as PlayTechnicals;

test("resolveGuardedPlaybookMatch: fresh DB read catches idle desync on assert", async () => {
  const prev = process.env.PLAYBOOK_VERDICT_GUARD_ASSERT;
  process.env.PLAYBOOK_VERDICT_GUARD_ASSERT = "1";
  instanceStateLoad = 0;
  try {
    const { resolveGuardedPlaybookMatch } = await import("./playbook-match-resolver");
    await assert.rejects(
      () => resolveGuardedPlaybookMatch(SESSION, desk, technicals, { now: NOW }),
      /persisted FSM state is idle/
    );
    assert.equal(instanceStateLoad, 2, "assert path must re-read instance state from DB");
  } finally {
    if (prev === undefined) delete process.env.PLAYBOOK_VERDICT_GUARD_ASSERT;
    else process.env.PLAYBOOK_VERDICT_GUARD_ASSERT = prev;
  }
});
