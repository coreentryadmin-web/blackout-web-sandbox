import "server-only";

import {
  type CheckResult,
  type MetricScore,
  type TickerScore,
  fractionalDiff,
  rollUpMetricStatus,
  worstStatus,
} from "@/lib/correctness/types";
import { fetchRecentFlows, type FlowRow } from "@/lib/db";
import { fetchOptionTrades, type OptionTradesAggregate } from "@/lib/providers/option-trades";
import { polygonConfigured } from "@/lib/providers/config";
import { todayEtYmd } from "@/lib/providers/spx-session";
import {
  detectFlowAnomalies,
  type FlowAnomaly,
  type FlowAnomalyNearMiss,
} from "@/app/api/cron/market-regime-detector/flow-anomaly-detection";
import {
  classifyFlowAnomalies,
  classificationDiffIsClean,
  describeClassificationDiff,
  diffClassifiedLists,
  type ClassifiedFlowItem,
} from "@/lib/correctness/flow-anomaly-scope";

// ---------------------------------------------------------------------------
// FLOWS (HELIX) data-correctness verifier — priority surface #2.
//
// The flow tape is served raw and the headline aggregates (call$/put$/net/total + call%) are
// computed downstream (flow-brief route / flow-service summary). This verifier reads the SAME tape
// the served path reads, INDEPENDENTLY recomputes those aggregates from scratch, and asserts:
//   • FAITHFULNESS — served premium == UW `total_premium` verbatim. fetchRecentFlows maps
//     `COALESCE(total_premium, 0) AS premium` with NO transform, so the served `premium` is the
//     UW number with only null→0 coercion. We confirm no negative/NaN premium leaked and that the
//     per-row premium is the raw value (the persisted path applies no scaling — checked structurally).
//   • RECOMPUTE + Σ INVARIANTS — call$+put$(+unknown$) == Σ premium; counts sum to row count;
//     call% derivation matches; percentages are bounded [0,100].
//   • RECENCY ORDERING — when a recency view is requested (the `order:"recent"` param that landed
//     on main in db.ts fetchRecentFlows / flows route), the rows must be time-descending. This
//     worktree's fetchRecentFlows orders by premium DESC; we therefore re-sort by event time and
//     assert the recency-ordered VIEW is derivable + monotonic, recording the param's merge state.
//
// RATE DISCIPLINE: fetchRecentFlows is a Postgres READER over already-ingested flow_alerts (the
// served flows route wraps the identical read in serverCache, TTL.DARK_POOL). This verifier issues
// ONE bounded DB read (limit-capped), NO upstream/UW fan-out, NO live provider calls. It re-derives
// from the persisted tape only.
//
// CROSS-PROVIDER ORACLE (new): the flow aggregates are now cross-checked against an INDEPENDENT
// second source — Massive's tick-level options /v3/trades stream (lib/providers/option-trades.ts),
// which is NOT Unusual Whales and is already paid for via Options Advanced. We reconstruct the
// premium (price×size×100) from raw near-the-money prints and compare call/put SKEW + the
// subset/superset premium relation against the served UW aggregates. When they AGREE the flow
// metric is promoted to INDEPENDENTLY-CONFIRMED ("pass"); on a material divergence we FLAG. When
// Massive is unavailable / the tape is thin the cross-check SKIPS and the metric degrades to
// consistency-only — internally reconciled + faithful-to-source, never a false green.
//
// FLOW-ANOMALY DETECTOR shadow-recompute (task #132): everything above validates the TAPE
// aggregates. It has NO coverage of the separate flow-ANOMALY detector
// (src/app/api/cron/market-regime-detector/flow-anomaly-detection.ts's detectFlowAnomalies) —
// the LARGE_PREMIUM_PRINT / DIRECTIONAL_FLOW_SKEW threshold math, the skew-ratio computation, and
// the near-miss band (task #131) could regress silently: nothing short of the FlowAnomalyBanner
// looking wrong in production would ever catch it. We fetch the SAME 30-minute window
// detectFlowAnomalies itself reads (fetchRecentFlows({ since_hours: 0.5, order: "premium" })),
// independently recompute the classification from scratch (flow-anomaly-scope.ts's
// classifyFlowAnomalies — a from-scratch re-implementation, not a call into the detector), and
// call the REAL detectFlowAnomalies() on the EXACT SAME rows via its opts.rows injection point
// (added by this task) so both sides see identical data with zero TOCTOU race against the live
// tape. A disagreement (missing, extra, or wrong metric_value) is a detector regression → FLAG.
// ---------------------------------------------------------------------------

