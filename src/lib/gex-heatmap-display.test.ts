import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fmtHeatmapMoney,
  fmtHeatmapMoneySigned,
  heatmapCellStyle,
  heatmapCellTextStyle,
} from "./gex-heatmap-display";

describe("gex-heatmap-display", () => {
  it("fmtHeatmapMoneySigned shows $0.0K at zero when showZero", () => {
    assert.equal(fmtHeatmapMoneySigned(0, { showZero: true }), "$0.0K");
    assert.equal(fmtHeatmapMoneySigned(0), "·");
  });

  it("fmtHeatmapMoney compacts magnitudes", () => {
    assert.equal(fmtHeatmapMoney(22_100), "$22.1K");
    assert.equal(fmtHeatmapMoney(-45_200_000), "-$45.2M");
  });

  it("heatmapCellStyle supports dex/charm lenses", () => {
    const dex = heatmapCellStyle(1_000, 2_000, "dex");
    assert.match(String(dex.backgroundColor), /34,\s*211,\s*238/);
    const charm = heatmapCellStyle(-1_000, 2_000, "charm");
    assert.match(String(charm.backgroundColor), /255,\s*45,\s*85/);
  });

  it("heatmapCellTextStyle switches to white on deep cells", () => {
    const deep = heatmapCellTextStyle(900, 1_000);
    assert.equal(deep.color, "#ffffff");
    const light = heatmapCellTextStyle(100, 1_000);
    assert.equal(light.color, undefined);
    assert.ok(light.textShadow);
  });
});
