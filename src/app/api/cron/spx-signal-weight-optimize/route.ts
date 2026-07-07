/**
 * Signal Weight Optimizer — runs nightly at 10 PM UTC (6 PM ET EDT / 5 PM ET EST).
 * Reads the last N days of spx_signal_observations that have outcomes, computes
 * per-signal directional accuracy vs the baseline, and writes a ranked report to
 * spx_signal_weight_reports. After 2+ weeks of data this report shows which signals
 * have real alpha and which are noise — informing manual or eventual automated
 * weight recalibration.
 *
 * Railway service: railway.spx-signal-weight-optimize.toml
 */
import { NextRequest, NextResponse } from "next/server";
import { requireDatabaseInProduction, dbQuery } from "@/lib/db";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import {
  initSpxSignalTables,
  insertWeightReport,
  type SignalWeightReport,
} from "@/features/spx/lib/spx-signal-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_LOOKBACK_DAYS = 30;

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  await initSpxSignalTables();

  const lookbackDays = parseInt(
    req.nextUrl.searchParams.get("days") ?? String(DEFAULT_LOOKBACK_DAYS),
    10
  );
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Overall baseline: % of directional observations that were correct.
    const baselineRes = await dbQuery<{ total: string; correct: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE direction IS NOT NULL AND outcome_at IS NOT NULL) AS total,
         COUNT(*) FILTER (WHERE direction IS NOT NULL AND outcome_at IS NOT NULL AND direction_correct = true) AS correct
       FROM spx_signal_observations
       WHERE observed_at > $1`,
      [since]
    );
    const baselineTotal = parseInt(baselineRes.rows[0]?.total ?? "0");
    const baselineCorrect = parseInt(baselineRes.rows[0]?.correct ?? "0");
    const baselinePct = baselineTotal > 0 ? (baselineCorrect / baselineTotal) * 100 : null;

    if (baselineTotal < 10) {
      const payload = {
        ok: true,
        skipped: true,
        reason: `Insufficient data: only ${baselineTotal} observations with outcomes in last ${lookbackDays} days. Need at least 10.`,
      };
      await logCronRun("spx-signal-weight-optimize", started, payload);
      return NextResponse.json(payload);
    }

    // Per-signal accuracy: unnest factors_json, join with outcome, group by label.
    // Only include observations that have outcomes AND a directional call.
    const signalRes = await dbQuery<{
      signal_label: string;
      fire_count: string;
      avg_weight: string;
      accuracy_pct: string | null;
      bull_fire_count: string;
      bull_correct: string;
      bear_fire_count: string;
      bear_correct: string;
    }>(
      `WITH obs AS (
         SELECT
           o.direction,
           o.direction_correct,
           f.value->>'label'    AS signal_label,
           (f.value->>'weight')::float AS signal_weight
         FROM spx_signal_observations o,
              jsonb_array_elements(o.factors_json) AS f(value)
         WHERE o.observed_at > $1
           AND o.outcome_at IS NOT NULL
           AND o.direction IS NOT NULL
           AND (f.value->>'weight')::float != 0
       )
       SELECT
         signal_label,
         COUNT(*)::text                                                            AS fire_count,
         ROUND(AVG(signal_weight)::numeric, 2)::text                              AS avg_weight,
         CASE
           WHEN COUNT(*) > 0
           THEN ROUND((COUNT(*) FILTER (WHERE direction_correct = true)::float / COUNT(*) * 100)::numeric, 1)::text
         END                                                                       AS accuracy_pct,
         COUNT(*) FILTER (WHERE signal_weight > 0)::text                          AS bull_fire_count,
         COUNT(*) FILTER (WHERE signal_weight > 0 AND direction_correct = true)::text AS bull_correct,
         COUNT(*) FILTER (WHERE signal_weight < 0)::text                          AS bear_fire_count,
         COUNT(*) FILTER (WHERE signal_weight < 0 AND direction_correct = true)::text AS bear_correct
       FROM obs
       GROUP BY signal_label
       HAVING COUNT(*) >= 5
       ORDER BY signal_label`,
      [since]
    );

    const report: SignalWeightReport[] = signalRes.rows.map((row) => {
      const fireCount = parseInt(row.fire_count);
      const accuracyPct = row.accuracy_pct != null ? parseFloat(row.accuracy_pct) : null;
      const edgePct = accuracyPct != null && baselinePct != null
        ? parseFloat((accuracyPct - baselinePct).toFixed(1))
        : null;

      const bullFire = parseInt(row.bull_fire_count);
      const bullCorrect = parseInt(row.bull_correct);
      const bearFire = parseInt(row.bear_fire_count);
      const bearCorrect = parseInt(row.bear_correct);

      return {
        signal_label: row.signal_label,
        fire_count: fireCount,
        avg_weight: parseFloat(row.avg_weight),
        accuracy_pct: accuracyPct,
        baseline_accuracy_pct: baselinePct,
        edge_pct: edgePct,
        bull_accuracy_pct: bullFire > 0 ? parseFloat(((bullCorrect / bullFire) * 100).toFixed(1)) : null,
        bear_accuracy_pct: bearFire > 0 ? parseFloat(((bearCorrect / bearFire) * 100).toFixed(1)) : null,
      };
    });

    // Sort by absolute edge descending — highest alpha signals first.
    report.sort((a, b) => Math.abs(b.edge_pct ?? 0) - Math.abs(a.edge_pct ?? 0));

    await insertWeightReport(lookbackDays, baselineTotal, baselinePct, report);

    // Log the top 5 and bottom 5 for visibility in Railway logs.
    const top5 = report.slice(0, 5).map(
      (r) => `${r.signal_label}: edge=${r.edge_pct != null ? `+${r.edge_pct}%` : "n/a"} (${r.fire_count} fires, ${r.accuracy_pct}% acc)`
    );
    const bottom5 = report.slice(-5).reverse().map(
      (r) => `${r.signal_label}: edge=${r.edge_pct != null ? `${r.edge_pct}%` : "n/a"} (${r.fire_count} fires, ${r.accuracy_pct}% acc)`
    );
    console.log(`[spx-signal-weight-optimize] baseline=${baselinePct?.toFixed(1)}% over ${baselineTotal} obs`);
    console.log(`[TOP alpha]: ${top5.join(" | ")}`);
    console.log(`[LOW alpha]: ${bottom5.join(" | ")}`);

    const payload = {
      ok: true,
      lookback_days: lookbackDays,
      total_observations: baselineTotal,
      baseline_accuracy_pct: baselinePct,
      signals_analyzed: report.length,
      top_signal: report[0]?.signal_label ?? null,
      top_edge_pct: report[0]?.edge_pct ?? null,
    };
    await logCronRun("spx-signal-weight-optimize", started, payload);
    return NextResponse.json(payload);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[spx-signal-weight-optimize]", detail);
    await logCronRun("spx-signal-weight-optimize", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}
