/**
 * SPX Slayer — SHADOW-MODE factor scoring. Structurally separate from
 * src/lib/spx-signals.ts on purpose: `computeSpxConfluence()` (the pure function
 * that gates a real BUY_CALL/BUY_PUT recommendation on real-money 0DTE trades)
 * never imports this file, and nothing in here is imported BY spx-signals.ts —
 * `git grep spx-signals-shadow src/lib/spx-signals.ts` returns nothing, so the
 * "this cannot touch the live score" guarantee is visible by inspection, not
 * just by test.
 *
 * Why shadow mode at all: this repo's BIE calibration harness
 * (src/lib/bie/calibration.ts) already refuses to turn a measured pattern into
 * an acted-on recommendation until a bucket clears MIN_EVIDENCE = 10 graded
 * plays — "report-first, a human ships the change." A brand-new, never-
 * backtested input (BIE's flow_anomalies table) on a real-money confluence
 * engine deserves at least that same bar BEFORE it can move score/action/grade
 * by one point. This module computes what a candidate factor WOULD have
 * contributed, so it can be logged next to the real score and graded against
 * outcomes later (see insertShadowFactorObservation in src/lib/db.ts) — with
 * zero live effect until a future, separately-reviewed change promotes it into
 * computeSpxConfluence()'s own `score +=` chain.
 *
 * Everything below is a pure function: no DB reads, no fetch, no bare
 * `Date.now()`/`new Date()` (the caller passes `now` explicitly) — so it is
 * fully unit-testable and structurally incapable of a side effect on the real
 * signal.
 */
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

/**
 * One row read from BIE's `flow_anomalies` table (written every 30min by the
 * market-regime-detector cron — see src/app/api/cron/market-regime-detector/
 * route.ts's detectFlowAnomalies(), and the read shape this mirrors in
 * src/lib/bie/ecosystem-context.ts's `recent_anomalies` query). `direction` is
 * whatever the detector wrote — today that's "bullish" | "bearish" | null; kept
 * as `string | null` here so a new detector-side value can't break this file's
 * types, `directionOf()` below is the single place that narrows it.
 */
export type FlowAnomalyInput = {
  ticker: string;
  anomaly_type: string;
  detected_at: string;
  detail: string;
  severity: string;
  direction: string | null;
};

export type ShadowFactorObservation = {
  /** e.g. "flow_anomaly_spy_sweep" — stable per (ticker, anomaly-type-family) so
   *  later evidence-gathering can bucket by this exact string (calibration.ts
   *  precedent: bucket first, act only once a bucket clears n>=10). */
  factor_name: string;
  /** false when the underlying read could not be confirmed fresh — see the
   *  module doc above. Must NEVER be collapsed with "confirmed no signal". */
  available: boolean;
  /** What this factor WOULD have contributed on the real ±3-to-±18 scale
   *  computeSpxConfluence() uses (src/lib/spx-signals.ts) — explicitly
   *  provisional/unproven, see SEVERITY_WEIGHT below for the rationale. */
  implied_weight: number;
  direction: "bullish" | "bearish" | "neutral";
  detail: string;
};

/**
 * SPY/QQQ + the same 6 mega-caps src/lib/providers/polygon.ts already tracks as
 * LEADER_STOCKS for the real "Mega-caps" factor in spx-signals.ts. Reusing that
 * exact universe rather than inventing a second ticker list that could silently
 * drift from it.
 */
export const SHADOW_ANOMALY_TICKERS: readonly string[] = [
  "SPY",
  "QQQ",
  "AAPL",
  "NVDA",
  "MSFT",
  "GOOG",
  "TSLA",
  "META",
];

/**
 * Matches scoreHelixFlowAlignment's own institutional-0DTE-sweep window in
 * spx-signals.ts (30 minutes) — an anomaly this old is as stale as an old HELIX
 * print would be for a same-day 0DTE decision, shadow or not.
 */
const ANOMALY_WINDOW_MS = 30 * 60 * 1000;

/**
 * Provisional weight scale — NOT derived from any backtest, and explicitly not
 * meant to be trusted until a factor_name bucket clears bie/calibration.ts's
 * MIN_EVIDENCE = 10 evidence bar. Chosen to land inside the real engine's own
 * ±3 (Dark pool, a multi-day/low-conviction signal) to ±18 (GEX wall, the
 * single largest weight in the file) range, using the market-regime-detector's
 * own severity taxonomy as the anchor: CRITICAL is its $5M+ single-print /
 * most-extreme-skew tier (given ±10, on par with a "strong" HELIX 0DTE sweep),
 * down to LOW (±3, on par with Dark pool's deliberately-capped weight).
 */
const SEVERITY_WEIGHT: Record<string, number> = {
  CRITICAL: 10,
  HIGH: 7,
  MEDIUM: 5,
  LOW: 3,
};
const DEFAULT_SEVERITY_WEIGHT = 3; // unrecognized severity string — treat as LOW, not zero.

/** Short, stable slug for the factor_name — new anomaly_type strings fall back
 *  to "anomaly" rather than breaking factor_name generation. */
