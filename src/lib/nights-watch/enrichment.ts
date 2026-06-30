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

import { listUserPositions, listRecentClosedUserPositions, type UserPositionRow } from "@/lib/db";
import { withServerCache } from "@/lib/server-cache";
import {
  enrichPosition,
  valuationFromContract,
  valuationFromSnapshot,
  type ContractValuation,
  type EnrichedPosition,
  type LiveMark,
  type ValuationUnavailableReason,
} from "@/lib/nights-watch/valuation";
import { getNwChain, matchContract, nwChainKey, type NwChain } from "@/lib/nights-watch/chain-cache";
import { getOptionSnapshot, type OptionSnapshot } from "@/lib/providers/options-snapshot";
import { buildOcc, getLiveOptionMark } from "@/lib/ws/options-socket";
import { buildPositionContextMap } from "@/lib/nights-watch/position-context";
import { computeVerdict, type Verdict } from "@/lib/nights-watch/verdict";

/**
 * SCALING (cache-reader rule): the Night's Watch panel polls this every ~5s, PER USER.
 * Uncached that is one Postgres SELECT (plus a per-position cache-read fan-out for WS
 * marks + snapshots) on EVERY poll — ~400 q/s at 1000 users, multiplied by every open
 * tab and every rapid re-poll. We wrap the WHOLE enrich pass (DB load + valuation) in a
 * SHORT per-user single-flight cache so a user's concurrent tabs / back-to-back polls
 * collapse to ONE DB read + ONE valuation pass per window.
 *
 * Why this TTL: 3s is comfortably BELOW the 5s poll cadence, so each genuine poll still
 * gets a fresh build — the cache only ever absorbs the DUPLICATE load (multi-tab, rapid
 * re-fire, the React-StrictMode double-mount). P&L therefore stays at most ~3s old, never
 * minutes-stale. staleWhileRevalidate is DISABLED so an expired entry forces a blocking
 * refresh (concurrent callers during that refresh still dedup via the inflight map) rather
 * than handing back an older snapshot — we never serve stale P&L to keep the figure honest.
 *
 * Correctness on mutation: POST/PATCH/DELETE return the mutated row to the client
 * immediately (optimistic), and this 3s window self-heals on the next poll, so a just
 * created/closed/edited position is reflected within one cadence — no explicit bust needed.
 *
 * Keyed by (userId, view) so the panel's default (open+recent-closed) view and any explicit
 * status filter never share an entry. userId is the TRUSTED Clerk scope — it never derives
 * ownership from anything else, so one user can never read another's cache entry.
 */
const ENRICHED_POSITIONS_TTL_MS = 3_000;

/**
 * Load a user's saved positions and enrich each with a live valuation + the
 * deterministic Hold/Trim/Sell verdict. userId is the TRUSTED owner scope — the
 * caller (route auth() or the Largo dispatcher) is responsible for supplying the
 * authenticated user; this function never derives ownership from any other source.
 *
 * Wrapped in the short per-user single-flight cache (see ENRICHED_POSITIONS_TTL_MS) so
 * concurrent/duplicate polls collapse to one DB read + valuation pass.
 */
export async function getEnrichedPositionsForUser(
  userId: string,
  status?: "open" | "closed"
): Promise<Array<EnrichedPosition & { verdict: Verdict }>> {
  const view = status ?? "all";
  return withServerCache(
    `nw:enriched:${userId}:${view}`,
    ENRICHED_POSITIONS_TTL_MS,
    async () => {
      const positions = await listUserPositions(userId, status);
      return enrichPositionRows(positions);
    },
    // localOnly: this per-user payload is built from THIS replica's in-memory WS marks and
    // expires in 3s — pushing thousands of ephemeral per-user blobs to shared Redis would only
    // pollute it. The in-flight single-flight dedup (the actual scaling win) is replica-local
    // anyway, which is exactly where a user's concurrent tabs / rapid polls land.
    { staleWhileRevalidate: false, localOnly: true }
  );
}

