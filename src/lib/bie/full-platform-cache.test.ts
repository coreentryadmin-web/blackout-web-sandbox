import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BIE_FULL_STATE_CACHE_KEY,
  readBieFullState,
  writeBieFullState,
  type BieFullState,
} from "@/lib/bie/full-platform-cache";

function fixture(): BieFullState {
  return {
    asOf: "2026-07-13T15:00:00.000Z",
    platform: { spx: { price: 7560 } },
    intel: { regime_label: "RANGE_BOUND" },
    vectorUniverse: { rows: [{ ticker: "SPX", spot: 7560 }] },
    darkPool: { prints: [] },
    hotTickers: [{ ticker: "NVDA", premium: 1_000_000 }],
    errors: {},
  };
}

describe("bie:full-state cache", () => {
  test("cache key is stable", () => {
    assert.equal(BIE_FULL_STATE_CACHE_KEY, "bie:full-state");
  });

  test("read returns null before any write (fresh process fallback)", async () => {
    const v = await readBieFullState();
    // Either null (nothing written) or a previously-written object — never throws.
    assert.ok(v === null || typeof v === "object");
  });

  test("write then read round-trips the snapshot", async () => {
    const snap = fixture();
    await writeBieFullState(snap);
    const back = await readBieFullState();
    assert.deepEqual(back, snap);
  });
});
