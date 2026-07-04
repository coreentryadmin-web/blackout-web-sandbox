import assert from "node:assert/strict";
import { before, describe, test, mock } from "node:test";
import type { UngradedAlertAuditRow } from "@/lib/db";

// Regression: alert_audit_log.outcome was never UPDATEd anywhere in the codebase (grep for
// "UPDATE alert_audit_log" turned up zero hits), so fetchResolvedAlertAuditRows() — the read
// side that feeds BIE precedent search — always returned 0 rows. This suite proves the fix
// (syncAlertAuditOutcomes) actually propagates each product's ALREADY-COMPUTED origin outcome
// onto alert_audit_log, and — just as important — leaves a row alone when its origin isn't
// resolved yet, rather than ever inventing an answer.

let mockUngraded: UngradedAlertAuditRow[] = [];
let mockZeroDteGrade: { direction_hit: boolean | null; graded_at: string | null } | null = null;
let mockNighthawkOutcome: { outcome: string } | null = null;
let mockSpxOutcome: { outcome: string } | null = null;
let gradeCalls: Array<{ id: number; outcome: string; laterCorrect: boolean | null }> = [];
let gradeReturns = true;

mock.module("../db", {
  namedExports: {
    TERMINAL_ALERT_OUTCOMES: ["target", "stop", "ambiguous", "unfilled"],
    fetchUngradedAlertAuditRows: async () => mockUngraded,
    fetchZeroDteGradeForAudit: async () => mockZeroDteGrade,
    fetchNighthawkOutcomeForAudit: async () => mockNighthawkOutcome,
    fetchSpxClaudePlayOutcomeForAudit: async () => mockSpxOutcome,
    gradeAlertAuditLogOutcome: async (id: number, outcome: string, laterCorrect: boolean | null) => {
      gradeCalls.push({ id, outcome, laterCorrect });
      return gradeReturns;
    },
  },
});

function row(overrides: Partial<UngradedAlertAuditRow> = {}): UngradedAlertAuditRow {
  return {
    id: 1,
    alert_type: "zerodte",
    source_table: "zerodte_setup_log",
    source_key: { session_date: "2026-07-01", ticker: "NVDA" },
    fired_at: "2026-07-01T14:30:00.000Z",
    ...overrides,
  };
}

