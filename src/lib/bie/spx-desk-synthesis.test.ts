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
});
