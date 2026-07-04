// BIE Stage 4 — alert_audit_log outcome propagation.
//
// THE BUG: alert_audit_log.outcome/outcome_graded_at/later_correct were added to the table
// (docs/bie/AUDIT-TRAIL-SCHEMA.md) so fetchResolvedAlertAuditRows() could feed
// precedent-search.ts's ingestAlertPrecedents() — the pipeline behind Largo's
// get_similar_precedents tool ("has a setup like this happened before, and what happened").
// But nothing ever wrote to `outcome` after insert: a repo-wide grep for "UPDATE
// alert_audit_log" turns up zero matches before this file existed. Every alert_audit_log row
// for every product (0DTE, Night Hawk, SPX Slayer's spx_claude_play) has sat at
// outcome = NULL forever, so fetchResolvedAlertAuditRows()'s `WHERE outcome = ANY(...)`
// filter has matched 0 rows since Stage 4 shipped — the precedent store has been empty and
// get_similar_precedents has been a silent no-op, platform-wide, this whole time.
//
// THE FIX IS PURE PROPAGATION, NOT A NEW GRADING METHODOLOGY. Every alert_audit_log row
// carries source_table/source_key pointing back to the origin row that its OWN product
// already grades independently, on its own schedule, using its own (already-reviewed,
// already-tested) logic:
//   - zerodte_setup_log.direction_hit      (src/lib/zerodte/board.ts: computeLedgerGrade)
//   - nighthawk_play_outcomes.outcome      (src/lib/nighthawk/play-outcomes.ts: resolveOutcome)
//   - spx_play_outcomes.outcome            (src/lib/spx-play-outcomes.ts: classifyOutcome)
// This module never re-derives "was this correct" from prices/times itself — it only reads
// each origin row's ALREADY-COMPUTED result and copies/maps it onto alert_audit_log. If the
// origin row isn't resolved yet (or doesn't exist), the audit row is left untouched for the
// next run — there is no "unresolved" or "give up" terminal state written here, only
// "resolved" or "still nothing to say".

import {
  fetchNighthawkOutcomeForAudit,
  fetchSpxClaudePlayOutcomeForAudit,
  fetchUngradedAlertAuditRows,
  fetchZeroDteGradeForAudit,
  gradeAlertAuditLogOutcome,
  TERMINAL_ALERT_OUTCOMES,
  type TerminalAlertOutcome,
  type UngradedAlertAuditRow,
} from "@/lib/db";

// Cheap pre-filter only (see fetchUngradedAlertAuditRows's doc comment) — real "is this
// resolved" gating happens per-product against the origin row. 3 hours comfortably covers
// SPX Slayer's same-session open->close cadence without needlessly delaying it, while 0DTE
// (next-session close) and Night Hawk (next-day 4:30pm ET) naturally stay unresolved past
// this window regardless and are simply left alone until their own grading catches up.
const DEFAULT_MIN_AGE_MINUTES = 180;
const DEFAULT_LIMIT = 500;

/** Pure: 0DTE's own `direction_hit` boolean -> the shared terminal-outcome vocabulary.
 *  `direction_hit: true` means the setup's stated direction was correct by session close —
 *  the closest analogue to a Night Hawk "target" hit. `false` is the "stop" analogue (thesis
 *  failed). `null` means the row IS graded (graded_at is set) but genuinely ungradeable (no
 *  flag price or no close price — computeLedgerGrade's documented behavior) — that's not a
 *  real answer to hand to precedent search, so it maps to "leave alone", not a vocabulary
 *  value. Exported + pure so this mapping decision is unit-testable without a DB. */
export function mapZeroDteOutcome(directionHit: boolean | null): TerminalAlertOutcome | null {
  if (directionHit === true) return "target";
  if (directionHit === false) return "stop";
  return null;
}

/** Pure: Night Hawk's own `outcome` column already uses this exact vocabulary
 *  (`target|stop|open|ambiguous|pending|unfilled` — see nighthawk_play_outcomes' CHECK
 *  constraint in db.ts) so this is a pass-through filter, not a translation: only the four
 *  TERMINAL_ALERT_OUTCOMES values count as resolved; `open`/`pending` (still live) or any
 *  unrecognized value map to "leave alone". */
export function mapNighthawkOutcome(outcome: string | null): TerminalAlertOutcome | null {
  if (outcome != null && (TERMINAL_ALERT_OUTCOMES as readonly string[]).includes(outcome)) {
    return outcome as TerminalAlertOutcome;
  }
  return null;
}

/** Pure: spx_play_outcomes' own `outcome` (`open|win|loss|breakeven`, plus the
 *  bookkeeping-only `superseded` used when a new play force-closes a stale "open" row —
 *  see db.ts's insertOpenSpxPlay) -> the shared vocabulary. `win`/`loss` map cleanly onto
 *  `target`/`stop` (a definite, correct/incorrect trade result). `breakeven` maps to
 *  `ambiguous` — not a clean win or loss, same "resolved but not directionally clear-cut"
 *  meaning `ambiguous` already carries for Night Hawk. `open` (still live) and `superseded`
 *  (force-closed as bookkeeping, never a real trade thesis test) both map to "leave alone" —
 *  a superseded row was never allowed to play out, so it has no real outcome to report. */
