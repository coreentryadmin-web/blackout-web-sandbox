import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { GexHeatmap } from "./polygon-options-gex";

// LARGO-126 / task #126 — the canonical GexPositioning contract never computed a "king"
// (argmax |net-gamma|) strike at all, so nighthawk/positioning.ts's warm cache-read path
// had to hardcode gex_king_strike: null even when the underlying matrix had a real one.
// This is the pure-mapper regression test proving the field is now derived correctly —
// see positioning.test.ts for the end-to-end proof that the warm path actually surfaces it.

// gex-positioning.ts (and its gex-cross-validation.ts / gex-intraday-adjust.ts imports)
// carry a real `import "server-only"` — stub the package so plain `node --test` (no
// Next.js "react-server" export condition) doesn't crash at module-load time, same
// gotcha documented across this repo's other provider test files.
mock.module("server-only", { namedExports: {} });

let gexPositioningFromHeatmap: typeof import("./gex-positioning").gexPositioningFromHeatmap;

before(async () => {
  ({ gexPositioningFromHeatmap } = await import("./gex-positioning"));
});

/** Minimal GexHeatmap with a given gex.strike_totals. Only the fields the mapper reads. */
function makeHeatmap(strikeTotals: Record<string, number>, spot = 100): GexHeatmap {
  const total = Object.values(strikeTotals).reduce((a, b) => a + b, 0);
  const strikes = Object.keys(strikeTotals).map(Number).sort((a, b) => b - a);
  return {
    underlying: "TEST",
    spot,
    change_pct: 0,
    asof: new Date().toISOString(),
    expiries: ["2026-06-26"],
    strikes,
    max_pain: null,
    gex: {
      cells: {},
      strike_totals: strikeTotals,
      call_wall: strikes[0] ?? null,
      put_wall: strikes[strikes.length - 1] ?? null,
      total,
      flip: null,
      regime: { flip: null, posture: null, read: "" },
    },
    vex: {
      cells: {},
      strike_totals: {},
      pos_wall: null,
      neg_wall: null,
      total: 0,
      flip: null,
      regime: { posture: null, read: "" },
    },
    shift: { available: false, status: "collecting" },
    source: "polygon",
    data_delay: "test",
  } as GexHeatmap;
}

test("gexPositioningFromHeatmap: gex_king_strike is the argmax |net-gamma| strike, not just the largest positive", () => {
  // 100 (call side, +40) is smaller in magnitude than 95 (put side, -70) — the king must be
  // the put strike even though it's negative, proving this isn't just "reuse call_wall".
  const p = gexPositioningFromHeatmap("TEST", makeHeatmap({ "100": 40, "95": -70, "105": 10 }));
  assert.ok(p);
  assert.equal(p!.gex_king_strike, 95);
});

test("gexPositioningFromHeatmap: gex_king_strike is null when strike_totals has no entries", () => {
  // hm.strikes must stay non-empty so gexPositioningFromHeatmap doesn't treat the whole
  // matrix as cold (that's the SEPARATE strikes.length===0 guard, tested by the cold-matrix
  // path elsewhere) — but gex.strike_totals itself is empty, so kingFromStrikeTotals's loop
  // never runs and king correctly stays null (a single present-but-zero strike would
  // trivially "win" the argmax with no competing candidate, which is not this case).
  const hm = makeHeatmap({ "100": 5 });
  hm.gex.strike_totals = {};
  const p = gexPositioningFromHeatmap("TEST", hm);
  assert.ok(p);
  assert.equal(p!.gex_king_strike, null);
});

test("gexPositioningFromHeatmap: non-finite strike keys/values are skipped", () => {
  const p = gexPositioningFromHeatmap(
    "TEST",
    makeHeatmap({ "100": 5, "not-a-strike": 999, "110": Number.NaN })
  );
  assert.ok(p);
  assert.equal(p!.gex_king_strike, 100);
});
