// PR-N4 (docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §3.5, the C-2 class): publish-time
// evidence pinning for the OVERNIGHT edition — the analogue of the 0DTE entry_context
// (#311). When a published play fails, this is the durable record of what the builder
// actually saw at publish: spot, band-vs-spot geometry, regime/breadth, catalyst flags,
// score components. Every later gate (N3 band sanity, N5 Cortex veto) and every
// calibration cut reads from this substrate — the forensics that produced the decision
// doc were "impossible" cuts precisely because none of this existed per-play.
//
// HONESTY RULES (same as the rejection audit rows in play-outcomes.ts):
//  - only values ACTUALLY COMPUTED during this build are pinned — a missing dossier/tech
//    card yields nulls, never a re-fetched or guessed number (a pin backfilled later
//    would record what the market looked like at pin time, not at publish);
//  - FAIL-SOFT: buildNighthawkPublishContexts never throws. A pinning failure costs the
//    pin (logged), never the outcome row and never the edition publish.
//
// Pure module: no I/O, no db imports — unit-testable with fixture plays like the rest of
// this directory's parsing/grading logic.

import type { PlaybookPlay } from "./types";
import type { ScoredCandidate, NightHawkRegimeContext } from "./scorer";
import type { TickerDossier } from "./dossier";
import { parsePlayLevels } from "./play-levels";
import { confluenceSnapshot } from "./play-outcomes";
import { assignNighthawkTier, nhTierInputFromScored } from "./nighthawk-tiers";
// Type-only (erased at runtime): the gate module imports this file's geometry helper, so a
// value import back the other way would be a cycle. The pinned gate result is opaque here.
import type { NighthawkPublishGateResult } from "./publish-gates";
import type { MarketBreadthMetrics } from "@/lib/providers/polygon";

/** Bump when the pinned shape changes so calibration reads can segment by version.
 *  v2 (PR-N3): + `gates` (publish-gate verdict/blocks/checks) and `quote_session`. */
export const PUBLISH_CONTEXT_VERSION = 2;

/** The slice of the evening MarketWideContext the pin actually uses — narrow on purpose
 *  so tests don't have to build the full context object and the pin can't silently grow
 *  a dependency on something the builder didn't really look at. */
export type PublishContextMarket = {
  /** Regime read the scorer used (regimeContextFromMarket(ctx)) — vix rank, tide bias,
   *  breadth advance pct, composite regime. */
  regime: NightHawkRegimeContext | null;
  /** The BIE market-breadth bundle already fetched for the edition (ctx.market_breadth). */
  market_breadth: MarketBreadthMetrics | null;
  /** UW earnings calendar rows for tomorrow (ctx.tomorrow_earnings) — publish-time
   *  knowledge of "does this name report into the play's session". */
  tomorrow_earnings: Array<Record<string, unknown>>;
  /** Tomorrow's session date (ctx.tomorrow) — the date an earnings hit refers to. */
  tomorrow: string;
  /** Last VIX daily close available at build time (ctx.vix_bars), null when absent. */
  vix_close: number | null;
  /** Last SPX daily close available at build time (ctx.spx_bars), null when absent. */
  spx_close: number | null;
};

/** Signed % move from `from` to `to`; null when either side is unusable. */
function pctFrom(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to) || from === 0) {
    return null;
  }
  return ((to - from) / from) * 100;
}

function round4(n: number | null): number | null {
  return n == null ? null : Math.round(n * 10_000) / 10_000;
}

