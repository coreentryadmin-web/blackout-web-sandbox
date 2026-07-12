import "server-only";

import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { normalizeVectorTicker } from "./vector-ticker";
import { loadCurrentChainContracts } from "./vector-gex-reconstruct-server";
import {
  perExpiryWallsFromContracts,
  type PerExpiryWalls,
} from "./vector-dte-walls-core";
import type { VectorDteHorizon } from "./vector-dte-horizon";

/**
 * Per-expiry GEX walls + gamma flip for a DTE horizon, for ANY optionable ticker.
 *
 * Non-oracle tickers (everything except SPX/SPY/QQQ) have no UW per-expiry gamma-ladder
 * WS feed, so the DTE toggle used to be hidden for them and their walls were a single
 * blended near-term aggregate. But the Polygon options chain already carries per-contract
 * EXPIRY + OI + IV, so we can compute real per-expiry walls: band the chain around the live
 * spot, filter to the horizon's expiries, and recompute the GEX ladder at spot with the same
 * closed-form BSM math the reconstruction engine uses. This is the server shell (spot + cached
 * chain fetch); the horizon math is the pure `perExpiryWallsFromContracts` core.
 *
 * Data flow: spot (getGexPositioning) → cached banded chain (loadCurrentChainContracts,
 * Redis 10min) → expiry filter (expiriesForHorizon) → ladder (gexLadderAtSpot) → walls
 * (computeGexWalls) + flip (gammaFlipFromLadder).
 *
 * Best-effort: returns null on any failure (no spot, empty chain, empty horizon, thrown
 * fetch). A null is the caller's signal to fall back to the blended near-term walls — a live
 * overlay must degrade, never error or blank.
 */

/** Short in-process memo so a walls read + a flip read for the same (ticker,horizon) share
 *  one chain fetch + one ladder computation instead of doing the work twice. The chain itself
 *  is Redis-cached 10min; this only collapses the paired walls/flip calls the route makes back
 *  to back. Deliberately tiny (a few seconds) — it's a request-coalescer, not a data cache. */
const MEMO_TTL_MS = 5_000;
type MemoEntry = { at: number; value: PerExpiryWalls | null };
const memo = new Map<string, MemoEntry>();

export async function getPerExpiryGexWalls(
  ticker: string,
  horizon: VectorDteHorizon
): Promise<PerExpiryWalls | null> {
  const t = normalizeVectorTicker(ticker);
  const memoKey = `${t}:${horizon}`;
  const cached = memo.get(memoKey);
  if (cached && Date.now() - cached.at < MEMO_TTL_MS) return cached.value;

  let value: PerExpiryWalls | null = null;
  try {
    const pos = await getGexPositioning(t);
    const spot = pos?.spot;
    if (spot && spot > 0) {
      const contracts = await loadCurrentChainContracts(t, spot);
      if (contracts.length) {
        value = perExpiryWallsFromContracts(contracts, spot, horizon, todayEtYmd());
      }
    }
  } catch {
    value = null; // live overlay: fall back, never throw
  }

  memo.set(memoKey, { at: Date.now(), value });
  return value;
}

/** Test-only reset of the request-coalescing memo. */
export function _resetPerExpiryWallsMemoForTest(): void {
  memo.clear();
}

export { perExpiryWallsFromContracts } from "./vector-dte-walls-core";
