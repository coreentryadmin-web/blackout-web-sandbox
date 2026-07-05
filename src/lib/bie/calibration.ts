// BLACKOUT Intelligence Engine — Layer 5 calibration harness.
// The gates (score floor, aggression thresholds, time-of-day factors) were set by
// judgment; this module lets MEASURED OUTCOMES challenge them. Every graded play
// is bucketed by the signals that admitted it, and buckets with enough evidence
// produce explicit recommendations — report-first (a human ships the change),
// never silent auto-tuning. Pure math + assembly; unit-tested.
//
// Two products, two ledgers: 0DTE Command's setups live in zerodte_setup_log
// (the pass below) and SPX Slayer's closed plays live in spx_play_outcomes —
// a completely separate table this harness never looked at until now. SPX
// Slayer already runs its OWN live adaptive-gate loop (see
// spx-play-telemetry.ts's loadAdaptivePlayGates, fed by fetchPlayOutcomeStats)
// that feeds real score-floor/promote-threshold adjustments back into
// spx-play-engine.ts. That loop is untouched by this file. What's added here
// is a SECOND, read-only analytics pass — BIE's own calibration REPORT
// gaining awareness of SPX Slayer's outcome data, evidence-gated the same way
// (n≥10/bucket), so both self-improving loops are at least visible in one
// place even though they don't talk to each other.

import {
  dbConfigured,
  fetchClosedPlayOutcomes,
  fetchSpxToolCallingBieInteractions,
  fetchZeroDteSetupLogRange,
} from "@/lib/db";
import { SPX_ENGINE_TOOL_NAMES } from "@/lib/largo/tool-defs";
import { todayEt } from "@/lib/nighthawk/session";
import { gradeRank } from "@/lib/spx-play-config";
import type { PlayOutcomeRow } from "@/lib/spx-play-outcomes";
import { etMinutesOf } from "@/lib/zerodte/plan";
import { storeKnowledge } from "./knowledge";

export type CalibrationInputRow = {
  session_date: string;
  score_max: number;
  spike: boolean;
  first_flagged_at: string;
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
  flags_json: Record<string, unknown> | null;
};

export type CalibrationBucket = {
  label: string;
  n: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  avg_pnl_pct: number | null;
};

export type CalibrationReport = {
  window: { since: string; through: string; sessions: number };
  graded_plays: number;
  by_score_band: CalibrationBucket[];
  by_time_of_day: CalibrationBucket[];
  by_spike: CalibrationBucket[];
  /** Deterministic, evidence-cited recommendations — empty until buckets have n≥10. */
  recommendations: string[];
  /** SPX Slayer's own closed-play calibration (spx_play_outcomes), computed and
   *  attached by runBieCalibration alongside the 0DTE pass above. null when the
   *  DB call fails or hasn't been attached (e.g. computeCalibration alone, in
   *  isolation, never sets this — it's 0DTE-only and additive analytics is
   *  wired in by the async orchestrator). Additive field — the 0DTE shape above
   *  is unchanged. */
  spx_slayer: SpxCalibrationReport | null;
  /** Task #112 — Largo's own answer-quality cohort for turns that touched SPX
   *  Slayer's live-engine state (bie_interactions, not spx_play_outcomes — this
   *  measures BIE's ANSWERS about the engine, not the engine's own trade P&L,
   *  which is what spx_slayer above already covers). Same attach-after-compute
   *  pattern as spx_slayer: null until runBieCalibration's async orchestrator
   *  fills it in. See computeSpxToolCallCalibration below for the cohort
   *  definition and metrics. */
  spx_tool_calls: SpxToolCallCalibrationReport | null;
};

// ── SPX Slayer's own closed-play calibration (additive, parallel to the 0DTE pass) ──

/** Slim projection of spx-play-outcomes.ts's PlayOutcomeRow — only what bucketing needs. */
export type SpxCalibrationInputRow = {
  session_date: string;
  grade: string;
  outcome: PlayOutcomeRow["outcome"];
  pnl_pts: number | null;
  opened_at: string;
};

