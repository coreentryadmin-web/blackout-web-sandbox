/**
 * SPX Slayer — SHADOW-MODE factor scoring, part 2: risk-reversal skew + realized-vs-implied
 * vol divergence. Sibling to src/lib/spx-signals-shadow.ts (the flow_anomalies shadow
 * factor from the framework PR, #464) — read that file's module doc first, everything it
 * says applies here unchanged:
 *
 * - computeSpxConfluence() (src/lib/spx-signals.ts) never imports this file, and this file
 *   never imports FROM spx-signals.ts's `score +=` chain — `git grep spx-signals-shadow-skew
 *   src/lib/spx-signals.ts` returns nothing, so "this cannot touch the live score" is visible
 *   by inspection, not just by test.
 * - Both factor functions below are pure: no DB reads, no fetch, no bare
 *   `Date.now()`/`new Date()` (the caller passes `now` explicitly) — structurally incapable
 *   of a side effect on the real signal. All I/O (the UW/Polygon fetches) lives in the
 *   caller, src/lib/providers/spx-signal-log.ts's `logSpxSkewShadowFactors`.
 * - Same evidence-gate rationale as the framework PR: bie/calibration.ts's MIN_EVIDENCE = 10
 *   precedent — log first, promote into the real score only after a factor_name bucket earns
 *   it via a separately-reviewed change.
 *
 * WHY A SEPARATE FILE rather than adding to spx-signals-shadow.ts: the flow_anomalies factor
 * reads a local Postgres table (cheap, no external rate limit). These two factors instead
 * call UW/Polygon HTTP APIs, which this codebase treats as a scarce, pooled resource (see
 * src/lib/providers/uw-rate-limiter.ts's "2-RPS cluster UW budget" and spx-desk.ts's
 * runUwPooled usage) — keeping the fetch/parse concerns for a genuinely different data
 * source in their own file, mirroring the 1-file-per-data-source split spx-signals.ts itself
 * doesn't have but spx-desk.ts's provider imports do (unusual-whales.ts vs polygon.ts vs
 * polygon-options-gex.ts are already separate modules for this same reason).
 *
 * DATA SOURCE + WHY NOT WIRED THROUGH SpxDeskPayload: buildSpxDesk() (spx-desk.ts) is the
 * single hot path shared by the member-facing dashboard poll (/api/market/spx/desk, ~every
 * few seconds per browser tab), the play route, AND the evaluator cron — all through the one
 * cached loadSpxDesk() lane (spx-desk-loader.ts). Adding two more forced UW/Polygon calls
 * there would tax that shared "scarce UW budget" on every consumer for a pair of factors that
 * are explicitly unproven and only need to run once per evaluateSpxPlay tick. Instead these
 * fetch directly in logSpxSkewShadowFactors, exactly like logSpxShadowFactors already fetches
 * its own flow_anomalies rows there rather than threading them through the desk payload —
 * `desk` is passed to both factor functions below only for the same forward-compat reason
 * computeShadowFactors takes it (a future factor needing spot-relative context is a body-only
 * change, not a signature change at every call site), unused today (`void desk`).
 */
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { ShadowFactorObservation } from "@/features/spx/lib/spx-signals-shadow";

