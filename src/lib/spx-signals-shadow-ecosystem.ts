/**
 * SPX Slayer — SHADOW-MODE factor scoring, ecosystem-context flavor. Sibling of
 * src/lib/spx-signals-shadow.ts (the flow_anomalies shadow factor, shipped in
 * feat/spx-shadow-signal-framework) — same non-negotiable, same guarantee:
 * `computeSpxConfluence()` (src/lib/spx-signals.ts) never imports this file, and
 * nothing in here is imported BY spx-signals.ts. `git grep spx-signals-shadow
 * src/lib/spx-signals.ts` returns nothing, so "this cannot touch the live score"
 * is visible by inspection, not just by test.
 *
 * What this file generalizes: `getNhConfluenceBonus()` (src/lib/spx-play-engine.ts)
 * is the ONE cross-instrument input the live engine already trusts — it reads
 * Night Hawk's evening edition directly out of Postgres (`fetchLatestNighthawkEdition`)
 * and injects a bounded +-3 "prior" straight into `confluence.score`. That's a
 * real, live, un-shadowed effect, hand-rolled for exactly one other instrument.
 * Meanwhile `src/lib/bie/ecosystem-context.ts::fetchEcosystemContext()` already
 * exists as BIE's general-purpose "what does the rest of the platform know about
 * this ticker" query layer — this module is what happens when SPX Slayer reads
 * from THAT instead of hand-rolling a second bespoke direct-DB read per
 * instrument. Two candidate factors, both shadow-only (see the module doc in
 * spx-signals-shadow.ts for the full "report first, prove it with n>=10 evidence
 * before it can move score/action/grade" rationale — bie/calibration.ts's
 * MIN_EVIDENCE=10 precedent applies here exactly the same way):
 *
 *  1. `ecosystem_zerodte_agreement` — does 0DTE Command's same-day take
 *     (`zerodte_today`) point the same direction as the engine's own confluence
 *     bias? This is the 0DTE-Command analogue of the live NH bonus above, kept
 *     shadow-only because — unlike Night Hawk, which this engine has trusted
 *     live for a while — 0DTE Command agreement has never been backtested
 *     against SPX Slayer's own outcomes.
 *  2. `ecosystem_spx_anomaly` — a pattern-detected flow anomaly attributed
 *     directly to ticker "SPX" in BIE's `flow_anomalies` table (see
 *     DIFFERENTIATION FROM THE SIBLING FACTOR below — this is NOT a second copy
 *     of the flow_anomaly_* factor already shipped in spx-signals-shadow.ts).
 *
 * DIFFERENTIATION FROM THE SIBLING FACTOR (spx-signals-shadow.ts): that file's
 * `computeShadowFactors` reads `flow_anomalies` for the SPY/QQQ + 6-mega-cap
 * proxy universe (`SHADOW_ANOMALY_TICKERS`) — deliberately EXCLUDING "SPX"
 * itself (SPX has no options-flow "ticker" of its own in the retail sense; it's
 * the index). This module's anomaly factor is the complementary read: it goes
 * through `fetchEcosystemContext("SPX")`, whose `recent_anomalies` query is
 * `WHERE ticker = 'SPX'` — i.e. rows the market-regime-detector cron wrote for
 * HELIX prints with NO per-stock ticker attribution at all (see
 * `detectFlowAnomalies()` in src/app/api/cron/market-regime-detector/route.ts:
 * `const t = r.ticker ?? "SPX"` — a null-ticker print, meaning "generic SPX
 * index 0DTE flow", is grouped under the literal string "SPX"). So the two
 * factors are mutually exclusive by construction (disjoint ticker filters:
 * "SPX" here vs SPY/QQQ/8-name-universe there) and answer different questions —
 * "is a proxy stock/ETF flashing an anomaly" vs "is raw, unattributed SPX index
 * flow itself flashing one" — not a duplicate under a different name.
 *
 * STALENESS GUARD: this module treats `flow_feed_fresh` (BIE's own
 * `isFlowFrameFreshAnywhere()` cluster-wide check, exposed on every
 * `EcosystemContext`) as a blanket gate over BOTH factors above, not just the
 * anomaly one — matching the sibling factor's discipline that "BIE can't
 * confirm its own read is fresh right now" must never be silently collapsed
 * into a confirmed neutral reading. `fetchEcosystemContext()` itself already
 * fails open to an all-empty, `flow_feed_fresh:false` context on ANY internal
 * error (see its own module doc), so gating everything on this one flag is the
 * conservative, "when BIE can't vouch for its own read, trust nothing it
 * returned" choice — including `zerodte_today`, even though that field isn't
 * literally HELIX flow data. A future, separately-reviewed change could split
 * this into a narrower per-field freshness signal if evidence-gathering ever
 * needs that granularity; today's shadow-only stakes don't justify the added
 * complexity.
 *
 * Two-tier shape, deliberately: `deriveEcosystemShadowFactors` is a pure
 * function (no DB, no fetch, no bare clock read — same "fully unit-testable,
 * structurally incapable of a side effect" bar as computeShadowFactors) that
 * takes an already-fetched ecosystem-context slice. `computeEcosystemShadowFactors`
 * is the thin async wrapper that actually calls `fetchEcosystemContext("SPX")`
 * and hands the result to the pure function — kept separate so the scoring
 * logic itself stays exhaustively unit-testable with plain objects, while the
 * wiring (and its `fetchEcosystemContext` dependency) gets its own test using
 * this repo's `mock.module()` convention (see ecosystem-context.test.ts).
 */
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import type { SpxPlayDirection } from "@/lib/spx-signals";
import {
  fetchEcosystemContext,
  type EcosystemContext,
  type EcosystemZeroDteTake,
  type EcosystemAnomaly,
} from "@/lib/bie/ecosystem-context";
import type { ShadowFactorObservation } from "@/lib/spx-signals-shadow";

