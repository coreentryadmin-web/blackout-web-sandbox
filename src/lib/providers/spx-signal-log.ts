import {
  dbConfigured,
  dbQuery,
  insertShadowFactorObservation,
  getMeta,
  insertSpxSignalLog,
  insertSpxEngineSnapshot,
  fetchRecentSpxEngineSnapshots,
  setMeta,
} from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { SpxPlayDirection, SpxSignalFactor } from "@/lib/spx-signals";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { isFlowFrameFreshAnywhere } from "@/lib/flow-liveness";
import { computeShadowFactors, SHADOW_ANOMALY_TICKERS } from "@/lib/spx-signals-shadow";
import { computeMacroPredictionsShadowFactor, resolveMacroWindowState } from "@/lib/spx-signals-shadow-predictions";
import { fetchUwPredictionsConsensus, type PredictionConsensusSignal } from "@/lib/providers/unusual-whales";
import {
  computeSkewShadowFactor,
  computeVolDivergenceShadowFactor,
  type RiskReversalSkewReading,
  type VolDivergenceReading,
} from "@/lib/spx-signals-shadow-skew";
import { fetchUwRealizedVol, fetchUwRiskReversalSkew } from "./unusual-whales";
import { fetchPolygonIvTermStructure, fetchPolygonRealizedVol } from "./polygon-options-gex";
import { latestRow, parseLatestImpliedVol, parseLatestRealizedVol, parseLatestRiskReversalSkew } from "@/lib/nighthawk/vol-metrics";
import { computeEcosystemShadowFactors } from "@/lib/spx-signals-shadow-ecosystem";
import { computeCatalystShadowFactors, type CatalystInput } from "@/lib/spx-signals-shadow-catalysts";
import { fetchBenzingaCatalysts } from "@/lib/providers/polygon";
import { uwConfigured, polygonConfigured } from "@/lib/providers/config";
import {
  buildPrecedentSearchQuery,
  computePrecedentShadowFactor,
  PRECEDENT_SEARCH_K,
} from "@/lib/spx-signals-shadow-precedents";
import { findSimilarPrecedents } from "@/lib/bie/precedent-search";
import { bieEmbeddingsConfigured } from "@/lib/bie/embeddings";

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

const ENGINE_SNAPSHOT_CURSOR_KEY = "spx_engine_snapshot_cursor";

/**
 * Structural input for maybeLogSpxEngineSnapshot below — deliberately a narrow
 * shape (same idiom as maybeLogSpxPlay's own `desk`/`play` params above and
 * every logSpx*ShadowFactors' `confluence` param) rather than importing the
 * full SpxPlayPayload type from spx-play-payload.ts: this file only ever
 * reads these 7 fields off whatever evaluateSpxPlay (src/lib/spx-play-
 * engine.ts) produced, so there's no reason to couple this module to that
 * type's full shape (or invite an import cycle back toward the engine).
 */
export type SpxEngineSnapshotInput = {
  phase: string;
  action: string;
  direction: string | null;
  score: number;
  thesis: string;
  headline: string;
  gates: { passed: boolean; blocks: string[] };
  as_of: string | null;
};

export type SpxEngineSnapshotRow = {
  id: number;
  observed_at: string;
  session_date: string;
  phase: string;
  action: string;
  direction: string | null;
  score: number;
  gates_passed: boolean;
  gates_blocks: unknown;
  thesis: string;
  as_of: string | null;
};

/**
 * State-transition key for the throttle in maybeLogSpxEngineSnapshot below.
 * Deliberately excludes score/thesis/headline — same reasoning as signalKey()
 * above (score/confidence/headline jitter tick-to-tick on an otherwise-
 * unchanged rejection/scan state and would defeat the throttle if included).
 * Keys only on the fields that represent an ACTUAL engine-state change: which
 * phase/action the engine is in, which direction (if any) it's leaning, and
 * exactly which gates are blocking entry right now. A direction flip with no
 * other change (e.g. bullish watch -> bearish watch) is included on purpose:
 * it's exactly the kind of transition "why was the engine scanning/watching
 * at time Y" needs to see, even though phase/action/blocks look identical.
 */
function engineSnapshotStateKey(
  snap: Pick<SpxEngineSnapshotInput, "phase" | "action" | "direction" | "gates">
): string {
  return JSON.stringify({
    phase: snap.phase,
    action: snap.action,
    direction: snap.direction,
    blocks: snap.gates.blocks,
  });
}