/**
 * A resolved UW historical-risk-reversal-skew reading, or null when no ticker in the
 * fallback chain (SPX, then SPY — see logSpxSkewShadowFactors) returned a parseable row.
 * `risk_reversal` keeps UW's raw sign convention.
 *
 * SIGN CONVENTION (verified against LIVE UW data, not just the docstring on
 * parseLatestRiskReversalSkew): a live pull of `/api/stock/SPY/historical-risk-reversal-skew`
 * on 2026-07-04 returned 29 daily 25-delta rows spanning 2026-05-21..2026-07-02, EVERY ONE
 * positive (range +0.0067 to +0.0663, e.g. `{"date":"2026-07-02","delta":25,
 * "risk_reversal":"0.0663361729210146"}`). A "calls IV minus puts IV" definition would be
 * predominantly NEGATIVE for an equity index — the persistent put-side skew/crash-premium
 * ("volatility smirk") is one of the most robust stylized facts in index options, so a
 * multi-week run of positive values under that definition would be the anomaly, not the
 * norm. That confirms UW's `risk_reversal` here is effectively (put IV − call IV): positive
 * = puts bid over calls = fear/hedging demand, matching src/lib/nighthawk/vol-metrics.ts's
 * `parseLatestRiskReversalSkew` docstring — NOT src/lib/nighthawk/scorer.ts's
 * `scoreSkewConfirmation` comment ("positive = calls bid over puts = bullish"), which this
 * investigation surfaced as inverted relative to the live data. That NightHawk scorer.ts
 * function is a separate subsystem (ticker candidate scoring, not SPX 0DTE confluence) and
 * out of scope for this PR to change — logged as its own finding in docs/audit/FINDINGS.md
 * for a follow-up fix, not bundled here.
 */
export type RiskReversalSkewReading = {
  ticker: "SPX" | "SPY";
  /** YYYY-MM-DD (or whatever UW's `date` field carries) for the staleness check below. */
  date: string;
  risk_reversal: number;
} | null;

/**
 * A resolved realized-vs-implied vol reading. Both values are annualized decimals (0.15 =
 * 15%), the same unit fetchPolygonRealizedVol already returns and fetchPolygonIvTermStructure
 * already returns (avg_iv) — so `implied_vol - realized_vol` is a direct vol-point spread,
 * no unit conversion needed.
 *
 * `as_of_date`: null when sourced live from Polygon (computed fresh on every call from
 * recent bars / the current options snapshot — no historical-row staleness concept applies).
 * A date string when sourced from the UW `volatility/realized` fallback (a once-daily
 * historical series, per date-stamped rows) — checked against `now` the same way the skew
 * reading is.
 */
export type VolDivergenceReading = {
  source: "polygon" | "unusual_whales";
  as_of_date: string | null;
  realized_vol: number;
  implied_vol: number;
} | null;

/**
 * Historical daily UW series (risk-reversal skew, and the realized/implied vol fallback) —
 * how old the latest row can be before it's treated as stale rather than a real neutral
 * reading. 5 CALENDAR days covers a 3-day holiday weekend (e.g. Fri close -> Tue open) plus
 * up to a 1-day UW processing lag plus one buffer day. Provisional/tunable like every other
 * constant in this file — there's no existing precedent in this codebase for a once-daily
 * (as opposed to intraday/WS) feed staleness window to anchor to, unlike
 * spx-signals-shadow.ts's ANOMALY_WINDOW_MS which could reuse scoreHelixFlowAlignment's.
 */
const HISTORICAL_ROW_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

function rowIsFresh(dateStr: string, now: number): boolean {
  const ms = Date.parse(dateStr);
  if (!Number.isFinite(ms)) return false;
  const age = now - ms;
  return age >= 0 && age <= HISTORICAL_ROW_MAX_AGE_MS;
}

/**
 * Provisional weight tiers shared by both factors in this file — anchored to two REAL named
 * factors already in spx-signals.ts's own `score +=` chain (same anchoring approach
 * spx-signals-shadow.ts's SEVERITY_WEIGHT uses): "IV rank" (±4, a mild vol-positioning read)
 * for the moderate tier, and "VIX curve" backwardation (±8, "elevated near-term fear") for
 * the extreme tier. Deliberately did NOT copy VIX curve's real asymmetry (−8 fear / +4 calm)
 * for the vol-divergence factor below — that asymmetry was calibrated to VIX9D-vs-VIX3M
 * backwardation/contango specifically, and reusing it here for a differently-shaped
 * RV-vs-IV spread would be an arbitrary transplant, not a reasoned anchor. Both tiers here
 * are kept symmetric until real evidence (bie/calibration.ts's n>=10 bar) says otherwise.
 */
