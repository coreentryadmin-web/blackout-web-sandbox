import test from "node:test";
import assert from "node:assert/strict";
import {
  DEGRADED_FEED_LIVE_BLOCK_PLAYBOOKS,
  isDegradedForLivePlaybook,
  liveDataQualityMode,
  playbookDataQualityFlags,
  shouldFailClosedLiveOnDataQuality,
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

test("liveDataQualityMode: severe when 2+ feed issues", () => {
  assert.equal(
    liveDataQualityMode({ halt_channel_stale: true, desk_stale: true, gex_missing: false }),
    "severe"
  );
  assert.equal(
    liveDataQualityMode({ halt_channel_stale: true, desk_stale: false, gex_missing: false }),
    "degraded"
  );
  assert.equal(
    liveDataQualityMode({ halt_channel_stale: false, desk_stale: false, gex_missing: false }),
    "normal"
  );
  assert.equal(shouldFailClosedLiveOnDataQuality("severe"), true);
  assert.equal(shouldFailClosedLiveOnDataQuality("degraded"), false);
});