export type { ShadowFactorObservation } from "@/lib/spx-signals-shadow";

/** The slice of EcosystemContext this module actually reads — kept narrow
 *  (rather than accepting the whole EcosystemContext) so the pure deriver's
 *  contract is obvious from its signature alone, and so a future field added
 *  to EcosystemContext can't silently change this function's behavior. */
export type EcosystemShadowInput = Pick<EcosystemContext, "zerodte_today" | "recent_anomalies" | "flow_feed_fresh">;

/**
 * Provisional weight scale for the 0DTE-agreement factor — same ±3-to-±18 range
 * computeSpxConfluence() itself uses (src/lib/spx-signals.ts), same "explicitly
 * unproven, not to be trusted until factor_name clears bie/calibration.ts's
 * MIN_EVIDENCE=10" caveat as every other shadow factor. Bucketed off 0DTE
 * Command's own 0-100 dossier score (src/lib/zerodte/scan.ts: `s.score =
 * Math.max(0, Math.min(100, ...))`) rather than its `conviction` label string,
 * since `score` is a stable numeric contract while `conviction` labels have
 * drifted before (see board.ts's "very strong" tier) and a new label string
 * should degrade to the conservative WEAK tier, never throw or silently
 * become 0.
 */
const ZERODTE_SCORE_STRONG = 75;
const ZERODTE_SCORE_MODERATE = 50;
const ZERODTE_WEIGHT_STRONG = 8;
const ZERODTE_WEIGHT_MODERATE = 5;
const ZERODTE_WEIGHT_WEAK = 3;

function zerodteMagnitude(score: number): number {
  if (score >= ZERODTE_SCORE_STRONG) return ZERODTE_WEIGHT_STRONG;
  if (score >= ZERODTE_SCORE_MODERATE) return ZERODTE_WEIGHT_MODERATE;
  return ZERODTE_WEIGHT_WEAK;
}

/** 0DTE Command writes "long" | "short" into zerodte_setup_log.direction (see
 *  src/lib/zerodte/board.ts's ZeroDteSetup type) — narrowed defensively rather
 *  than trusted as-is, matching this repo's "never fabricate a bias for an
 *  unrecognized value" rule (spx-signals-shadow.ts's own directionOf). */
function directionOfZeroDte(raw: string): "bullish" | "bearish" | "neutral" {
  if (raw === "long") return "bullish";
  if (raw === "short") return "bearish";
  return "neutral";
}

