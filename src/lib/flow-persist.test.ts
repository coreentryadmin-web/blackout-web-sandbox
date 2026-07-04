import { test } from "node:test";
import assert from "node:assert/strict";
import { isHelixAuditWorthy, buildHelixAuditRow, normalizeHelixDirection } from "./flow-persist";
import type { MarketFlowAlert } from "./providers/unusual-whales";

function flow(overrides: Partial<MarketFlowAlert> = {}): MarketFlowAlert {
  return {
    ticker: "AAPL",
    premium: 1_500_000,
    option_type: "CALL",
    expiry: "2026-07-10",
    strike: 200,
    direction: "bullish",
    score: 88,
    route: "whale",
    alerted_at: "2026-07-03T20:00:00Z",
    alert_rule: null,
    trade_count: null,
    has_sweep: true,
    ...overrides,
  };
}

test("isHelixAuditWorthy: only the whale route qualifies", () => {
  assert.equal(isHelixAuditWorthy("whale"), true);
  assert.equal(isHelixAuditWorthy("0dte"), false);
  assert.equal(isHelixAuditWorthy("stock"), false);
  assert.equal(isHelixAuditWorthy(""), false);
});

test("buildHelixAuditRow: shapes a whale print into the alert_audit_log row contract", () => {
  const row = buildHelixAuditRow("uw:abc123", flow());
  assert.equal(row.alert_type, "helix_whale");
  assert.equal(row.source_table, "flow_alerts");
  assert.deepEqual(row.source_key, { alert_id: "uw:abc123" });
  assert.equal(row.ticker, "AAPL");
  assert.equal(row.direction, "long");
  assert.equal(row.confidence_score, 88);
  assert.match(row.trigger_reason, /\$1,500,000 CALL premium print/);
});

test("buildHelixAuditRow: decision_trace is an array (required by toJsonbParam's array-vs-object contract)", () => {
  const row = buildHelixAuditRow("uw:abc123", flow());
  assert.ok(Array.isArray(row.decision_trace));
  assert.equal(row.decision_trace.length, 1);
  assert.equal(row.decision_trace[0].premium, 1_500_000);
});

test("normalizeHelixDirection: maps HELIX's bullish/bearish vocabulary onto alert_audit_log's long/short convention", () => {
  assert.equal(normalizeHelixDirection("bullish"), "long");
  assert.equal(normalizeHelixDirection("bearish"), "short");
});

test("normalizeHelixDirection: unknown side stays null, never guessed", () => {
  assert.equal(normalizeHelixDirection("unknown"), null);
});

test("buildHelixAuditRow: a bearish (put-side) print writes direction \"short\", not the raw \"bearish\" string", () => {
  const row = buildHelixAuditRow("uw:def456", flow({ direction: "bearish", option_type: "PUT" }));
  assert.equal(row.direction, "short");
});