export function mapSpxPlayOutcome(outcome: string | null): TerminalAlertOutcome | null {
  if (outcome === "win") return "target";
  if (outcome === "loss") return "stop";
  if (outcome === "breakeven") return "ambiguous";
  return null;
}

/** Pure: derives the boolean `later_correct` column from the terminal outcome we just wrote.
 *  `target` (thesis played out) -> true, `stop` (thesis failed) -> false. `ambiguous` and
 *  `unfilled` are genuinely indeterminate by definition (both hit same day / never fillable
 *  at all) so `later_correct` stays null rather than guessing either direction. */
export function laterCorrectForOutcome(outcome: TerminalAlertOutcome): boolean | null {
  if (outcome === "target") return true;
  if (outcome === "stop") return false;
  return null;
}

export type AlertOutcomeSyncResult = {
  scanned: number;
  graded: number;
  /** Origin row found but not yet resolved (still open/pending/ungradeable) — expected and
   *  harmless; picked up again next run once the product's own grading catches up. */
  unresolved: number;
  /** No origin row found at all for this source_key (e.g. a VETO'd spx_claude_play verdict
   *  that never became a play) — expected for some alert types, not an error. */
  no_match: number;
  errors: string[];
};

/**
 * Resolve one ungraded row against its origin table. Returns the mapped terminal outcome to
 * write, or null if there is nothing to write yet (unresolved origin, no matching origin row,
 * or an alert_type this sync doesn't know how to grade). Never throws for an unrecognized
 * alert_type — that's a "not applicable", not a failure.
 */
async function resolveOrigin(
  row: UngradedAlertAuditRow
): Promise<{ outcome: TerminalAlertOutcome } | { unresolved: true } | { no_match: true }> {
  switch (row.alert_type) {
    case "zerodte": {
      const sessionDate = String(row.source_key.session_date ?? "");
      const ticker = String(row.source_key.ticker ?? "");
      if (!sessionDate || !ticker) return { no_match: true };
      const grade = await fetchZeroDteGradeForAudit(sessionDate, ticker);
      if (!grade) return { no_match: true };
      if (grade.graded_at == null) return { unresolved: true };
      const outcome = mapZeroDteOutcome(grade.direction_hit);
      return outcome ? { outcome } : { unresolved: true };
    }
    case "nighthawk": {
      const editionFor = String(row.source_key.edition_for ?? "");
      const ticker = String(row.source_key.ticker ?? "");
      if (!editionFor || !ticker) return { no_match: true };
      const origin = await fetchNighthawkOutcomeForAudit(editionFor, ticker);
      if (!origin) return { no_match: true };
      const outcome = mapNighthawkOutcome(origin.outcome);
      return outcome ? { outcome } : { unresolved: true };
    }
    case "spx_claude_play": {
      const direction = row.source_key.direction != null ? String(row.source_key.direction) : "";
      const price = Number(row.source_key.price);
      if (!direction || !Number.isFinite(price)) return { no_match: true };
      const origin = await fetchSpxClaudePlayOutcomeForAudit(direction, price, row.fired_at);
      if (!origin) return { no_match: true };
      const outcome = mapSpxPlayOutcome(origin.outcome);
      return outcome ? { outcome } : { unresolved: true };
    }
    default:
      // nighthawk_rejected is filtered out at the query layer (fetchUngradedAlertAuditRows);
      // any other future alert_type this sync hasn't been taught yet is a no-op, not a crash.
      return { no_match: true };
  }
}

/**
 * The sync entry point — call from a low-frequency cron (this is grading historical rows,
 * never live-critical). Idempotent and safe to re-run at any cadence: every write is guarded
 * by `WHERE outcome IS NULL` at the DB layer, and rows that can't be resolved yet are simply
 * skipped, not marked failed, so the next run picks them up for free.
 */
export async function syncAlertAuditOutcomes(opts?: {
  minAgeMinutes?: number;
  limit?: number;
}): Promise<AlertOutcomeSyncResult> {
  const minAgeMinutes = opts?.minAgeMinutes ?? DEFAULT_MIN_AGE_MINUTES;
  const limit = opts?.limit ?? DEFAULT_LIMIT;

  const rows = await fetchUngradedAlertAuditRows(minAgeMinutes, limit);
  const result: AlertOutcomeSyncResult = {
    scanned: rows.length,
    graded: 0,
    unresolved: 0,
    no_match: 0,
    errors: [],
  };

  for (const row of rows) {
    try {
      const resolved = await resolveOrigin(row);
      if ("outcome" in resolved) {
        const wrote = await gradeAlertAuditLogOutcome(
          row.id,
          resolved.outcome,
          laterCorrectForOutcome(resolved.outcome)
        );
        if (wrote) result.graded += 1;
        // wrote === false means a concurrent run/manual grade already resolved this row
        // between our SELECT and UPDATE — not double-counted, not an error.
      } else if ("unresolved" in resolved) {
        result.unresolved += 1;
      } else {
        result.no_match += 1;
      }
    } catch (err) {
      result.errors.push(
        `id=${row.id} alert_type=${row.alert_type}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}
