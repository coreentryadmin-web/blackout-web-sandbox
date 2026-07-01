import assert from "node:assert/strict";
import { test } from "node:test";
import {
  odteGexScopeFromHeatmap,
  odteStrikeTotalsFromCells,
  resolveOdteExpiry,
} from "./gex-odte-scope";

test("resolveOdteExpiry prefers today when on the axis", () => {
  assert.equal(resolveOdteExpiry(["2026-07-02", "2026-07-01", "2026-07-08"], "2026-07-01"), "2026-07-01");
  assert.equal(resolveOdteExpiry(["2026-07-02", "2026-07-08"], "2026-07-01"), "2026-07-02");
});

test("odteStrikeTotalsFromCells sums one expiry column", () => {
  const cells = {
    "7400": { "2026-07-01": -1, "2026-07-02": -9 },
    "7550": { "2026-07-01": 5, "2026-07-02": 1 },
  };
  const totals = odteStrikeTotalsFromCells(cells, [7400, 7550], "2026-07-01");
  assert.deepEqual(totals, { "7400": -1, "7550": 5 });
});

test("odteGexScopeFromHeatmap builds 0DTE net from heatmap cells", () => {
  const hm = {
    spot: 7500,
    expiries: ["2026-07-01", "2026-07-02"],
    strikes: [7400, 7550],
    gex: {
      cells: {
        "7400": { "2026-07-01": -2, "2026-07-02": -20 },
        "7550": { "2026-07-01": 1, "2026-07-02": 30 },
      },
      strike_totals: { "7400": -22, "7550": 31 },
      total: 9,
      call_wall: 7550,
      put_wall: 7400,
      flip: null,
      regime: { posture: "long" as const, read: "test" },
    },
  };
  const scope = odteGexScopeFromHeatmap(hm as never, "2026-07-01");
  assert.equal(scope.expiry, "2026-07-01");
  assert.equal(scope.total, -1);
  assert.deepEqual(scope.strikeTotals, { "7400": -2, "7550": 1 });
});
