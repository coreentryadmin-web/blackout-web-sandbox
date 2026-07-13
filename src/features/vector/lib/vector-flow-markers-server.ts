import "server-only";

import { fetchLargeOptionPrints } from "@/lib/providers/option-trades";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { normalizeVectorTicker } from "./vector-ticker";
import { loadCurrentChainContracts } from "./vector-gex-reconstruct-server";
import { expiriesForHorizon, type VectorDteHorizon } from "./vector-dte-horizon";
import {
  capFlowMarkers,
  filterLargeFlowPrints,
  DEFAULT_FLOW_MAX_MARKERS,
  type FlowPrint,
} from "./vector-flow-markers";

/**
 * Server shell behind the Vector options-flow markers overlay (feature #20). Resolves the real large
 * option prints for a ticker + DTE horizon, filters/caps them with the SAME pure logic the client
 * uses, and returns the small array the chart plots — one marker per notable trade at its strike/time.
 *
 * Data source (REAL): `fetchLargeOptionPrints` in `src/lib/providers/option-trades.ts` — the bounded,
 * rate-limited, cached Massive/Polygon per-OCC trades fan-out (the same path the flow-consistency
 * reconstruction already uses), which returns individual near-ATM prints WITH strike + timestamp.
 *
 * HORIZON scoping: option TRADES are pulled per single expiry (the Polygon trades endpoint is
 * per-OCC), so — unlike the walls/max-pain, which filter a whole chain — we scope by pulling the
 * NEAREST expiry INSIDE the horizon (0DTE → today; weekly → the nearest ≤7-DTE expiry; monthly →
 * nearest ≤35-DTE; all → the front expiry). Fanning trades across every expiry in the horizon would
 * blow the per-OCC contract cap; the front expiry carries the overwhelming majority of live flow and
 * keeps the pull bounded. This is a deliberate, documented scope — see the PR write-up.
 *
 * Best-effort + HONEST: returns `available:false` with an empty list on any failure (Polygon not
 * configured, no spot, empty chain/horizon, thrown fetch) so the chart draws nothing rather than
 * fabricating flow. `reason` explains an empty result for diagnostics.
 */

export type VectorFlowMarkers = {
  available: boolean;
  reason?: string;
  /** The expiry the prints were pulled from (the horizon's front expiry). */
  expiry: string | null;
  spot: number | null;
  prints: FlowPrint[];
  meta: {
    minPremium: number;
    /** Total large prints found upstream before the display cap. */
    largeFound: number;
    /** How many large prints were dropped by the top-N display cap (annotated, never silent). */
    truncated: number;
    /** True when an upstream contract pull failed (partial result). */
    partial: boolean;
  };
};

/** ±band around spot for the display filter — matches the provider's near-the-money discovery band. */
const FLOW_BAND_PCT = 0.05;

function emptyMarkers(reason: string): VectorFlowMarkers {
  return {
    available: false,
    reason,
    expiry: null,
    spot: null,
    prints: [],
    meta: { minPremium: 0, largeFound: 0, truncated: 0, partial: false },
  };
}

/**
 * Resolve the single expiry to pull flow for: the NEAREST live expiry inside `horizon`. Reuses the
 * cached current chain (same fetch the per-expiry walls use) to enumerate expiries, then the pure
 * `expiriesForHorizon` (which sorts ascending by DTE and honestly falls back to the nearest expiry
 * when a bounded horizon is empty). Null when the chain has no live expiry.
 */
async function frontExpiryForHorizon(
  ticker: string,
  spot: number,
  horizon: VectorDteHorizon
): Promise<string | null> {
  const contracts = await loadCurrentChainContracts(ticker, spot);
  if (!contracts.length) return null;
  const expiries = [...new Set(contracts.map((c) => c.expiry))].sort();
  const scoped = expiriesForHorizon(expiries, horizon, todayEtYmd());
  // expiriesForHorizon returns ascending-by-DTE; the first is the front (nearest) expiry.
  return scoped[0] ?? null;
}

export async function getVectorFlowMarkers(
  ticker: string,
  horizon: VectorDteHorizon,
  maxMarkers: number = DEFAULT_FLOW_MAX_MARKERS
): Promise<VectorFlowMarkers> {
  const t = normalizeVectorTicker(ticker);
  try {
    const pos = await getGexPositioning(t);
    const spot = pos?.spot;
    if (!(spot && spot > 0)) return emptyMarkers("no spot");

    const expiry = await frontExpiryForHorizon(t, spot, horizon);
    if (!expiry) return emptyMarkers("no live expiry in chain");

    const res = await fetchLargeOptionPrints(t, { expiry });
    if (!res) return emptyMarkers("options-trades provider not configured");

    // Map provider prints → the client FlowPrint shape, then run the SAME pure filter + cap the
    // client would (defensive band re-check + top-N display cap) so server and client agree exactly.
    const mapped: FlowPrint[] = res.prints.map((p) => ({
      strike: p.strike,
      side: p.type,
      premium: p.premium,
      size: p.size,
      tsMs: p.tsMs,
      aggressor: p.aggressor,
    }));
    const filtered = filterLargeFlowPrints(mapped, {
      minPremium: res.meta.minPremium,
      spot,
      bandPct: FLOW_BAND_PCT,
    });
    const { shown, truncated } = capFlowMarkers(filtered, maxMarkers);

    return {
      available: true,
      expiry,
      spot,
      prints: shown,
      meta: {
        minPremium: res.meta.minPremium,
        largeFound: res.meta.largeFound,
        // Combine the provider's own top-N drop with this display cap so the annotation is complete.
        truncated: (res.meta.truncated ? res.meta.largeFound - res.prints.length : 0) + truncated,
        partial: res.meta.partial,
      },
    };
  } catch {
    return emptyMarkers("fetch failed");
  }
}
