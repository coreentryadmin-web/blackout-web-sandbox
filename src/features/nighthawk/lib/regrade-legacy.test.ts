import assert from "node:assert/strict";
import test from "node:test";
import {
  isLegacyGradedNighthawkOutcome,
  regradeLegacyNighthawkOutcomes,
  type RegradeLegacyDeps,
} from "./regrade-legacy";
import {
  GRADE_METHODOLOGY_CURRENT,
  GRADE_METHODOLOGY_LEGACY,
} from "./grade-methodology";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";

// PR-N2 honest re-grade. The fixture shapes mirror the measured N-2 forensics
// (docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §2.1/§2.2): the phantom-win row is the
// OKTA/HIMS/ANET class — a LONG whose published band sat below the open and whose
// session never traded back into it (low > band top), graded "target" under the old
// level-touch rules but 'unfilled' under current rules.

function row(over: Partial<NighthawkPlayOutcomeRow>): NighthawkPlayOutcomeRow {
  return {
    id: 1,
    edition_for: "2026-06-29",
    ticker: "OKTA",
    direction: "LONG",
    conviction: "A",
    entry_range_low: 100,
    entry_range_high: 101,
    target: 110,
    stop: 95,
    score: 70,
    sector: "Technology",
    // Persisted bars: open gapped ABOVE the band (105 > 101), session low 103.2 never
    // re-entered it, high touched the 110 target. Level-touch grade: target. Current
    // rules: unfilled (no fill ever existed at the published band).
    next_day_open: 105,
    next_day_close: 111,
    session_high: 112,
    session_low: 103.2,
    hit_target: true,
    hit_stop: false,
    outcome: "target",
    created_at: "2026-06-29T22:00:00.000Z",
    grade_methodology: GRADE_METHODOLOGY_LEGACY,
    legacy_grade: null,
    ...over,
  };
}

/** Hermetic dep harness mirroring the real SQL semantics: the fetch only returns
 *  non-current-methodology resolved rows, and persist applies the same guard +
 *  COALESCE-first-write-wins legacy_grade capture regradeLegacyNighthawkOutcome's
 *  UPDATE enforces — so a second run sees promoted rows exactly like production. */
function harness(rows: NighthawkPlayOutcomeRow[]) {
  const persisted: number[] = [];
  const deps: RegradeLegacyDeps = {
    fetchLegacy: async () =>
      rows.filter((r) => r.outcome !== "pending" && r.grade_methodology !== GRADE_METHODOLOGY_CURRENT),
    persist: async (id, verdict) => {
      const target = rows.find((r) => r.id === id);
      // Mirror the SQL guard: resolved + not already current.
      if (!target || target.outcome === "pending" || target.grade_methodology === GRADE_METHODOLOGY_CURRENT) {
        return false;
      }
      // Mirror COALESCE(legacy_grade, jsonb_build_object(...old values...)).
      target.legacy_grade = target.legacy_grade ?? {
        outcome: target.outcome,
        hit_target: target.hit_target,
        hit_stop: target.hit_stop,
        grade_methodology: target.grade_methodology ?? GRADE_METHODOLOGY_LEGACY,
      };
      target.hit_target = verdict.hit_target;
      target.hit_stop = verdict.hit_stop;
      target.outcome = verdict.outcome;
      target.grade_methodology = GRADE_METHODOLOGY_CURRENT;
      persisted.push(id);
      return true;
    },
  };
  return { deps, persisted };
}

test("isLegacyGradedNighthawkOutcome: resolved non-current rows only; NULL tags quarantine as legacy", () => {
  assert.equal(isLegacyGradedNighthawkOutcome(row({})), true, "explicit legacy tag");
  assert.equal(
    isLegacyGradedNighthawkOutcome(row({ grade_methodology: null })),
    true,
    "unprovable provenance is legacy, never current"
  );
  assert.equal(
    isLegacyGradedNighthawkOutcome(row({ grade_methodology: GRADE_METHODOLOGY_CURRENT })),
    false,
    "already-current rows are never re-graded"
  );
  assert.equal(
    isLegacyGradedNighthawkOutcome(row({ outcome: "pending", grade_methodology: null })),
    false,
    "pending rows belong to the cron / stuck repair, not the methodology regrade"
  );
});

test("re-grades a legacy phantom win to 'unfilled' under current rules, preserving the old grade", async () => {
  const rows = [row({ id: 1 })];
  const { deps } = harness(rows);

  const result = await regradeLegacyNighthawkOutcomes({}, deps);

  assert.equal(result.matched, 1);
  assert.equal(result.regraded, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.methodology, GRADE_METHODOLOGY_CURRENT);
  assert.deepEqual(
    result.rows[0],
    {
      id: 1,
      ticker: "OKTA",
      edition_for: "2026-06-29",
      previous_outcome: "target",
      outcome: "unfilled",
      hit_target: false,
      hit_stop: false,
      changed: true,
    },
    "the phantom win must re-grade to unfilled with the previous grade in the ledger"
  );
  // The row itself: promoted, old grade preserved verbatim.
  assert.equal(rows[0].outcome, "unfilled");
  assert.equal(rows[0].grade_methodology, GRADE_METHODOLOGY_CURRENT);
  assert.deepEqual(rows[0].legacy_grade, {
    outcome: "target",
    hit_target: true,
    hit_stop: false,
    grade_methodology: GRADE_METHODOLOGY_LEGACY,
  });
});

