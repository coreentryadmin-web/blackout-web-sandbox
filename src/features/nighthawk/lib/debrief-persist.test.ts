// PR-N10 — debrief persistence tests: the cron pass (fail-soft, first-write-wins,
// newly-graded rows only, honest counts) and the rejection counterfactual runner
// (bounded, same-bar-path grading, ungradeable persisted with reason). Hermetic via
// dependency injection — the passes take their DB/provider seams as deps, so no
// module mocking and no network anywhere.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkPlayOutcomeRow, NighthawkPublishGateRejectionRow } from "@/lib/db";
import {
  gradeRejectedPlay,
  levelsFromRejectionSnapshot,
  runNighthawkDebriefPass,
  runNighthawkRejectionCounterfactuals,
} from "./debrief-persist";
import { GRADE_METHODOLOGY_CURRENT } from "./grade-methodology";

const NOW = Date.parse("2026-07-14T20:35:00Z");

function fullRow(over: Partial<NighthawkPlayOutcomeRow> = {}): NighthawkPlayOutcomeRow {
  return {
    id: 1,
    edition_for: "2026-07-14",
    ticker: "TEST",
    direction: "LONG",
    conviction: "B",
    entry_range_low: 100,
    entry_range_high: 102,
    target: 110,
    stop: 95,
    score: 62,
    sector: "Technology",
    next_day_open: 101,
    next_day_close: 96,
    session_high: 103,
    session_low: 94.5,
    hit_target: false,
    hit_stop: true,
    outcome: "stop",
    created_at: "2026-07-14T00:00:00.000Z",
    pulled: false,
    pulled_reason: null,
    publish_context: null,
    morning_verdict: null,
    grade_methodology: GRADE_METHODOLOGY_CURRENT,
    legacy_grade: null,
    debrief: null,
    ...over,
  };
}

function rejectionRow(over: Partial<NighthawkPublishGateRejectionRow> = {}): NighthawkPublishGateRejectionRow {
  return {
    id: 7,
    ticker: "DELL",
    edition_for: "2026-07-08",
    direction: "LONG",
    fired_at: "2026-07-07T23:40:00.000Z",
    input_snapshot: {
      entry_range_low: 226.82,
      entry_range_high: 227.27,
      target: 469.47,
      stop: 225,
      gate_blocks: [{ code: "band_detached" }, { code: "target_unreachable" }],
    },
    counterfactual_json: null,
    ...over,
  };
}

// ── The debrief pass ─────────────────────────────────────────────────────────────────

test("debrief pass: pins newly-graded rows with debriefed_at; honest counts", async () => {
  const pinned: Array<{ id: number; debrief: Record<string, unknown> }> = [];
  const result = await runNighthawkDebriefPass(
    { nowMs: NOW },
    {
      fetchRows: async () => [fullRow({ id: 1 }), fullRow({ id: 2, ticker: "AMD", outcome: "target", next_day_close: 111, session_high: 112 })],
      pin: async (id, debrief) => {
        pinned.push({ id, debrief });
        return { matched: true, written: true };
      },
    }
  );
  assert.deepEqual(
    { ok: result.ok, scanned: result.scanned, pinned: result.pinned, already_pinned: result.already_pinned, skipped: result.skipped },
    { ok: true, scanned: 2, pinned: 2, already_pinned: 0, skipped: 0 }
  );
  assert.equal(pinned.length, 2);
  // The pin is the pure debrief + the pass's clock stamp.
  assert.equal(pinned[0]!.debrief.debrief_version, 1);
  assert.equal(pinned[0]!.debrief.debriefed_at, new Date(NOW).toISOString());
  const fm = pinned[0]!.debrief.failure_mode as { tag: string };
  assert.equal(typeof fm.tag, "string");
});

test("debrief pass: first-write-wins — a raced row counts as already_pinned, never overwritten", async () => {
  const result = await runNighthawkDebriefPass(
    { nowMs: NOW },
    {
      fetchRows: async () => [fullRow({ id: 1 })],
      pin: async () => ({ matched: true, written: false }),
    }
  );
  assert.equal(result.pinned, 0);
  assert.equal(result.already_pinned, 1);
  assert.equal(result.ok, true);
});

