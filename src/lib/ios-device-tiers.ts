/**
 * iPhone 16 Pro / Pro Max logical viewport constants (portrait CSS pixels).
 * Used by Playwright E2E and documentation — not runtime detection.
 */
export const IPHONE_16_PRO = {
  name: "iPhone 16 Pro",
  width: 402,
  height: 874,
  tierClass: "ios-tier-pro",
} as const;

export const IPHONE_16_PRO_MAX = {
  name: "iPhone 16 Pro Max",
  width: 440,
  height: 956,
  tierClass: "ios-tier-pro-max",
} as const;

/** Minimum logical width to classify Pro Max tier (matches CSS @media min-width: 430px). */
export const IOS_TIER_PRO_MIN_WIDTH = 393;

/** Minimum logical width to classify Pro Max tier (matches CSS @media min-width: 430px). */
export const IOS_TIER_PRO_MAX_MIN_WIDTH = 430;
