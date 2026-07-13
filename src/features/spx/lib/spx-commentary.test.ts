import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { generateSpxCommentary } from "@/features/spx/lib/spx-commentary";

// The 2026-07-13 redesign: generateSpxCommentary is a THIN deterministic composition
// over src/lib/bie/spx-live-voice.ts (bias header + 3–4 sentence voice + ≤3 triggers +
// transition-only changed[]). These tests cover the composition seams; the brain's own
// behavior (bias math, event detection, dedupe) is covered by spx-live-voice.test.ts.

function bearishDesk(over: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return {
    available: true,
    as_of: "2026-07-13T14:30:00.000Z",
    price: 7512.3,
    vwap: 7544.2,
    above_vwap: false,
    gamma_flip: 7528,
    above_gamma_flip: false,
    ema20: 7520.1,
    ema50: 7535.4,
    prior_close: 7540,
    vix: 16,
    regime: "bearish",
    gex_walls: [
      { strike: 7550, net_gex: 3_200_000, kind: "resistance", distance_pts: 37.7 },
      { strike: 7495, net_gex: -2_800_000, kind: "support", distance_pts: -17.3 },
    ],
    ...over,
  } as unknown as SpxDeskPayload;
}

describe("generateSpxCommentary (deterministic trader-first read)", () => {
  test("bearish tape → bias header headline, voiced body, ≤3 triggers, no {{}} markers", async () => {
    const result = await generateSpxCommentary(bearishDesk());
    assert.ok(result, "expected a read");
    assert.equal(result.bias, "bearish");
    assert.equal(
      result.headline,
      "BEARISH · 4/4 aligned · below VWAP & γ-flip · short gamma amplifies moves → favor PUTS on rallies into 7,528"
    );
    assert.match(result.body, /^🔥 Sellers pressing — SPX 7,512/);
    assert.match(result.body, /PUTS on rallies or stand aside/);
    assert.ok(result.watch.length > 0 && result.watch.length <= 3, `watch=${result.watch.length}`);
    assert.equal(result.watch[0], "reclaim 7,544 → bias flips — calls window opens");
    // Deterministic composition never emits the LLM-era {{ }} emphasis markers.
    for (const text of [result.headline, result.body, ...result.watch, ...result.changed]) {
      assert.ok(!text.includes("{{") && !text.includes("}}"), `{{}} leak in: ${text}`);
    }
  });

  test("changed[] carries ONLY transitions vs the previous window", async () => {
    const prev = bearishDesk({ above_vwap: true, price: 7546.1 } as Partial<SpxDeskPayload>);
    const result = await generateSpxCommentary(bearishDesk(), prev);
    assert.ok(result);
    assert.ok(
      result.changed.some((l) => l.includes("lost VWAP 7,544")),
      `expected VWAP-lost transition, got: ${JSON.stringify(result.changed)}`
    );

    // Same desk twice → zero transitions (nothing restated).
    const quiet = await generateSpxCommentary(bearishDesk(), bearishDesk());
    assert.ok(quiet);
    assert.deepEqual(quiet.changed, []);
  });

  test("first window (no previous desk) → empty changed[], no fake baseline noise", async () => {
    const result = await generateSpxCommentary(bearishDesk(), null);
    assert.ok(result);
    assert.deepEqual(result.changed, []);
  });

  test("open engine play prints one line and flags a conflicting read", async () => {
    const result = await generateSpxCommentary(bearishDesk(), null, {
      openPlay: { status: "open", direction: "long", entry_price: 7520, stop: 7505, target: 7555 },
    });
    assert.ok(result);
    const engineLine = result.body.split("\n").find((l) => l.startsWith("🎯 engine live"));
    assert.ok(engineLine, "expected engine line");
    assert.match(engineLine, /LONG from 7,520, stop 7,505, target 7,555/);
    // Bearish read vs open LONG — the conflict must be called out, never silent.
    assert.match(engineLine, /read now conflicts with the open play/);
  });

  test("lotto / power hour lifecycle lines appear only when live", async () => {
    const withPlays = await generateSpxCommentary(bearishDesk(), null, {
      lotto: { phase: "WATCH", direction: "short", strike: 7490 },
      powerHour: { phase: "NONE", direction: null, strike: null },
    });
    assert.ok(withPlays);
    assert.match(withPlays.body, /🎰 lotto WATCH — PUT 7,490/);
    assert.ok(!withPlays.body.includes("power hour"), "NONE power hour must not print");
  });

  test("unavailable desk / missing price → null (route 502s and retries)", async () => {
    assert.equal(await generateSpxCommentary(bearishDesk({ available: false })), null);
    assert.equal(
      await generateSpxCommentary(bearishDesk({ price: 0 } as Partial<SpxDeskPayload>)),
      null
    );
  });
});