test("a fillable legacy row keeps its grade under current rules — restamped, changed=false", async () => {
  // Band was reachable (low 99.5 <= band top 101) and the stop was hit (low <= 95? no —
  // use a stop grade): low 94 hits stop 95 after a fill existed. Current rules agree
  // with the old 'stop' grade — the regrade restamps without changing the verdict.
  const rows = [
    row({
      id: 2,
      ticker: "WDC",
      next_day_open: 100.5,
      next_day_close: 94.5,
      session_high: 102,
      session_low: 94,
      hit_target: false,
      hit_stop: true,
      outcome: "stop",
    }),
  ];
  const { deps } = harness(rows);

  const result = await regradeLegacyNighthawkOutcomes({}, deps);

  assert.equal(result.regraded, 1);
  assert.equal(result.rows[0].outcome, "stop");
  assert.equal(result.rows[0].changed, false);
  assert.equal(rows[0].grade_methodology, GRADE_METHODOLOGY_CURRENT);
  assert.deepEqual(
    rows[0].legacy_grade,
    { outcome: "stop", hit_target: false, hit_stop: true, grade_methodology: GRADE_METHODOLOGY_LEGACY },
    "even an unchanged verdict preserves the pre-regrade grade for the audit trail"
  );
});

test("idempotent: a second run matches nothing and the preserved legacy grade survives untouched", async () => {
  const rows = [row({ id: 1 })];
  const { deps, persisted } = harness(rows);

  const first = await regradeLegacyNighthawkOutcomes({}, deps);
  assert.equal(first.regraded, 1);
  const preserved = rows[0].legacy_grade;

  const second = await regradeLegacyNighthawkOutcomes({}, deps);
  assert.equal(second.matched, 0, "a promoted row can never match the selector again");
  assert.equal(second.regraded, 0);
  assert.equal(persisted.length, 1, "no second write");
  assert.equal(rows[0].legacy_grade, preserved, "first-write-wins: the original grade is never rewritten");
});

test("dry-run resolves and reports every would-be change but persists nothing", async () => {
  const rows = [row({ id: 1 })];
  const { deps, persisted } = harness(rows);

  const result = await regradeLegacyNighthawkOutcomes({ dryRun: true }, deps);

  assert.equal(result.dry_run, true);
  assert.equal(result.matched, 1);
  assert.equal(result.regraded, 0);
  assert.equal(result.rows[0].outcome, "unfilled", "dry-run still shows what WOULD grade");
  assert.equal(persisted.length, 0);
  assert.equal(rows[0].outcome, "target", "row untouched");
  assert.equal(rows[0].grade_methodology, GRADE_METHODOLOGY_LEGACY);
  assert.equal(rows[0].legacy_grade, null);
});

test("bounded: processes at most `limit` rows per run; the rest re-match next run", async () => {
  const rows = [row({ id: 1 }), row({ id: 2, ticker: "HIMS" }), row({ id: 3, ticker: "ANET" })];
  const { deps } = harness(rows);

  const result = await regradeLegacyNighthawkOutcomes({ limit: 2 }, deps);
  assert.equal(result.matched, 3);
  assert.equal(result.regraded, 2);

  const second = await regradeLegacyNighthawkOutcomes({ limit: 2 }, deps);
  assert.equal(second.matched, 1, "the unprocessed row is still legacy and re-matches");
  assert.equal(second.regraded, 1);
});

test("a legacy row whose persisted bars can't support a verdict is skipped, never fabricated", async () => {
  // No close persisted (shouldn't exist for a resolved row, but defensive): current
  // rules would return 'pending' — the row must stay quarantined as legacy rather than
  // gain a made-up current grade.
  const rows = [row({ id: 9, next_day_close: null })];
  const { deps, persisted } = harness(rows);

  const result = await regradeLegacyNighthawkOutcomes({}, deps);
  assert.equal(result.matched, 1);
  assert.equal(result.skipped_unresolvable, 1);
  assert.equal(result.regraded, 0);
  assert.equal(persisted.length, 0);
  assert.equal(rows[0].grade_methodology, GRADE_METHODOLOGY_LEGACY, "stays in the legacy segment");
});

test("per-row failures land in errors and never abort the rest of the run", async () => {
  const rows = [row({ id: 1 }), row({ id: 2, ticker: "HIMS" })];
  const { deps } = harness(rows);
  const failingDeps: RegradeLegacyDeps = {
    ...deps,
    persist: async (id, verdict) => {
      if (id === 1) throw new Error("boom");
      return deps.persist(id, verdict);
    },
  };

  const result = await regradeLegacyNighthawkOutcomes({}, failingDeps);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /OKTA@2026-06-29: boom/);
  assert.equal(result.regraded, 1, "the second row still graded");
});
