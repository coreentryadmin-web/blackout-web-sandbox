import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSpxPlayDeskContext } from "./spx-play-context";
import { mixedTapeBlockThreshold } from "./spx-play-gates";
import type { SpxDeskPayload } from "./spx-desk";

function baseDesk(): SpxDeskPayload {
  return {
    available: true,
    market_open: true,
    price: 5500,
    gamma_flip: 5490,
    max_pain: 5510,
    news_headlines: [],
    gex_walls: [],
    polled_at: new Date().toISOString(),
  } as SpxDeskPayload;
}

test("mixedTapeBlockThreshold: B-grade strong score gets +1 tolerance", () => {
  const weak = mixedTapeBlockThreshold("B", 48);
  const strong = mixedTapeBlockThreshold("B", 60);
  assert.equal(strong, weak + 1);
});

test("mixedTapeBlockThreshold: A-grade baseline above B", () => {
  assert.ok(mixedTapeBlockThreshold("A", 50) >= mixedTapeBlockThreshold("B", 50));
});

test("buildSpxPlayDeskContext: computes conflict meter and session budget", () => {
  const ctx = buildSpxPlayDeskContext(
    baseDesk(),
    {
      score: 55,
      grade: "B",
      factors: [],
      direction: "long",
    },
    { session_entries_today: 2, session_losses_today: 1 }
  );
  assert.equal(ctx.session_entries_used, 2);
  assert.equal(ctx.session_losses_used, 1);
  assert.equal(ctx.suggested_option_type, "call");
  assert.ok(ctx.suggested_strike != null);
  assert.equal(ctx.gamma_flip_dist_pts, 10);
});
