// PR-N2 (docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §2.1/§2.2 N-2): grading-methodology
// version tags for nighthawk_play_outcomes.grade_methodology.
//
// WHY THIS EXISTS: the advertised overnight record (42.9% WR) silently blended two
// grading methodologies. Rows graded before the fillability rule landed kept their old
// grades ("level touch": target/stop from session high/low touching the level, with NO
// check that the published entry band was ever fillable), while rows graded after it —
// including the 12 rows repaired by the PR-N1 stuck-outcome regrade — carry current-rules
// grades ("fillability": the session must trade back into the published band or the play
// is 'unfilled', excluded from win/loss). Measured on the 26-play history: every
// open-beyond-band play graded 6T/1S +5.11% avg (phantom wins — the entry never existed)
// while the genuinely fillable plays graded 0T/4S −1.39%. One aggregate over both rule
// sets is not a record, it's an artifact of WHEN each row happened to be graded.
//
// Tags name WHAT THE RULE WAS (never a date):
//  - v1_level_touch — pre-fillability resolveOutcome: outcome from the level touch alone.
//  - v2_fillability — current resolveOutcome (play-outcomes.ts): fill at the published
//    band required first; gap-away sessions grade 'unfilled' and never enter the WR
//    denominator.
//
// Dependency-free leaf (same idiom as play-levels.ts): imported by db.ts (stamping/
// backfill), analytics.ts (segmentation), the regrade lib, and client display code —
// so a zero-import module is the only cycle-safe, client-bundle-safe home.

/** Rows graded by the CURRENT resolveOutcome (fill-at-band required, 'unfilled' verdict). */
export const GRADE_METHODOLOGY_CURRENT = "v2_fillability";

/** Rows still carrying a grade written before the fillability rule (level touch only).
 *  Also the conservative boot-backfill tag for any resolved row with no stamp: provenance
 *  is unprovable from the row itself, so an unstamped grade is NEVER presumed current —
 *  it stays quarantined in the legacy segment until the admin legacy-regrade re-verifies
 *  it under current rules and promotes it (preserving the old grade in legacy_grade). */
export const GRADE_METHODOLOGY_LEGACY = "v1_level_touch";

/** Human-readable labels for the record UI / API `methodology` fields. */
export const GRADE_METHODOLOGY_LABEL: Record<string, string> = {
  [GRADE_METHODOLOGY_CURRENT]:
    "Current rules — a play must be fillable at its published entry band; gap-away sessions grade unfilled and are excluded from the win rate",
  [GRADE_METHODOLOGY_LEGACY]:
    "Legacy rules — graded on level touch alone, with no check that the published entry band was fillable (superseded; reported separately, never blended into the headline)",
};

export function gradeMethodologyLabel(tag: string | null | undefined): string {
  return GRADE_METHODOLOGY_LABEL[tag ?? ""] ?? GRADE_METHODOLOGY_LABEL[GRADE_METHODOLOGY_LEGACY];
}

/** The segmentation rule, used identically by analytics + the regrade selector: only an
 *  explicit current-version stamp counts as current. NULL/unknown tags are legacy —
 *  unprovable provenance must degrade toward the quarantined segment, never toward the
 *  advertised headline. */
export function isCurrentGradeMethodology(tag: string | null | undefined): boolean {
  return tag === GRADE_METHODOLOGY_CURRENT;
}