/**
 * Retrospective, throttled snapshot of EVERY evaluateSpxPlay tick — not just
 * committed BUY/SELL/TRIM signals (maybeLogSpxPlay above, which never even
 * looks at a rejected/scanning tick since it early-returns on any action
 * outside that allowlist). evaluateSpxPlay runs on every mutate:true poll
 * (effectively every RTH minute — see src/lib/spx-evaluator.ts's
 * runSpxEvaluator), and until this function existed, a tick that did NOT
 * commit a signal (SCANNING, WATCHING/near-miss, a gate-blocked entry, a
 * Claude veto) left zero trace anywhere once the next tick overwrote it in
 * memory — "why was the last signal rejected" or "what was the engine doing
 * at 10:15" was unanswerable after the fact. Writes into the SEPARATE
 * spx_engine_snapshots table (src/lib/db.ts) rather than widening
 * spx_signal_log's schema: a rejection/scan has no committed
 * direction/entry/premium the way a real signal does.
 *
 * THROTTLED via the SAME platform_meta-cursor idiom maybeLogSpxPlay uses
 * above (getMeta/setMeta around a state key), just keyed on
 * engineSnapshotStateKey's phase/action/direction/gates.blocks tuple instead
 * of maybeLogSpxPlay's action/direction signal key — writing unconditionally
 * here would flood Postgres with a near-duplicate row every single poll tick
 * while the engine idles in an unchanged SCANNING/WATCHING state, unlike
 * maybeLogSpxPlay (which only ever sees a handful of BUY/SELL/TRIM actions
 * per session to begin with).
 *
 * Called from evaluateSpxPlay's exported wrapper in src/lib/spx-play-
 * engine.ts via firePlayTelemetry, exactly like every other best-effort write
 * in that file — no internal try/catch, a failure here must never affect the
 * real signal shown to members.
 */
export async function maybeLogSpxEngineSnapshot(snap: SpxEngineSnapshotInput): Promise<void> {
  if (!dbConfigured()) return;

  const key = engineSnapshotStateKey(snap);
  const prev = await getMeta(ENGINE_SNAPSHOT_CURSOR_KEY);
  if (prev === key) return;

  await insertSpxEngineSnapshot({
    session_date: todayEtYmd(),
    phase: snap.phase,
    action: snap.action,
    direction: snap.direction,
    score: snap.score,
    gates_passed: snap.gates.passed,
    gates_blocks: snap.gates.blocks,
    // Prefer thesis (the richer, gate/Claude-aware explanation text) and fall back to
    // headline only when thesis is empty — mirrors how member-facing UIs already treat
    // these two SpxPlayPayload fields (thesis is the "why", headline the short label).
    thesis: snap.thesis || snap.headline,
    as_of: snap.as_of,
  });
  await setMeta(ENGINE_SNAPSHOT_CURSOR_KEY, key);
}

