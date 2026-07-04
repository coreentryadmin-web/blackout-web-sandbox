import { dbConfigured, dbQuery, insertShadowFactorObservation, getMeta, insertSpxSignalLog, setMeta } from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { SpxSignalFactor } from "@/lib/spx-signals";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { isFlowFrameFreshAnywhere } from "@/lib/flow-liveness";
import { computeShadowFactors, SHADOW_ANOMALY_TICKERS } from "@/lib/spx-signals-shadow";
import {
  computeSkewShadowFactor,
  computeVolDivergenceShadowFactor,
  type RiskReversalSkewReading,
  type VolDivergenceReading,
} from "@/lib/spx-signals-shadow-skew";
import { fetchUwRealizedVol, fetchUwRiskReversalSkew } from "./unusual-whales";
import { fetchPolygonIvTermStructure, fetchPolygonRealizedVol } from "./polygon-options-gex";
import { latestRow, parseLatestImpliedVol, parseLatestRealizedVol, parseLatestRiskReversalSkew } from "@/lib/nighthawk/vol-metrics";

const CURSOR_KEY = "spx_signal_log_cursor";

export type SpxSignalLogRow = {
  id: number;
  signal_key: string;
  action: string;
  bias: string;
  score: number;
  confidence: number;
  price: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  headline: string;
  factors: unknown;
  created_at: string;
};

/**
 * Stable per-session signal identity. Deliberately EXCLUDES score/confidence/
 * headline — those jitter between otherwise-identical plays and previously caused
 * near-duplicate signals to log as "new". Session date is included so a new
 * session re-logs even if its first signal matches yesterday's last.
 */
function signalKey(parts: { action: string; direction?: string | null }): string {
  return `${todayEtYmd()}|${parts.action}|${parts.direction ?? ""}`;
}

export async function maybeLogSpxPlay(
  desk: { price: number; market_open?: boolean },
  play: {
    action: string;
    direction: string | null;
    grade: string;
    score: number;
    confidence: number;
    headline: string;
    thesis: string;
    factors: SpxSignalFactor[];
    levels: {
      entry: number | null;
      stop: number | null;
      target: number | null;
      invalidation: string;
    };
  }
): Promise<void> {
  if (!dbConfigured() || !desk.market_open) return;
  if (!["BUY", "SELL", "TRIM"].includes(play.action)) return;

  const key = signalKey({
    action: play.action,
    direction: play.direction,
  });
  const prev = await getMeta(CURSOR_KEY);
  if (prev === key) return;

  await insertSpxSignalLog({
    signal_key: key,
    action: play.action,
    bias: play.direction === "long" ? "bullish" : play.direction === "short" ? "bearish" : "neutral",
    score: play.score,
    confidence: play.confidence,
    price: desk.price,
    entry: play.levels.entry,
    stop: play.levels.stop,
    target: play.levels.target,
    headline: play.headline,
    factors: play.factors,
  });
  await setMeta(CURSOR_KEY, key);
}

// Watched-ticker window for the flow-anomaly shadow factor — same 30-minute
// window computeShadowFactors applies internally (spx-signals-shadow.ts). Kept
// as its own literal since the SQL WHERE clause needs one; keep the two in
// sync if either window ever changes.
const SHADOW_ANOMALY_LOOKBACK_MINUTES = 30;

/**
 * SHADOW-MODE factor logging — fire-and-forget from evaluateSpxPlay
 * (src/lib/spx-play-engine.ts), called immediately after the real
 * computeSpxConfluence() there and passed its already-computed score/grade
 * purely for later correlation against outcomes. See
 * src/lib/spx-signals-shadow.ts's module doc for the full rationale (shadow
 * mode, the bie/calibration.ts n>=10 evidence-gate precedent).
 *
 * Reads flow_anomalies with the same shape/columns as
 * src/lib/bie/ecosystem-context.ts's own `recent_anomalies` query (batched
 * across the watched-ticker list with ANY($1), the same pattern
 * fetchNighthawkEchoForTickers uses there for a ticker-list query) rather than
 * inventing a second query style against the same table.
 *
 * Mirrors maybeLogSpxPlay's own shape in this file: no internal try/catch —
 * the caller wraps this in its own fire-and-forget helper (firePlayTelemetry in
 * spx-play-engine.ts), exactly like every other best-effort write in that file.
 * A failure here must never affect the real signal shown to members.
 */
