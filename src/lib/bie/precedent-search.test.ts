import { test } from "node:test";
import assert from "node:assert/strict";
import { describeAuditRow } from "./precedent-search";
import type { AlertAuditTrailRow } from "@/lib/db";

const base: AlertAuditTrailRow = {
  id: 1,
  alert_type: "zerodte",
  ticker: "NVDA",
  direction: "long",
  fired_at: "2026-07-01T14:30:00.000Z",
  confidence_score: 82,
  confidence_label: "high",
  trigger_reason: "aggression spike",
  outcome: "target",
};

test("describeAuditRow: cites every real field, fabricates nothing", () => {
  const d = describeAuditRow(base);
  assert.match(d, /0DTE Command/);
  assert.match(d, /NVDA/);
  assert.match(d, /long/);
  assert.match(d, /high conviction/);
  assert.match(d, /score 82/);
  assert.match(d, /aggression spike/);
  assert.match(d, /Outcome: target\./);
});

test("describeAuditRow: null direction reads as 'no stated direction', not 'null'", () => {
  const d = describeAuditRow({ ...base, direction: null });
  assert.match(d, /no stated direction/);
  assert.doesNotMatch(d, /\bnull\b/i);
});

test("describeAuditRow: missing outcome reads as 'not yet graded'", () => {
  const d = describeAuditRow({ ...base, outcome: null });
  assert.match(d, /Outcome: not yet graded\./);
});

test("describeAuditRow: nighthawk_rejected alert_type gets its own label", () => {
  const d = describeAuditRow({ ...base, alert_type: "nighthawk_rejected" });
  assert.match(d, /Night Hawk \(rejected at the publish gate\)/);
});

test("describeAuditRow: unknown alert_type falls back to the raw value rather than throwing", () => {
  const d = describeAuditRow({ ...base, alert_type: "future_instrument" });
  assert.match(d, /future_instrument/);
});

test("describeAuditRow: no confidence_label or score omits those clauses cleanly", () => {
  const d = describeAuditRow({ ...base, confidence_label: null, confidence_score: null });
  assert.doesNotMatch(d, /conviction/);
  assert.doesNotMatch(d, /score/);
});