export async function fetchRecentSpxSnapshots(limit = 50): Promise<SpxEngineSnapshotRow[]> {
  if (!dbConfigured()) return [];
  return fetchRecentSpxEngineSnapshots(limit);
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

/**
 * SHADOW-MODE factor logging, catalyst edition — sibling of
 * logSpxShadowFactors above (same fire-and-forget call site in
 * evaluateSpxPlay, src/lib/spx-play-engine.ts), kept as its own function
 * rather than folded into logSpxShadowFactors so this PR's diff there is a
 * single new call, not a change to the flow-anomaly factor's own body. See
 * src/lib/spx-signals-shadow-catalysts.ts's module doc for the full
 * rationale (folding Benzinga catalysts into the real "Mega-caps" factor's
 * blind spot — it scores `change_pct` with no notion of WHY a leader moved).
 *
 * Fetches Benzinga catalysts per mega-cap leader ticker via the SAME
 * fetchBenzingaCatalysts (src/lib/providers/polygon.ts) every other consumer
 * uses (largo/run-tool.ts's get_catalysts tool, nights-watch/position-
 * detail.ts, nighthawk/dossier.ts) — no new provider call. Deliberately does
 * NOT add a catalyst fetch to buildSpxDesk()/SpxDeskPayload
 * (src/lib/providers/spx-desk.ts): that builder runs on every desk
 * poll/render on the member-facing hot path, while this shadow factor only
 * needs to run once per evaluateSpxPlay tick — same reason
 * logSpxShadowFactors queries flow_anomalies directly here instead of
 * threading it through desk. fetchBenzingaCatalysts is itself
 * serverCache-wrapped (TTL.NEWS, 2min) per ticker, so repeat ticks share one
 * upstream pull per ticker per window regardless of call site.
 *
 * AVAILABILITY: fetchBenzingaCatalysts swallows its own fetch errors and
 * returns [] on failure (src/lib/providers/polygon.ts), so it cannot itself
 * signal "the fetch broke" vs "no catalysts." polygonConfigured() (Benzinga
 * news is served through Polygon's /benzinga/v2/news, gated on
 * POLYGON_API_KEY) is passed as the best available "the fetch could even
 * have succeeded" proxy — see computeCatalystShadowFactors's own doc comment
 * for the honest limitation this leaves (a configured-but-transiently-
 * failing fetch still reads as "no catalysts found," same as every other
 * consumer of this fetcher today).
 */
export async function logMegaCapCatalystShadowFactors(
  desk: SpxDeskPayload,
  confluence: { score: number; grade: string }
): Promise<void> {
  if (!dbConfigured()) return;

  const leaders = desk.leader_stocks ?? [];
  const catalystFetchOk = polygonConfigured();

  let catalysts: CatalystInput[] = [];
  if (catalystFetchOk && leaders.length > 0) {
    const perTicker = await Promise.all(
      leaders.map(async (l): Promise<CatalystInput[]> => {
        const found = await fetchBenzingaCatalysts(l.ticker, 5);
        return found.map((c) => ({ ticker: l.ticker, type: c.type, title: c.title, published: c.published }));
      })
    );
    catalysts = perTicker.flat();
  }

  const observations = computeCatalystShadowFactors(desk, catalysts, catalystFetchOk);
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
 * SHADOW-MODE factor logging, precedent-search edition — sibling of
 * logSpxShadowFactors above (same fire-and-forget call site in
 * evaluateSpxPlay, src/lib/spx-play-engine.ts), kept as its own function for
 * the same "independently reviewable/revertible" reason
 * logMegaCapCatalystShadowFactors documents just above. See
 * src/lib/spx-signals-shadow-precedents.ts's module doc for the full
 * rationale: BIE's `get_similar_precedents` (src/lib/bie/precedent-search.ts)
 * finally has real graded rows to return now that
 * src/lib/bie/alert-outcome-sync.ts fixed `alert_audit_log.outcome`
 * propagation, so this is SPX Slayer's own engine asking that same
 * "has a setup like this happened before, and what happened" question about
 * its own current setup.
 *
 * Reuses Largo's own `get_similar_precedents` call shape verbatim
 * (src/lib/largo/run-tool.ts: `findSimilarPrecedents(query, 5)` —
 * PRECEDENT_SEARCH_K mirrors that `5`), just with a deterministically-built
 * query string (buildPrecedentSearchQuery) instead of one composed by an LLM
 * tool call, since this call site has no model in the loop.
 *
 * AVAILABILITY: `findSimilarPrecedents` -> `searchKnowledge()`
 * (bie/knowledge.ts) fails open to `[]` on three indistinguishable
 * conditions — DB/Voyage-embeddings not configured, a real query that found
 * nothing above the similarity floor, or an internal error — so an empty
 * result alone can't tell "not configured" apart from "genuinely nothing
 * found." `bieEmbeddingsConfigured()` (dbConfigured() is already guaranteed
 * true past the early return above) is passed as the best available "the
 * search could even have run" proxy, the same class of honest, documented
 * limitation logMegaCapCatalystShadowFactors already accepts for
 * `polygonConfigured()`/fetchBenzingaCatalysts above. The pure scorer
 * (computePrecedentShadowFactor) applies its OWN further "not enough
 * precedents yet" gate on top of this — see that function's doc for why a
 * near-empty corpus right now is expected, not broken.
 */
export async function logSpxPrecedentsShadowFactor(
  desk: SpxDeskPayload,
  confluence: { score: number; grade: string; direction: SpxPlayDirection | null }
): Promise<void> {
  if (!dbConfigured()) return;

  const searchConfirmedAvailable = bieEmbeddingsConfigured();
  const query = buildPrecedentSearchQuery(desk, confluence.direction, confluence.grade, confluence.score);
  const hits = searchConfirmedAvailable ? await findSimilarPrecedents(query, PRECEDENT_SEARCH_K) : [];

  const observations = computePrecedentShadowFactor(hits, searchConfirmedAvailable, confluence.direction);
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
