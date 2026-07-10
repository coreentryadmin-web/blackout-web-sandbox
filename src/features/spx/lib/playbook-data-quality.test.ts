import test from "node:test";
import assert from "node:assert/strict";
import {
  DEGRADED_FEED_LIVE_BLOCK_PLAYBOOKS,
  isDegradedForLivePlaybook,
  playbookDataQualityFlags,
} from "./playbook-data-quality";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

test("isDegradedForLivePlaybook: blocks event PB on halt stale", () => {
  const desk = { halt_channel_stale: true, polled_at: new Date().toISOString(), gex_walls: [{}] } as SpxDeskPayload;
  const flags = playbookDataQualityFlags(desk);
  assert.equal(isDegradedForLivePlaybook("PB-03", flags), true);
  assert.equal(isDegradedForLivePlaybook("PB-01", flags), false);
});

test("DEGRADED_FEED_LIVE_BLOCK_PLAYBOOKS includes breakout/event set", () => {
  assert.ok(DEGRADED_FEED_LIVE_BLOCK_PLAYBOOKS.has("PB-14"));
  assert.ok(!DEGRADED_FEED_LIVE_BLOCK_PLAYBOOKS.has("PB-01"));
});
