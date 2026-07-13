import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { priceVsLevel } from "../components/SpxLiveSpotPrice";

describe("priceVsLevel", () => {
  it("returns up when spot is above level", () => {
    assert.equal(priceVsLevel(100, 99), "up");
  });

  it("returns down when spot is below level", () => {
    assert.equal(priceVsLevel(98, 99), "down");
  });

  it("returns null when inputs are missing", () => {
    assert.equal(priceVsLevel(null, 99), null);
    assert.equal(priceVsLevel(100, null), null);
  });
});
