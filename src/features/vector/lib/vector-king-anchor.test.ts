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

test("kingAnchorTitle: rounds and thousands-separates behind the anchor glyph", () => {
  assert.equal(kingAnchorTitle(749.6), "⚓ 750");
  assert.equal(kingAnchorTitle(7499.36), "⚓ 7,499");
});
