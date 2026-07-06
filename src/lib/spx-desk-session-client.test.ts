import test from "node:test";
import assert from "node:assert/strict";
import {
  isClientDeskSessionOpen,
  resolveDeskLive,
  resolveDeskSessionActive,
  shouldDiscardStaleClosedDeskCache,
} from "./spx-desk-session-client";

test("resolveDeskSessionActive trusts ET clock during RTH even before pulse initializes", () => {
  const monRth = new Date("2026-07-06T14:00:00.000Z"); // 10:00 ET Mon
  assert.equal(
    resolveDeskSessionActive({
      initialized: false,
      pulse: null,
      deskStable: { market_open: false, market_label: "CLOSED" },
      etSessionOpen: isClientDeskSessionOpen(monRth),
    }),
    true
  );
});

test("resolveDeskLive accepts ET RTH when merged desk lacks market_open (SSE-only overlay)", () => {
  const monRth = new Date("2026-07-06T14:00:00.000Z");
  const etOpen = isClientDeskSessionOpen(monRth);
  assert.equal(
    resolveDeskLive({
      sessionActive: true,
      etSessionOpen: etOpen,
      merged: {
        available: true,
        price: 7512.77,
        feed_stalled: false,
        market_open: false,
        market_label: "CLOSED",
      },
    }),
    true
  );
});

test("shouldDiscardStaleClosedDeskCache clears post-close snapshot during RTH", () => {
  const monRth = new Date("2026-07-06T14:00:00.000Z");
  assert.equal(
    shouldDiscardStaleClosedDeskCache(
      { market_open: false, market_label: "CLOSED", price: 7500 },
      isClientDeskSessionOpen(monRth)
    ),
    true
  );
});
