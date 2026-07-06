import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IPHONE_16_PRO,
  IPHONE_16_PRO_MAX,
  IOS_TIER_PRO_MAX_MIN_WIDTH,
  IOS_TIER_PRO_MIN_WIDTH,
} from "@/lib/ios-device-tiers";

describe("ios-device-tiers", () => {
  it("defines iPhone 16 Pro logical viewport", () => {
    assert.equal(IPHONE_16_PRO.width, 402);
    assert.equal(IPHONE_16_PRO.height, 874);
    assert.equal(IPHONE_16_PRO.tierClass, "ios-tier-pro");
  });

  it("defines iPhone 16 Pro Max logical viewport", () => {
    assert.equal(IPHONE_16_PRO_MAX.width, 440);
    assert.equal(IPHONE_16_PRO_MAX.height, 956);
    assert.equal(IPHONE_16_PRO_MAX.tierClass, "ios-tier-pro-max");
  });

  it("uses CSS-aligned tier breakpoints", () => {
    assert.ok(IOS_TIER_PRO_MIN_WIDTH < IPHONE_16_PRO.width);
    assert.ok(IOS_TIER_PRO_MAX_MIN_WIDTH < IPHONE_16_PRO_MAX.width);
  });
});