const ZERODTE_AGREEMENT_FACTOR = "ecosystem_zerodte_agreement";

function zerodteAgreementFactor(
  zerodte: EcosystemZeroDteTake | null,
  confluenceDirection: SpxPlayDirection | null
): ShadowFactorObservation {
  if (!zerodte) {
    return {
      factor_name: ZERODTE_AGREEMENT_FACTOR,
      available: true,
      implied_weight: 0,
      direction: "neutral",
      detail: "No same-day 0DTE Command take for ticker SPX (zerodte_setup_log has no row for SPX today)",
    };
  }

  const zDir = directionOfZeroDte(zerodte.direction);
  if (zDir === "neutral" || confluenceDirection == null) {
    return {
      factor_name: ZERODTE_AGREEMENT_FACTOR,
      available: true,
      implied_weight: 0,
      direction: "neutral",
      detail:
        confluenceDirection == null
          ? `0DTE Command take present (${zerodte.direction}, score ${zerodte.score}) but the engine has no directional bias right now to compare against`
          : `0DTE Command take has an unrecognized direction value ("${zerodte.direction}") — treated as neutral, never fabricated into bullish/bearish`,
    };
  }

  const magnitude = zerodteMagnitude(zerodte.score);
  const confluenceBullish = confluenceDirection === "long";
  const zerodteBullish = zDir === "bullish";
  const agrees = confluenceBullish === zerodteBullish;
  const weight = zerodteBullish ? magnitude : -magnitude;

  return {
    factor_name: ZERODTE_AGREEMENT_FACTOR,
    available: true,
    implied_weight: weight,
    direction: zDir,
    detail: `0DTE Command ${zerodte.direction} take on SPX today (score ${zerodte.score}, conviction ${zerodte.conviction ?? "n/a"}) ${agrees ? "AGREES" : "DISAGREES"} with engine's ${confluenceDirection} bias [shadow: not scored]`,
  };
}

/**
 * Severity taxonomy — identical anchor points to spx-signals-shadow.ts's own
 * SEVERITY_WEIGHT (kept as a separate literal, not a shared import, since the
 * two modules are intentionally structurally independent — see this file's
 * module doc on why nothing here imports FROM or is imported BY the sibling).
 */
const ANOMALY_SEVERITY_WEIGHT: Record<string, number> = {
  CRITICAL: 10,
  HIGH: 7,
  MEDIUM: 5,
  LOW: 3,
};
const DEFAULT_ANOMALY_WEIGHT = 3;

function anomalySeverityWeight(severity: string): number {
  return ANOMALY_SEVERITY_WEIGHT[severity?.toUpperCase()] ?? DEFAULT_ANOMALY_WEIGHT;
}

function directionOfAnomaly(raw: string | null): "bullish" | "bearish" | "neutral" {
  if (raw === "bullish") return "bullish";
  if (raw === "bearish") return "bearish";
  return "neutral";
}

/** Short, stable slug for the factor_name — mirrors spx-signals-shadow.ts's
 *  anomalyTypeSlug (kept as its own copy for the same "structurally
 *  independent modules" reason as ANOMALY_SEVERITY_WEIGHT above). */
function anomalyTypeSlug(anomalyType: string): string {
  const t = (anomalyType ?? "").toUpperCase();
  if (t.includes("SWEEP")) return "sweep";
  if (t.includes("SKEW")) return "skew";
  if (t.includes("CONCENTRATION")) return "concentration";
  if (t.includes("PREMIUM")) return "premium";
  if (t.includes("PUT_SURGE")) return "put_surge";
  return "anomaly";
}

const ANOMALY_WATCH_FACTOR = "ecosystem_spx_anomaly_watch";

/**
 * `recent_anomalies` (fetchEcosystemContext's own SQL: `WHERE ticker = 'SPX'
 * AND detected_at >= NOW() - 24h ORDER BY detected_at DESC LIMIT 5`) is already
 * time-windowed and ticker-scoped server-side — unlike the sibling factor,
 * which queries the raw table itself and so re-checks a 30min window
 * client-side, there's no age math to redo here. Just reduce to the
 * single highest-severity row, same "dominant signal only" rule
 * scoreFlowStrikeConcentration/spx-signals-shadow.ts's per-ticker reduction
 * both use.
 */
