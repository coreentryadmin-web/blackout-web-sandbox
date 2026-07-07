import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { dbQuery } from "@/lib/db";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { initSpxSignalTables } from "@/features/spx/lib/spx-signal-db";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const days = Math.max(1, Math.min(90, parseInt(sp.get("days") ?? "7", 10)));
  const minOutcomes = Math.max(1, parseInt(sp.get("minOutcomes") ?? "20", 10));

  try {
    // The writer cron (spx-signal-observe) creates spx_signal_observations on first run; this
    // read route used to assume it existed and 42P01'd on every admin load until the cron had run.
    // Ensure it exists first (idempotent) so the analytics show an honest empty state, not an error.
    await initSpxSignalTables();
    // ── date range ─────────────────────────────────────────────────────────────
    const rangeRow = await dbQuery<{ from_dt: string; to_dt: string }>(`
      SELECT
        MIN(observed_at)::text AS from_dt,
        MAX(observed_at)::text AS to_dt
      FROM spx_signal_observations
      WHERE observed_at >= NOW() - ($1 || ' days')::interval
    `, [days]);

    const dateRange = {
      from: rangeRow.rows[0]?.from_dt ?? "",
      to:   rangeRow.rows[0]?.to_dt   ?? "",
    };

    // ── summary ────────────────────────────────────────────────────────────────
    const summaryRes = await dbQuery<{
      total_observations:        number;
      observations_with_outcomes: number;
      overall_accuracy:          number;
      avg_score:                 number;
    }>(`
      SELECT
        COUNT(*)                                              AS total_observations,
        COUNT(*) FILTER (WHERE outcome_at IS NOT NULL)       AS observations_with_outcomes,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE direction_correct = true AND outcome_at IS NOT NULL)
          / NULLIF(COUNT(*) FILTER (WHERE outcome_at IS NOT NULL), 0),
          2
        )                                                     AS overall_accuracy,
        ROUND(AVG(score)::numeric, 2)                         AS avg_score
      FROM spx_signal_observations
      WHERE observed_at >= NOW() - ($1 || ' days')::interval
    `, [days]);

    const summary = {
      total_observations:         Number(summaryRes.rows[0]?.total_observations         ?? 0),
      observations_with_outcomes: Number(summaryRes.rows[0]?.observations_with_outcomes ?? 0),
      overall_accuracy:           Number(summaryRes.rows[0]?.overall_accuracy           ?? 0),
      avg_score:                  Number(summaryRes.rows[0]?.avg_score                  ?? 0),
      date_range: dateRange,
    };

    const baselineAccuracy = summary.overall_accuracy;

    // ── signal correlations ────────────────────────────────────────────────────
    // Unnest factors_json (JSONB array of {label, weight}) and correlate with outcomes.
    // Only rows that have outcomes are included so accuracy is meaningful.
    const sigCorrRes = await dbQuery<{
      label:             string;
      fire_count:        number;
      avg_weight:        number;
      accuracy_pct:      number;
      bullish_accuracy:  number;
      bearish_accuracy:  number;
    }>(`
      SELECT
        f->>'label'                                                 AS label,
        COUNT(*)                                                    AS fire_count,
        ROUND(AVG((f->>'weight')::numeric)::numeric, 3)            AS avg_weight,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE o.direction_correct = true)
          / NULLIF(COUNT(*), 0),
          2
        )                                                           AS accuracy_pct,
        ROUND(
          100.0 * COUNT(*) FILTER (
            WHERE (f->>'weight')::numeric > 0 AND o.direction_correct = true
          ) / NULLIF(
            COUNT(*) FILTER (WHERE (f->>'weight')::numeric > 0), 0
          ),
          2
        )                                                           AS bullish_accuracy,
        ROUND(
          100.0 * COUNT(*) FILTER (
            WHERE (f->>'weight')::numeric < 0 AND o.direction_correct = true
          ) / NULLIF(
            COUNT(*) FILTER (WHERE (f->>'weight')::numeric < 0), 0
          ),
          2
        )                                                           AS bearish_accuracy
      FROM spx_signal_observations o,
           jsonb_array_elements(o.factors_json) AS f
      WHERE o.observed_at  >= NOW() - ($1 || ' days')::interval
        AND o.outcome_at   IS NOT NULL
        AND (f->>'weight')::numeric <> 0
      GROUP BY f->>'label'
      HAVING COUNT(*) >= $2
      ORDER BY fire_count DESC
    `, [days, minOutcomes]);

    const signalCorrelations = sigCorrRes.rows.map((r) => ({
      label:             r.label,
      fire_count:        Number(r.fire_count),
      avg_weight:        Number(r.avg_weight),
      accuracy_pct:      Number(r.accuracy_pct),
      baseline_accuracy: baselineAccuracy,
      edge:              Number(r.accuracy_pct) - baselineAccuracy,
      bullish_accuracy:  Number(r.bullish_accuracy ?? 0),
      bearish_accuracy:  Number(r.bearish_accuracy ?? 0),
    }));

    // ── score band performance ─────────────────────────────────────────────────
    const bandRes = await dbQuery<{
      band:         string;
      count:        number;
      accuracy_pct: number;
      avg_move_30m: number;
    }>(`
      SELECT
        CASE
          WHEN score >= 70             THEN '70+'
          WHEN score >= 60             THEN '60-70'
          WHEN score >= 52             THEN '52-60'
          -- Catch-all for EVERYTHING below 52 (including negatives) — labeling it
          -- '45-52' was a lie: the band's live average score was 27.3.
          ELSE                              '<52'
        END                                                       AS band,
        COUNT(*)                                                   AS count,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE direction_correct = true AND outcome_at IS NOT NULL)
          / NULLIF(COUNT(*) FILTER (WHERE outcome_at IS NOT NULL), 0),
          2
        )                                                          AS accuracy_pct,
        ROUND(AVG(outcome_move)::numeric, 4)                      AS avg_move_30m
      FROM spx_signal_observations
      WHERE observed_at >= NOW() - ($1 || ' days')::interval
      GROUP BY band
      ORDER BY MIN(score) DESC
    `, [days]);

    const scoreBandPerformance = bandRes.rows.map((r) => ({
      band:         r.band,
      count:        Number(r.count),
      accuracy_pct: Number(r.accuracy_pct ?? 0),
      avg_move_30m: Number(r.avg_move_30m ?? 0),
    }));

    // ── session window performance ─────────────────────────────────────────────
    const windowRes = await dbQuery<{
      window:       string;
      count:        number;
      accuracy_pct: number;
      avg_score:    number;
      avg_move_30m: number;
    }>(`
      SELECT
        session_window                                             AS window,
        COUNT(*)                                                   AS count,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE direction_correct = true AND outcome_at IS NOT NULL)
          / NULLIF(COUNT(*) FILTER (WHERE outcome_at IS NOT NULL), 0),
          2
        )                                                          AS accuracy_pct,
        ROUND(AVG(score)::numeric, 2)                             AS avg_score,
        ROUND(AVG(outcome_move)::numeric, 4)                      AS avg_move_30m
      FROM spx_signal_observations
      WHERE observed_at >= NOW() - ($1 || ' days')::interval
        AND session_window IS NOT NULL
      GROUP BY session_window
      ORDER BY count DESC
    `, [days]);

    const sessionWindowPerformance = windowRes.rows.map((r) => ({
      window:       r.window,
      count:        Number(r.count),
      accuracy_pct: Number(r.accuracy_pct ?? 0),
      avg_score:    Number(r.avg_score ?? 0),
      avg_move_30m: Number(r.avg_move_30m ?? 0),
    }));

    // ── gate block frequency ───────────────────────────────────────────────────
    // gates_blocked_json is a JSONB array of {gate, detail}
    const gateTotal = summary.total_observations || 1;

    const gateRes = await dbQuery<{
      gate:        string;
      block_count: number;
    }>(`
      SELECT
        g->>'gate'   AS gate,
        COUNT(*)     AS block_count
      FROM spx_signal_observations o,
           jsonb_array_elements(o.gates_blocked_json) AS g
      WHERE o.observed_at >= NOW() - ($1 || ' days')::interval
        AND o.gates_blocked_json IS NOT NULL
        AND jsonb_array_length(o.gates_blocked_json) > 0
      GROUP BY g->>'gate'
      ORDER BY block_count DESC
    `, [days]);

    const gateBlockFrequency = gateRes.rows.map((r) => ({
      gate:        r.gate,
      block_count: Number(r.block_count),
      block_pct:   Math.round((Number(r.block_count) / gateTotal) * 10000) / 100,
    }));

    // ── hourly accuracy ────────────────────────────────────────────────────────
    const hourlyRes = await dbQuery<{
      hour:         number;
      count:        number;
      accuracy_pct: number;
    }>(`
      SELECT
        EXTRACT(HOUR FROM observed_at AT TIME ZONE 'America/New_York')::int AS hour,
        COUNT(*)                                                              AS count,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE direction_correct = true AND outcome_at IS NOT NULL)
          / NULLIF(COUNT(*) FILTER (WHERE outcome_at IS NOT NULL), 0),
          2
        )                                                                     AS accuracy_pct
      FROM spx_signal_observations
      WHERE observed_at >= NOW() - ($1 || ' days')::interval
        AND EXTRACT(HOUR FROM observed_at AT TIME ZONE 'America/New_York') BETWEEN 9 AND 15
      GROUP BY hour
      ORDER BY hour
    `, [days]);

    const hourlyAccuracy = hourlyRes.rows.map((r) => ({
      hour:         Number(r.hour),
      count:        Number(r.count),
      accuracy_pct: Number(r.accuracy_pct ?? 0),
    }));

    // ── recent observations ────────────────────────────────────────────────────
    const recentRes = await dbQuery<{
      id:               string;
      observed_at:      string;
      price:            number;
      score:            number;
      grade:            string;
      direction:        string | null;
      engine_action:    string;
      session_window:   string;
      factors_json:     Array<{ label: string; weight: number }>;
      gates_blocked:    Array<{ gate: string; detail: string }>;
      outcome_move: number | null;
      direction_correct: boolean | null;
    }>(`
      SELECT
        id::text,
        observed_at::text,
        price,
        score,
        grade,
        direction,
        engine_action,
        session_window,
        factors_json,
        gates_blocked_json AS gates_blocked,
        outcome_move,
        direction_correct
      FROM spx_signal_observations
      WHERE observed_at >= NOW() - ($1 || ' days')::interval
      ORDER BY observed_at DESC
      LIMIT 100
    `, [days]);

    const recentObservations = recentRes.rows.map((r) => ({
      id:             r.id,
      observed_at:    r.observed_at,
      price:          Number(r.price),
      score:          Number(r.score),
      grade:          r.grade,
      direction:      r.direction ?? null,
      engine_action:  r.engine_action,
      session_window: r.session_window,
      factors:        (r.factors_json ?? []).map((f) => ({
        label:  String(f.label),
        weight: Number(f.weight),
      })),
      gates_blocked: (r.gates_blocked ?? []).map((g) => ({
        gate:   String(g.gate),
        detail: String(g.detail),
      })),
      outcome_move:      r.outcome_move != null ? Number(r.outcome_move) : null,
      direction_correct: r.direction_correct ?? null,
    }));

    return NextResponse.json(
      roundFloats({
        summary,
        signal_correlations:       signalCorrelations,
        score_band_performance:    scoreBandPerformance,
        session_window_performance: sessionWindowPerformance,
        gate_block_frequency:      gateBlockFrequency,
        hourly_accuracy:           hourlyAccuracy,
        recent_observations:       recentObservations,
      })
    );
  } catch (error) {
    recordAdminRouteError("admin/signal-analytics", error);
    return NextResponse.json({ error: "Failed to load signal analytics" }, { status: 502 });
  }
}
