import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeZeroGammaFlip,
  grossAbsFromStrikeTotals,
  grossAbsFromUwGexRows,
  isHairlineNetGammaSign,
  odteGexScopeFromHeatmap,
  odteStrikeTotalsFromCells,
  recomputeScopedGexLevels,
  resolveOdteExpiry,
  resolveZeroDteExpiry,
} from "./gex-odte-scope";

test("resolveOdteExpiry prefers today when on the axis", () => {
  assert.equal(resolveOdteExpiry(["2026-07-02", "2026-07-01", "2026-07-08"], "2026-07-01"), "2026-07-01");
  assert.equal(resolveOdteExpiry(["2026-07-02", "2026-07-08"], "2026-07-01"), "2026-07-02");
});

test("resolveZeroDteExpiry is strict — no front fallback", () => {
  assert.equal(resolveZeroDteExpiry(["2026-07-01", "2026-07-08"], "2026-07-01"), "2026-07-01");
  assert.equal(resolveZeroDteExpiry(["2026-07-02", "2026-07-08"], "2026-07-01"), null);
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

test("computeZeroGammaFlip picks neg→pos crossing nearest spot (2-decimal)", () => {
  const totals = { "5990": -10, "6010": 10 };
  assert.equal(computeZeroGammaFlip(totals, 6000), 6000);
});

test("recomputeScopedGexLevels matches server wall semantics", () => {
  const totals = { "5900": -5, "6000": 8, "6100": 3 };
  const levels = recomputeScopedGexLevels(totals, 6050);
  assert.equal(levels.callWall, 6000);
  assert.equal(levels.putWall, 5900);
  assert.equal(levels.king, 6000);
  assert.equal(levels.netTotal, 6);
});

test("isHairlineNetGammaSign: balanced book is hairline", () => {
  const totals = { "7400": -9_000_000_000, "7550": 8_300_000_000 };
  const net = -700_000_000;
  const gross = grossAbsFromStrikeTotals(totals);
  assert.equal(isHairlineNetGammaSign(net, gross), true);
});

test("grossAbsFromUwGexRows sums |call+put| per row", () => {
  const gross = grossAbsFromUwGexRows([
    { call_gamma_oi: 5, put_gamma_oi: -2 },
    { call_gamma_oi: -1, put_gamma_oi: -4 },
  ]);
  assert.equal(gross, 8);
});