export async function logSpxShadowFactors(
  desk: SpxDeskPayload,
  confluence: { score: number; grade: string }
): Promise<void> {
  if (!dbConfigured()) return;

  const [anomalyRows, flowFeedFresh] = await Promise.all([
    dbQuery<{
      ticker: string;
      anomaly_type: string;
      detected_at: string;
      detail: string;
      severity: string;
      direction: string | null;
    }>(
      `SELECT ticker, anomaly_type, detected_at, detail, severity, direction
       FROM flow_anomalies
       WHERE ticker = ANY($1::text[]) AND detected_at >= NOW() - ($2 || ' minutes')::interval
       ORDER BY detected_at DESC`,
      [SHADOW_ANOMALY_TICKERS, SHADOW_ANOMALY_LOOKBACK_MINUTES]
    ),
    isFlowFrameFreshAnywhere(),
  ]);

  // detected_at comes back as a driver-parsed Date for a TIMESTAMPTZ column (same
  // reason ecosystem-context.ts wraps it in String() before handing it to a
  // caller) — normalize to a string before it reaches computeShadowFactors's
  // Date.parse().
  const anomalies = anomalyRows.rows.map((r) => ({
    ticker: r.ticker,
    anomaly_type: r.anomaly_type,
    detected_at: String(r.detected_at),
    detail: r.detail,
    severity: r.severity,
    direction: r.direction,
  }));

  const observations = computeShadowFactors(desk, anomalies, flowFeedFresh);
  const sessionDate = todayEtYmd();

  for (const obs of observations) {
    await insertShadowFactorObservation({
      session_date: sessionDate,
      factor_name: obs.factor_name,
      available: obs.available,
      implied_weight: obs.implied_weight,
      direction: obs.direction,
      detail: obs.detail,
      price_at_observation: desk.price ?? null,
      actual_score: confluence.score,
      actual_grade: confluence.grade,
    });
  }
}

/**
 * Best-effort extraction of a raw UW row's date, trying the same candidate keys
 * src/lib/nighthawk/vol-metrics.ts's own sortRowsByDateDesc checks — kept in sync
 * intentionally since both read the SAME UW row shapes.
 */
function rowDate(row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  const d = String(row.date ?? row.as_of ?? row.timestamp ?? row.trading_date ?? "");
  return d || null;
}

/**
 * Resolves a risk-reversal-skew reading for computeSkewShadowFactor. UW's
 * historical-risk-reversal-skew endpoint returns EMPTY for the SPX ticker (confirmed live,
 * 2026-07-04 — `{"data":[]}`) but real data for SPY — the exact same "SPX sometimes 404s/
 * empties, fall back to SPY as the liquid proxy" situation spx-desk.ts's resolveCanonicalDeskGex
 * caller already handles for NOPE (`fetchUwNope("SPX").catch(() => null).then(r => r ??
 * fetchUwNope("SPY")...)`) — mirrored here as a plain sequential try-SPX-then-SPY rather than
 * hardcoding SPY only, so this keeps working if UW ever backfills SPX.
 */
async function resolveSkewReading(): Promise<RiskReversalSkewReading> {
  for (const ticker of ["SPX", "SPY"] as const) {
    const rows = await fetchUwRiskReversalSkew(ticker).catch(() => []);
    const skew = parseLatestRiskReversalSkew(rows);
    const date = rowDate(latestRow(rows));
    if (skew != null && date != null) {
      return { ticker, date, risk_reversal: skew };
    }
  }
  return null;
}

/**
 * Resolves a realized-vs-implied vol reading for computeVolDivergenceShadowFactor. Reuses the
 * SAME primary/fallback precedent src/lib/largo/run-tool.ts's `get_realized_vol` /
 * `get_iv_term_structure` tool cases already use — Polygon primary (fetchPolygonRealizedVol /
 * fetchPolygonIvTermStructure, computed live from real bars / the current chain snapshot),
 * UW as fallback. Deliberately all-or-nothing per source rather than mixing a Polygon RV with
 * a UW IV (or vice versa): keeps each observation a single coherent snapshot instead of two
 * numbers from different moments/providers.
 *
 * realized_vol_30d is compared against the IV term-structure point NEAREST 30 DTE (not the
 * front-month/0DTE point) — an apples-to-apples tenor match, since comparing a 30-day realized
 * read against a same-day 0DTE IV print would conflate two different horizons.
 */