function spxAnomalyFactor(anomalies: EcosystemAnomaly[]): ShadowFactorObservation {
  if (anomalies.length === 0) {
    return {
      factor_name: ANOMALY_WATCH_FACTOR,
      available: true,
      implied_weight: 0,
      direction: "neutral",
      detail: "No flow anomalies attributed directly to ticker SPX in the last 24h (BIE ecosystem-context read — distinct from the SPY/QQQ/mega-cap proxy universe the sibling flow_anomaly_* shadow factor already covers)",
    };
  }

  let best = anomalies[0];
  let bestWeight = anomalySeverityWeight(best.severity);
  for (const a of anomalies.slice(1)) {
    const w = anomalySeverityWeight(a.severity);
    if (w > bestWeight) {
      best = a;
      bestWeight = w;
    }
  }

  const dir = directionOfAnomaly(best.direction);
  const weight = dir === "bullish" ? bestWeight : dir === "bearish" ? -bestWeight : 0;

  return {
    factor_name: `ecosystem_spx_anomaly_${anomalyTypeSlug(best.anomaly_type)}`,
    available: true,
    implied_weight: weight,
    direction: dir,
    detail: `SPX ${best.anomaly_type} (${best.severity}) — ${best.detail} [BIE ecosystem-context, ticker-scoped to SPX — shadow: not scored]`,
  };
}

/**
 * Pure scorer — see module doc for the two-tier shape rationale. Blanket
 * `flow_feed_fresh` gate first (never fabricated into a neutral reading for
 * either factor), then one observation per factor family.
 */
export function deriveEcosystemShadowFactors(
  ctx: EcosystemShadowInput,
  confluenceDirection: SpxPlayDirection | null
): ShadowFactorObservation[] {
  if (!ctx.flow_feed_fresh) {
    const detail =
      "BIE ecosystem-context flow feed not confirmed fresh (flow_feed_fresh=false) — cannot distinguish a real reading from a down/stale pipeline, so nothing ecosystem-context returned right now can be trusted";
    return [
      { factor_name: ZERODTE_AGREEMENT_FACTOR, available: false, implied_weight: 0, direction: "neutral", detail },
      { factor_name: ANOMALY_WATCH_FACTOR, available: false, implied_weight: 0, direction: "neutral", detail },
    ];
  }

  return [zerodteAgreementFactor(ctx.zerodte_today, confluenceDirection), spxAnomalyFactor(ctx.recent_anomalies)];
}

/**
 * Async wrapper — fetches BIE's ecosystem-context for SPX and derives shadow
 * observations. `desk` is accepted (unused today) purely to match the
 * `(desk, ...)` shape every other factor function in this repo's shadow
 * modules uses (spx-signals-shadow.ts's own `computeShadowFactors`) — so a
 * future revision needing desk context is a body-only change, not a signature
 * change at every call site.
 *
 * NON-BLOCKING NOTE: this function itself does one `await` (the
 * fetchEcosystemContext call) and is only ever invoked from
 * logSpxEcosystemShadowFactors (src/lib/providers/spx-signal-log.ts), which is
 * in turn only ever invoked via evaluateSpxPlay's `firePlayTelemetry` fire-and-
 * forget wrapper (src/lib/spx-play-engine.ts) — the exact same pattern already
 * proven safe for logSpxShadowFactors. `evaluateSpxPlay` never awaits this
 * chain, so no amount of latency inside fetchEcosystemContext (itself already
 * a Promise.all of several queries, and already used as a fire-and-forget-safe
 * read by the admin BIE report / Largo tools) can delay a real play evaluation.
 */
export async function computeEcosystemShadowFactors(
  desk: SpxDeskPayload,
  confluenceDirection: SpxPlayDirection | null
): Promise<ShadowFactorObservation[]> {
  void desk;
  const ctx = await fetchEcosystemContext("SPX");
  return deriveEcosystemShadowFactors(ctx, confluenceDirection);
}
