import { test } from "node:test";
import assert from "node:assert/strict";
import { VECTOR_CHART_LOCALE, isUsableChartLocale } from "./vector-chart-config";

test("VECTOR_CHART_LOCALE is a tag Intl can format with (won't throw at chart paint)", () => {
  // The whole point of pinning the locale: a tag Intl rejects throws inside
  // lightweight-charts' time-axis formatting and blanks the canvas. Guard that the
  // constant we ship is always a usable one.
  assert.equal(isUsableChartLocale(VECTOR_CHART_LOCALE), true);
  // And prove the guard actually rejects the tag that caused the blank-chart bug.
  assert.equal(isUsableChartLocale("en-US@posix"), false);
});

test("isUsableChartLocale accepts plain BCP-47 tags and rejects junk", () => {
  assert.equal(isUsableChartLocale("en-US"), true);
  assert.equal(isUsableChartLocale("en"), true);
  assert.equal(isUsableChartLocale("not a locale"), false);
});
