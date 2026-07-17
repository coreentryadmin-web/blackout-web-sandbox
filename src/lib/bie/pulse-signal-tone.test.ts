import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { professionalizePulseLine } from "./pulse-signal-tone";

describe("pulse-signal-tone", () => {
  it("maps regime flip emoji to institutional label", () => {
    const out = professionalizePulseLine("⚡ regime flipped → LONG GAMMA — dealers dampen moves");
    assert.match(out, /Regime flip/i);
    assert.doesNotMatch(out, /⚡/);
  });

  it("maps flow print emoji", () => {
    const out = professionalizePulseLine("💰 $1.2M NVDA 180C 2026-07-17 buy");
    assert.match(out, /Flow print/i);
  });
});
