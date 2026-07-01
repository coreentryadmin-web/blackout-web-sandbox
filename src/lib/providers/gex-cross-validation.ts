import "server-only";

/**
 * GEX cross-validation via UW per-strike dealer gamma.
 *
 * Prefers the UW `gex_strike_expiry:TICKER` WebSocket ladder when the channel is
 * fresh (zero REST RPS). Falls back to `/api/stock/{ticker}/spot-exposures/strike`
 * cached for 60s when WS data is unavailable.
 *
 * Usage: call `validateGexAgainstUW(ticker, primaryGexWalls)` after getGexPositioning()
 * returns — it does NOT block the primary data path and only logs divergences.
 *
 * Matching is sign-aware: call wall ↔ max positive UW net GEX, put wall ↔ max negative,
 * flip ↔ zero-crossing on the UW ladder (same semantics as Polygon computeGexRegime).
 */

import { fetchUwSpotExposuresByStrike } from "@/lib/providers/unusual-whales";
import {
  crossValidateGexLevels,
  type GexCrossValidationCoreResult,
} from "@/lib/providers/gex-cross-validation-core";
import { getGexStrikeExpiryLadder, isUwChannelFresh } from "@/lib/ws/uw-socket";

// ---------------------------------------------------------------------------
// In-process 60-second cache (avoids hammering the UW 2 RPS budget).
// One entry per ticker — in practice only "SPX" is used.
// ---------------------------------------------------------------------------
type CacheEntry = {
  strikeLadder: Map<number, number>; // strike → net_gex
  cachedAt: number;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/**
 * Build (or return cached) per-strike GEX map from UW WS (preferred) or REST fallback.
 * Each entry: strike → net_gex (call_gamma_oi + put_gamma_oi in the UW normalized shape).
 */
async function getUwStrikeLadder(ticker: string): Promise<Map<number, number> | null> {
  const key = ticker.toUpperCase();
  const entry = cache.get(key);
  if (entry && Date.now() - entry.cachedAt < CACHE_TTL_MS) {
    return entry.strikeLadder;
  }

  if (isUwChannelFresh("gex_strike_expiry", 120_000)) {
    const ws = getGexStrikeExpiryLadder(key);
    if (ws && ws.ladder.size > 0) {
      cache.set(key, { strikeLadder: ws.ladder, cachedAt: ws.updatedAt });
      return ws.ladder;
    }
  }

  let rows: Record<string, unknown>[];
  try {
    rows = await fetchUwSpotExposuresByStrike(key, 500);
  } catch {
    return null; // UW unavailable — cross-validation is best-effort only
  }

  if (!rows || rows.length === 0) return null;

  const ladder = new Map<number, number>();
  for (const r of rows) {
    const strike = Number(r.strike ?? r.strike_price);
    if (!Number.isFinite(strike) || strike <= 0) continue;
    const callG = Number(r.call_gamma_oi ?? r.call_gex ?? r.call_gamma ?? 0);
    const putG = Number(r.put_gamma_oi ?? r.put_gex ?? r.put_gamma ?? 0);
    const net = (Number.isFinite(callG) ? callG : 0) + (Number.isFinite(putG) ? putG : 0);
    ladder.set(strike, net);
  }

  if (ladder.size === 0) return null;

  cache.set(key, { strikeLadder: ladder, cachedAt: Date.now() });
  return ladder;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type GexCrossValidationResult = Omit<GexCrossValidationCoreResult, "uw"> & {
  /** ISO timestamp of when the UW ladder was fetched (cached). */
  uw_asof: string | null;
};

/**
 * Cross-validate primary GEX walls against the UW per-strike dealer gamma ladder.
 * WS-first when `gex_strike_expiry` is fresh; REST cached 60s otherwise.
 * Returns null when UW data is not available (never blocks the primary path).
 */
export async function validateGexAgainstUW(
  ticker: string,
  primary: { callWall: number | null; putWall: number | null; gammaFlip: number | null },
  opts?: { spot?: number }
): Promise<GexCrossValidationResult | null> {
  const ladder = await getUwStrikeLadder(ticker).catch(() => null);
  if (!ladder || ladder.size === 0) return null;

  const core = crossValidateGexLevels(primary, ladder, { spot: opts?.spot });
  if (!core) return null;

  const entry = cache.get(ticker.toUpperCase());
  const uw_asof = entry ? new Date(entry.cachedAt).toISOString() : null;

  const { uw: _uw, ...rest } = core;
  return { ...rest, uw_asof };
}
