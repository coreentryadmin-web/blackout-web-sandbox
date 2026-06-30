import assert from "node:assert/strict";
import test from "node:test";
import { outcomeSessionDate, parsePlayLevels, resolveOutcome } from "./play-outcomes";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import type { PlaybookPlay } from "./types";

test("outcomeSessionDate resolves the edition date itself, not the next trading day", () => {
  assert.equal(outcomeSessionDate({ edition_for: "2026-06-30" }), "2026-06-30");
});

test("parsePlayLevels extracts entry range, target, and stop", () => {
  const play = {
    entry_range: "$198 - $202",
    target: "$215",
    stop: "$190",
  } as PlaybookPlay;

  assert.deepEqual(parsePlayLevels(play), {
    entry_range_low: 198,
    entry_range_high: 202,
    target: 215,
    stop: 190,
  });
});

test("resolveOutcome marks long target hit using session high", () => {
  const row = {
    direction: "LONG",
    entry_range_low: 198,
    entry_range_high: 202,
    target: 215,
    stop: 190,
    next_day_open: 201,
    next_day_close: 211,
    session_high: 216,
    session_low: 199,
  } as NighthawkPlayOutcomeRow;

  const outcome = resolveOutcome(row);

  assert.equal(outcome.outcome, "target");
  assert.equal(outcome.hit_target, true);
  assert.equal(outcome.hit_stop, false);
});
