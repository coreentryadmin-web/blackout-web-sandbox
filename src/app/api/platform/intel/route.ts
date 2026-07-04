import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { isPremarketBriefFresh, todayEtYmd } from "@/lib/providers/spx-session";
import {
  fetchSignalAccuracyBySource,
  blendedAccuracy,
  MIN_SAMPLE_FOR_RECOMMENDATION,
  type SignalAccuracyBySource,
} from "@/lib/signal-accuracy";

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

const EMPTY_SIGNAL_ACCURACY: SignalAccuracyBySource = {
  SPX_SLAYER: { total: 0, wins: 0, winRate: null },
  NIGHT_HAWK: { total: 0, wins: 0, winRate: null },
};

/**
 * /api/platform/intel — unified platform intelligence snapshot
 *
 * Every cron reads this at startup to understand current state before acting.
 * Returns: regime, recent anomalies, active coaching alerts, latest brief,
 * signal accuracy, and cross-cron health.
 */
export async function GET(req: NextRequest) {
  // Premium session OR cron secret — this snapshot aggregates paid SPX content (brief levels,
  // coaching, win-rate stats). Must not be world-readable. Cron callers pass Bearer CRON_SECRET.
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;
  try {
    const [regime, anomalies, coaching, brief, signalAcc] = await Promise.allSettled([
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
      // 4. Latest pre-market brief (brief_date needed to gate staleness below)
      dbQuery(
        "SELECT brief_date, brief_type, published_at, spx_price, call_wall, put_wall, king_strike, net_gex, gex_bias FROM platform_briefs WHERE brief_type = 'premarket' ORDER BY brief_date DESC LIMIT 1",
        []
      ),
      // 5. Signal accuracy — real numbers from the LIVE outcome ledgers (spx_play_outcomes,
      // nighthawk_play_outcomes), NOT signal_events/signal_outcomes. That bridge table was
      // designed to unify SPX Slayer + Night Hawk accuracy under one ledger but has never
      // received a single write in production (nothing calls POST /api/signals/record outside
      // its own route file) — this JOIN used to always return zero rows, so signalAccuracy and
      // the regime-conditional recommendation below were permanently stuck on "INSUFFICIENT
      // DATA". See docs/audit/FINDINGS.md and src/lib/signal-accuracy.ts.
      fetchSignalAccuracyBySource(),
    ]);

    const regimeRow = regime.status === "fulfilled" && regime.value.rows.length > 0
      ? regime.value.rows[0] : null;

    const anomalyRows: FlowAnomalyRow[] =
      anomalies.status === "fulfilled" ? (anomalies.value.rows as FlowAnomalyRow[]) : [];
    const coachingRows: CoachingAlertRow[] =
      coaching.status === "fulfilled" ? (coaching.value.rows as CoachingAlertRow[]) : [];
    const briefRowRaw = brief.status === "fulfilled" && brief.value.rows.length > 0
      ? brief.value.rows[0] : null;
    // Same staleness gate as /api/brief/premarket: a premarket brief 2+ sessions
    // old must not be served as current — this snapshot feeds cron decisioning
    // and AI prompt context, not just a UI panel.
    const briefDateYmd = briefRowRaw
      ? (briefRowRaw.brief_date instanceof Date
          ? briefRowRaw.brief_date.toISOString().slice(0, 10)
          : String(briefRowRaw.brief_date).slice(0, 10))
      : null;
    const briefRow = briefRowRaw && briefDateYmd && isPremarketBriefFresh(briefDateYmd, todayEtYmd())
      ? briefRowRaw
      : null;
    const bySource: SignalAccuracyBySource =
      signalAcc.status === "fulfilled" ? signalAcc.value : EMPTY_SIGNAL_ACCURACY;
    const blended = blendedAccuracy(bySource);

    // Derive platform-wide intelligence summary
    const criticalAnomalies = anomalyRows.filter((a) => a.severity === "CRITICAL");
    const urgentCoaching = coachingRows.filter((c) => c.urgency === "CRITICAL" || c.urgency === "HIGH");
    const currentRegime = regimeRow?.composite ?? "UNKNOWN";

    // Is the platform's real, blended (SPX Slayer + Night Hawk) accuracy currently good?
    // NOTE: this used to be conditioned on the CURRENT market regime (bull/bear/chop) via
    // signal_events.metadata->>'regime' — but that column was never populated by any real
    // writer even before signal_events went dead, and neither spx_play_outcomes nor
    // nighthawk_play_outcomes tag a row with "which regime was active when this was opened."
    // A genuine regime-conditional breakdown isn't derivable from the real ledgers without a
    // new schema column/join, which is out of scope for this data-source fix — so this is now
    // conditioned on real accumulated sample size instead of a fabricated regime match.
    const currentRegimeProfitable =
      blended.total >= MIN_SAMPLE_FOR_RECOMMENDATION && blended.winRate != null
        ? blended.winRate > 50
        : null;

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

      // Signal accuracy — real numbers per source (SPX_SLAYER, NIGHT_HAWK) from the live
      // outcome ledgers. winRate is null (never a bogus 0%) until that source has a closed
      // sample.
      signalAccuracy: bySource,

      // Regime-conditional accuracy: intentionally empty. See the currentRegimeProfitable
      // comment above — neither real ledger tags an outcome with the regime active at entry,
      // so a genuine per-regime breakdown can't be computed here without new schema/joins.
      // Kept as an array (not removed) so any existing consumer iterating this field doesn't
      // need a shape change.
      regimeAccuracy: [] as Array<{ regime: string; total: number; wins: number; winRate: number | null }>,

      // Cross-cron synthesis
      intelligence: {
        currentRegime,
        currentRegimeProfitable,
        criticalAnomalyCount: criticalAnomalies.length,
        urgentCoachingCount: urgentCoaching.length,
        // No longer regime-keyed (see regimeAccuracy above) — signalAccuracy above already
        // exposes both real sources' numbers directly.
        bestPerformingRegime: null,
        worstPerformingRegime: null,
        // Recommendation for signal-taking right now — real blended (SPX Slayer + Night
        // Hawk) win rate instead of the always-empty regime-conditional join.
        signalRecommendation: currentRegimeProfitable === false
          ? `REDUCE SIZE — blended signal win rate is ${blended.winRate}% across ${blended.total} closed plays (SPX Slayer + Night Hawk, current regime ${currentRegime}).`
          : criticalAnomalies.length > 0
          ? `CAUTION — ${criticalAnomalies.length} critical anomaly(ies) detected. Verify direction before opening.`
          : currentRegimeProfitable === true
          ? `NORMAL SIZE — blended signal win rate is ${blended.winRate}% across ${blended.total} closed plays (SPX Slayer + Night Hawk). Proceed with confidence.`
          : `INSUFFICIENT DATA — only ${blended.total} closed signal(s) so far (need ${MIN_SAMPLE_FOR_RECOMMENDATION}+ to assess accuracy).`,
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
