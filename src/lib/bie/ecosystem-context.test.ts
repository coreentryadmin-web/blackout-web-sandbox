import { test } from "node:test";
import assert from "node:assert/strict";
import { ECOSYSTEM_CONTEXT_FIELDS, mapNighthawkEchoRows } from "./ecosystem-context";

test("ECOSYSTEM_CONTEXT_FIELDS: covers every real field with a non-empty description", () => {
  const expected = ["zerodte_today", "nighthawk_recent", "recent_audit_entries", "recent_flow", "recent_anomalies", "flow_feed_fresh"];
  assert.deepEqual(
    ECOSYSTEM_CONTEXT_FIELDS.map((f) => f.field).sort(),
    [...expected].sort()
  );
  for (const f of ECOSYSTEM_CONTEXT_FIELDS) {
    assert.ok(f.description.length > 10, `${f.field} needs a real description, not a stub`);
  }
});

test("mapNighthawkEchoRows: maps rows keyed by uppercased ticker", () => {
  const map = mapNighthawkEchoRows([
    { ticker: "aapl", edition_for: "2026-07-01", direction: "long", conviction: "high", outcome: "target", score: 82 },
  ]);
  assert.deepEqual(map.get("AAPL"), {
    edition_for: "2026-07-01",
    direction: "long",
    conviction: "high",
    outcome: "target",
    score: 82,
  });
});

test("mapNighthawkEchoRows: null score stays null, not 0", () => {
  const map = mapNighthawkEchoRows([
    { ticker: "NVDA", edition_for: "2026-07-02", direction: "short", conviction: "medium", outcome: "pending", score: null },
  ]);
  assert.equal(map.get("NVDA")?.score, null);
});

test("mapNighthawkEchoRows: empty input returns empty map", () => {
  assert.equal(mapNighthawkEchoRows([]).size, 0);
});

test("mapNighthawkEchoRows: last row wins per ticker if duplicates slip through", () => {
  const map = mapNighthawkEchoRows([
    { ticker: "TSLA", edition_for: "2026-07-01", direction: "long", conviction: "low", outcome: "stop", score: 40 },
    { ticker: "TSLA", edition_for: "2026-06-30", direction: "short", conviction: "high", outcome: "target", score: 90 },
  ]);
  assert.equal(map.size, 1);
  assert.equal(map.get("TSLA")?.edition_for, "2026-06-30");
});