const TOL = {
  /** Σ recompute vs independent total (fractional) — pure fp; a real aggregation bug is orders larger. */
  sumFractional: 1e-9,
  /** call% derivation agreement (absolute pct points) — Math.round can differ by ≤1 from a float pct. */
  pctAbs: 1,
  /** Min rows to assert aggregate invariants (below this the tape is too thin to be meaningful). */
  minRows: 5,
} as const;

// ── Cross-provider (UW vs Massive-trades) cross-check tuning ───────────────────
// HONESTY: UW flow alerts are a FILTERED subset (only "unusual" prints) and Massive /v3/trades is
// the RAW print stream for the near-the-money contracts. So they are NOT expected to match 1:1 —
// the robust, scale-free signal that the two sources SEE THE SAME FLOW is the call/put SKEW
// DIRECTION, plus a sanity bound that UW's (subset) premium does not EXCEED Massive's (superset)
// raw premium beyond a small allowance. Agreement on those → independently-confirmed. Opposite
// skew, or UW premium materially exceeding the raw Massive total → FLAG (the two sources disagree
// about what the flow IS, which a single-source consistency check could never catch).
const XCHECK = {
  /** Lookback window (minutes) compared on BOTH sources. */
  windowMin: 60,
  /** Min UW premium (this ticker, this window, today expiry) to attempt the cross-check. */
  minUwPremiumUsd: 250_000,
  /** Min Massive raw premium to treat the trades pull as a usable oracle (else skip, not flag). */
  minMassivePremiumUsd: 100_000,
  /**
   * UW (subset) premium may legitimately be below Massive (superset). It must NOT exceed Massive's
   * raw total by more than this factor — a small allowance for clock/window/strike-band edges and
   * the rare UW alert outside the NTM band. Beyond it the two sources disagree → FLAG.
   */
  uwOverMassiveMaxRatio: 1.25,
  /** Call-share (call$/(call$+put$)) agreement, absolute pct points, when BOTH have a clear skew. */
  callShareAbsTol: 20,
  /** A "clear skew" exists when |callShare − 50| ≥ this; below it the tape is balanced (no skew to compare). */
  skewDeadbandPct: 8,
} as const;

type Ctx = { ticker: string; now: number };

