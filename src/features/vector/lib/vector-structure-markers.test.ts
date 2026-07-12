import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStructureMarkers } from "./vector-structure-markers";

const barsFrom = (path: number[]) =>
  path.map((p, i) => ({ time: 60 * i, high: p + 0.5, low: p - 0.5, close: p }));

// Same hand-traced path as the engine tests: pivots [2:H, 4:L, 7:HH, 9:HL, 11:LH],
// events [6: BOS up @104.5, 12: CHOCH down @102.5].
const PATH = [100, 102, 104, 102, 101, 103, 105, 106, 104, 103, 104, 105, 98, 97, 99];

test("buildStructureMarkers: pivots + breaks composed, time-ascending, correct visual mapping", () => {
  const m = buildStructureMarkers(barsFrom(PATH), 2);
  // 5 pivot labels + 2 break markers.
  assert.equal(m.length, 7);
  // Ascending time (setMarkers contract).
  for (let i = 1; i < m.length; i++) assert.ok(m[i]!.time >= m[i - 1]!.time);

  const at = (t: number, text: string) => m.find((x) => x.time === 60 * t && x.text === text)!;
  // First pivots slate; HH/HL green; LH red.
  assert.equal(at(2, "H").color, "#94a3b8");
  assert.equal(at(7, "HH").color, "#34d399");
  assert.equal(at(9, "HL").color, "#34d399");
  assert.equal(at(11, "LH").color, "#f87171");
  // Highs above, lows below; labels are text-only (size 0).
  assert.equal(at(7, "HH").position, "aboveBar");
  assert.equal(at(9, "HL").position, "belowBar");
  assert.equal(at(7, "HH").size, 0);
  // BOS: cyan arrowUp pointing into the up-break bar (belowBar); CHOCH: amber arrowDown aboveBar.
  const bos = at(6, "BOS");
  assert.deepEqual([bos.color, bos.shape, bos.position, bos.size], ["#22d3ee", "arrowUp", "belowBar", 1]);
  const choch = at(12, "CHOCH");
  assert.deepEqual([choch.color, choch.shape, choch.position, choch.size], ["#f59e0b", "arrowDown", "aboveBar", 1]);
});

test("buildStructureMarkers: [] on structureless input", () => {
  assert.deepEqual(buildStructureMarkers(barsFrom([1, 2, 3, 4, 5, 6]), 2), []);
});
