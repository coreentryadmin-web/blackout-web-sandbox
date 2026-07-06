import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mapAlertAuditTrailRow, computeSafePgPoolMaxDefault } from "./db";

test("mapAlertAuditTrailRow: converts NUMERIC confidence_score (a string from node-pg) to a real number", () => {
  const row = mapAlertAuditTrailRow({
    id: "42",
    alert_type: "zerodte",
    ticker: "nvda",
    direction: "long",
    fired_at: "2026-07-01T14:30:00.000Z",
    confidence_score: "82.5",
    confidence_label: "high",
    trigger_reason: "aggression spike",
    outcome: "target",
  });
  assert.equal(row.id, 42);
  assert.equal(typeof row.confidence_score, "number");
  assert.equal(row.confidence_score, 82.5);
});

test("mapAlertAuditTrailRow: null direction/confidence/trigger_reason/outcome stay null, not 'null' strings", () => {
  const row = mapAlertAuditTrailRow({
    id: 1,
    alert_type: "nighthawk_rejected",
    ticker: "TSLA",
    direction: null,
    fired_at: "2026-07-01T00:00:00.000Z",
    confidence_score: null,
    confidence_label: null,
    trigger_reason: null,
    outcome: null,
  });
  assert.equal(row.direction, null);
  assert.equal(row.confidence_score, null);
  assert.equal(row.confidence_label, null);
  assert.equal(row.trigger_reason, null);
  assert.equal(row.outcome, null);
});

test("mapAlertAuditTrailRow: fired_at normalizes to an ISO string regardless of the driver's returned format", () => {
  const row = mapAlertAuditTrailRow({
    id: 1,
    alert_type: "zerodte",
    ticker: "SPY",
    direction: "short",
    fired_at: "2026-07-01T14:30:00.000Z",
    confidence_score: 50,
    confidence_label: "medium",
    trigger_reason: null,
    outcome: "pending",
  });
  assert.equal(row.fired_at, "2026-07-01T14:30:00.000Z");
});

// Regression: PG_POOL_MAX's fallback default used to be a flat 5, uncoupled from PgBouncer's
// actual backend budget or REPLICA_COUNT. Production explicitly overrode it to 15, and with 5
// live replicas that's 75 total connections against a documented 20-backend PgBouncer budget —
// a real 3.75x oversubscription a prior "Query read timeout" investigation missed by modeling
// the ceiling off the code default instead of the real production override.
test("computeSafePgPoolMaxDefault: divides the documented PgBouncer budget across live replicas", () => {
  assert.equal(computeSafePgPoolMaxDefault(20, 5), 4);
  assert.equal(computeSafePgPoolMaxDefault(20, 1), 20);
  assert.equal(computeSafePgPoolMaxDefault(20, 4), 5);
});

test("computeSafePgPoolMaxDefault: clamps to a floor of 1 for absurd replica counts", () => {
  assert.equal(computeSafePgPoolMaxDefault(20, 1000), 1);
  assert.equal(computeSafePgPoolMaxDefault(20, 0), 20, "replicaCount<=1 must not divide by zero");
});

test("upsertZeroDteSetupLog: direction/top_strike/expiry are pinned (COALESCE-guarded) in the ON CONFLICT UPDATE", () => {
  const src = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
  const upsertBody = src.slice(
    src.indexOf("export async function upsertZeroDteSetupLog"),
    src.indexOf("RETURNING (xmax = 0) AS inserted")
  );
  assert.match(
    upsertBody,
    /direction\s*=\s*COALESCE\(zerodte_setup_log\.direction,\s*EXCLUDED\.direction\)/
  );
  assert.match(
    upsertBody,
    /top_strike\s*=\s*COALESCE\(zerodte_setup_log\.top_strike,\s*EXCLUDED\.top_strike\)/
  );
  assert.match(
    upsertBody,
    /expiry\s*=\s*COALESCE\(zerodte_setup_log\.expiry,\s*EXCLUDED\.expiry\)/
  );
  assert.match(upsertBody, /entry_premium\s*=\s*COALESCE\(zerodte_setup_log\.entry_premium,\s*EXCLUDED\.entry_premium\)/);
  assert.match(upsertBody, /flow_avg_fill\s*=\s*COALESCE\(zerodte_setup_log\.flow_avg_fill,\s*EXCLUDED\.flow_avg_fill\)/);
  assert.match(upsertBody, /plan_json\s*=\s*COALESCE\(zerodte_setup_log\.plan_json,\s*EXCLUDED\.plan_json\)/);
});