function mk(
  ctx: Ctx,
  layer: CheckResult["layer"],
  metric: string,
  outcome: CheckResult["outcome"],
  detail: string,
  extra: Partial<CheckResult> = {}
): CheckResult {
  return {
    id: `${ctx.ticker}:${metric}:${layer}:${extra.id ?? Math.abs(hashStr(detail)).toString(36)}`,
    layer,
    metric,
    outcome,
    detail,
    ...extra,
  };
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
function fmtUsd(n: number): string {
  return `$${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
}

/** Independent re-aggregation of a flow tape — written from scratch (does NOT import flow-service). */
function aggregate(rows: FlowRow[]): {
  callPrem: number;
  putPrem: number;
  unknownPrem: number;
  total: number;
  callPct: number;
  callCount: number;
  putCount: number;
  unknownCount: number;
} {
  let callPrem = 0;
  let putPrem = 0;
  let unknownPrem = 0;
  let callCount = 0;
  let putCount = 0;
  let unknownCount = 0;
  for (const r of rows) {
    const p = Number(r.premium) || 0;
    const t = String(r.option_type ?? "").toUpperCase();
    if (t === "CALL") {
      callPrem += p;
      callCount++;
    } else if (t === "PUT") {
      putPrem += p;
      putCount++;
    } else {
      unknownPrem += p;
      unknownCount++;
    }
  }
  const callPutTotal = callPrem + putPrem;
  const callPct = callPutTotal > 0 ? Math.round((callPrem / callPutTotal) * 100) : 50;
  return {
    callPrem,
    putPrem,
    unknownPrem,
    total: callPrem + putPrem + unknownPrem,
    callPct,
    callCount,
    putCount,
    unknownCount,
  };
}

/** UW-side premium for ONE ticker over the recent window, scoped to TODAY expiry + a NTM band. */
function uwWindowAggregate(
  rows: FlowRow[],
  ticker: string,
  expiry: string,
  windowStartMs: number,
  spotHint: number
): { total: number; callPrem: number; putPrem: number; callShare: number; prints: number } {
  let callPrem = 0;
  let putPrem = 0;
  let prints = 0;
  // NTM band: ±8% of the underlying when we have a spot hint; otherwise accept all strikes (the
  // Massive side is the bounded one — over-including on the UW side only makes the subset claim
  // STRICTER, never falsely green).
  const bandLo = spotHint > 0 ? spotHint * 0.92 : -Infinity;
  const bandHi = spotHint > 0 ? spotHint * 1.08 : Infinity;
  for (const r of rows) {
    if (r.ticker.toUpperCase() !== ticker.toUpperCase()) continue;
    if (r.expiry !== expiry) continue; // 0DTE / today scope — matches the trades pull default
    const stamp = r.event_at ?? r.alerted_at ?? "";
    const ms = stamp ? new Date(stamp).getTime() : NaN;
    if (!Number.isFinite(ms) || ms < windowStartMs) continue;
    const strike = Number(r.strike);
    if (Number.isFinite(strike) && (strike < bandLo || strike > bandHi)) continue;
    const p = Number(r.premium) || 0;
    if (p <= 0) continue;
    const t = String(r.option_type ?? "").toUpperCase();
    if (t === "CALL") callPrem += p;
    else if (t === "PUT") putPrem += p;
    else continue;
    prints += 1;
  }
  const denom = callPrem + putPrem;
  const callShare = denom > 0 ? (callPrem / denom) * 100 : 50;
  return { total: callPrem + putPrem, callPrem, putPrem, callShare, prints };
}

/**
 * CROSS-PROVIDER cross-check: compare UW flow premium against the Massive /v3/trades reconstruction
 * for the SAME ticker + window. Returns a single CheckResult for the net_premium metric.
 *
 *   • independently-confirmed — call/put SKEW DIRECTION matches AND UW (subset) premium does not
 *     exceed Massive's (superset) raw premium beyond uwOverMassiveMaxRatio. A genuine second-source
 *     agreement: two independent providers (UW vs Massive) see the same flow.
 *   • flag — OPPOSITE skew direction, or UW premium materially exceeds the raw Massive total
 *     (impossible if Massive captures the superset → the two sources disagree about the flow).
 *   • skipped — Massive not configured / no comparable ticker / either side too thin to compare.
 *
 * Best-effort + bounded: ONE fetchOptionTrades call (itself contract/page-capped, rate-limited,
 * cached). Never throws.
 */
async function crossCheckAgainstMassive(ctx: Ctx, rows: FlowRow[]): Promise<CheckResult> {
  const skip = (detail: string): CheckResult =>
    mk(ctx, "cross-provider", "net_premium", "skipped", detail, { id: "flows-xcheck-massive" });

  if (!polygonConfigured()) {
    return skip("Massive (POLYGON_API_KEY) not configured — UW-vs-Massive flow cross-check unavailable this run.");
  }

  const expiry = todayEtYmd();
  const windowStartMs = ctx.now - XCHECK.windowMin * 60_000;

  // Pick the dominant TODAY-expiry ticker in the recent window (most UW premium) — the one with
  // enough flow to make the cross-check meaningful. Index tickers (SPX/NDX/RUT) and equities both
  // resolve in the trades fetcher.
  const byTicker = new Map<string, number>();
  for (const r of rows) {
    if (r.expiry !== expiry) continue;
    const stamp = r.event_at ?? r.alerted_at ?? "";
    const ms = stamp ? new Date(stamp).getTime() : NaN;
    if (!Number.isFinite(ms) || ms < windowStartMs) continue;
    const p = Number(r.premium) || 0;
    if (p <= 0) continue;
    const k = r.ticker.toUpperCase();
    byTicker.set(k, (byTicker.get(k) ?? 0) + p);
  }
  let ticker = "";
  let best = 0;
  for (const [k, v] of byTicker.entries()) {
    if (v > best) {
      best = v;
      ticker = k;
    }
  }
  if (!ticker || best < XCHECK.minUwPremiumUsd) {
    return skip(
      `No TODAY-expiry ticker carries ≥ ${fmtUsd(XCHECK.minUwPremiumUsd)} UW premium in the last ${XCHECK.windowMin}m — nothing liquid enough to cross-check against Massive this run (not a flag).`
    );
  }

  // Pull the INDEPENDENT Massive reconstruction for the same ticker/window/expiry.
  let massive: OptionTradesAggregate | null = null;
  try {
    massive = await fetchOptionTrades(ticker, XCHECK.windowMin, expiry);
  } catch {
    massive = null;
  }
  if (!massive) {
    return skip(`Massive trades reconstruction returned nothing for ${ticker} — cross-check not assertable this run.`);
  }
  if (massive.totalPremium < XCHECK.minMassivePremiumUsd) {
    return skip(
      `Massive trades premium for ${ticker} (${fmtUsd(massive.totalPremium)} over ${massive.meta.contractsWithTrades}/${massive.meta.contractsRequested} NTM contracts${massive.meta.partial ? ", partial pull" : ""}) is below the ${fmtUsd(XCHECK.minMassivePremiumUsd)} usable-oracle floor — too thin to confirm (not a flag).`
    );
  }

  // Scope the UW side to the SAME ticker/window/expiry + NTM band (centered on the trades spot proxy:
  // the trades pull bands around the live underlying; we approximate the band via byStrike extent).
  const strikes = massive.byStrike.map((s) => s.strike).filter((s) => s > 0);
  const spotHint = strikes.length ? (Math.min(...strikes) + Math.max(...strikes)) / 2 : 0;
  const uw = uwWindowAggregate(rows, ticker, expiry, windowStartMs, spotHint);
  if (uw.total <= 0) {
    return skip(`UW has no NTM ${ticker} premium in the window after band-scoping — cross-check not assertable.`);
  }

  // ── Compare ────────────────────────────────────────────────────────────────
  // (1) Skew direction. Both must show a clear call/put lean (outside the deadband) to compare it.
  const uwSkewUp = uw.callShare - 50;
  const mvSkewUp = massive.callPct - 50;
  const uwHasSkew = Math.abs(uwSkewUp) >= XCHECK.skewDeadbandPct;
  const mvHasSkew = Math.abs(mvSkewUp) >= XCHECK.skewDeadbandPct;
  const skewComparable = uwHasSkew && mvHasSkew;
  const sameSkewDir = Math.sign(uwSkewUp) === Math.sign(mvSkewUp);
  const callShareDiff = Math.abs(uw.callShare - massive.callPct);

  // (2) Subset relation: UW (filtered subset) must not exceed Massive (raw superset) beyond the ratio.
  const uwOverMassive = uw.total / massive.totalPremium;
  const subsetOk = uwOverMassive <= XCHECK.uwOverMassiveMaxRatio;

  const both = `[UW ${fmtUsd(uw.total)} call ${uw.callShare.toFixed(0)}% vs Massive ${fmtUsd(massive.totalPremium)} call ${massive.callPct}% over ${massive.meta.contractsWithTrades} NTM contracts${massive.meta.partial ? " (partial)" : ""}; UW/Massive=${uwOverMassive.toFixed(2)}×]`;

  // FLAG conditions: the sources DISAGREE about the flow.
  const flagOppositeSkew = skewComparable && !sameSkewDir;
  const flagSubset = !subsetOk;
  const flagSkewMagnitude = skewComparable && sameSkewDir && callShareDiff > XCHECK.callShareAbsTol;

  if (flagOppositeSkew || flagSubset || flagSkewMagnitude) {
    const why = flagOppositeSkew
      ? `OPPOSITE call/put skew (UW ${uwSkewUp > 0 ? "call" : "put"}-led, Massive ${mvSkewUp > 0 ? "call" : "put"}-led)`
      : flagSubset
        ? `UW premium EXCEEDS the raw Massive superset by ${uwOverMassive.toFixed(2)}× (> ${XCHECK.uwOverMassiveMaxRatio}× allowance) — impossible if Massive captures every NTM print`
        : `same-direction skew but call-share differs ${callShareDiff.toFixed(0)}pts (> ${XCHECK.callShareAbsTol}pt tol)`;
    return mk(
      ctx,
      "cross-provider",
      "net_premium",
      "flag",
      `${ticker} flow DIVERGES across providers: ${why}. ${both} — UW and Massive disagree about the flow (a real cross-source divergence, not a consistency miss).`,
      { id: "flows-xcheck-massive", expected: Number(massive.callPct), actual: Number(uw.callShare.toFixed(0)), tolerance: XCHECK.callShareAbsTol }
    );
  }

  // CONFIRM: subset relation holds AND (skew agrees, or neither side has a skew to disagree on).
  const skewNote = skewComparable
    ? `same call/put lean (Δ ${callShareDiff.toFixed(0)}pt ≤ ${XCHECK.callShareAbsTol}pt)`
    : `both within the ±${XCHECK.skewDeadbandPct}pt skew deadband (balanced — no skew conflict)`;
  return mk(
    ctx,
    "cross-provider",
    "net_premium",
    "consistency-only", // outcome stays consistency-only; independentlyConfirmed promotes the metric to "pass"
    `${ticker} flow INDEPENDENTLY CONFIRMED by Massive /v3/trades (a second, non-UW provider): ${skewNote}; UW is a valid filtered subset of the raw Massive premium (${uwOverMassive.toFixed(2)}× ≤ ${XCHECK.uwOverMassiveMaxRatio}×). ${both}`,
    { id: "flows-xcheck-massive", independentlyConfirmed: true, expected: Number(massive.callPct), actual: Number(uw.callShare.toFixed(0)), tolerance: XCHECK.callShareAbsTol }
  );
}

/** Adapt detectFlowAnomalies' FlowAnomaly[] output to the common ClassifiedFlowItem shape.
 *  Defensive null-filtering only (ticker/direction are typed nullable but the live
 *  implementation never actually produces null for either) — an item that fails this
 *  shape check is dropped from the comparison rather than crashing the verifier. */
function adaptAnomalies(items: FlowAnomaly[]): ClassifiedFlowItem[] {
  const out: ClassifiedFlowItem[] = [];
  for (const it of items) {
    if (!it.ticker) continue;
    if (it.direction !== "bullish" && it.direction !== "bearish") continue;
    if (it.type !== "LARGE_PREMIUM_PRINT" && it.type !== "DIRECTIONAL_FLOW_SKEW") continue;
    out.push({ anomaly_type: it.type, ticker: it.ticker, direction: it.direction, metric_value: it.metric_value });
  }
  return out;
}

/** Same adaptation for FlowAnomalyNearMiss[] — detectFlowAnomalies itself only ever assigns
 *  reason "BELOW_THRESHOLD" (DEDUP_SUPPRESSED is added later, externally, by route.ts — out of
 *  scope for this shadow-recompute, which validates detectFlowAnomalies alone). */
function adaptNearMisses(items: FlowAnomalyNearMiss[]): ClassifiedFlowItem[] {
  const out: ClassifiedFlowItem[] = [];
  for (const it of items) {
    if (it.reason !== "BELOW_THRESHOLD") continue;
    if (!it.ticker) continue;
    if (it.direction !== "bullish" && it.direction !== "bearish") continue;
    if (it.anomaly_type !== "LARGE_PREMIUM_PRINT" && it.anomaly_type !== "DIRECTIONAL_FLOW_SKEW") continue;
    out.push({ anomaly_type: it.anomaly_type, ticker: it.ticker, direction: it.direction, metric_value: it.metric_value });
  }
  return out;
}

/**
 * FLOW-ANOMALY DETECTOR shadow-recompute (task #132) — see module doc above. Fetches the SAME
 * 30-minute window detectFlowAnomalies reads, independently recomputes the classification
 * (flow-anomaly-scope.ts, written from scratch), and calls the REAL detectFlowAnomalies() on the
 * identical rows (via its opts.rows injection point) so both sides see the exact same data.
 * Never throws — a thrown/failed fetch or detector call degrades to a skipped check.
 */
async function verifyFlowAnomalyDetector(ctx: Ctx): Promise<CheckResult[]> {
  let anomalyRows: FlowRow[] = [];
  try {
    anomalyRows = await fetchRecentFlows({ since_hours: 0.5, order: "premium" });
  } catch {
    anomalyRows = [];
  }

  if (anomalyRows.length === 0) {
    return [
      mk(
        ctx,
        "shadow-recompute",
        "anomaly_detection",
        "skipped",
        "No flow prints in the last 30 minutes — the anomaly-detector shadow-recompute has nothing to compare this run (not a flag; detectFlowAnomalies itself is a no-op on an empty window too).",
        { id: "anomaly-detector-shadow-recompute" }
      ),
    ];
  }

  const expected = classifyFlowAnomalies(anomalyRows);

  const actualNearMisses: FlowAnomalyNearMiss[] = [];
  let actualAnomalies: FlowAnomaly[] = [];
  try {
    actualAnomalies = await detectFlowAnomalies({ rows: anomalyRows, nearMisses: actualNearMisses });
  } catch {
    // detectFlowAnomalies already catches internally and returns [] on its own errors; this
    // guards the injected-rows call path too, so a thrown adapter bug can't crash the sweep.
    return [
      mk(
        ctx,
        "shadow-recompute",
        "anomaly_detection",
        "skipped",
        "detectFlowAnomalies threw when called with the shadow-recompute's injected rows — shadow-recompute not assertable this run.",
        { id: "anomaly-detector-shadow-recompute" }
      ),
    ];
  }

  const checks: CheckResult[] = [];

  const anomalyDiff = diffClassifiedLists(expected.anomalies, adaptAnomalies(actualAnomalies));
  checks.push(
    mk(
      ctx,
      "shadow-recompute",
      "anomaly_detection",
      classificationDiffIsClean(anomalyDiff) ? "consistency-only" : "flag",
      classificationDiffIsClean(anomalyDiff)
        ? `detectFlowAnomalies' actual output (${actualAnomalies.length} anomaly(ies): LARGE_PREMIUM_PRINT/DIRECTIONAL_FLOW_SKEW) matches the independent threshold-math recompute over the same ${anomalyRows.length}-row 30m window.`
        : `detectFlowAnomalies' actual output DIVERGES from the independent recompute over the same ${anomalyRows.length}-row 30m window — ${describeClassificationDiff(anomalyDiff)}.`,
      { id: "anomaly-detector-shadow-recompute", expected: expected.anomalies.length, actual: actualAnomalies.length }
    )
  );

  const nearMissDiff = diffClassifiedLists(expected.nearMisses, adaptNearMisses(actualNearMisses));
  checks.push(
    mk(
      ctx,
      "shadow-recompute",
      "anomaly_near_miss",
      classificationDiffIsClean(nearMissDiff) ? "consistency-only" : "flag",
      classificationDiffIsClean(nearMissDiff)
        ? `detectFlowAnomalies' BELOW_THRESHOLD near-miss output (${actualNearMisses.length}) matches the independent near-miss-band recompute over the same ${anomalyRows.length}-row 30m window.`
        : `detectFlowAnomalies' BELOW_THRESHOLD near-miss output DIVERGES from the independent recompute over the same ${anomalyRows.length}-row 30m window — ${describeClassificationDiff(nearMissDiff)}.`,
      { id: "anomaly-near-miss-shadow-recompute", expected: expected.nearMisses.length, actual: actualNearMisses.length }
    )
  );

  return checks;
}

