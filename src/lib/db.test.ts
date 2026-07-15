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

// P0 one-way commit door (fix/zerodte-status-latch): status transitions in
// updateZeroDteLiveState only move FORWARD along the real ladder derivePlayStatus
// (zerodte/plan.ts) encodes — OPEN ↔ HOLD are the same live rung (the mark drifting
// in/out of the entry band, legitimate both ways), TRIM is sticky, CLOSED terminal.
// Two independent writers share this UPDATE (the ~2-min cron sync in zerodte/scan.ts
// and the ~1s live-marks lane, each with its OWN latch memo / possibly stale row
// snapshot), so the regression guard has to live IN the SQL — a JS-side check reads
// a status that may already be stale by the time the write lands. Same
// source-inspection idiom as the upsert COALESCE-pin test above (no PG in CI).
test("updateZeroDteLiveState: SQL status CASE is monotonic — CLOSED terminal, TRIM never regresses to OPEN/HOLD", () => {
  const src = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
  const start = src.indexOf("export async function updateZeroDteLiveState");
  assert.ok(start > 0, "updateZeroDteLiveState exists");
  const body = src.slice(start, src.indexOf("stampZeroDteExitContext"));
  // CLOSED is terminal (#321) — any write against a CLOSED row keeps CLOSED.
  assert.match(body, /WHEN status = 'CLOSED' THEN status/);
  // TRIM never demotes back to the live rung: a stale writer (pre-target-tag latch)
  // deriving OPEN/HOLD must not un-trim a play members were already told to trim.
  assert.match(body, /WHEN status = 'TRIM' AND \$3 IN \('OPEN','HOLD'\) THEN status/);
  // Legitimate forward/live transitions still pass through.
  assert.match(body, /ELSE \$3/);
  // The mark + peak/trough latches still land even when the status write is dropped
  // (real quote data must never be discarded by the status guard).
  assert.match(body, /GREATEST\(COALESCE\(peak_premium, \$4\), \$4\)/);
  assert.match(body, /LEAST\(COALESCE\(trough_premium, \$4\), \$4\)/);
});

// PR-N1 (P0, docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §0.1): ensureSchema used to
// re-issue nighthawk_play_outcomes_outcome_check TWICE — the correct DROP+ADD (with
// 'unfilled') right after the table DDL, then a stale pre-'unfilled' copy ~270 lines
// later that, running last, clobbered the constraint back on every boot. Every
// `outcome = 'unfilled'` grade write then threw, leaving 12 rows permanently
// "pending" while the cron logged ok. Pin: the CHECK is ADDed exactly once, its
// DROP is paired exactly once, and the allowed set is the full 6-outcome union
// resolveOutcome (play-outcomes.ts) can emit. Same source-inspection idiom as the
// tests above (no PG in CI).
test("ensureSchema: nighthawk play-outcome CHECK issued exactly once, allowed set includes 'unfilled'", () => {
  const src = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
  const adds = src.match(/ADD CONSTRAINT nighthawk_play_outcomes_outcome_check/g) ?? [];
  assert.equal(
    adds.length,
    1,
    "the outcome CHECK must be ADDed exactly once — a later duplicate silently wins on every boot"
  );
  const drops = src.match(/DROP CONSTRAINT IF EXISTS nighthawk_play_outcomes_outcome_check/g) ?? [];
  assert.equal(drops.length, 1, "exactly one DROP, paired with the single ADD");

  // The single surviving ADD must allow everything resolveOutcome can write.
  const addIdx = src.indexOf("ADD CONSTRAINT nighthawk_play_outcomes_outcome_check");
  const stmt = src.slice(addIdx, src.indexOf(")", src.indexOf("CHECK", addIdx) + 1) + 1);
  for (const outcome of ["target", "stop", "open", "ambiguous", "pending", "unfilled"]) {
    assert.ok(stmt.includes(`'${outcome}'`), `outcome CHECK must allow '${outcome}' — got: ${stmt}`);
  }
  // And the fix ordering that makes the DROP+ADD meaningful: it must run AFTER the
  // CREATE TABLE whose inline column CHECK (auto-named the same) lacks 'unfilled'.
  assert.ok(
    addIdx > src.indexOf("CREATE TABLE IF NOT EXISTS nighthawk_play_outcomes"),
    "the re-issue must follow the table DDL it upgrades"
  );
});
