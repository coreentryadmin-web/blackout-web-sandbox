import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SpxDeskPayload } from "./spx-desk";
import { knownCommentaryNumbers } from "./spx-commentary";

describe("knownCommentaryNumbers", () => {
  test("does not overflow when desk includes multi-million flow premiums", () => {
    const desk = {
      available: true,
      price: 6242,
      gamma_flip: 6235,
      gex_king: 6250,
      flow_0dte_call_premium: 12_500_000,
      flow_0dte_put_premium: 9_800_000,
      spx_flows: [{ strike: 6250, premium: 1_500_000 }],
      gex_walls: [{ strike: 6260, net_gex: -2_100_000, kind: "resistance" }],
      levels: [{ value: 6220, kind: "support" }],
    } as unknown as SpxDeskPayload;

    const ctx = {
      confluence: { score: 67, levels: { entry: 6242, stop: 6230, target: 6260 } },
      price_action: { price: 6242, change_pct: 0.43 },
      volatility: { vix: 13.2, iv_rank: 43.7 },
    };

    const known = knownCommentaryNumbers(desk, ctx);
    assert.ok(known.length < 5000, `known set unexpectedly large: ${known.length}`);
    assert.ok(known.includes(6242));
    assert.ok(known.includes(43.7) || known.includes(44));
    assert.ok(known.some((n) => n > 0 && n < 30), "expected pt distance derived from strikes");
  });
});