export type SpxCalibrationBucket = {
  label: string;
  n: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  /** Points, not percent — spx_play_outcomes grades P&L in SPX points (pnl_pts),
   *  unlike 0DTE's plan_pnl_pct. Named distinctly so a reader never mixes units. */
  avg_pnl_pts: number | null;
};

export type SpxCalibrationReport = {
  window: { since: string; through: string; sessions: number };
  closed_plays: number;
  by_grade_band: SpxCalibrationBucket[];
  by_time_of_day: SpxCalibrationBucket[];
  /** Same evidence-gating philosophy as the 0DTE pass — empty until n≥10. */
  recommendations: string[];
};

const MIN_EVIDENCE = 10;

function bucketize(rows: CalibrationInputRow[], label: (r: CalibrationInputRow) => string): CalibrationBucket[] {
  const groups = new Map<string, CalibrationInputRow[]>();
  for (const r of rows) {
    const key = label(r);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return Array.from(groups.entries())
    .map(([lbl, group]) => {
      const wins = group.filter((r) => (r.plan_pnl_pct ?? 0) > 0).length;
      const pnls = group.map((r) => r.plan_pnl_pct).filter((p): p is number => p != null);
      return {
        label: lbl,
        n: group.length,
        wins,
        losses: group.length - wins,
        win_rate_pct: group.length > 0 ? Math.round((wins / group.length) * 1000) / 10 : null,
        avg_pnl_pct: pnls.length ? Math.round((pnls.reduce((a, b) => a + b, 0) / pnls.length) * 10) / 10 : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

const scoreBand = (r: CalibrationInputRow): string =>
  r.score_max >= 75 ? "score 75+" : r.score_max >= 65 ? "score 65-74" : "score 55-64";

function todBand(r: CalibrationInputRow): string {
  const m = etMinutesOf(Date.parse(r.first_flagged_at));
  if (m < 9 * 60 + 50) return "open 9:30-9:50";
  if (m < 11 * 60) return "prime 9:50-11:00";
  if (m < 13 * 60 + 30) return "lunch 11:00-13:30";
  return "afternoon 13:30-15:00";
}

/** Pure assembly — feed it graded rows, get buckets + evidence-cited recommendations. */
export function computeCalibration(
  rows: CalibrationInputRow[],
  window: { since: string; through: string; sessions: number }
): CalibrationReport {
  const graded = rows.filter((r) => r.plan_outcome && r.plan_outcome !== "ungradeable");
  const byScore = bucketize(graded, scoreBand);
  const byTod = bucketize(graded, todBand);
  const bySpike = bucketize(graded, (r) => (r.spike ? "spike" : "no spike"));

  const recs: string[] = [];
  for (const b of byScore) {
    if (b.n < MIN_EVIDENCE || b.win_rate_pct == null) continue;
    if (b.win_rate_pct < 40)
      recs.push(
        `${b.label} underperforms (${b.wins}W/${b.losses}L, ${b.win_rate_pct}% over ${b.n} plays) — consider raising the A-tier floor above this band.`
      );
    if (b.win_rate_pct > 65)
      recs.push(
        `${b.label} outperforms (${b.wins}W/${b.losses}L, ${b.win_rate_pct}%) — weightings that admit more of this band earn their risk.`
      );
  }
  for (const b of byTod) {
    if (b.n < MIN_EVIDENCE || b.win_rate_pct == null) continue;
    if (b.win_rate_pct < 40)
      recs.push(
        `${b.label} window underperforms (${b.win_rate_pct}% over ${b.n}) — consider a stronger time-of-day penalty or a hard entry block there.`
      );
  }
  const spike = bySpike.find((b) => b.label === "spike");
  const noSpike = bySpike.find((b) => b.label === "no spike");
  if (
    spike &&
    noSpike &&
    spike.n >= MIN_EVIDENCE &&
    noSpike.n >= MIN_EVIDENCE &&
    spike.win_rate_pct != null &&
    noSpike.win_rate_pct != null &&
    spike.win_rate_pct - noSpike.win_rate_pct >= 15
  ) {
    recs.push(
      `Spike plays outperform non-spike by ${Math.round((spike.win_rate_pct - noSpike.win_rate_pct) * 10) / 10} points — the spike bonus is earning more than its +5.`
    );
  }

  return {
    window,
    graded_plays: graded.length,
    by_score_band: byScore,
    by_time_of_day: byTod,
    by_spike: bySpike,
    recommendations: recs,
    // Attached by runBieCalibration once it has computed the SPX passes too —
    // this pure function only ever sees 0DTE rows, so it never has SPX data to
    // report for either additive slice below.
    spx_slayer: null,
    spx_tool_calls: null,
  };
}

function bucketizeSpx(
  rows: SpxCalibrationInputRow[],
  label: (r: SpxCalibrationInputRow) => string
): SpxCalibrationBucket[] {
  const groups = new Map<string, SpxCalibrationInputRow[]>();
  for (const r of rows) {
    const key = label(r);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return Array.from(groups.entries())
    .map(([lbl, group]) => {
      // Use the play's own graded outcome (spx-play-outcomes.ts's classifyOutcome —
      // handles STOP/TARGET/TRAIL/THESIS/THETA/SESSION exit nuance) rather than a
      // raw pnl-sign check, so breakevens are counted as neither a win nor a loss
      // (unlike the 0DTE bucketize() above, which has no breakeven concept).
      const wins = group.filter((r) => r.outcome === "win").length;
      const losses = group.filter((r) => r.outcome === "loss").length;
      const pnls = group.map((r) => r.pnl_pts).filter((p): p is number => p != null);
      return {
        label: lbl,
        n: group.length,
        wins,
        losses,
        win_rate_pct: group.length > 0 ? Math.round((wins / group.length) * 1000) / 10 : null,
        avg_pnl_pts: pnls.length ? Math.round((pnls.reduce((a, b) => a + b, 0) / pnls.length) * 10) / 10 : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** A/A+ vs B vs C/D — reuses spx-play-config.ts's gradeRank so the band edges
 *  never drift out of sync with the live grade-floor gate (spx-play-gates.ts). */
const spxGradeBand = (r: SpxCalibrationInputRow): string => {
  const rank = gradeRank(r.grade);
  if (rank >= gradeRank("A")) return "A/A+";
  if (rank >= gradeRank("B")) return "B";
  return "C/D";
};

/** Same 4 clock windows as 0DTE's todBand — deliberately identical boundaries so
 *  the two products' time-of-day sections read side by side without translation.
 *  Separate function only because the field is opened_at here, first_flagged_at there. */
function spxTodBand(r: SpxCalibrationInputRow): string {
  const m = etMinutesOf(Date.parse(r.opened_at));
  if (m < 9 * 60 + 50) return "open 9:30-9:50";
  if (m < 11 * 60) return "prime 9:50-11:00";
  if (m < 13 * 60 + 30) return "lunch 11:00-13:30";
  return "afternoon 13:30-15:00";
}

/** Pure assembly for SPX Slayer's own ledger — same evidence-gating philosophy
 *  (n≥10/bucket) as computeCalibration above, applied to spx_play_outcomes rows
 *  instead of zerodte_setup_log rows. Never reads or writes the live engine. */
export function computeSpxCalibration(
  rows: SpxCalibrationInputRow[],
  window: { since: string; through: string; sessions: number }
): SpxCalibrationReport {
  // fetchClosedPlayOutcomes already excludes outcome='open' at the SQL layer, but
  // this is a pure function that may be handed anything — stay defensive the same
  // way computeCalibration defends against ungraded 0DTE rows above.
  const closed = rows.filter((r) => r.outcome !== "open");
  const byGrade = bucketizeSpx(closed, spxGradeBand);
  const byTod = bucketizeSpx(closed, spxTodBand);

  const recs: string[] = [];
  for (const b of byGrade) {
    if (b.n < MIN_EVIDENCE || b.win_rate_pct == null) continue;
    if (b.win_rate_pct < 40)
      recs.push(
        `SPX Slayer grade ${b.label} underperforms (${b.wins}W/${b.losses}L, ${b.win_rate_pct}% over ${b.n} closed plays) — consider raising the grade floor above this band.`
      );
    if (b.win_rate_pct > 65)
      recs.push(
        `SPX Slayer grade ${b.label} outperforms (${b.wins}W/${b.losses}L, ${b.win_rate_pct}% over ${b.n}) — this band is earning its risk.`
      );
  }
  for (const b of byTod) {
    if (b.n < MIN_EVIDENCE || b.win_rate_pct == null) continue;
    if (b.win_rate_pct < 40)
      recs.push(
        `SPX Slayer ${b.label} window underperforms (${b.win_rate_pct}% over ${b.n}) — consider a stronger time-of-day penalty there.`
      );
  }

  return {
    window,
    closed_plays: closed.length,
    by_grade_band: byGrade,
    by_time_of_day: byTod,
    recommendations: recs,
  };
}

// ── Task #112: SPX-tool-calling cohort within bie_interactions (additive, a
// third pass alongside the 0DTE and SPX-Slayer-outcomes passes above) ──
//
// Before this, calibration.ts could measure whether SPX Slayer's PLAYS made
// money (computeSpxCalibration above) but had no way to measure whether
// Largo's ANSWERS about SPX Slayer's live engine state (walls, gamma flip,
// open plays, signal log, lotto/power-hour state...) were actually GOOD
// answers — grounding-verifier claim-by-claim correctness says nothing about
// whether the answer picked the right tool, read the right phase, or served
// stale-but-technically-accurate info. This slice tracks that cohort
// continuously instead of "assuming it's fine because grounding passed once."

/** Slim projection of a bie_interactions row — only what this slice's cohort
 *  test and metrics need. */
export type SpxToolCallInputRow = {
  tools_used: string[];
  /** "claude_fallback", a router intent name (e.g. "spx_structure"), or null if
   *  a row predates task #103's intent_bucket column. */
  intent_bucket: string | null;
  answer_source: string;
  claims_total: number | null;
  claims_verified: number | null;
  latency_ms: number | null;
};

export type SpxToolCallCalibrationReport = {
  window: { since: string; through: string };
  /** Rows in the cohort — see isSpxToolCallingRow for the membership test. */
  n: number;
  /** Of the n cohort rows, how many were answered by Claude's tool-calling loop
   *  vs. matched deterministically by the BIE router. Reported as raw counts
   *  (not just a derived rate) so a reader never has to reconstruct them from a
   *  percentage, same convention fetchBieInteractionStats already uses. */
  claude_fallback_n: number;
  router_matched_n: number;
  /** router_matched_n / n — a properly-integrated SPX Slayer question should
   *  ideally often be answerable by the deterministic router (composeBieAnswer's
   *  spx_structure intent) rather than needing full Claude tool-calling every
   *  time; tracked over time as a signal of whether router coverage for SPX
   *  questions is keeping up. null when n = 0. */
  router_match_rate_pct: number | null;
  /** Aggregate sum(claims_verified)/sum(claims_total) across cohort rows that
   *  actually carried numeric claims (claims_total > 0) — weights rows by how
   *  many claims they made, unlike an unweighted average of each row's own
   *  ratio. null when no cohort row had any graded claims yet. */
  grounding_pass_rate_pct: number | null;
  avg_latency_ms: number | null;
  /** Same evidence-gating philosophy as the other two passes — empty until n≥10. */
  recommendations: string[];
};

/** Cohort membership: does this bie_interactions row represent a Largo turn
 *  that touched SPX Slayer's own live-engine state? A UNION of two conditions,
 *  not just a tools_used check — see fetchSpxToolCallingBieInteractions's doc
 *  comment (db.ts) for the full reasoning on why the intent_bucket check is
 *  required: the deterministic router's spx_structure answer reads the exact
 *  same engine state via runLargoTool("get_spx_structure", {}) internally, but
 *  logBie() always records that path's tools_used as the ["blackout_intelligence"]
 *  sentinel rather than the real tool name, so a pure tools_used check would
 *  silently exclude every router-matched SPX-engine turn. */
function isSpxToolCallingRow(row: SpxToolCallInputRow): boolean {
  return row.tools_used.some((t) => (SPX_ENGINE_TOOL_NAMES as readonly string[]).includes(t)) ||
    row.intent_bucket === "spx_structure";
}

/** Pure assembly — feed it bie_interactions-shaped rows (any cohort mix), get
 *  the SPX-tool-calling slice's sample count, router-vs-Claude split, grounding
 *  pass rate, and latency. Never touches spx_signals.ts or any live play-engine
 *  gate — read-only reporting over already-logged turns. */
export function computeSpxToolCallCalibration(
  rows: SpxToolCallInputRow[],
  window: { since: string; through: string }
): SpxToolCallCalibrationReport {
  const cohort = rows.filter(isSpxToolCallingRow);
  const n = cohort.length;

  const claudeFallbackN = cohort.filter((r) => r.answer_source === "claude").length;
  const routerMatchedN = cohort.filter((r) => r.answer_source === "bie-router").length;
  const routerMatchRatePct = n > 0 ? Math.round((routerMatchedN / n) * 1000) / 10 : null;

  // Only rows that actually carried numeric claims count toward the grounding
  // ratio — a turn with zero claims (claims_total = 0) has nothing to verify,
  // and folding it in would dilute the ratio with a trivial non-signal.
  const graded = cohort.filter((r) => (r.claims_total ?? 0) > 0);
  const totalClaims = graded.reduce((s, r) => s + (r.claims_total ?? 0), 0);
  const verifiedClaims = graded.reduce((s, r) => s + (r.claims_verified ?? 0), 0);
  const groundingPassRatePct = totalClaims > 0 ? Math.round((verifiedClaims / totalClaims) * 1000) / 10 : null;

  const latencies = cohort.map((r) => r.latency_ms).filter((l): l is number => l != null);
  const avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;

  const recs: string[] = [];
  if (n >= MIN_EVIDENCE && groundingPassRatePct != null && groundingPassRatePct < 70) {
    recs.push(
      `SPX-tool-calling Largo turns show only ${groundingPassRatePct}% claim grounding over ${n} turns — since grounding checks numbers, not answer quality, this is worth a manual read of a few transcripts to see whether the desk tools' outputs are being misread or just under-verified.`
    );
  }
  if (n >= MIN_EVIDENCE && routerMatchRatePct != null && routerMatchRatePct < 30) {
    recs.push(
      `Only ${routerMatchRatePct}% of SPX-tool-calling turns were answered by the deterministic router over ${n} turns — most SPX-engine-state questions still fall through to full Claude tool-calling; consider widening composeSpxStructure's coverage.`
    );
  }

  return {
    window,
    n,
    claude_fallback_n: claudeFallbackN,
    router_matched_n: routerMatchedN,
    router_match_rate_pct: routerMatchRatePct,
    grounding_pass_rate_pct: groundingPassRatePct,
    avg_latency_ms: avgLatencyMs,
    recommendations: recs,
  };
}

export function formatCalibration(r: CalibrationReport): string {
  const bucket = (b: CalibrationBucket) =>
    `- ${b.label}: ${b.n} plays, ${b.wins}W/${b.losses}L${b.win_rate_pct != null ? ` (${b.win_rate_pct}%)` : ""}${b.avg_pnl_pct != null ? `, avg ${b.avg_pnl_pct >= 0 ? "+" : ""}${b.avg_pnl_pct}%` : ""}`;
  const zeroDteSection = [
    // Explicitly labeled "0DTE Command" (not just "BIE") now that this report can
    // carry a second product's section below — a reader must never conflate the two.
    `0DTE Command calibration — ${r.window.since} → ${r.window.through} (${r.window.sessions} sessions, ${r.graded_plays} graded plays)`,
    ``,
    `By score band:`,
    ...r.by_score_band.map(bucket),
    ``,
    `By time of day:`,
    ...r.by_time_of_day.map(bucket),
    ``,
    `Spike vs no-spike:`,
    ...r.by_spike.map(bucket),
    ``,
    r.recommendations.length
      ? `Recommendations (evidence-cited, report-first — a human ships the change):\n${r.recommendations.map((x) => `- ${x}`).join("\n")}`
      : `Recommendations: none yet — no bucket has ${MIN_EVIDENCE}+ graded plays. The harness waits for evidence; it never tunes on noise.`,
  ].join("\n");

  // Clearly separated, clearly labeled additional sections — self-improving
  // passes reported together but never merged into one set of buckets/recommendations.
  const sections = [zeroDteSection];
  if (r.spx_slayer) sections.push(`---`, ``, formatSpxCalibration(r.spx_slayer));
  if (r.spx_tool_calls) sections.push(`---`, ``, formatSpxToolCallCalibration(r.spx_tool_calls));
  return sections.join("\n");
}

export function formatSpxCalibration(r: SpxCalibrationReport): string {
  const bucket = (b: SpxCalibrationBucket) =>
    `- ${b.label}: ${b.n} plays, ${b.wins}W/${b.losses}L${b.win_rate_pct != null ? ` (${b.win_rate_pct}%)` : ""}${b.avg_pnl_pts != null ? `, avg ${b.avg_pnl_pts >= 0 ? "+" : ""}${b.avg_pnl_pts}pts` : ""}`;
  return [
    `SPX Slayer calibration — ${r.window.since} → ${r.window.through} (${r.window.sessions} sessions, ${r.closed_plays} closed plays)`,
    ``,
    `By grade band:`,
    ...r.by_grade_band.map(bucket),
    ``,
    `By time of day:`,
    ...r.by_time_of_day.map(bucket),
    ``,
    r.recommendations.length
      ? `Recommendations (evidence-cited, report-first — a human ships the change):\n${r.recommendations.map((x) => `- ${x}`).join("\n")}`
      : `Recommendations: none yet — no bucket has ${MIN_EVIDENCE}+ closed plays. The harness waits for evidence; it never tunes on noise.`,
  ].join("\n");
}

export function formatSpxToolCallCalibration(r: SpxToolCallCalibrationReport): string {
  return [
    `SPX-tool-calling Largo turns — ${r.window.since} → ${r.window.through} (${r.n} turns touched SPX Slayer's own engine state)`,
    ``,
    `Grounding pass rate: ${r.grounding_pass_rate_pct != null ? `${r.grounding_pass_rate_pct}%` : "no graded claims yet"}`,
    `Avg latency: ${r.avg_latency_ms != null ? `${r.avg_latency_ms}ms` : "—"}`,
    `Answered by: ${r.claude_fallback_n} Claude tool-calling turn(s), ${r.router_matched_n} deterministic router match(es)${r.router_match_rate_pct != null ? ` (${r.router_match_rate_pct}% router-matched)` : ""}`,
    ``,
    r.recommendations.length
      ? `Recommendations (evidence-cited, report-first — a human ships the change):\n${r.recommendations.map((x) => `- ${x}`).join("\n")}`
      : `Recommendations: none yet — fewer than ${MIN_EVIDENCE} SPX-tool-calling turns in this window. The harness waits for evidence; it never tunes on noise.`,
  ].join("\n");
}

/** SPX Slayer's own closed-play pass — same rolling window as the 0DTE pass above,
 *  fed by the SAME fetcher spx-play-telemetry.ts's live gate loop uses
 *  (fetchClosedPlayOutcomes), but consumed here for reporting only. Failure is
 *  isolated to this helper (never throws) so a problem on SPX Slayer's side can
 *  never take down the 0DTE half of the report. */
async function computeSpxSlayerCalibration(
  since: string,
  through: string
): Promise<SpxCalibrationReport | null> {
  try {
    // fetchClosedPlayOutcomes has no date-range parameter (unlike
    // fetchZeroDteSetupLogRange) — it returns the most recent N closed plays,
    // which is already exactly what an existing fetcher offers, so this filters
    // that set down to the same rolling window in JS rather than adding new SQL.
    const rows = await fetchClosedPlayOutcomes(500);
    const sinceCutoffMs = Date.parse(`${since}T00:00:00Z`);
    const windowed: SpxCalibrationInputRow[] = rows
      .filter((r) => Date.parse(r.opened_at) >= sinceCutoffMs)
      .map((r) => ({
        session_date: r.session_date,
        grade: r.grade,
        outcome: r.outcome,
        pnl_pts: r.pnl_pts,
        opened_at: r.opened_at,
      }));
    const sessions = new Set(windowed.map((r) => r.session_date)).size;
    return computeSpxCalibration(windowed, { since, through, sessions });
  } catch {
    return null;
  }
}

/** Task #112's SPX-tool-calling pass — same rolling window as the other two
 *  passes above, fed by fetchSpxToolCallingBieInteractions (which does the
 *  cohort filtering at the SQL layer — see its doc comment in db.ts). Failure
 *  is isolated to this helper (never throws), same fail-open contract as
 *  computeSpxSlayerCalibration above, so a problem here can never take down the
 *  rest of the report. */
async function computeSpxToolCallCalibrationFromDb(
  since: string,
  through: string
): Promise<SpxToolCallCalibrationReport | null> {
  try {
    const rows = await fetchSpxToolCallingBieInteractions(since, SPX_ENGINE_TOOL_NAMES);
    return computeSpxToolCallCalibration(
      rows.map((r) => ({
        tools_used: r.tools_used,
        intent_bucket: r.intent_bucket,
        answer_source: r.answer_source,
        claims_total: r.claims_total,
        claims_verified: r.claims_verified,
        latency_ms: r.latency_ms,
      })),
      { since, through }
    );
  } catch {
    return null;
  }
}

/** Build the rolling-window calibration report, persist it into the knowledge
 *  store, and return it. Runs on the daily cron tick; safe ad hoc. */
export async function runBieCalibration(days = 14): Promise<CalibrationReport | null> {
  if (!dbConfigured()) return null;
  try {
    const through = todayEt();
    const since = new Date(Date.parse(`${through}T12:00:00Z`) - days * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const rows = await fetchZeroDteSetupLogRange(since);
    const sessions = new Set(rows.map((r) => r.session_date)).size;
    const report = computeCalibration(
      rows.map((r) => ({
        session_date: r.session_date,
        score_max: r.score_max,
        spike: r.spike,
        first_flagged_at: r.first_flagged_at,
        plan_outcome: r.plan_outcome,
        plan_pnl_pct: r.plan_pnl_pct,
        flags_json: r.flags_json,
      })),
      { since, through, sessions }
    );
    // Additive: attach SPX Slayer's own calibration pass alongside 0DTE's. This is
    // BIE's calibration REPORT gaining awareness of the other product's outcome
    // data — it does NOT feed into spx-play-telemetry.ts's live adaptive gates
    // (that loop keeps reading fetchPlayOutcomeStats() on its own, unchanged).
    report.spx_slayer = await computeSpxSlayerCalibration(since, through);
    // Task #112: attach the SPX-tool-calling answer-quality cohort too — a THIRD,
    // independent read-only pass over bie_interactions (Largo's own turns), never
    // touching spx_signals.ts or any live play-engine gate/score/action.
    report.spx_tool_calls = await computeSpxToolCallCalibrationFromDb(since, through);
    await storeKnowledge("self_eval", `bie:calibration:${through}`, formatCalibration(report)).catch(() => 0);
    return report;
  } catch {
    return null;
  }
}
