import test from "node:test";
import assert from "node:assert/strict";
import { buildVectorTerminalLines } from "./vector-terminal-lines";
import type { VectorWallEvent } from "./vector-wall-events";

test("buildVectorTerminalLines: empty events show polling copy", () => {
  const lines = buildVectorTerminalLines("NVDA", "gex", [], true);
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /VECTOR · NVDA · GEX structure/);
  assert.match(text, /No GEX structure shifts yet/);
});

test("buildVectorTerminalLines: filters events by active lens", () => {
  const events: VectorWallEvent[] = [
    {
      kind: "call_wall_shift",
      lens: "gex",
      time: 1_700_000_000,
      message: "Call wall shifted to 500",
      severity: "info",
    },
    {
      kind: "put_wall_shift",
      lens: "vex",
      time: 1_700_000_060,
      message: "VEX put wall shifted",
      severity: "info",
    },
  ];
  const lines = buildVectorTerminalLines("SPY", "gex", events, true);
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /Call wall shifted to 500/);
  assert.doesNotMatch(text, /VEX put wall/);
});
