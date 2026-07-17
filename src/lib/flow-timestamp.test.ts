import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractUwTimestampFromRaw,
  flowEventTimeMs,
  resolveFlowTimes,
} from "./flow-timestamp";

test("extractUwTimestampFromRaw prefers created_at then executed_at", () => {
  assert.equal(
    extractUwTimestampFromRaw({ created_at: "2026-07-16T20:00:00.000Z" }),
    "2026-07-16T20:00:00.000Z"
  );
  assert.equal(
    extractUwTimestampFromRaw({ executed_at: "2026-07-16T21:00:00.000Z" }),
    "2026-07-16T21:00:00.000Z"
  );
});

test("extractUwTimestampFromRaw parses start_time epoch", () => {
  const ms = Date.parse("2026-07-16T20:00:00.000Z");
  assert.equal(extractUwTimestampFromRaw({ start_time: ms }), "2026-07-16T20:00:00.000Z");
});

test("resolveFlowTimes uses ingest time as display-only fallback", () => {
  const r = resolveFlowTimes({
    created_at: null,
    inserted_at: "2026-07-17T12:00:00.000Z",
    raw_payload: {},
  });
  assert.equal(r.event_at, null);
  assert.equal(r.display_at, "2026-07-17T12:00:00.000Z");
  assert.equal(r.tape_time_estimated, true);
});

test("resolveFlowTimes recovers timestamp from raw_payload when column is null", () => {
  const r = resolveFlowTimes({
    created_at: null,
    inserted_at: "2026-07-17T12:00:00.000Z",
    raw_payload: { created_at: "2026-07-16T15:59:00.000Z" },
  });
  assert.equal(r.event_at, "2026-07-16T15:59:00.000Z");
  assert.equal(r.tape_time_estimated, false);
});

test("flowEventTimeMs ignores estimated ingest fallback", () => {
  assert.equal(
    flowEventTimeMs({
      alerted_at: "2026-07-17T12:00:00.000Z",
      tape_time_estimated: true,
    }),
    null
  );
  assert.equal(
    flowEventTimeMs({ event_at: "2026-07-16T15:59:00.000Z" }),
    Date.parse("2026-07-16T15:59:00.000Z")
  );
});
