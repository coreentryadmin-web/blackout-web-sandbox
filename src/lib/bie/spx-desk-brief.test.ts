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
    assert.ok(result.body.includes("THESIS"));
    assert.ok(result.body.includes("MECHANIC"));
    assert.ok(result.body.includes("WHY"));
    assert.ok(result.body.includes("SIGNALS"));
    assert.ok(result.body.includes("LEVELS"));
    assert.ok(result.body.includes("SETUP"));
    assert.ok(result.body.includes("RISK"));
    assert.ok(result.body.includes("NEXT 5M"));
    assert.ok(result.body.includes("FLIPS IT"));
    assert.match(result.headline, /\{\{[\d,.\-+ ]+\}\}/);
    assert.ok(result.watch.length >= 1);
    assert.deepEqual(result.changed, []);
    assert.ok(["bullish", "bearish", "neutral"].includes(result.bias));
  });

  test("NEWS line DECODES HTML entities in the raw headline title (N5-2 leak)", () => {
    const desk = fakeDesk();
    (desk as unknown as { news_headlines: Array<{ title: string }> }).news_headlines = [
      { title: "S&amp;P 500 rips as Nvidia&#39;s guidance &#34;stuns&#34;" },
    ];
    const confluence = computeSpxConfluence(desk);
    assert.ok(confluence);
    const result = composeSpxDeskBrief(desk, confluence!, [], "mid-morning");
    assert.ok(result.body.includes(`S&P 500 rips as Nvidia's guidance "stuns"`), result.body);
    assert.ok(!/&#\d+;|&amp;|&#x/.test(result.body), "no leftover HTML entities in the brief body");
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

  test("cross-tool ENGINE and LOTTO lines when live engine state present", () => {
    const desk = fakeDesk();
    const confluence = computeSpxConfluence(desk);
    assert.ok(confluence);

    const result = composeSpxDeskBrief(desk, confluence!, [], "mid-morning", {
      openPlay: {
        status: "open",
        direction: "long",
        entry_price: 5895,
        stop: 5888,
        target: 5920,
        grade: "A",
      },
      lotto: {
        phase: "WATCH",
        direction: "long",
        strike: 5925,
      },
      powerHour: {
        phase: "WATCH",
        direction: "short",
        strike: 5880,
      },
    });

    assert.ok(result.body.includes("ENGINE"));
    assert.ok(result.body.includes("LOTTO"));
    assert.ok(result.body.includes("POWER HOUR"));
  });

  test("final-30 phase blocks new 0DTE setup language", () => {
    const desk = fakeDesk();
    const confluence = computeSpxConfluence(desk);
    assert.ok(confluence);

    const result = composeSpxDeskBrief(desk, confluence!, [], "final-30");
    assert.ok(result.body.includes("final-30") || result.body.includes("No new 0DTE"));
  });

  test("LEVELS include session extremes when near spot", () => {
    const desk = fakeDesk();
    desk.hod = 5902;
    desk.pdh = 5910;
    const confluence = computeSpxConfluence(desk);
    assert.ok(confluence);

    const result = composeSpxDeskBrief(desk, confluence!, [], "afternoon");
    assert.ok(result.body.includes("LEVELS"));
    assert.match(result.body, /HOD|PDH/);
  });
});
