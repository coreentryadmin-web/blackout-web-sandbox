// BLACKOUT Intelligence Engine — Layer 5 calibration harness.
// The gates (score floor, aggression thresholds, time-of-day factors) were set by
// judgment; this module lets MEASURED OUTCOMES challenge them. Every graded play
// is bucketed by the signals that admitted it, and buckets with enough evidence
// produce explicit recommendations — report-first (a human ships the change),
// never silent auto-tuning. Pure math + assembly; unit-tested.

import { dbConfigured, fetchZeroDteSetupLogRange } from "@/lib/db";
import { todayEt } from "@/lib/nighthawk/session";
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
  };
}

export function formatCalibration(r: CalibrationReport): string {
  const bucket = (b: CalibrationBucket) =>
    `- ${b.label}: ${b.n} plays, ${b.wins}W/${b.losses}L${b.win_rate_pct != null ? ` (${b.win_rate_pct}%)` : ""}${b.avg_pnl_pct != null ? `, avg ${b.avg_pnl_pct >= 0 ? "+" : ""}${b.avg_pnl_pct}%` : ""}`;
  return [
    `BIE calibration — ${r.window.since} → ${r.window.through} (${r.window.sessions} sessions, ${r.graded_plays} graded plays)`,
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
    await storeKnowledge("self_eval", `bie:calibration:${through}`, formatCalibration(report)).catch(() => 0);
    return report;
  } catch {
    return null;
  }
}
