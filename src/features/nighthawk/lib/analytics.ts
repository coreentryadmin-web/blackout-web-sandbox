import { fetchNighthawkFunnelStats, fetchNighthawkOutcomeAnalytics, type NighthawkPlayOutcomeRow } from "@/lib/db";
import { entryRangeMid } from "@/features/nighthawk/lib/entry-range";
import { REJECTION_TRIGGER_REASON, type NighthawkRejectionDetail } from "@/features/nighthawk/lib/play-outcomes";
import {
  GRADE_METHODOLOGY_CURRENT,
  GRADE_METHODOLOGY_LEGACY,
  gradeMethodologyLabel,
  isCurrentGradeMethodology,
} from "@/features/nighthawk/lib/grade-methodology";
// The one LOW-N disclosure threshold for the whole platform (zerodte/record.ts) — the
// 0DTE record section already badges every n<5 bucket; Night Hawk cuts now carry the
// same flag so no 2-sample bucket can read like a track record on any surface.
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";

// Task #145: funnel/rejection-rate stats. Reverse-indexes REJECTION_TRIGGER_REASON (the single
// source of truth for the 5 rejection-stage strings, play-outcomes.ts) by its TEXT value so a
// `trigger_reason` read back from `alert_audit_log` (already grouped in SQL by
// fetchNighthawkFunnelStats) can be labeled with its short stage slug — no second copy of the
// reason strings, no decision_trace JSON parsing needed just to show which stage a rejection
// came from.
const STAGE_BY_TRIGGER_REASON = new Map<string, NighthawkRejectionDetail["stage"]>(
  (Object.entries(REJECTION_TRIGGER_REASON) as Array<[NighthawkRejectionDetail["stage"], string]>).map(
    ([stage, reason]) => [reason, stage]
  )
);

/** "sector_concentration" -> "Sector concentration". Falls back to the raw slug for a
 *  trigger_reason that doesn't match any known stage (defensive only — every row this reads
 *  was itself written from REJECTION_TRIGGER_REASON's 5 fixed values; see
 *  fetchNighthawkFunnelStats's doc comment). */
