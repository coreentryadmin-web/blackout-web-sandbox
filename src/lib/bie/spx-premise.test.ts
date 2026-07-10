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
