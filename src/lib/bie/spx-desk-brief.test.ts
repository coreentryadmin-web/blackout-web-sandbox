import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { computeSpxConfluence } from "@/features/spx/lib/spx-signals";
import { composeSpxDeskBrief } from "@/lib/bie/spx-desk-brief";

function fakeDesk(): SpxDeskPayload {
  return {
    available: true,
    as_of: "2026-07-04T15:00:00.000Z",
    source: "test",
    price: 5900,
    spx_change_pct: 0.35,
    vwap: 5895,
    above_vwap: true,
    above_gamma_flip: true,
    gamma_flip: 5890,
    gamma_regime: "mean_revert",
    gex_king: 5900,
    max_pain: 5850,
    gex_walls: [
      { strike: 5910, net_gex: -2_100_000, kind: "resistance" },
      { strike: 5885, net_gex: 1_800_000, kind: "support" },
    ],
    levels: [],
    flow_0dte_net: 420_000,
    uw_iv_rank: 42,
  } as unknown as SpxDeskPayload;
}

describe("composeSpxDeskBrief", () => {
  test("returns structured brief with required body labels and {{}} numbers", () => {
    const desk = fakeDesk();
    const confluence = computeSpxConfluence(desk);
    assert.ok(confluence);

    const result = composeSpxDeskBrief(
      desk,
      confluence!,
      ["SPX +2.00 pts (5898.00 → 5900.00)"],
      "mid-morning"
    );

    assert.match(result.headline, /LONG|CHOP|NO-EDGE|SHORT/);
    assert.ok(result.body.includes("WHY"));
    assert.ok(result.body.includes("LEVELS"));
    assert.ok(result.body.includes("SETUP"));
    assert.ok(result.body.includes("RISK"));
    assert.ok(result.body.includes("NEXT 5M"));
    assert.ok(result.body.includes("FLIPS IT"));
    assert.match(result.headline, /\{\{[\d,.\-+ ]+\}\}/);
    assert.deepEqual(result.watch, []);
    assert.deepEqual(result.changed, []);
    assert.ok(["bullish", "bearish", "neutral"].includes(result.bias));
  });

  test("grade C/D maps to NO-EDGE verb", () => {
    const desk = fakeDesk();
    desk.price = 5900;
    desk.vwap = 5910;
    desk.above_vwap = false;
    desk.above_gamma_flip = false;
    desk.gamma_flip = 5915;
    desk.flow_0dte_net = 0;
    desk.tide_bias = "neutral";
    desk.dark_pool = undefined;

    const confluence = computeSpxConfluence(desk);
    assert.ok(confluence);
    const result = composeSpxDeskBrief(desk, confluence!, [], "midday-grind");
    if (confluence!.grade === "C" || confluence!.grade === "D" || confluence!.action === "WAIT") {
      assert.match(result.headline, /NO-EDGE|CHOP/);
    }
  });
});
