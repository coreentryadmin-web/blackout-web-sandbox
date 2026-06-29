import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeWeightedConflicts } from "./spx-play-conflicts";
import type { SpxDeskPayload } from "./providers/spx-desk";
import type { SpxSignalFactor } from "./spx-signals";

const baseDesk = (): SpxDeskPayload =>
  ({
    price: 7400,
    market_open: true,
    tide_bias: "bullish",
    gamma_regime: "mean_revert",
    above_gamma_flip: true,
    gex_walls: [{ kind: "resistance", strike: 7450, gex: 1e9, distance: 50 }],
    news_headlines: [{ title: "Market rally continues on dovish Fed tone" }],
    vix: 26,
  }) as SpxDeskPayload;

describe("computeWeightedConflicts", () => {
  it("does not double-count news when News risk factor is already scored", () => {
    const factors: SpxSignalFactor[] = [
      { label: "Live tape", weight: 12, detail: "calls" },
      { label: "News risk", weight: -6, detail: "bearish headline" },
      { label: "TRIN", weight: -6, detail: "selling" },
    ];
    const { weighted_conflicts } = computeWeightedConflicts(baseDesk(), 50, factors);
    // 2 soft opposing (News + TRIN) = 2 — no extra +2 news desk penalty
    assert.equal(weighted_conflicts, 2);
  });

  it("does not inflate with max(raw opposing factor count) when desk bonuses are absent", () => {
    const factors: SpxSignalFactor[] = [
      { label: "Live tape", weight: 12, detail: "calls" },
      { label: "TRIN", weight: -6, detail: "selling" },
      { label: "EMA 20", weight: -5, detail: "below" },
    ];
    const { conflicts, weighted_conflicts } = computeWeightedConflicts(baseDesk(), 55, factors);
    assert.equal(conflicts, 2);
    assert.equal(weighted_conflicts, 2);
  });

  it("counts hard opposing factors at 2x in weighted score", () => {
    const factors: SpxSignalFactor[] = [
      { label: "Live tape", weight: 12, detail: "calls" },
      { label: "Market tide", weight: -10, detail: "bearish tide" },
    ];
    const { weighted_conflicts } = computeWeightedConflicts(baseDesk(), 40, factors);
    assert.equal(weighted_conflicts, 2);
  });
});
