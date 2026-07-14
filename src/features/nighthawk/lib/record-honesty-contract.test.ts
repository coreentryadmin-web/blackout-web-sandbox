import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GRADE_METHODOLOGY_CURRENT,
  GRADE_METHODOLOGY_LEGACY,
} from "./grade-methodology";

// PR-N2 source contracts (same readFileSync idiom as nighthawk-pinning-contract.test.ts):
// the load-bearing SQL/wiring properties of the methodology-versioned record that a
// refactor could silently drop —
//  1. the schema adds are idempotent ALTER … IF NOT EXISTS and the boot backfill stamps
//     ONLY unstamped resolved rows as legacy (conservative provenance);
//  2. every grade write through updateNighthawkPlayOutcome stamps the current tag;
//  3. the legacy regrade preserves the old grade COALESCE-first-write-wins and is
//     guarded to non-current rows (idempotence in SQL, not caller discipline);
//  4. the record API serves both segments and the strip renders the honest split
//     (unfilled/pulled/legacy counts + methodology tag + LOW-N chip);
//  5. every headline surface (track-record page predicate) checks the methodology.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("db.ts: grade_methodology/legacy_grade are idempotent ALTERs and the backfill only stamps unstamped resolved rows", () => {
  const src = read("src/lib/db.ts");
  assert.match(
    src,
    /ALTER TABLE nighthawk_play_outcomes ADD COLUMN IF NOT EXISTS grade_methodology TEXT/,
    "prod tables must pick the column up on boot"
  );
  assert.match(
    src,
    /ALTER TABLE nighthawk_play_outcomes ADD COLUMN IF NOT EXISTS legacy_grade JSONB/,
    "prod tables must pick the preserved-grade column up on boot"
  );
  const backfill = src.match(
    /UPDATE nighthawk_play_outcomes\s+SET grade_methodology = '\$\{GRADE_METHODOLOGY_LEGACY\}'\s+WHERE outcome <> 'pending' AND grade_methodology IS NULL/
  );
  assert.ok(
    backfill,
    "boot backfill must tag ONLY resolved rows with no stamp as legacy — pending rows have no methodology and stamped rows are never restamped"
  );
});

test("db.ts: updateNighthawkPlayOutcome stamps the current methodology on every real grade", () => {
  const src = read("src/lib/db.ts");
  const fn = src.slice(
    src.indexOf("export async function updateNighthawkPlayOutcome"),
    src.indexOf("export async function fetchLegacyGradedNighthawkOutcomes")
  );
  assert.match(
    fn,
    /grade_methodology = CASE WHEN \$8 = 'pending' THEN grade_methodology ELSE '\$\{GRADE_METHODOLOGY_CURRENT\}' END/,
    "the cron/stuck-repair write path must stamp current-rules grades (and never stamp a non-verdict)"
  );
});

test("db.ts: the legacy regrade preserves the old grade first-write-wins and can never touch a current row", () => {
  const src = read("src/lib/db.ts");
  const fn = src.slice(
    src.indexOf("export async function regradeLegacyNighthawkOutcome"),
    src.indexOf("/** PR-N4: persist one morning-confirm verdict")
  );
  assert.match(
    fn,
    /legacy_grade = COALESCE\(legacy_grade, jsonb_build_object\(/,
    "the superseded grade is pinned once and never overwritten — history is quarantined, not destroyed"
  );
  assert.match(
    fn,
    /'outcome', outcome,\s*'hit_target', hit_target,\s*'hit_stop', hit_stop,/,
    "the preserved blob must capture the pre-UPDATE grade fields verbatim"
  );
  assert.match(
    fn,
    /AND outcome <> 'pending'\s+AND \(grade_methodology IS NULL OR grade_methodology <> '\$\{GRADE_METHODOLOGY_CURRENT\}'\)/,
    "idempotence lives in the SQL guard: a promoted row can never match again"
  );
});

test("db.ts: the legacy work-queue selector matches the segmentation rule (NULL and unknown tags are legacy)", () => {
  const src = read("src/lib/db.ts");
  const fn = src.slice(
    src.indexOf("export async function fetchLegacyGradedNighthawkOutcomes"),
    src.indexOf("export async function regradeLegacyNighthawkOutcome")
  );
  assert.match(fn, /WHERE outcome <> 'pending'/);
  assert.match(
    fn,
    /AND \(grade_methodology IS NULL OR grade_methodology <> '\$\{GRADE_METHODOLOGY_CURRENT\}'\)/,
    "anything not explicitly current is regrade work — unprovable provenance never reads as current"
  );
});

test("analytics.ts: the headline is computed from the current-methodology partition, cuts included", () => {
  const src = read("src/features/nighthawk/lib/analytics.ts");
  assert.match(
    src,
    /partitionByMethodology\(rows\)/,
    "rows must be segmented before ANY headline math"
  );
  assert.match(
    src,
    /const scoreable = currentRows\.filter\(/,
    "the scoreable set (headline WR denominator and every cut) must derive from currentRows, never from the blended rows"
  );
});

test("record route: serves methodology, both segments, and the denominator-explaining counts", () => {
  const src = read("src/app/api/market/nighthawk/record/route.ts");
  assert.match(src, /methodology: metrics\.methodology/);
  assert.match(src, /current: segmentWire\(metrics\.segments\.current\)/);
  assert.match(src, /legacy: segmentWire\(metrics\.segments\.legacy\)/);
  assert.match(src, /unfilled_count: metrics\.unfilled_count/);
  assert.match(src, /pulled_count: metrics\.pulled_count/);
  assert.match(src, /low_n: c\.low_n/, "per-conviction cuts must carry the LOW-N flag to the client");
});

test("HawkRecordStrip: renders the honest split — segment-gated sample, unfilled/pulled/legacy counts, LOW-N chip, methodology tag", () => {
  const src = read("src/features/nighthawk/components/HawkRecordStrip.tsx");
  assert.match(
    src,
    /const gateSample = cur \? cur\.scoreable : record\?\.total_resolved \?\? 0/,
    "the 30-sample ripeness gate must count CURRENT-methodology scoreable rows, not blended resolved rows"
  );
  assert.match(src, /LOW_N_THRESHOLD/, "the shared platform threshold, same as the 0DTE record section");
  assert.match(src, /LowNChip/, "thin evidence must be badged with the shared amber-chip grammar");
  assert.match(src, /MethodologyTag/, "the strip must disclose which rule set the record is graded under");
  assert.match(src, /unfilled/, "unfilled count must be visible");
  assert.match(src, /pulled/, "pulled count must be visible");
  assert.match(src, /legacy-graded/i, "the legacy segment must be visibly separate, never silently merged");
});

test("track-record page predicate: every shared headline surface checks the methodology", () => {
  const src = read("src/lib/track-record-page.ts");
  const fn = src.slice(
    src.indexOf("export function isNighthawkOutcomeScoreable"),
    src.indexOf("function nhEntryMid")
  );
  assert.match(
    fn,
    /isCurrentGradeMethodology\(r\.grade_methodology\)/,
    "public track record, plays feed, signal accuracy and Largo all share this predicate — dropping the check re-opens the blend everywhere at once"
  );
});

test("the tags name the rule, not a date, and stay distinct", () => {
  assert.equal(GRADE_METHODOLOGY_LEGACY, "v1_level_touch");
  assert.equal(GRADE_METHODOLOGY_CURRENT, "v2_fillability");
  assert.notEqual(GRADE_METHODOLOGY_LEGACY, GRADE_METHODOLOGY_CURRENT);
});
