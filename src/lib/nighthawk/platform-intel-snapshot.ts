import { dbConfigured, dbQuery } from "@/lib/db";
import { isPremarketBriefFresh, todayEtYmd } from "@/lib/providers/spx-session";

/** Cross-service intel pulled from the same Postgres tables as /api/platform/intel. */
export type PlatformIntelSnapshot = {
  composite_regime: string | null;
  gex_regime: string | null;
  flow_regime: string | null;
  playbook: string | null;
  net_gex: number | null;
  above_vwap: boolean | null;
  iv_percentile: number | null;
  critical_anomaly_count: number;
  anomaly_tickers: string[];
  signal_recommendation: string | null;
  last_brief: {
    call_wall: number | null;
    put_wall: number | null;
    gex_bias: string | null;
    net_gex: number | null;
  } | null;
};

function emptySnapshot(): PlatformIntelSnapshot {
  return {
    composite_regime: null,
    gex_regime: null,
    flow_regime: null,
    playbook: null,
    net_gex: null,
    above_vwap: null,
    iv_percentile: null,
    critical_anomaly_count: 0,
    anomaly_tickers: [],
    signal_recommendation: null,
    last_brief: null,
  };
}

/** Read platform intel directly from Postgres — no HTTP self-call during edition build. */
export async function fetchPlatformIntelSnapshot(): Promise<PlatformIntelSnapshot> {
  if (!dbConfigured()) return emptySnapshot();

  try {
    const [regimeRes, anomalyRes, briefRes, regimeAccRes] = await Promise.all([
      dbQuery("SELECT * FROM market_regime ORDER BY captured_at DESC LIMIT 1", []),
      dbQuery(
        `SELECT ticker, severity FROM flow_anomalies
         WHERE detected_at > NOW() - INTERVAL '60 minutes'
         ORDER BY detected_at DESC LIMIT 20`,
        []
      ),
      dbQuery(
        `SELECT brief_date, call_wall, put_wall, net_gex, gex_bias FROM platform_briefs
         WHERE brief_type = 'premarket' ORDER BY brief_date DESC LIMIT 1`,
        []
      ),
      dbQuery(
        `SELECT se.metadata->>'regime' AS regime,
                ROUND(COUNT(*) FILTER (WHERE so.direction_correct = true)::numeric /
                  NULLIF(COUNT(*), 0) * 100, 1) AS win_rate
         FROM signal_events se
         JOIN signal_outcomes so ON so.signal_event_id = se.id
         WHERE se.fired_at > NOW() - INTERVAL '30 days'
           AND so.checkpoint = 'T+30'
           AND se.metadata->>'regime' IS NOT NULL
         GROUP BY se.metadata->>'regime'`,
        []
      ),
    ]);

    const regimeRow = regimeRes.rows[0] as Record<string, unknown> | undefined;
    const anomalies = anomalyRes.rows as Array<{ ticker?: string; severity?: string }>;
    const briefRowRaw = briefRes.rows[0] as Record<string, unknown> | undefined;
    const regimeAcc = regimeAccRes.rows as Array<{ regime?: string; win_rate?: string | number }>;

    // Same staleness gate as /api/brief/premarket — this snapshot feeds cron
    // decisioning and AI prompt context (formatPlatformIntelForPrompt below),
    // so a 2+ session-old brief must not be treated as current here either.
    const briefDateYmd = briefRowRaw?.brief_date
      ? (briefRowRaw.brief_date instanceof Date
          ? briefRowRaw.brief_date.toISOString().slice(0, 10)
          : String(briefRowRaw.brief_date).slice(0, 10))
      : null;
    const briefRow = briefRowRaw && briefDateYmd && isPremarketBriefFresh(briefDateYmd, todayEtYmd())
      ? briefRowRaw
      : undefined;

    const composite = regimeRow?.composite != null ? String(regimeRow.composite) : null;
    const critical = anomalies.filter((a) => a.severity === "CRITICAL");
    const currentAcc = composite
      ? regimeAcc.find((r) => r.regime === composite)
      : undefined;
    const winRate = currentAcc?.win_rate != null ? Number(currentAcc.win_rate) : null;

    let signalRecommendation: string | null = null;
    if (winRate != null && winRate < 50 && composite) {
      signalRecommendation = `REDUCE SIZE — ${composite} regime historical win rate ${winRate}%.`;
    } else if (critical.length > 0) {
      signalRecommendation = `CAUTION — ${critical.length} critical flow anomaly(ies) in the last hour.`;
    } else if (winRate != null && winRate >= 50 && composite) {
      signalRecommendation = `NORMAL SIZE — ${composite} regime historical win rate ${winRate}%.`;
    }

    return {
      composite_regime: composite,
      gex_regime: regimeRow?.gex_regime != null ? String(regimeRow.gex_regime) : null,
      flow_regime: regimeRow?.flow_regime != null ? String(regimeRow.flow_regime) : null,
      playbook: regimeRow?.playbook != null ? String(regimeRow.playbook) : null,
      net_gex: regimeRow?.net_gex != null ? Number(regimeRow.net_gex) : null,
      above_vwap: regimeRow?.above_vwap != null ? Boolean(regimeRow.above_vwap) : null,
      iv_percentile: regimeRow?.iv_percentile != null ? Number(regimeRow.iv_percentile) : null,
      critical_anomaly_count: critical.length,
      anomaly_tickers: anomalies
        .map((a) => String(a.ticker ?? "").toUpperCase())
        .filter(Boolean)
        .slice(0, 10),
      signal_recommendation: signalRecommendation,
      last_brief: briefRow
        ? {
            call_wall: briefRow.call_wall != null ? Number(briefRow.call_wall) : null,
            put_wall: briefRow.put_wall != null ? Number(briefRow.put_wall) : null,
            gex_bias: briefRow.gex_bias != null ? String(briefRow.gex_bias) : null,
            net_gex: briefRow.net_gex != null ? Number(briefRow.net_gex) : null,
          }
        : null,
    };
  } catch (err) {
    console.warn("[nighthawk/platform-intel] snapshot failed:", err);
    return emptySnapshot();
  }
}

export function formatPlatformIntelForPrompt(intel: PlatformIntelSnapshot | null | undefined): string {
  if (!intel?.composite_regime && !intel?.signal_recommendation) return "Platform intel: unavailable.";
  const lines = [
    `Composite regime: ${intel.composite_regime ?? "unknown"}`,
    intel.gex_regime ? `GEX regime: ${intel.gex_regime}` : null,
    intel.flow_regime ? `Flow regime: ${intel.flow_regime}` : null,
    intel.playbook ? `Desk playbook: ${intel.playbook}` : null,
    intel.net_gex != null ? `Net GEX: ${intel.net_gex}` : null,
    intel.above_vwap != null ? `SPX vs VWAP: ${intel.above_vwap ? "above" : "below"}` : null,
    intel.iv_percentile != null ? `IV percentile: ${intel.iv_percentile}` : null,
    intel.critical_anomaly_count
      ? `Critical anomalies (60m): ${intel.critical_anomaly_count}${intel.anomaly_tickers.length ? ` — ${intel.anomaly_tickers.join(", ")}` : ""}`
      : null,
    intel.last_brief?.call_wall != null
      ? `Latest brief walls: call ${intel.last_brief.call_wall} / put ${intel.last_brief.put_wall ?? "?"} (${intel.last_brief.gex_bias ?? "?"})`
      : null,
    intel.signal_recommendation ? `Sizing note: ${intel.signal_recommendation}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}