const MODERATE_WEIGHT = 4;
const EXTREME_WEIGHT = 8;

/**
 * Skew-magnitude thresholds, in UW's raw `risk_reversal` units — anchored to the actual live
 * SPY sample this file's module doc cites (29 daily rows, +0.0067 to +0.0663, clustering
 * around ~0.02-0.035). FLAT_BAND sits just below the observed sample minimum (a reading this
 * small is indistinguishable from the "normal, quiet" baseline this ticker has shown
 * recently); EXTREME sits comfortably above the observed sample max (a reading this large
 * would be a genuine outlier against the same window). Explicitly a single-ticker,
 * single-window empirical anchor, not a backtest — exactly why this stays in shadow mode.
 */
const SKEW_FLAT_BAND = 0.01;
const SKEW_EXTREME = 0.05;

/**
 * Vol-divergence thresholds, in annualized-decimal vol points (0.02 = 2 vol points).
 * Anchored the same way: a live SPX pull for this same investigation showed
 * implied_volatility 0.131 vs realized_volatility 0.087 (a 4.4-point spread) on a single
 * sampled date — comfortably inside the "moderate" tier below, which is the point: this
 * threshold set is deliberately conservative (a spread has to clear a full extra 3 points
 * beyond that single observed sample to hit EXTREME) rather than tuned to flag that one
 * sample as already extreme.
 */
const VOL_DIVERGENCE_FLAT_BAND = 0.02;
const VOL_DIVERGENCE_EXTREME = 0.05;

/**
 * Shadow-score UW's historical risk-reversal skew (25-delta, SPX-then-SPY — see this file's
 * module doc for the sign convention and its live-data derivation). A meaningful divergence
 * from flat implies directional options positioning: elevated put-side skew (fear/hedging
 * demand) scores bearish, elevated call-side skew (complacency/call-buying demand) scores
 * bullish. `desk` is accepted-but-unused for the same forward-compat reason
 * computeShadowFactors takes it (see module doc).
 *
 * STALENESS GUARD: `reading` is null (no ticker in the fallback chain returned data) OR its
 * `date` is older than HISTORICAL_ROW_MAX_AGE_MS -> available:false. Both collapse to the
 * SAME observation so a dead/broken UW read can never be recorded as a confirmed "flat skew"
 * zero (the same "never conflate missing with neutral" rule as flow_anomaly_watch).
 *
 * @param now injectable clock (defaults to Date.now()), purely for deterministic tests.
 */
export function computeSkewShadowFactor(
  desk: SpxDeskPayload,
  reading: RiskReversalSkewReading,
  now: number = Date.now()
): ShadowFactorObservation {
  void desk;

  if (!reading || !rowIsFresh(reading.date, now)) {
    return {
      factor_name: "risk_reversal_skew",
      available: false,
      implied_weight: 0,
      direction: "neutral",
      detail: !reading
        ? "UW historical-risk-reversal-skew returned no data for SPX or SPY — cannot distinguish 'flat skew' from 'feed down'"
        : `UW historical-risk-reversal-skew's latest row (${reading.date}) is older than the ${HISTORICAL_ROW_MAX_AGE_MS / 86_400_000}-day freshness window`,
    };
  }

  const { ticker, date, risk_reversal: skew } = reading;
  const magnitude = Math.abs(skew);

  if (magnitude < SKEW_FLAT_BAND) {
    return {
      factor_name: "risk_reversal_skew",
      available: true,
      implied_weight: 0,
      direction: "neutral",
      detail: `${ticker} 25-delta risk reversal ${skew.toFixed(4)} (${date}) — inside the flat band, no meaningful put/call skew`,
    };
  }

  // Positive UW risk_reversal = puts bid over calls = fear = bearish tilt; negative = calls
  // bid over puts = bullish tilt. See module doc for the live-data sign derivation.
  const direction: ShadowFactorObservation["direction"] = skew > 0 ? "bearish" : "bullish";
  const tierWeight = magnitude >= SKEW_EXTREME ? EXTREME_WEIGHT : MODERATE_WEIGHT;
  const weight = direction === "bearish" ? -tierWeight : tierWeight;

  return {
    factor_name: "risk_reversal_skew",
    available: true,
    implied_weight: weight,
    direction,
    detail: `${ticker} 25-delta risk reversal ${skew > 0 ? "+" : ""}${skew.toFixed(4)} (${date}) — ${
      direction === "bearish" ? "put-side skew (fear)" : "call-side skew (complacency)"
    } [shadow: not scored]`,
  };
}