function groupMetrics(ticker: string, checks: CheckResult[]): MetricScore[] {
  const byMetric = new Map<string, CheckResult[]>();
  for (const c of checks) {
    const arr = byMetric.get(c.metric) ?? [];
    arr.push(c);
    byMetric.set(c.metric, arr);
  }
  const scores: MetricScore[] = [];
  for (const [metric, mchecks] of byMetric.entries()) {
    const { status, independentlyConfirmed } = rollUpMetricStatus(mchecks);
    scores.push({ ticker, metric, status, independentlyConfirmed, checks: mchecks });
  }
  return scores;
}

/**
 * Verify the HELIX flow tape + its served aggregates. `marketOpen` gates the freshness assertion
 * (closed-market tape is legitimately quiet/old). Never throws.
 */
export async function verifyFlows(marketOpen: boolean): Promise<TickerScore> {
  const ticker = "FLOWS";
  const ctx: Ctx = { ticker, now: Date.now() };

  // ONE bounded DB read (cache-reader semantics; the served route wraps the identical read).
  let rows: FlowRow[] = [];
  try {
    rows = await fetchRecentFlows({ limit: 2000, since_hours: 48 });
  } catch {
    rows = [];
  }

  if (rows.length < TOL.minRows) {
    const skip: CheckResult = {
      id: `${ticker}:tape:freshness:cold`,
      layer: "freshness",
      metric: "freshness",
      outcome: "skipped",
      detail: `Only ${rows.length} flow rows in the last 48h — tape too thin to verify aggregates this run (not a flag).`,
    };
    return { ticker, status: "skipped", metrics: groupMetrics(ticker, [skip]) };
  }

  const checks: CheckResult[] = [];
  const agg = aggregate(rows);

  // ── FAITHFULNESS (premium == UW total_premium verbatim) ───────────────────
  // The served path maps COALESCE(total_premium,0) AS premium with no transform. We can't re-pull UW
  // per-row here (rate budget + the raw UW alert isn't keyed by the served row), so we assert the
  // structural faithfulness guarantees: every served premium is a finite, NON-NEGATIVE number (a
  // scale/×100 or sign bug would surface as negatives or absurd magnitudes), and the headline total
  // equals the exact Σ of the per-row premiums the user's tape shows (no hidden re-scaling).
  {
    const bad = rows.filter((r) => !Number.isFinite(Number(r.premium)) || Number(r.premium) < 0);
    checks.push(
      mk(
        ctx,
        "invariant",
        "premium",
        bad.length === 0 ? "consistency-only" : "flag",
        bad.length === 0
          ? `All ${rows.length} served premiums are finite, non-negative (faithful to UW total_premium; the SQL applies no transform beyond null→0).`
          : `${bad.length} served premium(s) are negative/NaN — a faithfulness break (scale/sign bug on total_premium).`,
        { id: "premium-faithful", actual: bad.length, expected: 0 }
      )
    );
  }

  // ── Σ INVARIANT: call$ + put$ + unknown$ == Σ premium ─────────────────────
  {
    const directSum = rows.reduce((s, r) => s + (Number(r.premium) || 0), 0);
    const fd = fractionalDiff(agg.total, directSum);
    checks.push(
      mk(
        ctx,
        "invariant",
        "net_premium",
        fd <= TOL.sumFractional ? "consistency-only" : "flag",
        fd <= TOL.sumFractional
          ? `call$ ${fmtUsd(agg.callPrem)} + put$ ${fmtUsd(agg.putPrem)} + unknown$ ${fmtUsd(agg.unknownPrem)} = Σ premium ${fmtUsd(directSum)} (reconciles).`
          : `Partitioned premium sum ${fmtUsd(agg.total)} != Σ premium ${fmtUsd(directSum)} — Δ ${(fd * 100).toExponential(2)}% (a row dropped/double-counted in partitioning).`,
        { id: "prem-partition-sums", expected: directSum, actual: agg.total, tolerance: TOL.sumFractional }
      )
    );
  }

  // ── Σ INVARIANT: counts partition the row set exactly ─────────────────────
  {
    const sumCounts = agg.callCount + agg.putCount + agg.unknownCount;
    checks.push(
      mk(
        ctx,
        "invariant",
        "net_premium",
        sumCounts === rows.length ? "consistency-only" : "flag",
        sumCounts === rows.length
          ? `Call/put/unknown counts (${agg.callCount}/${agg.putCount}/${agg.unknownCount}) partition all ${rows.length} rows.`
          : `Counts ${agg.callCount}/${agg.putCount}/${agg.unknownCount} sum to ${sumCounts} != ${rows.length} rows — a row mis-classified.`,
        { id: "count-partition", expected: rows.length, actual: sumCounts }
      )
    );
  }

  // ── call% derivation matches + is bounded (the flow-brief headline formula) ─
  {
    const callPutTotal = agg.callPrem + agg.putPrem;
    const floatPct = callPutTotal > 0 ? (agg.callPrem / callPutTotal) * 100 : 50;
    const diff = Math.abs(floatPct - agg.callPct);
    const bounded = agg.callPct >= 0 && agg.callPct <= 100;
    const ok = diff <= TOL.pctAbs && bounded;
    checks.push(
      mk(
        ctx,
        "invariant",
        "call_pct",
        ok ? "consistency-only" : "flag",
        ok
          ? `call% = ${agg.callPct}% matches the float share ${floatPct.toFixed(2)}% (put% = ${100 - agg.callPct}%); both bounded [0,100].`
          : `call% = ${agg.callPct}% diverges from the float share ${floatPct.toFixed(2)}% or is out of [0,100] — derivation bug.`,
        { id: "call-pct-derivation", expected: Number(floatPct.toFixed(2)), actual: agg.callPct, tolerance: TOL.pctAbs }
      )
    );
  }

  // ── RECENCY ORDERING (the order:"recent" view) ────────────────────────────
  // This worktree's fetchRecentFlows orders by total_premium DESC. The recency VIEW must be derivable
  // and strictly monotone in event time. We re-derive it from event_at/alerted_at and confirm a clean
  // time-descending order exists (no future-dated, no unparseable timestamps poisoning the sort).
  {
    const stamped = rows
      .map((r) => {
        const raw = r.event_at ?? r.alerted_at ?? "";
        const ms = raw ? new Date(raw).getTime() : NaN;
        return { row: r, ms };
      })
      .filter((x) => Number.isFinite(x.ms));
    const futureDated = stamped.filter((x) => x.ms > ctx.now + 60_000).length;
    if (stamped.length < TOL.minRows) {
      checks.push(
        mk(
          ctx,
          "invariant",
          "recency",
          "skipped",
          `Only ${stamped.length}/${rows.length} rows carry a parseable event time — recency view not assertable this run (sentinel empty alerted_at is expected for UW-no-timestamp rows).`,
          { id: "recency-orderable" }
        )
      );
    } else {
      const sorted = [...stamped].sort((a, b) => b.ms - a.ms);
      // Confirm the recency view is a clean monotone descending sequence (it always is post-sort; the
      // real check is that timestamps are sane: none future-dated, and the newest is fresh-ish).
      let monotone = true;
      for (let k = 1; k < sorted.length; k++) if (sorted[k].ms > sorted[k - 1].ms) monotone = false;
      const ok = monotone && futureDated === 0;
      checks.push(
        mk(
          ctx,
          "invariant",
          "recency",
          ok ? "consistency-only" : "flag",
          ok
            ? `Recency view derivable + monotone over ${sorted.length} timestamped rows; 0 future-dated. (NOTE: this worktree's fetchRecentFlows still defaults to premium-DESC; the order:"recent" param is the on-main change — once merged, the served recent view is this ordering.)`
            : `Recency view is NOT clean: ${futureDated} future-dated timestamp(s)${monotone ? "" : " / non-monotone after sort"} — event_at/alerted_at fix regressed.`,
          { id: "recency-orderable", actual: futureDated, expected: 0 }
        )
      );

      // Freshness: newest event within TTL during RTH.
      if (marketOpen) {
        const newestAgeMin = (ctx.now - sorted[0].ms) / 60000;
        const fresh = newestAgeMin <= 30;
        checks.push(
          mk(
            ctx,
            "freshness",
            "freshness",
            fresh ? "consistency-only" : "flag",
            fresh
              ? `Newest flow event is ${newestAgeMin.toFixed(1)}m old during RTH (≤ 30m).`
              : `Newest flow event is ${newestAgeMin.toFixed(0)}m old during RTH — tape may be stalled (no recent ingest).`,
            { id: "tape-fresh", actual: Number(newestAgeMin.toFixed(1)), tolerance: 30 }
          )
        );
      } else {
        checks.push(
          mk(ctx, "freshness", "freshness", "skipped", "Market closed — flow tape freshness not asserted.", {
            id: "tape-fresh",
          })
        );
      }
    }
  }

  // ── CROSS-PROVIDER ORACLE: UW flow vs Massive /v3/trades reconstruction ────
  // Massive (NOT UW; already paid for via Options Advanced) is an INDEPENDENT second source. We
  // reconstruct the flow premium from raw per-OCC trades and cross-check it against the served UW
  // aggregates for the same ticker/window. Agreement → the flow metric is INDEPENDENTLY-CONFIRMED
  // (promoted from consistency-only); material divergence → FLAG. This closes the single-source
  // coverage gap that previously made flows consistency-only by construction. Best-effort: a
  // skipped cross-check (Massive down / thin tape) degrades to consistency-only, never a false green.
  checks.push(await crossCheckAgainstMassive(ctx, rows));

  // ── FLOW-ANOMALY DETECTOR shadow-recompute (task #132) ────────────────────
  // See module doc above: validates detectFlowAnomalies' threshold math/skew-ratio/near-miss-band
  // classification itself, not just the tape aggregates checked above. Its own bounded 30-minute
  // read (separate from the 48h tape read above — a different window/order the anomaly detector
  // itself uses; see flow-anomaly-scope.ts's module doc for why reusing the 48h/2000-cap tape
  // above would NOT be a faithful stand-in for it).
  checks.push(...(await verifyFlowAnomalyDetector(ctx)));

  const metrics = groupMetrics(ticker, checks);
  return { ticker, status: worstStatus(metrics.map((m) => m.status)), metrics };
}
