import { test } from "node:test";
import assert from "node:assert/strict";
import { mapNighthawkEchoRows } from "./ecosystem-context";

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
