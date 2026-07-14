import assert from "node:assert/strict";
import test from "node:test";
import { detectPremiseCorrections } from "./spx-premise";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

function desk(partial: Partial<SpxDeskPayload>): SpxDeskPayload {
  return {
    available: true,
    as_of: new Date().toISOString(),
    price: 7556,
    vwap: 7550,
    gamma_flip: 7510,
    above_gamma_flip: true,
    spx_change_pct: 0.16,
    ...partial,
  } as SpxDeskPayload;
}

test("premise: below vwap question when spot is above emits CORRECTION", () => {
  const lines = detectPremiseCorrections("why is SPX below vwap", desk({}));
  assert.ok(lines.some((l) => l.startsWith("CORRECTION") && l.includes("ABOVE VWAP")));
});

test("premise: no correction when premise matches tape", () => {
  const lines = detectPremiseCorrections("why is SPX above vwap", desk({}));
  assert.equal(lines.length, 0);
});

test("premise: bearish dump question on green tape", () => {
  const lines = detectPremiseCorrections("why did SPX dump", desk({ spx_change_pct: 0.2 }));
  assert.ok(lines.some((l) => l.includes("green")));
});

// ── PR-L4a (live gauntlet P1): false spatial-premise correction for wall / max-pain claims.
// Gauntlet: "Why is SPX pinned ABOVE its call wall right now?" with spot 7,515 and call wall 7,550
// (spot is BELOW). The desk gave a bullish read and never corrected the false premise.
const callWallDesk = (spot: number, wall: number) =>
  desk({
    price: spot,
    vwap: spot, // neutralise the VWAP guard so only the wall check can fire
    gex_walls: [
      { strike: wall, net_gex: 5_000_000, kind: "resistance", distance_pts: wall - spot },
      { strike: spot - 40, net_gex: -4_000_000, kind: "support", distance_pts: -40 },
    ],
  } as Partial<SpxDeskPayload>);

test("premise: false 'above call wall' when spot is BELOW the wall emits CORRECTION", () => {
  const lines = detectPremiseCorrections("why is SPX pinned above its call wall right now", callWallDesk(7515, 7550));
  assert.ok(
    lines.some((l) => l.startsWith("CORRECTION") && /BELOW its call wall 7,550/.test(l)),
    `expected call-wall correction, got: ${JSON.stringify(lines)}`
  );
});

test("premise: TRUE 'above call wall' (spot above the wall) emits NO bogus correction", () => {
  const lines = detectPremiseCorrections("why is SPX above its call wall", callWallDesk(7560, 7550));
  assert.equal(lines.filter((l) => l.includes("call wall")).length, 0);
});

test("premise: false 'below put wall' when spot is ABOVE the put wall emits CORRECTION", () => {
  // Spot 7,515, put wall (most-negative net_gex) at 7,475 → spot is ABOVE the put wall.
  const d = desk({
    price: 7515,
    vwap: 7515,
    gex_walls: [
      { strike: 7550, net_gex: 5_000_000, kind: "resistance", distance_pts: 35 },
      { strike: 7475, net_gex: -6_000_000, kind: "support", distance_pts: -40 },
    ],
  } as Partial<SpxDeskPayload>);
  const lines = detectPremiseCorrections("why is SPX sitting below the put wall", d);
  assert.ok(
    lines.some((l) => l.startsWith("CORRECTION") && /ABOVE its put wall 7,475/.test(l)),
    `expected put-wall correction, got: ${JSON.stringify(lines)}`
  );
});

test("premise: false 'above max pain' when spot is below max pain emits CORRECTION", () => {
  const d = desk({ price: 7515, vwap: 7515, max_pain: 7550, gex_walls: [] } as Partial<SpxDeskPayload>);
  const lines = detectPremiseCorrections("why is SPX holding above max pain", d);
  assert.ok(
    lines.some((l) => l.startsWith("CORRECTION") && /BELOW its max pain 7,550/.test(l)),
    `expected max-pain correction, got: ${JSON.stringify(lines)}`
  );
});

test("premise: false 'above gamma flip' when spot is below the flip emits CORRECTION", () => {
  // Existing gamma-flip guard: spot below flip, question claims above.
  const d = desk({ price: 7500, vwap: 7500, gamma_flip: 7540, above_gamma_flip: false, gex_walls: [] } as Partial<SpxDeskPayload>);
  const lines = detectPremiseCorrections("why is SPX pinned above the gamma flip", d);
  assert.ok(
    lines.some((l) => l.startsWith("CORRECTION") && /BELOW γflip/.test(l)),
    `expected gamma-flip correction, got: ${JSON.stringify(lines)}`
  );
});

test("premise: no wall correction when there is no directional claim", () => {
  const lines = detectPremiseCorrections("what's the SPX call wall right now", callWallDesk(7515, 7550));
  assert.equal(lines.filter((l) => l.includes("call wall")).length, 0);
});
