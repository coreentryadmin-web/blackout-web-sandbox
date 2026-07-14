import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxConfluence } from "@/features/spx/lib/spx-signals";
import { synthesizeSpxDeskIntel } from "@/lib/bie/spx-desk-synthesis";

function fakeDesk(): SpxDeskPayload {
  return {
    available: true,
    as_of: "2026-07-10T15:00:00.000Z",
    source: "test",
    price: 5900,
    vwap: 5895,
    gamma_flip: 5890,
    above_gamma_flip: true,
    gex_walls: [
      { strike: 5910, kind: "resistance", net_gex: -500_000_000 },
      { strike: 5885, kind: "support", net_gex: 400_000_000 },
    ],
    flow_0dte_net: 300_000,
    levels: [],
  } as unknown as SpxDeskPayload;
}

function fakeConfluence(): SpxConfluence {
  return {
    score: 74,
    grade: "A",
    action: "BUY_CALL",
    bias: "bullish",
    direction: "long",
    confidence: 0.8,
    headline: "test",
    thesis: "VWAP hold + positive gamma",
    factors: [
      { label: "VWAP", weight: 0.35, detail: "above session average" },
      { label: "γ regime", weight: 0.25, detail: "positive gamma cushion" },
      { label: "Market tide", weight: -0.12, detail: "broad flow mixed" },
    ],
    levels: { entry: 5900, stop: 5888, target: 5920, invalidation: "lose 5888" },
    conflicts: 1,
    weighted_conflicts: 0.12,
    agreeing: 5,
    as_of: "2026-07-10T15:00:00.000Z",
  };
}

describe("synthesizeSpxDeskIntel", () => {
  test("emits THESIS MECHANIC and watch triggers", () => {
    const s = synthesizeSpxDeskIntel(fakeDesk(), fakeConfluence(), "afternoon");
    assert.match(s.thesis, /THESIS/);
    assert.match(s.thesis, /bullish/i);
    assert.match(s.mechanic!, /MECHANIC/);
    assert.match(s.mechanic!, /γflip/);
    assert.ok(s.watch.length >= 2);
  });

  test("surfaces FRICTION when opposing factors present", () => {
    const s = synthesizeSpxDeskIntel(fakeDesk(), fakeConfluence(), "midday-grind");
    assert.ok(s.friction?.includes("FRICTION"));
    assert.match(s.friction!, /Market tide/);
  });

  test("ALIGNMENT when engine conflicts with read", () => {
    const s = synthesizeSpxDeskIntel(fakeDesk(), fakeConfluence(), "afternoon", {
      openPlay: {
        status: "open",
        direction: "short",
        entry_price: 5910,
        stop: 5920,
        target: 5880,
        grade: "B",
      },
    });
    assert.ok(s.alignment?.includes("ENGINE conflicts"));
  });

  // fix/spx-slayer-desk-coherence — the γ-mechanic narration keys off the desk's hysteresis-coherent
  // `above_gamma_flip`, NOT a raw price>flip compare, so it can never contradict the regime inside the
  // 2pt band. Live-audit symptom: narration printed "below γflip / short γ" while the side/regime said
  // above. Here price sits 1pt BELOW the flip but the regime is still mean_revert (hysteresis) so the
  // desk serves above_gamma_flip:true — the narration MUST read "above γflip / long γ" to agree.
  test("γ-mechanic narration agrees with side+regime inside the hysteresis band", () => {
    const bandDeskAbove = {
      ...fakeDesk(),
      price: 7499,
      gamma_flip: 7500,
      above_gamma_flip: true, // regime held mean_revert by hysteresis despite price 1pt below flip
      gamma_regime: "mean_revert",
    } as unknown as SpxDeskPayload;
    const s = synthesizeSpxDeskIntel(bandDeskAbove, fakeConfluence(), "afternoon");
    assert.match(s.mechanic!, /above γflip/);
    assert.match(s.mechanic!, /long γ/);
    assert.doesNotMatch(s.mechanic!, /below γflip/);
    assert.doesNotMatch(s.mechanic!, /short γ/);

    // Symmetric: price 1pt ABOVE flip but regime held amplification → side false → "below / short γ".
    const bandDeskBelow = {
      ...fakeDesk(),
      price: 7501,
      gamma_flip: 7500,
      above_gamma_flip: false,
      gamma_regime: "amplification",
    } as unknown as SpxDeskPayload;
    const s2 = synthesizeSpxDeskIntel(bandDeskBelow, fakeConfluence(), "afternoon");
    assert.match(s2.mechanic!, /below γflip/);
    assert.match(s2.mechanic!, /short γ/);
    assert.doesNotMatch(s2.mechanic!, /above γflip/);
  });
});
