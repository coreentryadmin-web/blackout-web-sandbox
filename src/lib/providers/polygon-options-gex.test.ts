import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveHeatmapPageGuard } from "./polygon-options-gex";

test("defaults to 200 pages when OPTIONS_HEATMAP_PAGE_GUARD is unset", () => {
  assert.equal(resolveHeatmapPageGuard(undefined), 200);
});

test("defaults to 200 pages on a blank/non-numeric env value", () => {
  assert.equal(resolveHeatmapPageGuard(""), 200);
  assert.equal(resolveHeatmapPageGuard("not-a-number"), 200);
});

test("honors a larger env override for a venue that needs more pages", () => {
  assert.equal(resolveHeatmapPageGuard("500"), 500);
});

test("floors at 40 — the OLD cap already proven insufficient for SPX — even if env is set lower", () => {
  assert.equal(resolveHeatmapPageGuard("10"), 40);
});

test("an explicit 0 env value is falsy, so it's treated as unset (defaults to 200, not floored at 40)", () => {
  assert.equal(resolveHeatmapPageGuard("0"), 200);
});