/**
 * Shadow-score realized-vs-implied vol divergence (see this file's module doc for the primary
 * Polygon / fallback UW source and unit contract). Mirrors spx-signals.ts's real "VIX curve"
 * factor's regime framing: richer-than-realized implied vol reads as an elevated-fear regime
 * (bearish tilt, same direction VIX backwardation scores), cheaper-than-realized implied vol
 * reads as a calm/complacent regime (bullish tilt, same direction VIX contango scores) — see
 * MODERATE_WEIGHT/EXTREME_WEIGHT's doc for why the magnitude is NOT copied from VIX curve's
 * asymmetric ±8/+4.
 *
 * STALENESS GUARD: `reading` is null (both Polygon and the UW fallback failed to produce a
 * usable pair) -> available:false. A UW-sourced reading additionally checks `as_of_date`
 * against HISTORICAL_ROW_MAX_AGE_MS (a Polygon-sourced reading has no `as_of_date` — it's
 * computed live on every call, so no staleness check applies).
 */
export function computeVolDivergenceShadowFactor(
  desk: SpxDeskPayload,
  reading: VolDivergenceReading,
  now: number = Date.now()
): ShadowFactorObservation {
  void desk;

  if (!reading || (reading.as_of_date != null && !rowIsFresh(reading.as_of_date, now))) {
    return {
      factor_name: "realized_vs_implied_vol",
      available: false,
      implied_weight: 0,
      direction: "neutral",
      detail: !reading
        ? "Realized/implied vol unavailable from both Polygon and the UW fallback — cannot distinguish 'no divergence' from 'feed down'"
        : `UW realized/implied vol fallback's latest row (${reading.as_of_date}) is older than the ${HISTORICAL_ROW_MAX_AGE_MS / 86_400_000}-day freshness window`,
    };
  }

  const { source, realized_vol: rv, implied_vol: iv } = reading;
  const spread = iv - rv;
  const magnitude = Math.abs(spread);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  if (magnitude < VOL_DIVERGENCE_FLAT_BAND) {
    return {
      factor_name: "realized_vs_implied_vol",
      available: true,
      implied_weight: 0,
      direction: "neutral",
      detail: `[${source}] IV ${pct(iv)} vs RV ${pct(rv)} — inside the flat band, premium fairly priced to realized movement`,
    };
  }

  // Implied richer than realized (spread > 0) = elevated fear/hedging premium, same regime
  // VIX backwardation scores bearish. Implied cheaper than realized (spread < 0) = calm,
  // same regime VIX contango scores bullish.
  const direction: ShadowFactorObservation["direction"] = spread > 0 ? "bearish" : "bullish";
  const tierWeight = magnitude >= VOL_DIVERGENCE_EXTREME ? EXTREME_WEIGHT : MODERATE_WEIGHT;
  const weight = direction === "bearish" ? -tierWeight : tierWeight;

  return {
    factor_name: "realized_vs_implied_vol",
    available: true,
    implied_weight: weight,
    direction,
    detail: `[${source}] IV ${pct(iv)} vs RV ${pct(rv)} — ${
      direction === "bearish" ? "implied running rich (fear premium)" : "implied running cheap (complacent)"
    } [shadow: not scored]`,
  };
}