test("debrief pass: a pending row (defensive) is skipped — no debrief exists before a grade", async () => {
  const result = await runNighthawkDebriefPass(
    { nowMs: NOW },
    {
      fetchRows: async () => [fullRow({ outcome: "pending" })],
      pin: async () => {
        throw new Error("must not be called for a pending row");
      },
    }
  );
  assert.equal(result.skipped, 1);
  assert.equal(result.pinned, 0);
  assert.equal(result.ok, true);
});

test("debrief pass: fail-soft — a queue-fetch failure returns ok:false, never throws; a per-row pin failure isolates", async () => {
  const fetchFail = await runNighthawkDebriefPass(
    { nowMs: NOW },
    {
      fetchRows: async () => {
        throw new Error("pg down");
      },
      pin: async () => ({ matched: true, written: true }),
    }
  );
  assert.equal(fetchFail.ok, false);
  assert.match(fetchFail.errors[0]!, /pg down/);

  let calls = 0;
  const rowFail = await runNighthawkDebriefPass(
    { nowMs: NOW },
    {
      fetchRows: async () => [fullRow({ id: 1 }), fullRow({ id: 2, ticker: "OK" })],
      pin: async (id) => {
        calls += 1;
        if (id === 1) throw new Error("constraint violation");
        return { matched: true, written: true };
      },
    }
  );
  assert.equal(calls, 2); // the batch continued past the failing row
  assert.equal(rowFail.pinned, 1);
  assert.equal(rowFail.ok, false);
  assert.match(rowFail.errors[0]!, /TEST@2026-07-14/);
});

// ── The rejection counterfactual runner ──────────────────────────────────────────────

test("counterfactual runner: grades a blocked play on the same daily-bar path and pins it", async () => {
  const persisted: Array<{ id: number; blob: Record<string, unknown> }> = [];
  const barCalls: string[] = [];
  const result = await runNighthawkRejectionCounterfactuals(
    { nowMs: NOW },
    {
      polygonReady: () => true,
      fetchRejections: async (_days, opts) => {
        assert.equal(opts?.ungradedOnly, true); // only ungraded rows are ever re-ground
        return [rejectionRow()];
      },
      fetchDailyBar: async (ticker, from, to) => {
        barCalls.push(`${ticker}:${from}:${to}`);
        // DELL's real 2026-07-08 session bar.
        return [{ o: 422.88, h: 449.45, l: 414, c: 431.97 }];
      },
      persist: async (id, blob) => {
        persisted.push({ id, blob });
        return true;
      },
    }
  );
  assert.deepEqual(barCalls, ["DELL:2026-07-08:2026-07-08"]); // one bar, the play's own session
  assert.equal(result.graded, 1);
  assert.equal(result.ok, true);
  const blob = persisted[0]!.blob as Record<string, unknown>;
  // The DELL-class block grades 'unfilled' — the gate was trivially right.
  assert.equal(blob.outcome, "unfilled");
  assert.equal(blob.would_have_won, false);
  assert.equal(blob.basis, "underlying_daily_bar");
});

test("counterfactual runner: no bar yet → skipped (retried next run); Polygon off → honest note", async () => {
  const result = await runNighthawkRejectionCounterfactuals(
    { nowMs: NOW },
    {
      polygonReady: () => true,
      fetchRejections: async () => [rejectionRow()],
      fetchDailyBar: async () => [],
      persist: async () => {
        throw new Error("must not persist without a bar");
      },
    }
  );
  assert.equal(result.skipped_no_bar, 1);
  assert.equal(result.graded, 0);
  assert.equal(result.ok, true);

  const off = await runNighthawkRejectionCounterfactuals({ nowMs: NOW }, { polygonReady: () => false });
  assert.match(off.note!, /Polygon not configured/);
  assert.equal(off.scanned, 0);
});

