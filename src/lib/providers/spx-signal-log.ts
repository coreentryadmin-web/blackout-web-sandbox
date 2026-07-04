import { dbConfigured, dbQuery, insertShadowFactorObservation, getMeta, insertSpxSignalLog, setMeta } from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { SpxSignalFactor } from "@/lib/spx-signals";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { isFlowFrameFreshAnywhere } from "@/lib/flow-liveness";
import { computeShadowFactors, SHADOW_ANOMALY_TICKERS } from "@/lib/spx-signals-shadow";
import { computeMacroPredictionsShadowFactor, resolveMacroWindowState } from "@/lib/spx-signals-shadow-predictions";
import { uwConfigured } from "@/lib/providers/config";
import { fetchUwPredictionsConsensus, type PredictionConsensusSignal } from "@/lib/providers/unusual-whales";

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

// Module-scoped cache for the macro-predictions shadow factor's UW consensus read —
// same idiom as spx-desk.ts's cachedPriorDay/cachedPulseStructure (module-level value +
// TTL check, refreshed lazily on next call past TTL). Deliberately generous (90s): this
// factor is only ever read near a rare macro window (a handful of days per month), never
// on the hot desk-poll path, so there is no freshness reason to hit UW's 4 prediction
// endpoints on every single evaluateSpxPlay tick while inside that window.
const MACRO_PREDICTIONS_CACHE_TTL_MS = 90_000;
const MACRO_PREDICTIONS_FETCH_LIMIT = 40; // wide enough to likely surface SPY/QQQ even when they're not the single top-confidence name
let cachedMacroPredictions: {
  fetchedAt: number;
  signals: PredictionConsensusSignal[] | null;
  fresh: boolean;
} = { fetchedAt: 0, signals: null, fresh: false };

/**
 * Fetch (or reuse a cached) UW prediction-market consensus read, with the same
 * "don't fabricate a fresh reading from an empty result" discipline the flow-anomaly
 * factor applies via isFlowFrameFreshAnywhere(). fetchUwPredictionsConsensus itself
 * never throws (uwGetSafe swallows failures and returns null — see
 * src/lib/providers/unusual-whales.ts), so an empty top_signals array alone can't
 * distinguish "UW is down/not configured" from "no consensus data exists right now."
 * raw_counts (the per-source row counts BEFORE ticker filtering) is the signal that can:
 * all four sources returning zero rows is a strong, otherwise-vanishingly-unlikely
 * indicator of an outage/misconfiguration, not a real empty market.
 */
async function fetchMacroPredictionsConsensusCached(): Promise<{
  signals: PredictionConsensusSignal[] | null;
  fresh: boolean;
}> {
  if (!uwConfigured()) return { signals: null, fresh: false };

  const now = Date.now();
  if (now - cachedMacroPredictions.fetchedAt < MACRO_PREDICTIONS_CACHE_TTL_MS) {
    return { signals: cachedMacroPredictions.signals, fresh: cachedMacroPredictions.fresh };
  }

  const consensus = await fetchUwPredictionsConsensus(MACRO_PREDICTIONS_FETCH_LIMIT).catch(() => null);
  const rawTotal = consensus
    ? Object.values(consensus.raw_counts).reduce((sum, n) => sum + n, 0)
    : 0;
  const fresh = consensus != null && rawTotal > 0;
  const signals = consensus?.top_signals ?? null;
  cachedMacroPredictions = { fetchedAt: now, signals, fresh };
  return { signals, fresh };
}

/**
 * SHADOW-MODE macro-prediction factor logging — sibling of logSpxShadowFactors above,
 * kept as its own function (rather than folded into logSpxShadowFactors) so this
 * factor family's UW fetch/cache concerns stay isolated from the flow-anomaly factor's
 * DB-read concerns. Same fire-and-forget call-site contract: called from
 * evaluateSpxPlay (src/lib/spx-play-engine.ts) immediately after the real
 * computeSpxConfluence() call, wrapped in firePlayTelemetry, no internal try/catch —
 * a failure here must never affect the real signal shown to members. See
 * src/lib/spx-signals-shadow-predictions.ts's module doc for the full rationale
 * (observing UW prediction-market consensus specifically around macroHardBlock's own
 * CPI/FOMC/NFP/PPI/GDP windows, spx-play-gates.ts).
 *
 * `now` is captured ONCE here and threaded through both resolveMacroWindowState and
 * computeMacroPredictionsShadowFactor so the two calls can never disagree about which
 * side of a window boundary "now" falls on.
 */
export async function logSpxMacroPredictionsShadowFactor(
  desk: SpxDeskPayload,
  confluence: { score: number; grade: string }
): Promise<void> {
  if (!dbConfigured()) return;

  const now = Date.now();
  const windowState = resolveMacroWindowState(desk, now);

  // Cost guard: skip the UW round trip entirely unless a macro window is active or
  // imminent — see MACRO_PREDICTIONS_CACHE_TTL_MS's comment. The DB write below still
  // happens every tick regardless (same as computeShadowFactors' own "no anomaly"
  // placeholder) — spx_confluence_shadow_observations is designed to log one row per
  // factor per evaluation tick (see insertShadowFactorObservation's doc in db.ts), and a
  // cheap single-row insert is not the cost this guard is protecting against.
  const { signals, fresh } = windowState.near
    ? await fetchMacroPredictionsConsensusCached()
    : { signals: null, fresh: false };

  const observations = computeMacroPredictionsShadowFactor(desk, signals, fresh, now);
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