/**
 * The Night's Watch panel default view: a user's OPEN positions PLUS their recently
 * CLOSED (settled) positions, bounded so the closed set can never grow unbounded
 * (closed within the last `withinDays` days, capped at `limit`). Both sets are enriched
 * in ONE shared batch — distinct (underlying, expiry) chains are deduped ACROSS open and
 * closed together, so adding the closed tail costs at most a few extra cache reads and
 * never an extra upstream fetch per the cache-reader scaling rule. Closed legs run a null
 * valuation (no live quote) but carry realized_pnl from enrichPosition; open legs are
 * unchanged. Open positions always come first, then closed (newest-settled first).
 */
export async function getEnrichedOpenAndRecentClosedForUser(
  userId: string,
  { withinDays = 7, limit = 20 }: { withinDays?: number; limit?: number } = {}
): Promise<Array<EnrichedPosition & { verdict: Verdict }>> {
  // Short per-user single-flight cache (see ENRICHED_POSITIONS_TTL_MS): this is the panel's
  // DEFAULT poll path, so it is the hottest. Concurrent tabs / rapid re-polls collapse to one
  // DB read (both queries) + one valuation pass; SWR off so we never serve stale P&L. The
  // (withinDays, limit) shape is folded into the key so a non-default bound can't alias.
  return withServerCache(
    `nw:enriched:${userId}:default:${withinDays}:${limit}`,
    ENRICHED_POSITIONS_TTL_MS,
    async () => {
      const [open, closed] = await Promise.all([
        listUserPositions(userId, "open"),
        listRecentClosedUserPositions(userId, { withinDays, limit }),
      ]);
      return enrichPositionRows([...open, ...closed]);
    },
    // localOnly: same rationale as getEnrichedPositionsForUser — replica-local, ephemeral.
    { staleWhileRevalidate: false, localOnly: true }
  );
}

/**
 * Shared enrichment core — takes already-loaded rows and applies the batched, cache-reading
 * valuation + verdict to each. Splitting the load from the enrich lets callers compose a
 * combined open+closed set (panel default) while still deduping chains across the whole set.
 */
