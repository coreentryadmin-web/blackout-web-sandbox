import { computeGexWalls, type GexWalls } from "@/lib/providers/gex-wall-levels";
import {
  gexLadderAtSpot,
  gammaFlipFromLadder,
  type ReconstructContract,
} from "./vector-gex-reconstruct";
import { expiriesForHorizon, type VectorDteHorizon } from "./vector-dte-horizon";
import { VECTOR_WALL_NODES_PER_SIDE } from "./vector-bar-timeframes";

/**
 * PURE per-expiry GEX-walls core — the horizon-aware math behind DTE walls for ANY
 * optionable ticker (not just the 3 UW-oracle names). Kept dependency-light (no
 * network, no cache, no Date.now — `todayYmd` is passed in) so it's deterministic
 * and unit-testable; the network/Redis shell lives in vector-dte-walls-server.ts.
 *
 * Why this exists: the DTE toggle (0DTE/weekly/monthly/all) re-scopes the walls to a
 * days-to-expiry horizon. That used to require UW's per-expiry gamma-ladder WS feed,
 * which only the oracle tickers carry. But the Polygon options chain we already fetch
 * carries per-contract EXPIRY + OI + IV, so we can filter the chain to the horizon's
 * expiries and recompute the GEX ladder at spot with the SAME closed-form BSM math the
 * reconstruction engine uses (gexLadderAtSpot) — giving real per-expiry walls for every
 * ticker. No fabrication: gamma is standard BSM, OI/IV are the provider's snapshot.
 */
export type PerExpiryWalls = { walls: GexWalls; flip: number | null };

/**
 * Filter a chain to the horizon's expiries and compute walls + gamma flip at `spot`.
 *
 * Returns null (never throws, never fabricates) when there's no honest wall to draw:
 * bad spot, no contracts, no expiry inside the horizon, or an empty ladder after
 * filtering. A null here is the caller's signal to fall back to the blended near-term
 * walls rather than blank the overlay.
 *
 * Note the horizon filter uses `expiriesForHorizon`, which already applies the honest
 * "nearest expiry" fallback (e.g. a 0DTE horizon over a weekend snaps to the next
 * live expiry instead of returning empty), so a bounded horizon with no exact match
 * still yields walls — it just scopes to the closest real expiry.
 */
export function perExpiryWallsFromContracts(
  contracts: readonly ReconstructContract[],
  spot: number,
  horizon: VectorDteHorizon,
  todayYmd: string
): PerExpiryWalls | null {
  if (!(spot > 0) || contracts.length === 0) return null;

  const expiries = [...new Set(contracts.map((c) => c.expiry))].sort();
  const scoped = new Set(expiriesForHorizon(expiries, horizon, todayYmd));
  if (scoped.size === 0) return null;

  const filtered = contracts.filter((c) => scoped.has(c.expiry));
  if (filtered.length === 0) return null;

  // WALLS use the volume-adjusted ladder (OI + today's traded volume) so a strike printing heavy
  // volume NOW becomes a wall NOW — mid-session births/deaths (member-caught; OI-only strength
  // froze the dominant set at the open). Point-in-time honest: this path reads the chain at THIS
  // moment; the back-projected reconstruction stays OI-only.
  const wallLadder = gexLadderAtSpot(filtered, spot, todayYmd, { volumeAdjusted: true });
  if (wallLadder.size === 0) return null;

  // The FLIP must come from the OI-ONLY ladder. Volume is UNSIGNED — we cannot know whether
  // today's prints opened or closed dealer positioning — so blending it into a SIGNED
  // zero-crossing poisons the sign: SPX's giant same-day 0DTE put volume dragged the flip from
  // ~7,522 to ~7,000 (inside the ±12% plausibility band) and the regime banner told members
  // "LONG GAMMA — fade extremes" while the terminal/dashboard/Largo all correctly said short
  // (QA sweep #4, N4-1, regression from a63f162). Magnitude ranking tolerates the proxy; the
  // regime boundary does not.
  const oiLadder = gexLadderAtSpot(filtered, spot, todayYmd);
  const walls = computeGexWalls(wallLadder, { maxPerSide: VECTOR_WALL_NODES_PER_SIDE });
  const flip = oiLadder.size > 0 ? gammaFlipFromLadder(oiLadder, spot) : null;
  return { walls, flip };
}
