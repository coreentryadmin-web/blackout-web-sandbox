// Night's Watch — shared per-user position enrichment orchestration.
//
// The single source of truth for "fetch a user's positions + value + verdict them".
// Both the GET /api/account/positions route and the Largo get_my_positions tool call
// this so they can never drift apart.
//
// THE SCALING RULE (preserved verbatim): this is a cache READER. For a request it
// fetches each DISTINCT (underlying, expiry) chain exactly ONCE through the shared
// single-flight cache (getNwChain), resolves the SPX desk context ONCE per request,
// and matches every strike in-memory. Upstream cost is O(distinct chains) regardless
// of user/position count — never a per-position or per-user upstream call.

import { listUserPositions } from "@/lib/db";
import {
  enrichPosition,
  valuationFromContract,
  type ContractValuation,
  type EnrichedPosition,
  type LiveMark,
} from "@/lib/nights-watch/valuation";
import { getNwChain, matchContract, nwChainKey, type NwChain } from "@/lib/nights-watch/chain-cache";
import { buildOcc, getLiveOptionMark } from "@/lib/ws/options-socket";
import { buildPositionContextMap } from "@/lib/nights-watch/position-context";
import { computeVerdict, type Verdict } from "@/lib/nights-watch/verdict";

/**
 * Load a user's saved positions and enrich each with a live valuation + the
 * deterministic Hold/Trim/Sell verdict. userId is the TRUSTED owner scope — the
 * caller (route auth() or the Largo dispatcher) is responsible for supplying the
 * authenticated user; this function never derives ownership from any other source.
 */
export async function getEnrichedPositionsForUser(
  userId: string,
  status?: "open" | "closed"
): Promise<Array<EnrichedPosition & { verdict: Verdict }>> {
  const positions = await listUserPositions(userId, status);
  // Batch by (underlying, expiry): each distinct chain is fetched ONCE via the shared
  // single-flight cache, then every strike is matched in-memory. Upstream cost is
  // O(distinct chains) regardless of user/position count — never a per-position call.
  const groupKeys = Array.from(new Set(positions.map((p) => nwChainKey(p.ticker, p.expiry))));
  const chains = new Map<string, NwChain | null>();
  await Promise.all(
    groupKeys.map(async (key) => {
      const [root, exp] = key.split("|");
      chains.set(key, await getNwChain(root, exp).catch(() => null));
    })
  );
  // Resolve a fresh live WS mark per position (in-memory store first, Redis
  // fallback). Best-effort: any miss yields null and the valuation cleanly
  // falls back to the cached snapshot mark, so a WS outage never degrades this.
  const liveMarks = new Map<number, LiveMark | null>();
  await Promise.all(
    positions.map(async (p) => {
      try {
        const occ = buildOcc(p.ticker, p.expiry, p.option_type, p.strike);
        if (occ) liveMarks.set(p.id, await getLiveOptionMark(occ));
      } catch {
        /* live mark optional — snapshot fallback covers it */
      }
    })
  );

  // Cross-tool context resolved ONCE per request, keyed by underlying. For SPX
  // this is a single shared, cached desk read (O(distinct underlyings) — never a
  // per-position or per-user upstream call). Non-SPX underlyings get empty
  // context in v1, so the verdict engine only uses on-position data for them.
  const contextMap = await buildPositionContextMap(positions.map((p) => p.ticker));

  return positions.map((p) => {
    const chain = chains.get(nwChainKey(p.ticker, p.expiry)) ?? null;
    let valuation: ContractValuation | null = null;
    if (chain) {
      const contract = matchContract(chain.contracts, p.strike, p.option_type);
      if (contract) {
        valuation = valuationFromContract(contract, chain.spot, liveMarks.get(p.id) ?? null);
      }
    }
    const enrichedPosition = enrichPosition(p, valuation);
    const ctx = contextMap.get(p.ticker.trim().toUpperCase());
    // Deterministic, pure, free verdict — every action traces to named signals.
    const verdict = computeVerdict(enrichedPosition, ctx);
    return { ...enrichedPosition, verdict };
  });
}