async function enrichPositionRows(
  positions: UserPositionRow[]
): Promise<Array<EnrichedPosition & { verdict: Verdict }>> {
  // Batch by (underlying, expiry): each distinct chain is fetched ONCE via the shared
  // single-flight cache, then every strike is matched in-memory. Upstream cost is
  // O(distinct chains) regardless of user/position count — never a per-position call.
  const strikesByKey = new Map<string, number[]>();
  for (const p of positions) {
    const key = nwChainKey(p.ticker, p.expiry);
    const arr = strikesByKey.get(key) ?? [];
    arr.push(p.strike);
    strikesByKey.set(key, arr);
  }
  const groupKeys = Array.from(new Set(positions.map((p) => nwChainKey(p.ticker, p.expiry))));
  const chains = new Map<string, NwChain | null>();
  await Promise.all(
    groupKeys.map(async (key) => {
      const [root, exp] = key.split("|");
      chains.set(key, await getNwChain(root, exp, strikesByKey.get(key) ?? []).catch(() => null));
    })
  );
  // Build each position's OCC ONCE and reuse it for both the live WS mark and the
  // per-OCC unified-snapshot read (a malformed OCC simply yields null on both → chain path).
  const occByPosition = new Map<number, string | null>();
  for (const p of positions) {
    let occ: string | null = null;
    try {
      occ = buildOcc(p.ticker, p.expiry, p.option_type, p.strike);
    } catch {
      occ = null;
    }
    occByPosition.set(p.id, occ);
  }

  // Resolve a fresh live WS mark per position (in-memory store first, Redis
  // fallback). Best-effort: any miss yields null and the valuation cleanly
  // falls back to the cached snapshot/chain mark, so a WS outage never degrades this.
  const liveMarks = new Map<number, LiveMark | null>();
  await Promise.all(
    positions.map(async (p) => {
      const occ = occByPosition.get(p.id);
      if (!occ) return;
      try {
        liveMarks.set(p.id, await getLiveOptionMark(occ));
      } catch {
        /* live mark optional — snapshot/chain fallback covers it */
      }
    })
  );

  // Read the warmed per-OCC unified snapshot per position (cache READER — in-mem first,
  // Redis fallback; never an upstream call on this read path). A miss yields null and the
  // valuation cleanly falls back to the EXISTING chain path, so this is purely additive.
  const snapshots = new Map<number, OptionSnapshot | null>();
  await Promise.all(
    positions.map(async (p) => {
      const occ = occByPosition.get(p.id);
      if (!occ) return;
      try {
        snapshots.set(p.id, await getOptionSnapshot(occ));
      } catch {
        /* snapshot optional — chain fallback covers it */
      }
    })
  );

  // Cross-tool context resolved ONCE per request, keyed by underlying. For SPX
  // this is a single shared, cached desk read (O(distinct underlyings) — never a
  // per-position or per-user upstream call). Non-SPX underlyings get empty
  // context in v1, so the verdict engine only uses on-position data for them.
  const contextMap = await buildPositionContextMap(positions.map((p) => p.ticker));

  return positions.map((p) => {
    const liveMark = liveMarks.get(p.id) ?? null;
    let valuation: ContractValuation | null = null;

    // VALUATION SOURCE PRIORITY (WS mark is folded into both snapshot + chain valuers, so it
    // is honored FIRST regardless of which body runs):
    //   1. WS mark → 2. per-OCC unified snapshot → 3. chain (matchContract) → 4. none.
    // The per-OCC snapshot carries the SAME Massive fields as the chain, so when present it
    // yields the identical valuation. When ABSENT (cache miss / warm not run / parse skip), we
    // fall through to the EXISTING chain path UNCHANGED — the chain stays the fallback.
    const snap = snapshots.get(p.id) ?? null;
    // Identity guard (cheap money-safety): only trust a snapshot whose contract identity
    // (strike / type / expiry) matches the position. If buildOcc and Massive's OCC normalization
    // ever disagree (adjusted / non-standard strikes), a mismatched snapshot is ignored → clean
    // fall-through to the chain path, which re-matches strike+type in matchContract.
    const snapMatches =
      snap != null &&
      snap.optionType === p.option_type &&
      snap.strike != null &&
      Math.abs(snap.strike - p.strike) <= 0.005 &&
      snap.expiry === String(p.expiry).slice(0, 10);
    // Track whether the CONTRACT was located at all (in either source) so a null valuation can be
    // explained as 'no-quote' (found, no price) vs 'contract-not-found' (the unlisted case).
    let contractFound = false;
    if (snap && snapMatches) {
      contractFound = true;
      valuation = valuationFromSnapshot(snap, liveMark);
    }
    if (!valuation) {
      const chain = chains.get(nwChainKey(p.ticker, p.expiry)) ?? null;
      if (chain) {
        const contract = matchContract(chain.contracts, p.strike, p.option_type);
        if (contract) {
          contractFound = true;
          valuation = valuationFromContract(contract, chain.spot, liveMark);
        }
      }
    }

    // Reason hint for an unavailable valuation (ignored when live): the contract was located but
    // carried no usable price → 'no-quote'; never located in snapshot or chain → 'contract-not-found'
    // (the expected outcome for an UNLISTED / non-existent contract — not a system fault).
    const unavailableReason: ValuationUnavailableReason = valuation
      ? "unknown"
      : contractFound
        ? "no-quote"
        : "contract-not-found";
    const enrichedPosition = enrichPosition(p, valuation, new Date(), false, unavailableReason);
    const ctx = contextMap.get(p.ticker.trim().toUpperCase());
    // Deterministic, pure, free verdict — every action traces to named signals.
    const verdict = computeVerdict(enrichedPosition, ctx);
    return { ...enrichedPosition, verdict };
  });
}
