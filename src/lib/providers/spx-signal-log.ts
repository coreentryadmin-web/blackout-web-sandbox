import { dbConfigured, dbQuery, insertShadowFactorObservation, getMeta, insertSpxSignalLog, setMeta } from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { SpxPlayDirection, SpxSignalFactor } from "@/lib/spx-signals";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { isFlowFrameFreshAnywhere } from "@/lib/flow-liveness";
import { computeShadowFactors, SHADOW_ANOMALY_TICKERS } from "@/lib/spx-signals-shadow";
import { computeEcosystemShadowFactors } from "@/lib/spx-signals-shadow-ecosystem";

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
 * SHADOW-MODE factor logging, ecosystem-context flavor — sibling of
 * logSpxShadowFactors above, same fire-and-forget call contract from
 * evaluateSpxPlay (src/lib/spx-play-engine.ts), writing into the SAME
 * spx_confluence_shadow_observations table (factor_name is the discriminator
 * column — see db.ts's table comment). See
 * src/lib/spx-signals-shadow-ecosystem.ts's module doc for the full
 * rationale: this is the BIE-mediated generalization of the live
 * getNhConfluenceBonus() pattern to 0DTE Command, plus a second,
 * differentiated SPX-ticker-scoped flow-anomaly read.
 *
 * Takes `confluence.direction` (in addition to score/grade) because — unlike
 * the flow_anomalies factor above, which doesn't need the engine's own bias —
 * the 0DTE-agreement factor's whole point is comparing 0DTE Command's
 * direction against the engine's own. Callers must pass the SAME confluence
 * object logSpxShadowFactors was given (captured before the Night Hawk prior
 * mutates it), for the identical "pairs with the pure engine output" reason
 * documented on logSpxShadowFactors above.
 */
export async function logSpxEcosystemShadowFactors(
  desk: SpxDeskPayload,
  confluence: { score: number; grade: string; direction: SpxPlayDirection | null }
): Promise<void> {
  if (!dbConfigured()) return;

  const observations = await computeEcosystemShadowFactors(desk, confluence.direction);
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
