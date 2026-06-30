import assert from "node:assert/strict";
import test from "node:test";

import { expectedNighthawkEdition, nighthawkEditionCoversExpected } from "./admin-cron-health";

function withDefaultNighthawkWindow(fn: () => void) {
  const prevHour = process.env.NIGHTHAWK_EDITION_HOUR_ET;
  const prevMinute = process.env.NIGHTHAWK_EDITION_MINUTE_ET;
  const prevCatchup = process.env.NIGHTHAWK_EDITION_CATCHUP_MIN;
  delete process.env.NIGHTHAWK_EDITION_HOUR_ET;
  delete process.env.NIGHTHAWK_EDITION_MINUTE_ET;
  delete process.env.NIGHTHAWK_EDITION_CATCHUP_MIN;
  try {
    fn();
  } finally {
    if (prevHour === undefined) delete process.env.NIGHTHAWK_EDITION_HOUR_ET;
    else process.env.NIGHTHAWK_EDITION_HOUR_ET = prevHour;
    if (prevMinute === undefined) delete process.env.NIGHTHAWK_EDITION_MINUTE_ET;
    else process.env.NIGHTHAWK_EDITION_MINUTE_ET = prevMinute;
    if (prevCatchup === undefined) delete process.env.NIGHTHAWK_EDITION_CATCHUP_MIN;
    else process.env.NIGHTHAWK_EDITION_CATCHUP_MIN = prevCatchup;
  }
}

test("Night Hawk health expects today's edition before the evening deadline", () => {
  withDefaultNighthawkWindow(() => {
    const expectation = expectedNighthawkEdition(new Date("2026-06-30T08:04:00Z"));

    assert.equal(expectation.et_date, "2026-06-30");
    assert.equal(expectation.expected_edition_for, "2026-06-30");
    assert.equal(expectation.after_deadline, false);
    assert.equal(nighthawkEditionCoversExpected("2026-06-30", expectation), true);
  });
});

test("Night Hawk health expects the next trading day after the evening deadline", () => {
  withDefaultNighthawkWindow(() => {
    const expectation = expectedNighthawkEdition(new Date("2026-06-30T23:31:00Z"));

    assert.equal(expectation.et_date, "2026-06-30");
    assert.equal(expectation.expected_edition_for, "2026-07-01");
    assert.equal(expectation.after_deadline, true);
    assert.equal(nighthawkEditionCoversExpected("2026-06-30", expectation), false);
    assert.equal(nighthawkEditionCoversExpected("2026-07-01", expectation), true);
  });
});

test("Night Hawk health carries the next trading edition across a market holiday", () => {
  withDefaultNighthawkWindow(() => {
    const expectation = expectedNighthawkEdition(new Date("2026-07-03T16:00:00Z"));

    assert.equal(expectation.et_date, "2026-07-03");
    assert.equal(expectation.expected_edition_for, "2026-07-06");
    assert.equal(expectation.after_deadline, false);
  });
});
