import "server-only";

import { fetchUwSpotExposuresByStrike } from "@/lib/providers/unusual-whales";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { normalizeVectorTicker } from "./vector-ticker";
import { computeFlowGexLadder } from "./vector-flow-gex";

/**
 * Server shell for the FLOW-GEX lens: fetch UW `spot-exposures/strike` (the per-strike gamma
 * decomposed by trade side that our code already consumes for the GEX cross-validation / cold-cache
 * fallback) and turn it into the `{strike: netGex}` map `buildGexLadder` renders. The flow SIGN +
 * magnitude math is the pure `computeFlowGexLadder`; this only adds the fetch and the spot.
 *
 * Returns the SAME `{spot, strikeTotals}` shape as `getHorizonStrikeTotals` (the OI path) so the
 * route branches trivially. Best-effort: returns null on any gap (no rows, thrown fetch) so the
 * route can render a graceful empty ladder rather than error — a member toggle must degrade, never
 * throw.
 *
 * NOTE: `spot-exposures/strike` sums ALL expiries server-side, which matches the all-expiry
 * aggregate the Skylit fit used — so the flow lens is inherently all-expiry and does NOT re-scope to
 * the DTE toggle (the OI lens does). The route echoes the horizon but the flow map ignores it.
 */
export async function getFlowStrikeTotals(
  ticker: string
): Promise<{ spot: number | null; strikeTotals: Record<string, number> } | null> {
  const t = normalizeVectorTicker(ticker);
  try {
    const rows = await fetchUwSpotExposuresByStrike(t, 500);
    if (!rows || rows.length === 0) return null;

    const { strikeTotals, spot: snapSpot } = computeFlowGexLadder(rows);
    if (Object.keys(strikeTotals).length === 0) return null;

    // Prefer the live spot the OI ladder centres on so both lenses band/centre identically; fall
    // back to the exposure snapshot's own `price` when the positioning read is cold.
    let spot = snapSpot;
    try {
      const pos = await getGexPositioning(t);
      if (pos?.spot && pos.spot > 0) spot = pos.spot;
    } catch {
      // keep the snapshot spot — a cold positioning read must not blank the flow ladder
    }

    return { spot, strikeTotals };
  } catch {
    return null; // honest fallback — the route renders an empty flow ladder, never a 500
  }
}