function stageLabel(stage: string): string {
  return stage
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type NighthawkFunnelStage = {
  /** Short machine-readable slug, e.g. "premium_cap" — one of NighthawkRejectionDetail["stage"],
   *  or "other" for a trigger_reason this map doesn't recognize (should never happen in practice). */
  stage: string;
  /** Human-readable label for the UI, e.g. "Premium cap". */
  label: string;
  /** The raw, full trigger_reason sentence — shown as a tooltip/detail string. */
  trigger_reason: string;
  n: number;
};

export type NighthawkFunnelStats = {
  window_days: number;
  /** Plays that survived synthesis and were shown to members (nighthawk_play_outcomes rows
   *  in the window — one per edition/ticker). */
  published_count: number;
  /** Plays rejected at any of the 4 synthesis-funnel stages (alert_audit_log rows with
   *  alert_type = 'nighthawk_rejected' in the window). */
  rejected_count: number;
  /** published_count + rejected_count — every candidate that reached a publish/reject decision
   *  this window. NOT the full scored-candidate pool (that count isn't durably logged today). */
  candidates_count: number;
  /** rejected_count / candidates_count. 0 when there were no candidates at all. */
  rejection_rate: number;
  /** Rejected count broken down by stage, sorted by n descending (already sorted in SQL). */
  by_stage: NighthawkFunnelStage[];
};

/** Pure transform from raw funnel counts (db.ts's fetchNighthawkFunnelStats) into the shaped,
 *  labeled stats the admin dashboard renders — split out so it's unit-testable without a DB. */
export function buildNighthawkFunnel(
  windowDays: number,
  publishedCount: number,
  rejectedByReason: Array<{ trigger_reason: string; n: number }>
): NighthawkFunnelStats {
  const by_stage: NighthawkFunnelStage[] = rejectedByReason
    .map((r) => {
      const stage = STAGE_BY_TRIGGER_REASON.get(r.trigger_reason) ?? "other";
      return { stage, label: stageLabel(stage), trigger_reason: r.trigger_reason, n: r.n };
    })
    .sort((a, b) => b.n - a.n);
  const rejected_count = by_stage.reduce((sum, r) => sum + r.n, 0);
  const candidates_count = publishedCount + rejected_count;
  return {
    window_days: windowDays,
    published_count: publishedCount,
    rejected_count,
    candidates_count,
    rejection_rate: candidates_count > 0 ? rejected_count / candidates_count : 0,
    by_stage,
  };
}

/** PR-N2: one grading-rule-set's slice of the record. The two segments (current/legacy)
 *  are reported side by side and NEVER aggregated — a single WR over rows graded under
 *  different rule sets is not a record (§2.1: the blended 42.9% headline vs 11.1% under
 *  current rules on the same history). */
export type NighthawkRecordSegment = {
  /** grade-methodology.ts tag, e.g. "v2_fillability". */
  methodology: string;
  /** Human-readable description of what the rule set graded. */
  label: string;
  /** All resolved rows in this segment (including unfilled/pulled/stop-data-unavailable). */
  resolved: number;
  /** Rows entering the WR denominator (excl. unfilled, pulled, stop-data-unavailable). */
  scoreable: number;
  wins: number;
  losses: number;
  opens: number;
  ambiguous: number;
  unfilled: number;
  pulled: number;
  stop_data_unavailable: number;
  /** null (not a fake 0%) when nothing is scoreable. */
  win_rate: number | null;
  avg_return_pct: number | null;
  /** scoreable < LOW_N_THRESHOLD — UIs must badge this; the record must not be read. */
  low_n: boolean;
};

/** A grouped cut over CURRENT-methodology scoreable rows only (never blended), with the
 *  shared LOW-N flag so every surface badges thin evidence identically. */
export type NighthawkRecordCut = { n: number; win_rate: number; avg_return_pct: number; low_n: boolean };

export type NighthawkMetrics = {
  window_days: number;
  /** ALL resolved rows in the window, both methodology segments — a raw count, never a
   *  ratio input. Every ratio below is computed from segments.current.scoreable only. */
  total_resolved: number;
  pending_count: number;
  /** PR-N2: headline = CURRENT-methodology scoreable rows ONLY. Legacy-graded rows are
   *  quarantined in segments.legacy and can never move this number. */
  win_rate: number;
  /** Close vs entry mid — positive P&L regardless of target/stop tags. */
  profitable_rate: number;
  loss_rate: number;
  open_rate: number;
  ambiguous_rate: number;
  avg_return_pct: number;
  avg_winner_return_pct: number;
  avg_loser_return_pct: number;
  /**
   * Number of resolved plays excluded from win/loss counts because a stop level
   * is defined but intraday high/low data was unavailable (OTC/thin names).
   * Effective sample size for win_rate = total_resolved - stop_data_unavailable_count.
   */
  stop_data_unavailable_count: number;
  /** Plays whose session never traded back into the entry band (gap-away) — no fill existed. */
  unfilled_count: number;
  /** PR-N4: plays PULLED pre-open by an INVALIDATED morning verdict (one-way latch).
   *  Their grades are counterfactual-only — excluded from every ratio/bucket above,
   *  surfaced here so the record can say "N pulled" instead of silently shrinking. */
  pulled_count: number;
  /** PR-N2: the methodology tag the headline is computed under (= segments.current.methodology). */
  methodology: string;
  /** PR-N2: per-rule-set record slices, reported separately — the anti-blend contract. */
  segments: { current: NighthawkRecordSegment; legacy: NighthawkRecordSegment };
  by_conviction: Array<{ conviction: string } & NighthawkRecordCut>;
  by_direction: Array<{ direction: "LONG" | "SHORT" } & NighthawkRecordCut>;
  by_sector: Array<{ sector: string } & NighthawkRecordCut>;
  by_score_bucket: Array<{ bucket: string; n: number; win_rate: number; low_n: boolean }>;
  by_edition: Array<{ edition_for: string } & NighthawkRecordCut>;
  /** Task #145: synthesis funnel — candidates considered vs. published vs. rejected (by stage),
   *  over the same window_days. Independent of total_resolved/pending_count above: those are
   *  POST-publish outcome grading, this is the PRE-publish publish/reject decision itself. */
  funnel: NighthawkFunnelStats;
};

const SCORE_BUCKETS = ["40-54", "55-69", "70-84", "85-100"] as const;
const CONVICTION_ORDER = ["A+", "A", "B", "C"];

export function entryMid(row: NighthawkPlayOutcomeRow): number | null {
  const mid = entryRangeMid(row.entry_range_low, row.entry_range_high);
  if (mid != null) return mid;
  if (row.entry_range_low != null && row.entry_range_high != null) return null; // corrupt range, no fallback
  return row.next_day_open;
}

export function realizedReturnPct(row: NighthawkPlayOutcomeRow): number | null {
  const entry = entryMid(row);
  const close = row.next_day_close;
  if (entry == null || close == null || entry === 0) return null;
  const raw =
    row.direction === "LONG" ? (close - entry) / entry : (entry - close) / entry;
  return raw * 100;
}

function avgReturn(rows: NighthawkPlayOutcomeRow[]): number {
  const values = rows.map(realizedReturnPct).filter((v): v is number => v != null);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Stop-hit plays should always produce a non-positive realized return. A positive
// average here signals bad outcome grading (next_day_close ended up above entry
// mid on a "stop" row) — surface the magnitude as a loss rather than a positive
// number that reads as a gain to whoever consumes this (member route, admin
// dashboard). Mirrors the same clamp on track-record-page.ts's avgLoserPct.
export function avgLoserReturn(losers: NighthawkPlayOutcomeRow[]): number {
  return Math.min(0, avgReturn(losers));
}

function winRate(rows: NighthawkPlayOutcomeRow[]): number {
  if (rows.length === 0) return 0;
  return rows.filter((r) => r.outcome === "target").length / rows.length;
}

function profitableRate(rows: NighthawkPlayOutcomeRow[]): number {
  if (rows.length === 0) return 0;
  const withReturn = rows.filter((r) => realizedReturnPct(r) != null);
  if (withReturn.length === 0) return 0;
  return withReturn.filter((r) => (realizedReturnPct(r) ?? 0) > 0).length / withReturn.length;
}

function scoreBucket(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 40 && score <= 54) return "40-54";
  if (score >= 55 && score <= 69) return "55-69";
  if (score >= 70 && score <= 84) return "70-84";
  if (score >= 85 && score <= 100) return "85-100";
  return null;
}

function groupWithReturn(rows: NighthawkPlayOutcomeRow[]): NighthawkRecordCut {
  return {
    n: rows.length,
    win_rate: winRate(rows),
    avg_return_pct: avgReturn(rows),
    // Shared platform threshold (zerodte/record.ts): a cut below it must be badged by
    // every consumer — its ratio is noise, not a record.
    low_n: rows.length < LOW_N_THRESHOLD,
  };
}

/** PR-N2: the segmentation itself, exported so tests can pin the anti-blend rule.
 *  `current` admits ONLY rows explicitly stamped with the current methodology tag;
 *  everything else resolved — legacy tags, unknown tags, NULL — quarantines to
 *  `legacy`. Unprovable provenance degrades away from the headline, never toward it. */
export function partitionByMethodology(rows: NighthawkPlayOutcomeRow[]): {
  current: NighthawkPlayOutcomeRow[];
  legacy: NighthawkPlayOutcomeRow[];
} {
  const current: NighthawkPlayOutcomeRow[] = [];
  const legacy: NighthawkPlayOutcomeRow[] = [];
  for (const row of rows) {
    (isCurrentGradeMethodology(row.grade_methodology) ? current : legacy).push(row);
  }
  return { current, legacy };
}

/** One rule set's record slice. Scoreability inside a segment follows the same
 *  exclusion discipline as the headline always has (unfilled / pulled /
 *  stop-data-unavailable never enter the denominator but are always surfaced). */
export function buildRecordSegment(
  methodology: string,
  rows: NighthawkPlayOutcomeRow[]
): NighthawkRecordSegment {
  const unfilled = rows.filter((r) => r.outcome === "unfilled");
  const pulled = rows.filter((r) => r.pulled === true);
  const stopDataUnavailable = rows.filter(isStopDataUnavailable);
  const scoreable = rows.filter(
    (r) => !isStopDataUnavailable(r) && r.outcome !== "unfilled" && r.pulled !== true
  );
  const wins = scoreable.filter((r) => r.outcome === "target").length;
  const losses = scoreable.filter((r) => r.outcome === "stop").length;
  const opens = scoreable.filter((r) => r.outcome === "open").length;
  const ambiguous = scoreable.filter((r) => r.outcome === "ambiguous").length;
  return {
    methodology,
    label: gradeMethodologyLabel(methodology),
    resolved: rows.length,
    scoreable: scoreable.length,
    wins,
    losses,
    opens,
    ambiguous,
    unfilled: unfilled.length,
    pulled: pulled.length,
    stop_data_unavailable: stopDataUnavailable.length,
    win_rate: scoreable.length > 0 ? wins / scoreable.length : null,
    avg_return_pct: scoreable.length > 0 ? avgReturn(scoreable) : null,
    low_n: scoreable.length < LOW_N_THRESHOLD,
  };
}

function emptyMetrics(windowDays: number): NighthawkMetrics {
  return {
    window_days: windowDays,
    total_resolved: 0,
    pending_count: 0,
    win_rate: 0,
    profitable_rate: 0,
    loss_rate: 0,
    open_rate: 0,
    ambiguous_rate: 0,
    avg_return_pct: 0,
    avg_winner_return_pct: 0,
    avg_loser_return_pct: 0,
    by_conviction: CONVICTION_ORDER.map((conviction) => ({
      conviction,
      n: 0,
      win_rate: 0,
      avg_return_pct: 0,
      low_n: true,
    })),
    by_direction: (["LONG", "SHORT"] as const).map((direction) => ({
      direction,
      n: 0,
      win_rate: 0,
      avg_return_pct: 0,
      low_n: true,
    })),
    by_sector: [],
    by_score_bucket: SCORE_BUCKETS.map((bucket) => ({ bucket, n: 0, win_rate: 0, low_n: true })),
    by_edition: [],
    stop_data_unavailable_count: 0,
    unfilled_count: 0,
    pulled_count: 0,
    methodology: GRADE_METHODOLOGY_CURRENT,
    segments: {
      current: buildRecordSegment(GRADE_METHODOLOGY_CURRENT, []),
      legacy: buildRecordSegment(GRADE_METHODOLOGY_LEGACY, []),
    },
    funnel: buildNighthawkFunnel(windowDays, 0, []),
  };
}

/**
 * Returns true for plays where a stop is defined but intraday data is missing.
 * These plays cannot have stop outcomes reliably determined and must be excluded
 * from win/loss tallies to avoid silently inflating the win rate.
 */
function isStopDataUnavailable(r: NighthawkPlayOutcomeRow): boolean {
  return r.stop != null && r.session_high == null && r.session_low == null;
}

export async function getNighthawkMetrics(windowDays = 30): Promise<NighthawkMetrics> {
  // Independent reads (outcome grading vs. the pre-publish funnel) — run in parallel so the
  // funnel query never adds to this route's latency on top of the existing outcome query.
  const [{ rows, pending_count }, funnelRaw] = await Promise.all([
    fetchNighthawkOutcomeAnalytics(windowDays),
    fetchNighthawkFunnelStats(windowDays),
  ]);
  const funnel = buildNighthawkFunnel(windowDays, funnelRaw.published_count, funnelRaw.rejected_by_reason);

  if (rows.length === 0) {
    return { ...emptyMetrics(windowDays), pending_count, funnel };
  }

  const total = rows.length;
  // PR-N2: segment by grading methodology FIRST — everything headline-facing below is
  // computed over the CURRENT-methodology segment only. Legacy-graded rows (pre-
  // fillability "level touch" grades, incl. the phantom gap-away wins) live in
  // segments.legacy, reported side by side, never aggregated: on the measured history
  // the blend read 42.9% WR while the same plays under current rules read 11.1%.
  const { current: currentRows, legacy: legacyRows } = partitionByMethodology(rows);
  const segments = {
    current: buildRecordSegment(GRADE_METHODOLOGY_CURRENT, currentRows),
    legacy: buildRecordSegment(GRADE_METHODOLOGY_LEGACY, legacyRows),
  };
  // Exclusion discipline, unchanged (audit MEDIUM / PR-N4) but now applied within the
  // current segment: stop-data-unavailable (unevaluable stops), 'unfilled' (gap-away —
  // no fill existed to win or lose), and pulled (INVALIDATED pre-open, one-way latch;
  // grade is counterfactual-only) never enter a ratio denominator and are surfaced as
  // counts. Same rule as track-record-page.ts's isNighthawkOutcomeScoreable — keep the
  // two in lockstep.
  const scoreable = currentRows.filter(
    (r) => !isStopDataUnavailable(r) && r.outcome !== "unfilled" && r.pulled !== true
  );

  const winners = scoreable.filter((r) => r.outcome === "target");
  const losers = scoreable.filter((r) => r.outcome === "stop");
  const opens = scoreable.filter((r) => r.outcome === "open");
  const ambiguous = scoreable.filter((r) => r.outcome === "ambiguous");

  const by_conviction = CONVICTION_ORDER.map((conviction) => ({
    conviction,
    ...groupWithReturn(scoreable.filter((r) => r.conviction.toUpperCase() === conviction)),
  }));

  const by_direction = (["LONG", "SHORT"] as const).map((direction) => ({
    direction,
    ...groupWithReturn(scoreable.filter((r) => r.direction === direction)),
  }));

  const sectorMap = new Map<string, NighthawkPlayOutcomeRow[]>();
  for (const row of scoreable) {
    const sector = row.sector?.trim() || "Unknown";
    const bucket = sectorMap.get(sector) ?? [];
    bucket.push(row);
    sectorMap.set(sector, bucket);
  }
  const by_sector = Array.from(sectorMap.entries())
    .map(([sector, group]) => ({ sector, ...groupWithReturn(group) }))
    .filter((g) => g.n > 0)
    .sort((a, b) => b.win_rate - a.win_rate || b.n - a.n);

  const by_score_bucket = SCORE_BUCKETS.map((bucket) => {
    const group = scoreable.filter((r) => scoreBucket(r.score) === bucket);
    return { bucket, n: group.length, win_rate: winRate(group), low_n: group.length < LOW_N_THRESHOLD };
  });

  const editionMap = new Map<string, NighthawkPlayOutcomeRow[]>();
  for (const row of scoreable) {
    const bucket = editionMap.get(row.edition_for) ?? [];
    bucket.push(row);
    editionMap.set(row.edition_for, bucket);
  }
  const by_edition = Array.from(editionMap.entries())
    .map(([edition_for, group]) => ({ edition_for, ...groupWithReturn(group) }))
    .sort((a, b) => a.edition_for.localeCompare(b.edition_for));

  const scoreableTotal = scoreable.length;
  return {
    window_days: windowDays,
    total_resolved: total,
    pending_count,
    // Exclusion counts mirror the headline's segment (current) so the numbers displayed
    // next to the win rate explain ITS denominator; the legacy segment carries its own.
    stop_data_unavailable_count: segments.current.stop_data_unavailable,
    unfilled_count: segments.current.unfilled,
    pulled_count: segments.current.pulled,
    methodology: GRADE_METHODOLOGY_CURRENT,
    segments,
    win_rate: scoreableTotal > 0 ? winners.length / scoreableTotal : 0,
    profitable_rate: profitableRate(scoreable),
    loss_rate: scoreableTotal > 0 ? losers.length / scoreableTotal : 0,
    open_rate: scoreableTotal > 0 ? opens.length / scoreableTotal : 0,
    ambiguous_rate: scoreableTotal > 0 ? ambiguous.length / scoreableTotal : 0,
    avg_return_pct: avgReturn(scoreable),
    avg_winner_return_pct: avgReturn(winners),
    avg_loser_return_pct: avgLoserReturn(losers),
    by_conviction,
    by_direction,
    by_sector,
    by_score_bucket,
    by_edition,
    funnel,
  };
}