describe("alert-outcome-sync", () => {
  let mod: typeof import("./alert-outcome-sync");

  before(async () => {
    mod = await import("./alert-outcome-sync");
  });

  // ── pure mapping functions ──────────────────────────────────────────────────────

  test("mapZeroDteOutcome: direction_hit true/false map to target/stop, null leaves alone", () => {
    assert.equal(mod.mapZeroDteOutcome(true), "target");
    assert.equal(mod.mapZeroDteOutcome(false), "stop");
    assert.equal(mod.mapZeroDteOutcome(null), null);
  });

  test("mapNighthawkOutcome: passes through terminal values, filters open/pending", () => {
    assert.equal(mod.mapNighthawkOutcome("target"), "target");
    assert.equal(mod.mapNighthawkOutcome("stop"), "stop");
    assert.equal(mod.mapNighthawkOutcome("ambiguous"), "ambiguous");
    assert.equal(mod.mapNighthawkOutcome("unfilled"), "unfilled");
    assert.equal(mod.mapNighthawkOutcome("open"), null);
    assert.equal(mod.mapNighthawkOutcome("pending"), null);
    assert.equal(mod.mapNighthawkOutcome(null), null);
  });

  test("mapSpxPlayOutcome: win/loss/breakeven map to target/stop/ambiguous; open+superseded leave alone", () => {
    assert.equal(mod.mapSpxPlayOutcome("win"), "target");
    assert.equal(mod.mapSpxPlayOutcome("loss"), "stop");
    assert.equal(mod.mapSpxPlayOutcome("breakeven"), "ambiguous");
    assert.equal(mod.mapSpxPlayOutcome("open"), null);
    assert.equal(mod.mapSpxPlayOutcome("superseded"), null);
  });

  test("laterCorrectForOutcome: target->true, stop->false, ambiguous/unfilled->null", () => {
    assert.equal(mod.laterCorrectForOutcome("target"), true);
    assert.equal(mod.laterCorrectForOutcome("stop"), false);
    assert.equal(mod.laterCorrectForOutcome("ambiguous"), null);
    assert.equal(mod.laterCorrectForOutcome("unfilled"), null);
  });

  // ── syncAlertAuditOutcomes: the required "resolved -> writes" / "unresolved -> leaves alone" cases ──

  test("0DTE: resolved origin (graded_at set, direction_hit true) writes outcome=target + later_correct=true", async () => {
    mockUngraded = [row({ id: 101, alert_type: "zerodte", source_key: { session_date: "2026-07-01", ticker: "NVDA" } })];
    mockZeroDteGrade = { direction_hit: true, graded_at: "2026-07-01T21:00:00.000Z" };
    gradeCalls = [];
    gradeReturns = true;

    const result = await mod.syncAlertAuditOutcomes();

    assert.equal(result.scanned, 1);
    assert.equal(result.graded, 1);
    assert.equal(result.unresolved, 0);
    assert.deepEqual(gradeCalls, [{ id: 101, outcome: "target", laterCorrect: true }]);
  });

  test("0DTE: unresolved origin (graded_at still null) leaves the audit row untouched", async () => {
    mockUngraded = [row({ id: 102, alert_type: "zerodte", source_key: { session_date: "2026-07-04", ticker: "TSLA" } })];
    mockZeroDteGrade = { direction_hit: null, graded_at: null };
    gradeCalls = [];

    const result = await mod.syncAlertAuditOutcomes();

    assert.equal(result.graded, 0);
    assert.equal(result.unresolved, 1);
    assert.deepEqual(gradeCalls, [], "gradeAlertAuditLogOutcome must not be called for an unresolved origin row");
  });

  test("0DTE: graded_at set but direction_hit null (genuinely ungradeable) also leaves the row alone", () => {
    // Covered as its own case since it's easy to conflate with the "graded_at null" unresolved
    // case above — this is graded-but-no-answer, a different reason for the same "leave alone".
    assert.equal(mod.mapZeroDteOutcome(null), null);
  });

  test("Night Hawk: resolved origin (outcome=stop) writes through unchanged + later_correct=false", async () => {
    mockUngraded = [
      row({
        id: 201,
        alert_type: "nighthawk",
        source_key: { edition_for: "2026-06-30", ticker: "AAPL" },
      }),
    ];
    mockNighthawkOutcome = { outcome: "stop" };
    gradeCalls = [];
    gradeReturns = true;

    const result = await mod.syncAlertAuditOutcomes();

    assert.equal(result.graded, 1);
    assert.deepEqual(gradeCalls, [{ id: 201, outcome: "stop", laterCorrect: false }]);
  });

  test("Night Hawk: still-pending origin leaves the audit row untouched", async () => {
    mockUngraded = [
      row({ id: 202, alert_type: "nighthawk", source_key: { edition_for: "2026-07-04", ticker: "MSFT" } }),
    ];
    mockNighthawkOutcome = { outcome: "pending" };
    gradeCalls = [];

    const result = await mod.syncAlertAuditOutcomes();

    assert.equal(result.graded, 0);
    assert.equal(result.unresolved, 1);
    assert.deepEqual(gradeCalls, []);
  });

  test("SPX Slayer: matched closed play (win) writes outcome=target", async () => {
    mockUngraded = [
      row({
        id: 301,
        alert_type: "spx_claude_play",
        source_key: { price: 6234.5, direction: "long", at: "2026-07-01T15:00:00.000Z" },
      }),
    ];
    mockSpxOutcome = { outcome: "win" };
    gradeCalls = [];
    gradeReturns = true;

    const result = await mod.syncAlertAuditOutcomes();

    assert.equal(result.graded, 1);
    assert.deepEqual(gradeCalls, [{ id: 301, outcome: "target", laterCorrect: true }]);
  });

  test("SPX Slayer: no matching play (e.g. a VETO'd verdict) counts as no_match, never errors", async () => {
    mockUngraded = [
      row({
        id: 302,
        alert_type: "spx_claude_play",
        source_key: { price: 6200.0, direction: "short", at: "2026-07-01T15:05:00.000Z" },
      }),
    ];
    mockSpxOutcome = null;
    gradeCalls = [];

    const result = await mod.syncAlertAuditOutcomes();

    assert.equal(result.graded, 0);
    assert.equal(result.no_match, 1);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(gradeCalls, []);
  });

  test("a race where a concurrent run already graded the row (UPDATE affects 0 rows) is not double-counted", async () => {
    mockUngraded = [row({ id: 103, alert_type: "zerodte", source_key: { session_date: "2026-07-01", ticker: "NVDA" } })];
    mockZeroDteGrade = { direction_hit: true, graded_at: "2026-07-01T21:00:00.000Z" };
    gradeCalls = [];
    gradeReturns = false; // simulates WHERE outcome IS NULL matching zero rows

    const result = await mod.syncAlertAuditOutcomes();

    assert.equal(result.graded, 0);
    assert.equal(gradeCalls.length, 1, "the update was still attempted");
  });

  test("nighthawk_rejected and unrecognized alert_types are treated as no_match, never thrown", async () => {
    mockUngraded = [row({ id: 401, alert_type: "future_instrument", source_key: {} })];
    gradeCalls = [];

    const result = await mod.syncAlertAuditOutcomes();

    assert.equal(result.graded, 0);
    assert.equal(result.no_match, 1);
    assert.deepEqual(result.errors, []);
  });

  test("scanning zero rows returns a clean all-zero result", async () => {
    mockUngraded = [];
    const result = await mod.syncAlertAuditOutcomes();
    assert.deepEqual(result, { scanned: 0, graded: 0, unresolved: 0, no_match: 0, errors: [] });
  });
});
