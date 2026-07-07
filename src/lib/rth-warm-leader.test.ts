import { test } from "node:test";
import assert from "node:assert/strict";
import { rthWriterOverdue } from "./rth-warm-leader-logic";

const now = Date.parse("2026-07-02T15:00:00.000Z");

test("rthWriterOverdue: desk-warm overdue after 100s (90s heal threshold)", () => {
  const last = new Date(now - 100_000).toISOString();
  assert.equal(rthWriterOverdue("desk-warm", last, "ok", null, now), true);
});

test("rthWriterOverdue: desk-warm fresh at 80s", () => {
  const last = new Date(now - 80_000).toISOString();
  assert.equal(rthWriterOverdue("desk-warm", last, "ok", null, now), false);
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
