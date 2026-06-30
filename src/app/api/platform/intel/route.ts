import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

type FlowAnomalyRow = {
  anomaly_type: string;
  ticker: string | null;
  detail: string | null;
  severity: string | null;
  detected_at: string;
  premium: number | null;
};

type CoachingAlertRow = {
  trigger_type: string;
  alert_text: string;
  urgency: string | null;
  generated_at: string;
};

type SignalAccuracyRow = {
  signal_source: string;
  total: string | number;
  wins: string | number;
  win_rate: string | number | null;
};

type RegimeAccuracyRow = {
  regime: string;
  total: string | number;
  wins: string | number;
  win_rate: string | number | null;
};

/**
 * /api/platform/intel — unified platform intelligence snapshot
 *
 * Every cron reads this at startup to understand current state before acting.
 * Returns: regime, recent anomalies, active coaching alerts, latest brief,
 * signal accuracy by regime, and cross-cron health.
 */
export async function GET(req: NextRequest) {
  // Premium session OR cron secret — this snapshot aggregates paid SPX content (brief levels,
  // coaching, win-rate stats). Must not be world-readable. Cron callers pass Bearer CRON_SECRET.
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;
  try {
    const [regime, anomalies, coaching, brief, signalStats, regimeAccuracy] = await Promise.allSettled([
      // 1. Current market regime
      dbQuery(
        "SELECT * FROM market_regime ORDER BY captured_at DESC LIMIT 1",
        []
      ),
      // 2. Recent anomalies (last 60 minutes)
      dbQuery(
        "SELECT * FROM flow_anomalies WHERE detected_at > NOW() - INTERVAL '60 minutes' ORDER BY detected_at DESC",
        []
      ),
      // 3. Active coaching alerts (last 30 minutes)
      dbQuery(
        "SELECT * FROM coaching_alerts WHERE generated_at > NOW() - INTERVAL '30 minutes' ORDER BY generated_at DESC LIMIT 5",
        []
      ),
      // 4. Latest pre-market brief
      dbQuery(
        "SELECT brief_date, brief_type, published_at, spx_price, call_wall, put_wall, king_strike, net_gex, gex_bias FROM platform_briefs WHERE brief_type = 'premarket' ORDER BY brief_date DESC LIMIT 1",
        []
      ),
      // 5. Signal accuracy — last 30 days overall
      dbQuery(
        `SELECT
           se.signal_source,
           COUNT(*) FILTER (WHERE so.direction_correct IS NOT NULL) as total,
           COUNT(*) FILTER (WHERE so.direction_correct = true) as wins,
           ROUND(COUNT(*) FILTER (WHERE so.direction_correct = true)::numeric /
             NULLIF(COUNT(*) FILTER (WHERE so.direction_correct IS NOT NULL), 0) * 100, 1) as win_rate
         FROM signal_events se
         JOIN signal_outcomes so ON so.signal_event_id = se.id
         WHERE se.fired_at > NOW() - INTERVAL '30 days' AND so.checkpoint = 'T+30'
         GROUP BY se.signal_source`,
        []
      ),
      // 6. Signal accuracy broken down by regime (which regime is most profitable)
      dbQuery(
        `SELECT
           se.metadata->>'regime' as regime,
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE so.direction_correct = true) as wins,
           ROUND(COUNT(*) FILTER (WHERE so.direction_correct = true)::numeric /
             NULLIF(COUNT(*), 0) * 100, 1) as win_rate
         FROM signal_events se
         JOIN signal_outcomes so ON so.signal_event_id = se.id
         WHERE se.fired_at > NOW() - INTERVAL '30 days'
           AND so.checkpoint = 'T+30'
           AND se.metadata->>'regime' IS NOT NULL
         GROUP BY se.metadata->>'regime'
         ORDER BY win_rate DESC NULLS LAST`,
        []
      ),
    ]);

    const regimeRow = regime.status === "fulfilled" && regime.value.rows.length > 0
      ? regime.value.rows[0] : null;

    const anomalyRows: FlowAnomalyRow[] =
      anomalies.status === "fulfilled" ? (anomalies.value.rows as FlowAnomalyRow[]) : [];
    const coachingRows: CoachingAlertRow[] =
      coaching.status === "fulfilled" ? (coaching.value.rows as CoachingAlertRow[]) : [];
    const briefRow = brief.status === "fulfilled" && brief.value.rows.length > 0
      ? brief.value.rows[0] : null;
    const signalRows: SignalAccuracyRow[] =
      signalStats.status === "fulfilled" ? (signalStats.value.rows as SignalAccuracyRow[]) : [];
    const regimeAccRows: RegimeAccuracyRow[] =
      regimeAccuracy.status === "fulfilled" ? (regimeAccuracy.value.rows as RegimeAccuracyRow[]) : [];

    // Derive platform-wide intelligence summary
    const criticalAnomalies = anomalyRows.filter((a) => a.severity === "CRITICAL");
    const urgentCoaching = coachingRows.filter((c) => c.urgency === "CRITICAL" || c.urgency === "HIGH");
    const currentRegime = regimeRow?.composite ?? "UNKNOWN";

    // Best and worst performing regimes
    const bestRegime = regimeAccRows[0] ?? null;
    const worstRegime = regimeAccRows[regimeAccRows.length - 1] ?? null;

    // Is current regime historically profitable?
    const currentRegimeAcc = regimeAccRows.find((r) => r.regime === currentRegime);
    const currentRegimeProfitable = currentRegimeAcc ? Number(currentRegimeAcc.win_rate) > 50 : null;

    return NextResponse.json({
      // Current state
      regime: regimeRow ? {
        composite: regimeRow.composite,
        gexRegime: regimeRow.gex_regime,
        volRegime: regimeRow.vol_regime,
        trendRegime: regimeRow.trend_regime,
        flowRegime: regimeRow.flow_regime,
        playbook: regimeRow.playbook,
        capturedAt: regimeRow.captured_at,
        netGex: regimeRow.net_gex,
        aboveVwap: regimeRow.above_vwap,
        ivPercentile: regimeRow.iv_percentile,
      } : null,

      // Active anomalies
      anomalies: anomalyRows.map((a) => ({
        type: a.anomaly_type,
        ticker: a.ticker,
        detail: a.detail,
        severity: a.severity,
        detectedAt: a.detected_at,
        premium: a.premium,
      })),

      // Coaching alerts
      coachingAlerts: coachingRows.map((c) => ({
        trigger: c.trigger_type,
        alert: c.alert_text,
        urgency: c.urgency,
        generatedAt: c.generated_at,
      })),

      // Morning brief context
      lastBrief: briefRow ? {
        date: briefRow.brief_date,
        spxPrice: briefRow.spx_price,
        callWall: briefRow.call_wall,
        putWall: briefRow.put_wall,
        kingStrike: briefRow.king_strike,
        netGex: briefRow.net_gex,
        gexBias: briefRow.gex_bias,
        publishedAt: briefRow.published_at,
      } : null,

      // Signal accuracy
      signalAccuracy: signalRows.reduce((acc: Record<string, { total: number; wins: number; winRate: number }>, r) => {
        acc[r.signal_source] = { total: Number(r.total), wins: Number(r.wins), winRate: Number(r.win_rate) };
        return acc;
      }, {}),

      // Regime-conditional accuracy
      regimeAccuracy: regimeAccRows.map((r) => ({
        regime: r.regime,
        total: Number(r.total),
        wins: Number(r.wins),
        winRate: Number(r.win_rate),
      })),

      // Cross-cron synthesis
      intelligence: {
        currentRegime,
        currentRegimeProfitable,
        criticalAnomalyCount: criticalAnomalies.length,
        urgentCoachingCount: urgentCoaching.length,
        bestPerformingRegime: bestRegime?.regime ?? null,
        worstPerformingRegime: worstRegime?.regime ?? null,
        // Recommendation for signal-taking right now
        signalRecommendation: currentRegimeProfitable === false
          ? `REDUCE SIZE — current regime (${currentRegime}) has historically underperformed. Win rate: ${currentRegimeAcc?.win_rate ?? "unknown"}%.`
          : criticalAnomalies.length > 0
          ? `CAUTION — ${criticalAnomalies.length} critical anomaly(ies) detected. Verify direction before opening.`
          : currentRegimeProfitable === true
          ? `NORMAL SIZE — ${currentRegime} has a ${currentRegimeAcc?.win_rate}% historical win rate. Proceed with confidence.`
          : "INSUFFICIENT DATA — not enough signals to assess regime accuracy yet.",
      },

      timestamp: new Date().toISOString(),
    }, { status: 200, headers: NO_STORE });

  } catch (err) {
    // Graceful degradation — return empty state rather than error
    return NextResponse.json({
      regime: null,
      anomalies: [],
      coachingAlerts: [],
      lastBrief: null,
      signalAccuracy: {},
      regimeAccuracy: [],
      intelligence: {
        currentRegime: "UNKNOWN",
        currentRegimeProfitable: null,
        criticalAnomalyCount: 0,
        urgentCoachingCount: 0,
        signalRecommendation: "Platform intel unavailable — proceed with standard sizing.",
      },
      timestamp: new Date().toISOString(),
    }, { status: 200, headers: NO_STORE });
  }
}
