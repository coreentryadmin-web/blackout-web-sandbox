import { test } from "node:test";
import assert from "node:assert/strict";
import { pickKingStrikes, kingAnchorTitle } from "./vector-king-anchor";

test("pickKingStrikes: top-ranked strike per side is the king", () => {
  const walls = {
    callWalls: [{ strike: 750, pct: 40 }, { strike: 755, pct: 20 }],
    putWalls: [{ strike: 742, pct: 35 }, { strike: 738, pct: 10 }],
  };
  assert.deepEqual(pickKingStrikes(walls), { call: 750, put: 742 });
});

test("pickKingStrikes: skips non-finite / non-positive strikes to the next valid rank", () => {
  const walls = {
    callWalls: [{ strike: 0, pct: 99 }, { strike: 751, pct: 30 }],
    putWalls: [{ strike: Number.NaN, pct: 99 }, { strike: 740, pct: 25 }],
  };
  assert.deepEqual(pickKingStrikes(walls), { call: 751, put: 740 });
});

test("pickKingStrikes: null / empty sides yield null (anchor removed)", () => {
  assert.deepEqual(pickKingStrikes(null), { call: null, put: null });
  assert.deepEqual(pickKingStrikes({ callWalls: [], putWalls: [] }), { call: null, put: null });
  assert.deepEqual(
    pickKingStrikes({ callWalls: [{ strike: 750, pct: 40 }], putWalls: [] }),
    { call: 750, put: null }
  );
});

test("pickKingStrikes: band-aware — strongest wall WITHIN the timeframe band wins", () => {
  // Global strongest call is the far 8000 (strength 99); a nearer 7620 is weaker (strength 40).
  const walls = {
    callWalls: [{ strike: 8000, pct: 99 }, { strike: 7620, pct: 40 }, { strike: 7590, pct: 30 }],
    putWalls: [{ strike: 7100, pct: 99 }, { strike: 7540, pct: 45 }, { strike: 7560, pct: 20 }],
  };
  const spot = 7575;
  // Tight 1m band (±2% = ±151.5 → [7423.5, 7726.5]): the far 8000 / 7100 are OUT of band, so the
  // anchor is the strongest wall IN band — 7620 (call) and 7540 (put).
  assert.deepEqual(pickKingStrikes(walls, { spot, bandPct: 0.02 }), { call: 7620, put: 7540 });
  // Wide 4h band (±12% = ±909 → [6666, 8484]): the far 8000 / 7100 are now IN band and, being the
  // strongest, become the anchor — the timeframe-dynamic move.
  assert.deepEqual(pickKingStrikes(walls, { spot, bandPct: 0.12 }), { call: 8000, put: 7100 });
});

test("pickKingStrikes: nothing in band → falls back to the NEAREST wall on that side", () => {
  const walls = {
    callWalls: [{ strike: 8000, pct: 99 }, { strike: 7900, pct: 50 }], // both far above spot
    putWalls: [{ strike: 7000, pct: 99 }, { strike: 7100, pct: 50 }], // both far below spot
  };
  const spot = 7575;
  // ±1% band ([7499.25, 7650.75]) excludes every wall → nearest-to-spot on each side: 7900 / 7100.
  assert.deepEqual(pickKingStrikes(walls, { spot, bandPct: 0.01 }), { call: 7900, put: 7100 });
});

test("pickKingStrikes: no spot/band context → unchanged global-king behaviour", () => {
  const walls = {
    callWalls: [{ strike: 8000, pct: 99 }, { strike: 7620, pct: 40 }],
    putWalls: [{ strike: 7100, pct: 99 }, { strike: 7540, pct: 45 }],
  };
  assert.deepEqual(pickKingStrikes(walls), { call: 8000, put: 7100 });
  // A zero/invalid spot also degrades to the global king (never throws).
  assert.deepEqual(pickKingStrikes(walls, { spot: 0, bandPct: 0.05 }), { call: 8000, put: 7100 });
});

test("kingAnchorTitle: rounds and thousands-separates behind the anchor glyph", () => {
  assert.equal(kingAnchorTitle(749.6), "⚓ 750");
  assert.equal(kingAnchorTitle(7499.36), "⚓ 7,499");
});
