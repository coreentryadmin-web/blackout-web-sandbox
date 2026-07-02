import { test } from "node:test";
import assert from "node:assert/strict";
import { rthWriterOverdue } from "./rth-warm-leader-logic";

const now = Date.parse("2026-07-02T15:00:00.000Z");

test("rthWriterOverdue: nights-watch-warm overdue after 3m", () => {
  const last = new Date(now - 3 * 60_000).toISOString();
  assert.equal(rthWriterOverdue("nights-watch-warm", last, "ok", null, now), true);
});

test("rthWriterOverdue: nights-watch-warm fresh at 1m", () => {
  const last = new Date(now - 60_000).toISOString();
  assert.equal(rthWriterOverdue("nights-watch-warm", last, "ok", null, now), false);
});

test("rthWriterOverdue: flow-ingest skipped for alternate writer is not overdue", () => {
  const last = new Date(now - 30 * 60_000).toISOString();
  assert.equal(
    rthWriterOverdue("flow-ingest", last, "skipped", "ws_active_cluster", now),
    false
  );
});

test("rthWriterOverdue: unknown key never overdue", () => {
  assert.equal(rthWriterOverdue("db-cleanup", null, null, null, now), false);
});