function finiteOrNull(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

import type { TechnicalCard } from "./technicals";

/**
 * PR-N21: estimate ATR when the real ATR14 is unavailable (Polygon returned fewer than
 * 14 daily bars). Uses prior-day H/L range when available, else 1.5% of spot — conservative
 * defaults that let the target_unreachable gate evaluate rather than fail-closed with
 * geometry_unknown. The estimate is CLEARLY labeled in the geometry so calibration knows
 * it's synthetic.
 */
function estimateAtr(
  tech: TechnicalCard | null | undefined,
  spot: number | null
): number | null {
  const pdHigh = finiteOrNull(tech?.prior_day?.high);
  const pdLow = finiteOrNull(tech?.prior_day?.low);
  if (pdHigh != null && pdLow != null && pdHigh > pdLow) {
    return Number((pdHigh - pdLow).toFixed(4));
  }
  if (spot != null && spot > 0) {
    return Number((spot * 0.015).toFixed(4));
  }
  return null;
}

/**
 * The band/target/stop geometry BOTH the publish pin and the publish gates (PR-N3,
 * publish-gates.ts) read — one computation, so the number the gate thresholds on is
 * byte-identical to the number the pin records as evidence. All `*_pct` values are
 * SIGNED % of spot, UNROUNDED (the pin rounds for storage; the gates threshold raw).
 */
export type NighthawkPublishGeometry = {
  direction: "LONG" | "SHORT";
  /** Last price the dossier's tech card saw (tech.price); null when no tech card. */
  spot: number | null;
  prior_close: number | null;
  atr14: number | null;
  /** ET session date the spot quote came from (tech.price_session) — G-N3's subject. */
  quote_session: string | null;
  entry_range_low: number | null;
  entry_range_high: number | null;
  target: number | null;
  stop: number | null;
  /** Nearest FILLABLE band edge — LONG: band top; SHORT: band low. The level the
   *  member would actually transact at, so distances are measured from here. */
  fill_edge: number | null;
  /** spot → fill edge, signed % of spot. Strongly negative for a LONG = the N-3
   *  "detached band" signature (band sits far below the market). */
  band_distance_pct: number | null;
  target_distance_pct: number | null;
  stop_distance_pct: number | null;
};

/** Compute the publish-time geometry for one play from the SAME in-memory dossier the
 *  builder published from. Honesty rule: missing tech card / unparseable levels yield
 *  nulls — never a re-fetched or guessed number. */
export function computeNighthawkPublishGeometry(
  play: PlaybookPlay,
  dossier: TickerDossier | null | undefined
): NighthawkPublishGeometry {
  const levels = parsePlayLevels(play);
  const direction: "LONG" | "SHORT" = String(play.direction ?? "LONG").toUpperCase().includes("SHORT")
    ? "SHORT"
    : "LONG";
  const isLong = direction === "LONG";
  const tech = dossier?.tech ?? null;
  const spot = finiteOrNull(tech?.price);

  // Nearest fillable band edge: the level the member would actually transact at.
  const fillEdge = (isLong ? levels.entry_range_high : levels.entry_range_low) ?? null;

  return {
    direction,
    spot,
    prior_close: finiteOrNull(tech?.prior_day?.close),
    atr14: finiteOrNull(tech?.atr14) ?? estimateAtr(tech, spot),
    quote_session: typeof tech?.price_session === "string" ? tech.price_session : null,
    entry_range_low: levels.entry_range_low,
    entry_range_high: levels.entry_range_high,
    target: levels.target,
    stop: levels.stop,
    fill_edge: fillEdge,
    band_distance_pct: pctFrom(spot, fillEdge),
    target_distance_pct: pctFrom(spot, levels.target),
    stop_distance_pct: pctFrom(spot, levels.stop),
  };
}

/** True when `ticker` appears in the UW tomorrow-earnings calendar rows. Same field
 *  convention as hunt-builder.ts's earningsDateForTicker (ticker | symbol). */
export function earningsTomorrowForTicker(
  ticker: string,
  tomorrowEarnings: Array<Record<string, unknown>>
): boolean {
  const sym = ticker.toUpperCase();
  return tomorrowEarnings.some(
    (r) => String(r.ticker ?? r.symbol ?? "").toUpperCase() === sym
  );
}

/**
 * Build the publish-time pin for ONE play. Pure; throws only on truly malformed input,
 * which the plural wrapper below converts to a logged null (fail-soft).
 *
 * Geometry semantics (all signed % of spot, null when spot is unknown):
 *  - band_distance_pct: spot → the NEAREST FILLABLE band edge (LONG: band top; SHORT:
 *    band low). Strongly negative for a LONG = the band sits far below the market —
 *    the exact N-3 "detached band" signature the N3 gate will threshold on.
 *  - target_distance_pct / stop_distance_pct: spot → target/stop. Together with atr14
 *    these make "was the target achievable in one session" answerable after the fact.
 */
export function buildNighthawkPublishContext(opts: {
  play: PlaybookPlay;
  scored: ScoredCandidate | null | undefined;
  dossier: TickerDossier | null | undefined;
  market: PublishContextMarket;
  /** ISO build timestamp — passed in (not Date.now()) so the pin matches meta.built_at. */
  builtAt: string;
  /** PR-N3: the publish-gate evaluation this play went through — passed IN from the
   *  builder (never re-evaluated here) so the pin records the EXACT object that gated
   *  the play, PASS margins included (the calibration substrate for the thresholds).
   *  Optional + nullable: an un-gated caller degrades to a null pin, never a throw. */
  gates?: NighthawkPublishGateResult | null;
}): Record<string, unknown> {
  const { play, scored, dossier, market, builtAt } = opts;
  // One geometry computation shared with publish-gates.ts — see NighthawkPublishGeometry.
  const geo = computeNighthawkPublishGeometry(play, dossier);

  return {
    context_version: PUBLISH_CONTEXT_VERSION,
    pinned_at: builtAt,
    direction: geo.direction,
    conviction: String(play.conviction ?? "").toUpperCase() || null,
    score: finiteOrNull(play.score),
    entry_premium: finiteOrNull(play.entry_premium),

    // ── What the builder saw on the tape for THIS name ─────────────────────────
    spot_at_publish: geo.spot,
    prior_close: geo.prior_close,
    atr14: geo.atr14,
    quote_session: geo.quote_session,

    // ── Published geometry, re-parsed with the same parser grading uses ────────
    entry_range_low: geo.entry_range_low,
    entry_range_high: geo.entry_range_high,
    target: geo.target,
    stop: geo.stop,
    band_distance_pct: round4(geo.band_distance_pct),
    target_distance_pct: round4(geo.target_distance_pct),
    stop_distance_pct: round4(geo.stop_distance_pct),

    // ── PR-N3 publish-gate verdict for THIS play (null when un-gated) ──────────
    gates: opts.gates ?? null,

    // ── That evening's market state (regime + the BIE breadth bundle) ──────────
    market: {
      composite_regime: market.regime?.composite_regime ?? null,
      tide_bias: market.regime?.tide_bias ?? null,
      vix_iv_rank: market.regime?.vix_iv_rank ?? null,
      vix_close: market.vix_close,
      spx_close: market.spx_close,
      breadth: market.market_breadth
        ? {
            pct_advancing: market.market_breadth.pct_advancing,
            advance_decline_ratio: market.market_breadth.advance_decline_ratio,
            pct_above_vwap: market.market_breadth.pct_above_vwap,
          }
        : null,
    },

    // ── Catalyst knowledge AT PUBLISH (never re-derived later) ─────────────────
    catalysts: {
      earnings_tomorrow: earningsTomorrowForTicker(play.ticker ?? "", market.tomorrow_earnings),
      earnings_date: earningsTomorrowForTicker(play.ticker ?? "", market.tomorrow_earnings)
        ? market.tomorrow
        : null,
      earnings_risk: scored?.earnings_risk ?? false,
      catalyst_flags: scored?.catalyst_flags ?? [],
    },

    // ── PR-N7: tier engine assignment pinned at publish ─────────────────────────
    tier: scored
      ? (() => {
          const t = assignNighthawkTier(nhTierInputFromScored(scored));
          return { tier: t.tier, factors: t.factors };
        })()
      : null,

    // ── The builder's own score/conviction inputs (shared shape with the
    //    rejection audit rows — one snapshot format across the funnel) ──────────
    confluence: confluenceSnapshot(scored),
  };
}

/**
 * Build pins for a whole edition's plays: ticker → context (or null when that play's pin
 * failed). NEVER throws — per-play failures and a total failure both degrade to nulls
 * with a console.warn, because the pin is evidence, not a publish dependency: the
 * edition (and its outcome rows) must publish identically with or without it.
 */
export function buildNighthawkPublishContexts(opts: {
  plays: PlaybookPlay[];
  dossiers: Record<string, TickerDossier>;
  market: PublishContextMarket;
  builtAt: string;
  /** PR-N3: per-ticker publish-gate results from the builder's gate pass (see the
   *  singular builder's `gates` doc). Missing ticker/omitted map ⇒ null pin. */
  gateResults?: Record<string, NighthawkPublishGateResult | null>;
}): Record<string, Record<string, unknown> | null> {
  const out: Record<string, Record<string, unknown> | null> = {};
  let plays: PlaybookPlay[] = [];
  try {
    plays = Array.isArray(opts.plays) ? opts.plays : [];
  } catch {
    return out;
  }
  for (const play of plays) {
    const ticker = String(play?.ticker ?? "").toUpperCase();
    if (!ticker) continue;
    try {
      const dossier = opts.dossiers?.[ticker] ?? opts.dossiers?.[play.ticker] ?? null;
      out[ticker] = buildNighthawkPublishContext({
        play,
        scored: dossier?.scored ?? null,
        dossier,
        market: opts.market,
        builtAt: opts.builtAt,
        gates: opts.gateResults?.[ticker] ?? null,
      });
    } catch (err) {
      // Fail-soft: this play publishes un-pinned; the row still syncs.
      console.warn(`[nighthawk/publish-context] pin failed for ${ticker} (publishing un-pinned):`, err);
      out[ticker] = null;
    }
  }
  return out;
}
