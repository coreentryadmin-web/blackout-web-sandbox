import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContext } from "./position-narrative";
import { checkNumbersGrounded, extractNumbersFromText } from "@/lib/grounding-guard";
import type { PositionDetail } from "@/lib/nights-watch/position-detail";

function fakeDetail(): PositionDetail {
  return {
    position: {
      ticker: "NBIS",
      strike: 300,
      option_type: "call",
      side: "long",
      contracts: 2,
      expiry: "2026-09-18",
      entry_premium: 45.1,
      valuation: { mark: 52.3, delta: 0.62, gamma: 0.012, theta: -1.4, iv: 0.58 },
      current_value: 10460,
      unrealized_pnl: 1440,
      pnl_pct: 16,
      dte: 12,
      breakeven: 345.1,
      distance_to_strike_pct: 8.2,
      valuation_status: "live",
      verdict: { action: "hold", confidence: "medium", reasons: ["Trend intact"], signals: ["trend"] },
    },
    whatToDo: { action: "hold", headline: "Hold", directive: "Hold the position.", levelsToWatch: [] },
    sections: {
      positioning: null,
      flows: null,
      technicals: null,
      news: null,
      catalysts: null,
      confluence: null,
      dossier: null,
    },
    dataSources: [],
    as_of: "2026-07-04T14:00:00.000Z",
  } as unknown as PositionDetail;
}

describe("position-narrative: buildContext + grounding integration", () => {
  it("a narrative citing only context numbers passes the shared guard", () => {
    const context = buildContext(fakeDetail());
    const known = extractNumbersFromText(context);
    const narrative = "Holding the 300 call with entry at 45.1, now up 16% with 12 days to expiry.";
    const result = checkNumbersGrounded(narrative, known);
    assert.equal(result.grounded, true);
  });

  it("a narrative citing a hallucinated level fails the shared guard", () => {
    const context = buildContext(fakeDetail());
    const known = extractNumbersFromText(context);
    const narrative = "Watch for a breakout continuation toward 415, a level not in the signals.";
    const result = checkNumbersGrounded(narrative, known);
    assert.equal(result.grounded, false);
    assert.equal(result.ungroundedValue, 415);
  });
});