async function resolveVolDivergenceReading(): Promise<VolDivergenceReading> {
  const [polyVol, polyIvTerm] = await Promise.all([
    fetchPolygonRealizedVol("SPX").catch(() => null),
    fetchPolygonIvTermStructure("SPX").catch(() => [] as Awaited<ReturnType<typeof fetchPolygonIvTermStructure>>),
  ]);

  const rv =
    polyVol && polyVol.realized_vol_30d > 0
      ? polyVol.realized_vol_30d
      : polyVol && polyVol.realized_vol_10d > 0
        ? polyVol.realized_vol_10d
        : null;
  const ivPoint = polyIvTerm.length
    ? polyIvTerm.reduce((best, p) => (Math.abs(p.dte - 30) < Math.abs(best.dte - 30) ? p : best))
    : null;
  const iv = ivPoint && ivPoint.avg_iv > 0 ? ivPoint.avg_iv : null;

  if (rv != null && iv != null) {
    return { source: "polygon", as_of_date: null, realized_vol: rv, implied_vol: iv };
  }

  // Polygon came up short on at least one leg — fall back to UW's single combined endpoint,
  // which (confirmed live, 2026-07-04) carries realized_volatility AND implied_volatility on
  // the SAME row, e.g. `{"date":"2025-07-03","implied_volatility":"0.131000",
  // "realized_volatility":"0.087404"}` — one call recovers both legs together.
  const uwRows = await fetchUwRealizedVol("SPX").catch(() => []);
  const uwRv = parseLatestRealizedVol(uwRows);
  const uwIv = parseLatestImpliedVol(uwRows);
  const date = rowDate(latestRow(uwRows));
  if (uwRv != null && uwIv != null && date != null) {
    return { source: "unusual_whales", as_of_date: date, realized_vol: uwRv, implied_vol: uwIv };
  }

  return null;
}

/**
 * SHADOW-MODE factor logging, part 2 — risk-reversal skew + realized-vs-implied vol. Same
 * fire-and-forget wiring shape as logSpxShadowFactors above (called immediately after it from
 * evaluateSpxPlay in src/lib/spx-play-engine.ts, wrapped in the SAME firePlayTelemetry helper
 * there) — see src/lib/spx-signals-shadow-skew.ts's module doc for the full rationale
 * (including why these two factors fetch UW/Polygon directly here instead of through
 * SpxDeskPayload).
 */
export async function logSpxSkewShadowFactors(
  desk: SpxDeskPayload,
  confluence: { score: number; grade: string }
): Promise<void> {
  if (!dbConfigured()) return;

  const [skewReading, volReading] = await Promise.all([
    resolveSkewReading(),
    resolveVolDivergenceReading(),
  ]);

  const observations = [
    computeSkewShadowFactor(desk, skewReading),
    computeVolDivergenceShadowFactor(desk, volReading),
  ];
  const sessionDate = todayEtYmd();

  for (const obs of observations) {
    await insertShadowFactorObservation({
      session_date: sessionDate,
      factor_name: obs.factor_name,
      available: obs.available,
      implied_weight: obs.implied_weight,
      direction: obs.direction,
      detail: obs.detail,
      price_at_observation: desk.price ?? null,
      actual_score: confluence.score,
      actual_grade: confluence.grade,
    });
  }
}

/** @deprecated Use maybeLogSpxPlay from play engine */
export async function maybeLogSpxSignal(
  desk: import("./spx-desk").SpxDeskPayload
): Promise<void> {
  const { computeSpxTradeSignal } = await import("@/lib/spx-signals");
  const signal = computeSpxTradeSignal(desk);
  if (!signal) return;
  await maybeLogSpxPlay(desk, {
    action: signal.action === "BUY_CALL" || signal.action === "BUY_PUT" ? "BUY" : signal.action,
    direction:
      signal.action === "BUY_CALL" ? "long" : signal.action === "BUY_PUT" ? "short" : null,
    grade: "C",
    score: signal.score,
    confidence: signal.confidence,
    headline: signal.headline,
    thesis: signal.thesis,
    factors: signal.factors,
    levels: signal.levels,
  });
}

export async function fetchRecentSpxSignals(limit = 50): Promise<SpxSignalLogRow[]> {
  if (!dbConfigured()) return [];
  const { fetchRecentSpxSignalLogs } = await import("@/lib/db");
  return fetchRecentSpxSignalLogs(limit);
}
