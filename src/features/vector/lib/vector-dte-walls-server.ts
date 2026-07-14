import "server-only";

import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { normalizeVectorTicker } from "./vector-ticker";
import { loadCurrentChainContracts } from "./vector-gex-reconstruct-server";
import { gexLadderAtSpot } from "./vector-gex-reconstruct";
import {
  perExpiryWallsFromContracts,
  type PerExpiryWalls,
} from "./vector-dte-walls-core";
import { resolveHorizonExpiries, type VectorDteHorizon } from "./vector-dte-horizon";

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

/**
 * Horizon-scoped per-strike net-GEX totals for the GEX ladder panel — the SAME reconstruction
 * ladder (`gexLadderAtSpot`) that backs the DTE walls, but returned as the full `{strike: netGex}`
 * map the ladder renders (not just the top walls). Lets the side-panel ladder follow the chart's
 * DTE toggle: 0DTE / weekly / monthly scope to the horizon's expiries; "all" stays on the near-term
 * heatmap path (handled by the route, not here). Reuses the same Redis-cached banded chain the walls
 * use — no extra provider load. Returns null (never throws/fabricates) on any gap so the route can
 * fall back to the near-term aggregate rather than blank the panel.
 */
export async function getHorizonStrikeTotals(
  ticker: string,
  horizon: VectorDteHorizon
): Promise<{
  spot: number;
  strikeTotals: Record<string, number>;
  /** Honesty signal (P1-B): true + the shown expiry when the requested horizon had no in-window
   *  expiry and this ladder is really the NEAREST expiry (so the route/UI can label it honestly). */
  scope: { isFallback: boolean; fallbackExpiry: string | null };
} | null> {
  const t = normalizeVectorTicker(ticker);
  try {
    const pos = await getGexPositioning(t);
    const spot = pos?.spot;
    if (!(spot && spot > 0)) return null;
    const contracts = await loadCurrentChainContracts(t, spot);
    if (!contracts.length) return null;
    const today = todayEtYmd();
    const expiries = [...new Set(contracts.map((c) => c.expiry))].sort();
    // resolveHorizonExpiries (not just expiriesForHorizon) so we learn whether the horizon FELL
    // BACK to the nearest expiry — the "0DTE silently shows 07-15" mislabel the route must surface.
    const resolution = resolveHorizonExpiries(expiries, horizon, today);
    const scopedSet = new Set(resolution.expiries);
    if (scopedSet.size === 0) return null;
    const filtered = contracts.filter((c) => scopedSet.has(c.expiry));
    if (!filtered.length) return null;
    const ladder = gexLadderAtSpot(filtered, spot, today);
    if (ladder.size === 0) return null;
    const strikeTotals: Record<string, number> = {};
    for (const [strike, gex] of ladder) strikeTotals[String(strike)] = gex;
    return {
      spot,
      strikeTotals,
      scope: { isFallback: resolution.isFallback, fallbackExpiry: resolution.fallbackExpiry },
    };
  } catch {
    return null; // honest fallback — the route drops back to the near-term heatmap
  }
}

/** Test-only reset of the request-coalescing memo. */
export function _resetPerExpiryWallsMemoForTest(): void {
  memo.clear();
}

export { perExpiryWallsFromContracts } from "./vector-dte-walls-core";