function anomalyTypeSlug(anomalyType: string): string {
  const t = anomalyType.toUpperCase();
  if (t.includes("SWEEP")) return "sweep";
  if (t.includes("SKEW")) return "skew";
  if (t.includes("CONCENTRATION")) return "concentration";
  if (t.includes("PREMIUM")) return "premium";
  if (t.includes("PUT_SURGE")) return "put_surge";
  return "anomaly";
}

function directionOf(raw: string | null): "bullish" | "bearish" | "neutral" {
  if (raw === "bullish") return "bullish";
  if (raw === "bearish") return "bearish";
  return "neutral";
}

/**
 * Shadow-score BIE's flow_anomalies table (SPY/QQQ/mega-cap sweep/skew/
 * premium-spike/concentration patterns) — a table computeSpxConfluence() has
 * never read. Returns what each currently-anomalous watched ticker WOULD have
 * contributed; purely for logging, `desk` is accepted (unused today) only so
 * this matches the real factor functions' `(desk, ...)` shape and a future
 * shadow factor needing desk context (e.g. distance from spot) is a body-only
 * change, not a signature change at every call site.
 *
 * STALENESS GUARD (this is the important part): `flowFeedFresh` must come from
 * the SAME cluster-wide check the rest of BIE already uses —
 * isFlowFrameFreshAnywhere() (src/lib/flow-liveness.ts), the exact boolean
 * src/lib/bie/ecosystem-context.ts exposes as `flow_feed_fresh` — rather than
 * being inferred from an empty `anomalies` array. An empty array is ambiguous
 * on its own: it means EITHER "genuinely no anomaly on these tickers right
 * now" OR "the ingestion pipeline is down and we simply have no data," and
 * those are not the same data point for later evidence-gathering. When the
 * feed is not confirmed fresh this returns `available: false` so a downstream
 * reader can never mistake "couldn't tell" for a real zero-anomaly reading.
 *
 * @param now injectable clock (defaults to Date.now()) purely for deterministic
 *            tests — production call sites never pass this.
 */
export function computeShadowFactors(
  desk: SpxDeskPayload,
  anomalies: FlowAnomalyInput[],
  flowFeedFresh: boolean,
  now: number = Date.now()
): ShadowFactorObservation[] {
  void desk;

  if (!flowFeedFresh) {
    return [
      {
        factor_name: "flow_anomaly_watch",
        available: false,
        implied_weight: 0,
        direction: "neutral",
        detail:
          "Flow anomaly feed not confirmed fresh cluster-wide (isFlowFrameFreshAnywhere=false) — cannot distinguish 'no anomaly' from 'pipeline down'",
      },
    ];
  }

  const watched = new Set(SHADOW_ANOMALY_TICKERS);
  const recent = anomalies.filter((a) => {
    if (!watched.has((a.ticker ?? "").toUpperCase())) return false;
    const detectedMs = Date.parse(a.detected_at);
    if (!Number.isFinite(detectedMs)) return false;
    const age = now - detectedMs;
    return age >= 0 && age <= ANOMALY_WINDOW_MS;
  });

  if (recent.length === 0) {
    return [
      {
        factor_name: "flow_anomaly_watch",
        available: true,
        implied_weight: 0,
        direction: "neutral",
        detail: `No SPY/QQQ/mega-cap flow anomalies in the last ${ANOMALY_WINDOW_MS / 60_000}min (feed confirmed fresh)`,
      },
    ];
  }

  // One observation per ticker — keep only the highest-severity anomaly per
  // ticker so a noisy ticker with multiple detections in the window doesn't
  // produce duplicate rows. Mirrors scoreFlowStrikeConcentration's own "the
  // dominant stack only, not noisy accumulation" rule in spx-signals.ts.
  const bestByTicker = new Map<string, FlowAnomalyInput>();
  for (const a of recent) {
    const ticker = a.ticker.toUpperCase();
    const w = SEVERITY_WEIGHT[a.severity?.toUpperCase()] ?? DEFAULT_SEVERITY_WEIGHT;
    const existing = bestByTicker.get(ticker);
    const existingW = existing
      ? SEVERITY_WEIGHT[existing.severity?.toUpperCase()] ?? DEFAULT_SEVERITY_WEIGHT
      : -1;
    if (!existing || w > existingW) bestByTicker.set(ticker, a);
  }

  return [...bestByTicker.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ticker, a]) => {
      const dir = directionOf(a.direction);
      const magnitude = SEVERITY_WEIGHT[a.severity?.toUpperCase()] ?? DEFAULT_SEVERITY_WEIGHT;
      const weight = dir === "bullish" ? magnitude : dir === "bearish" ? -magnitude : 0;
      return {
        factor_name: `flow_anomaly_${ticker.toLowerCase()}_${anomalyTypeSlug(a.anomaly_type)}`,
        available: true,
        implied_weight: weight,
        direction: dir,
        detail: `${ticker} ${a.anomaly_type} (${a.severity}) — ${a.detail} [shadow: not scored]`,
      };
    });
}
