import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUwEconomicCalendar } from "./macro-events";

test("parseUwEconomicCalendar labels FOMC minutes separately from decisions", () => {
  const events = parseUwEconomicCalendar([
    { type: "fomc", event: "FOMC Minutes", time: "2026-07-08T18:00:00Z" },
    { type: "fomc", event: "FOMC Decision", time: "2026-07-29T18:00:00Z" },
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.event, "FOMC Minutes");
  assert.equal(events[1]?.event, "FOMC Decision");
});

test("parseUwEconomicCalendar maps bare fomc type to FOMC Decision", () => {
  const events = parseUwEconomicCalendar([{ type: "fomc", time: "2026-07-29T18:00:00Z" }]);
  assert.equal(events[0]?.event, "FOMC Decision");
});