test("counterfactual runner: unreconstructable levels persist an explicit ungradeable blob (never re-ground)", async () => {
  const persisted: Array<Record<string, unknown>> = [];
  const result = await runNighthawkRejectionCounterfactuals(
    { nowMs: NOW },
    {
      polygonReady: () => true,
      fetchRejections: async () => [
        rejectionRow({ input_snapshot: { gate_blocks: [{ code: "geometry_unknown" }] } }),
      ],
      fetchDailyBar: async () => [{ o: 100, h: 105, l: 99, c: 103 }],
      persist: async (_id, blob) => {
        persisted.push(blob);
        return true;
      },
    }
  );
  assert.equal(result.ungradeable, 1);
  assert.equal(persisted[0]!.outcome, "ungradeable");
  assert.match(String(persisted[0]!.reason), /cannot be reconstructed/);
});

test("counterfactual runner: fail-soft on fetch failure; per-row error isolates the batch", async () => {
  const fetchFail = await runNighthawkRejectionCounterfactuals(
    { nowMs: NOW },
    {
      polygonReady: () => true,
      fetchRejections: async () => {
        throw new Error("pg down");
      },
    }
  );
  assert.equal(fetchFail.ok, false);

  const rowFail = await runNighthawkRejectionCounterfactuals(
    { nowMs: NOW },
    {
      polygonReady: () => true,
      fetchRejections: async () => [rejectionRow({ id: 1, ticker: "BAD" }), rejectionRow({ id: 2 })],
      fetchDailyBar: async (ticker) => {
        if (ticker === "BAD") throw new Error("provider 500");
        return [{ o: 422.88, h: 449.45, l: 414, c: 431.97 }];
      },
      persist: async () => true,
    }
  );
  assert.equal(rowFail.graded, 1);
  assert.equal(rowFail.errors.length, 1);
  assert.match(rowFail.errors[0]!, /BAD@2026-07-08/);
});

// ── The pure counterfactual grader ───────────────────────────────────────────────────

test("gradeRejectedPlay: a would-have-won block grades target with the realized return", () => {
  const cf = gradeRejectedPlay({
    rejection: {
      ticker: "NVDA",
      edition_for: "2026-07-10",
      direction: "LONG",
      input_snapshot: { entry_range_low: 100, entry_range_high: 102, target: 110, stop: 95, gate_blocks: [] },
    },
    bar: { o: 101, h: 111, l: 100, c: 110.5 },
    nowMs: NOW,
  });
  assert.equal(cf.outcome, "target");
  assert.equal(cf.would_have_won, true);
  assert.equal(cf.hit_target, true);
  // close vs entry mid 101 → +9.41%
  assert.equal(cf.realized_return_pct, 9.41);
  assert.equal(cf.graded_at, new Date(NOW).toISOString());
});

test("gradeRejectedPlay: an open close only wins when profitable (conservative economics)", () => {
  const base = {
    ticker: "T",
    edition_for: "2026-07-10",
    direction: "LONG" as const,
    input_snapshot: { entry_range_low: 100, entry_range_high: 102, target: 120, stop: 90, gate_blocks: [] },
  };
  const up = gradeRejectedPlay({ rejection: base, bar: { o: 101, h: 106, l: 100, c: 105 }, nowMs: NOW });
  assert.equal(up.outcome, "open");
  assert.equal(up.would_have_won, true);
  const flat = gradeRejectedPlay({ rejection: base, bar: { o: 101, h: 102, l: 100, c: 101 }, nowMs: NOW });
  assert.equal(flat.would_have_won, false); // 101 close vs 101 mid = 0% — a tie is not a win
});

test("levelsFromRejectionSnapshot: structural read, junk-tolerant", () => {
  assert.deepEqual(levelsFromRejectionSnapshot({ entry_range_low: 1, entry_range_high: "2", target: 3, stop: null }), {
    entry_range_low: 1,
    entry_range_high: null,
    target: 3,
    stop: null,
  });
  assert.deepEqual(levelsFromRejectionSnapshot(null), {
    entry_range_low: null,
    entry_range_high: null,
    target: null,
    stop: null,
  });
});
