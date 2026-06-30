import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedCleanupTarget, cleanupRetentionDays } from "./db-cleanup-targets";

test("accepts all real (table,column) pairs incl. outcome tables", () => {
  assert.ok(isAllowedCleanupTarget("api_telemetry_events", "at"));
  assert.ok(isAllowedCleanupTarget("flow_alerts", "inserted_at"));
  assert.ok(isAllowedCleanupTarget("cron_job_runs", "started_at"));
  assert.ok(isAllowedCleanupTarget("spx_signal_log", "created_at"));
  assert.ok(isAllowedCleanupTarget("nighthawk_dossiers_staging", "created_at"));
  assert.ok(isAllowedCleanupTarget("nighthawk_job_log", "created_at"));
  assert.ok(isAllowedCleanupTarget("admin_audit_log", "created_at"));
  assert.ok(isAllowedCleanupTarget("spx_play_outcomes", "closed_at"));
  assert.ok(isAllowedCleanupTarget("nighthawk_play_outcomes", "created_at"));
  assert.ok(isAllowedCleanupTarget("market_regime", "captured_at"));
  assert.ok(isAllowedCleanupTarget("flow_anomalies", "detected_at"));
  assert.ok(isAllowedCleanupTarget("coaching_alerts", "generated_at"));
});

test("rejects wrong age column for the new operational tables", () => {
  assert.equal(isAllowedCleanupTarget("market_regime", "created_at"), false);
  assert.equal(isAllowedCleanupTarget("flow_anomalies", "created_at"), false);
  assert.equal(isAllowedCleanupTarget("coaching_alerts", "created_at"), false);
});

test("rejects wrong age column for outcome tables", () => {
  // spx must be pruned by closed_at, not opened_at/created_at (would touch open rows).
  assert.equal(isAllowedCleanupTarget("spx_play_outcomes", "opened_at"), false);
  assert.equal(isAllowedCleanupTarget("spx_play_outcomes", "created_at"), false);
  assert.equal(isAllowedCleanupTarget("nighthawk_play_outcomes", "updated_at"), false);
});

test("rejects wrong column for a known table", () => {
  assert.equal(isAllowedCleanupTarget("api_telemetry_events", "created_at"), false);
});

test("rejects unknown table", () => {
  assert.equal(isAllowedCleanupTarget("users", "id"), false);
});

test("rejects SQL-injection attempt in table name", () => {
  assert.equal(isAllowedCleanupTarget("flow_alerts; DROP TABLE x --", "inserted_at"), false);
});

test("rejects prototype-pollution keys", () => {
  assert.equal(isAllowedCleanupTarget("constructor", "x"), false);
  assert.equal(isAllowedCleanupTarget("__proto__", "x"), false);
  assert.equal(isAllowedCleanupTarget("hasOwnProperty", "x"), false);
});

test("cleanupRetentionDays: env override, fallback, and >=90d floor", () => {
  assert.equal(cleanupRetentionDays("120", 365), 120);
  assert.equal(cleanupRetentionDays(undefined, 365), 365);
  assert.equal(cleanupRetentionDays("  200  ", 365), 200);
  // Below-floor / invalid values clamp UP to the 90d safe floor.
  assert.equal(cleanupRetentionDays("5", 365), 90);
  assert.equal(cleanupRetentionDays("0", 365), 90);
  assert.equal(cleanupRetentionDays("-10", 365), 90);
  assert.equal(cleanupRetentionDays("abc", 365), 365);
  // Upper clamp.
  assert.equal(cleanupRetentionDays("99999", 365), 3650);
});
