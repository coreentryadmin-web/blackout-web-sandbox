import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowHaltDegradedBanner } from "./spx-halt-banner";

test("halt degraded banner: hidden off-hours even when the channel reads stale", () => {
  // Regression: the UW trading_halts channel is event-only and goes naturally
  // quiet outside RTH (holidays, overnight) -- that used to show a banner
  // claiming "entries blocked" when the session isn't even active.
  assert.equal(
    shouldShowHaltDegradedBanner({ sessionActive: false, haltChannelStale: true, activeHaltsCount: 0 }),
    false
  );
});

test("halt degraded banner: shown during an active session with a stale channel and no active halts", () => {
  assert.equal(
    shouldShowHaltDegradedBanner({ sessionActive: true, haltChannelStale: true, activeHaltsCount: 0 }),
    true
  );
});

test("halt degraded banner: hidden when the channel is fresh", () => {
  assert.equal(
    shouldShowHaltDegradedBanner({ sessionActive: true, haltChannelStale: false, activeHaltsCount: 0 }),
    false
  );
});

test("halt degraded banner: hidden when a real active halt is already shown separately", () => {
  assert.equal(
    shouldShowHaltDegradedBanner({ sessionActive: true, haltChannelStale: true, activeHaltsCount: 1 }),
    false
  );
});
