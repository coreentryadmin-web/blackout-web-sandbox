// Night's Watch — shared, cached options-chain layer.
//
// THE SCALING RULE: Night's Watch must be a cache READER, never a per-user upstream
// caller. getNwChain wraps the upstream fetch in withServerCache (in-flight dedup +
// Redis), keyed ONLY by (underlying, expiry, ET-date) — never by user or strike. So
// 500 users holding contracts on the same chain collapse to ONE upstream fetch per
// TTL window; the marginal upstream cost of another user is ZERO.

import { withServerCache, TTL } from "@/lib/server-cache";
import { fetchNwOptionChain, type ChainContract } from "@/lib/providers/polygon-options-gex";
import { todayEt } from "@/lib/et-date";

export type NwChain = { contracts: ChainContract[]; spot: number };

export function normalizeUnderlying(ticker: string): string {
  return ticker.trim().toUpperCase();
}

/** Stable batching key: positions that share this key share one cached chain fetch. */
export function nwChainKey(ticker: string, expiry: string): string {
  return `${normalizeUnderlying(ticker)}|${expiry.slice(0, 10)}`;
}

/**
 * Cached options chain for one (underlying, expiry), shared across ALL users.
 * Returns null when unconfigured / no spot / empty band (caller → 'unavailable',
 * never a fabricated price). Caching null for the TTL also shields a failing
 * underlying from being re-hammered by every user.
 */
export async function getNwChain(
  ticker: string,
  expiry: string,
  /** Held strikes for this chain — widens the banded fetch so legs outside the spot window still match. */
  strikeHints: number[] = []
): Promise<NwChain | null> {
  const root = normalizeUnderlying(ticker);
  const exp = expiry.slice(0, 10);
  const finiteHints = strikeHints.filter((s) => Number.isFinite(s) && s > 0);
  const hintSuffix =
    finiteHints.length > 0
      ? `:s${Math.floor(Math.min(...finiteHints))}-${Math.ceil(Math.max(...finiteHints))}`
      : "";
  const cacheKey = `nw:chain:${root}:${exp}:${todayEt()}${hintSuffix}`;
  return withServerCache<NwChain | null>(cacheKey, TTL.OPTIONS_CHAIN, () =>
    fetchNwOptionChain(root, exp, 0.35, finiteHints)
  );
}

/** Exact contract match (strike + type) within an already-fetched chain. */
export function matchContract(
  contracts: ChainContract[],
  strike: number,
  optionType: "call" | "put"
): ChainContract | null {
  const match = contracts.find((c) => {
    const s = Number(c.details?.strike_price);
    const t = String(c.details?.contract_type ?? "").toLowerCase();
    return Number.isFinite(s) && Math.abs(s - strike) < 1e-6 && t === optionType;
  });
  return match ?? null;
}
