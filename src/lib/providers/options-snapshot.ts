// Massive Options UNIFIED SNAPSHOT — the BATCHABLE per-contract valuation primitive.
//
// GET /v3/snapshot?ticker.any_of=<csv of OCC tickers>&limit=250 returns a real-time
// snapshot for up to 250 specific option contracts in ONE call (Options Advanced plan).
// This lets the warm cron value the DISTINCT held contracts in O(contracts / 250) calls
// instead of fetching a strike-banded chain per (underlying, expiry) — and the mapped
// OptionSnapshot carries the SAME Massive fields the chain does (greeks/last_quote/iv/oi),
// so valuing from it produces IDENTICAL numbers. It is a FETCH OPTIMIZATION, never a
// valuation-logic change.
//
// ADDITIVE + FALLBACK-SAFE: every fetch is best-effort (catch → partial/empty map) and
// the mapper NEVER fabricates — a missing/unfound contract is skipped, an absent price is
// null. A snapshot miss degrades cleanly to the existing chain path (see enrichment.ts).
//
// SCALING: all upstream goes through the rate-limited Polygon funnel (polygonRawJson →
// polygonTrackedFetch). The per-OCC cache below (Redis + in-mem, mirroring the WS
// optionMarks/writeMarkThrough pattern) makes user-facing reads pure cache hits, so the
// READ path never makes a per-user upstream call.

import { polygonRawJson } from "./polygon-options-gex";

// ---------------------------------------------------------------------------
// Types — the VERIFIED Massive unified-snapshot result shape (options `type`)
// ---------------------------------------------------------------------------

/** Raw unified-snapshot OPTIONS result (only the fields we read; doc paths verified). */
type UnifiedSnapshotResult = {
  ticker?: string;
  type?: string;
  /** Present ONLY on an unfound-ticker row — when set we SKIP the row (never fabricate). */
  error?: string;
  message?: string;
  implied_volatility?: number;
  open_interest?: number;
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number };
  last_quote?: {
    bid?: number;
    ask?: number;
    bid_size?: number;
    ask_size?: number;
    midpoint?: number;
    last_updated?: number;
  };
  last_trade?: { price?: number; size?: number; exchange?: number };
  details?: {
    strike_price?: number;
    contract_type?: string;
    exercise_style?: string;
    expiration_date?: string;
    underlying_ticker?: string;
    /** Deliverable shares per contract — 100 standard, non-100 for corp-action-adjusted. */
    shares_per_contract?: number;
  };
  underlying_asset?: { price?: number; ticker?: string; last_updated?: number };
  session?: {
    close?: number;
    open?: number;
    high?: number;
    low?: number;
    change?: number;
    change_percent?: number;
    volume?: number;
  };
};

type UnifiedSnapshotResponse = {
  request_id?: string;
  status?: string;
  next_url?: string;
  results?: UnifiedSnapshotResult[];
};

/**
 * Normalized per-contract snapshot — the SAME data the chain ChainContract carries, so a
 * valuation built from this equals the chain valuation by construction. `mark` follows the
 * doc MARK priority (last_quote.midpoint ?? mid(bid,ask) ?? last_trade.price) and is null
 * when no usable price exists — NEVER fabricated.
 */
export type OptionSnapshot = {
  /** OCC ticker, e.g. "O:SPXW250620C05850000". */
  ticker: string;
  /** Held-contract MARK (doc priority); null when no usable price exists. */
  mark: number | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  /** Day/session close — the 4th price tier (matches the chain's day.close); null when absent. */
  dayClose: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  iv: number | null;
  openInterest: number | null;
  /** Underlying spot = underlying_asset.price; null when absent. */
  underlyingPrice: number | null;
  strike: number | null;
  optionType: "call" | "put" | null;
  /** Expiration date YYYY-MM-DD from details.expiration_date; null when absent. */
  expiry: string | null;
  /**
   * Deliverable shares per contract from details.shares_per_contract — 100 for standard
   * listed options, NON-100 for corporate-action-adjusted contracts. null when absent;
   * downstream P&L defaults to 100 in that case.
   */
  sharesPerContract: number | null;
};

// ---------------------------------------------------------------------------
// Mapper — VERIFIED doc field paths only (never inferred)
// ---------------------------------------------------------------------------

/** Massive unified-snapshot ticker.any_of MAX per request (also the limit cap). */
export const UNIFIED_SNAPSHOT_MAX_PER_CALL = 250;

function finiteOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Mid of bid/ask. bid may be 0 for deep-OTM; require ask>0 so it is a REAL quote — IDENTICAL
 * guard to the chain (valuationFromContract) and the WS midOf, so the snapshot mid equals the
 * chain mid for the same bid/ask.
 */
function midOf(bid: number | null, ask: number | null): number | null {
  if (bid != null && ask != null && ask > 0 && bid >= 0) {
    return Number(((bid + ask) / 2).toFixed(4));
  }
  return null;
}

/**
 * Map ONE unified-snapshot result → OptionSnapshot, or null to SKIP it.
 * Skips: a missing ticker, a non-options row, and an unfound-ticker row (has `error`).
 *
 * MARK priority (verified doc): last_quote.midpoint ?? mid(bid,ask) ?? last_trade.price.
 * Never fabricates — when none of those yields a finite price, mark is null.
 */
export function mapUnifiedSnapshotResult(r: UnifiedSnapshotResult): OptionSnapshot | null {
  // Unfound-ticker rows carry `error`/`message` instead of data — SKIP (never fabricate).
  if (r?.error) return null;
  const ticker = typeof r?.ticker === "string" ? r.ticker : "";
  if (!ticker) return null;
  // Defensive: the request is options-only, but skip a non-options row if one ever appears.
  if (r.type != null && r.type !== "options") return null;

  const bid = finiteOrNull(r.last_quote?.bid);
  const ask = finiteOrNull(r.last_quote?.ask);
  const last = finiteOrNull(r.last_trade?.price);
  const dayClose = finiteOrNull(r.session?.close);

  // MARK ladder — IDENTICAL to the chain's (the shared resolveMark in valuation.ts):
  // mid(bid,ask) → last trade → day/session close. We deliberately do NOT use the provider
  // `last_quote.midpoint` first (the chain has no such field and computes (bid+ask)/2), so the
  // snapshot mark matches the chain for the same bid/ask. This `mark` is a convenience value;
  // the valuer (valuationFromSnapshot) re-resolves from the raw bid/ask/last/dayClose below.
  let mark: number | null = null;
  const mid = midOf(bid, ask);
  if (mid != null && mid > 0) {
    mark = mid;
  } else if (last != null && last > 0) {
    mark = last;
  } else if (dayClose != null && dayClose > 0) {
    mark = dayClose;
  }

  const ct = String(r.details?.contract_type ?? "").toLowerCase();
  const optionType: "call" | "put" | null =
    ct === "call" ? "call" : ct === "put" ? "put" : null;

  const expRaw = r.details?.expiration_date;
  const expiry = typeof expRaw === "string" && expRaw ? expRaw.slice(0, 10) : null;

  // Deliverable shares per contract — kept REAL (non-100 for corp-action-adjusted contracts);
  // null when absent/invalid so downstream P&L defaults to 100. Require >0 to reject junk.
  const spcRaw = finiteOrNull(r.details?.shares_per_contract);
  const sharesPerContract = spcRaw != null && spcRaw > 0 ? spcRaw : null;

  const up = finiteOrNull(r.underlying_asset?.price);

  return {
    ticker,
    mark: mark != null ? Number(mark.toFixed(4)) : null,
    bid,
    ask,
    last,
    dayClose,
    delta: finiteOrNull(r.greeks?.delta),
    gamma: finiteOrNull(r.greeks?.gamma),
    theta: finiteOrNull(r.greeks?.theta),
    vega: finiteOrNull(r.greeks?.vega),
    iv: finiteOrNull(r.implied_volatility),
    openInterest: finiteOrNull(r.open_interest),
    underlyingPrice: up != null && up > 0 ? up : null,
    strike: finiteOrNull(r.details?.strike_price),
    optionType,
    expiry,
    sharesPerContract,
  };
}

/** Split an array into chunks of at most `size`. Exported for chunking tests. */
export function chunkOccs<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Per-OCC outcome diagnostics for ONE snapshot fetch — so a caller (the warm cron) can log
 * exactly which requested contracts did NOT come back priced and why, instead of only a bare
 * "warmed N/M" count. Purely observational: it NEVER changes the returned snapshot map.
 */
export type SnapshotFetchDiagnostics = {
  /** Distinct OCCs requested (after dedupe). */
  requested: number;
  /** OCCs that mapped to a usable snapshot (in the returned map). */
  found: number;
  /**
   * OCCs the provider explicitly reported as unfound/error (row carried `error`), with the
   * provider's reason string — almost always an UNLISTED / non-existent contract.
   */
  unfound: Array<{ occ: string; reason: string }>;
  /**
   * OCCs that were requested but the provider returned NO row for at all (neither data nor an
   * error row) — e.g. a chunk fetch that threw/timed out, or a contract the endpoint omitted.
   */
  missing: string[];
  /**
   * OCCs that came back as a row but with NO usable price (mark null) — a real but quote-less
   * contract (e.g. market closed with no prior session / no two-sided quote).
   */
  noQuote: string[];
};

/**
 * Fetch real-time unified snapshots for a set of OCC option tickers, keyed by OCC.
 *
 * - DEDUPES the input, CHUNKS into ≤250 (the doc cap), and issues one
 *   GET /v3/snapshot?ticker.any_of=<csv>&limit=250 per chunk through the rate-limited
 *   Polygon funnel → O(distinct OCCs / 250) calls.
 * - Maps each non-error result via mapUnifiedSnapshotResult; SKIPS error/unfound rows.
 * - BEST-EFFORT: a failed chunk contributes nothing (the partial map from other chunks is
 *   still returned); a total failure returns an empty map. Never throws.
 *
 * When `diag` is passed it is POPULATED with per-OCC outcomes (found / unfound+reason /
 * missing / no-quote) so the caller can log exactly WHICH requested contracts didn't price and
 * why — turning a silent "warmed N/M" into an actionable line. Diagnostics never change the map.
 */
export async function fetchOptionsUnifiedSnapshot(
  occs: string[],
  diag?: SnapshotFetchDiagnostics
): Promise<Map<string, OptionSnapshot>> {
  const out = new Map<string, OptionSnapshot>();
  const unique = Array.from(new Set((occs ?? []).filter((o): o is string => Boolean(o))));
  if (diag) diag.requested = unique.length;
  if (unique.length === 0) return out;

  // Track which requested OCCs we saw a row for (any row), so we can derive `missing` (no row
  // at all) afterward. The provider echoes the OCC in `ticker` even on an error/unfound row.
  const seen = new Set<string>();
  const noQuote: string[] = [];
  const unfound: Array<{ occ: string; reason: string }> = [];

  const chunks = chunkOccs(unique, UNIFIED_SNAPSHOT_MAX_PER_CALL);
  await Promise.all(
    chunks.map(async (group) => {
      try {
        const params = new URLSearchParams({
          "ticker.any_of": group.join(","),
          limit: String(UNIFIED_SNAPSHOT_MAX_PER_CALL),
        });
        const json = await polygonRawJson<UnifiedSnapshotResponse>(
          `/v3/snapshot?${params}`,
          "/v3/snapshot"
        );
        for (const r of json?.results ?? []) {
          const occ = typeof r?.ticker === "string" ? r.ticker : "";
          if (occ) seen.add(occ);
          // Unfound/error row: provider returned the OCC with an `error`/`message` (almost always
          // an UNLISTED / non-existent contract). Record the reason so warming can explain the gap.
          if (r?.error) {
            if (diag && occ) unfound.push({ occ, reason: String(r.message ?? r.error) });
            continue;
          }
          const snap = mapUnifiedSnapshotResult(r);
          if (snap) {
            out.set(snap.ticker, snap);
            // A row that mapped but has no usable price is a real-but-quote-less contract.
            if (diag && snap.mark == null) noQuote.push(snap.ticker);
          }
        }
      } catch {
        // Best-effort: a failing chunk degrades to the chain fallback for those OCCs.
      }
    })
  );

  if (diag) {
    diag.found = out.size;
    diag.unfound = unfound;
    diag.noQuote = noQuote;
    // Requested OCCs the provider returned NO row for at all (chunk threw / endpoint omitted it).
    diag.missing = unique.filter((occ) => !seen.has(occ));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Per-OCC cache (Redis + in-mem) — mirrors ws/options-socket optionMarks/writeMarkThrough
// ---------------------------------------------------------------------------

/** Cache-key prefix for the warmed unified snapshot, keyed by OCC. */
const SNAP_REDIS_PREFIX = "nw:optsnap:";

/**
 * Redis TTL for a warmed snapshot (seconds). MUST be ≥ the warm-cron interval so a
 * user-facing read between warms is a cache hit (never a per-user upstream call). The
 * cron runs ~every 60s; default 120s gives a full extra interval of slack. Tunable.
 */
const SNAP_REDIS_TTL_SEC = Math.max(
  90,
  Number(process.env.NIGHTS_WATCH_SNAPSHOT_TTL_SEC ?? 120) || 120
);

/** In-memory snapshot store keyed by OCC, with the write time for staleness checks. */
type CachedSnapshot = { snap: OptionSnapshot; ts: number };
const snapshotMem: Map<string, CachedSnapshot> = new Map();

/** Max age (ms) a cached snapshot may be on read before it's treated as stale → null. */
const SNAP_FRESH_MS = SNAP_REDIS_TTL_SEC * 1000;

/** Best-effort write-through to Redis; the in-mem layer is already updated by the caller. */
async function writeSnapshotThrough(occ: string, snap: OptionSnapshot): Promise<void> {
  try {
    const { sharedCacheSet } = await import("../shared-cache");
    await sharedCacheSet(`${SNAP_REDIS_PREFIX}${occ}`, { snap, ts: Date.now() }, SNAP_REDIS_TTL_SEC);
  } catch {
    // Redis optional — in-mem store already holds the snapshot; non-fatal.
  }
}

/**
 * Write a batch of freshly-fetched snapshots into the per-OCC cache (in-mem + Redis).
 * Called by the warm cron after fetchOptionsUnifiedSnapshot. Best-effort, never throws.
 */
export async function setOptionSnapshots(snaps: OptionSnapshot[]): Promise<void> {
  const now = Date.now();
  const writes: Promise<void>[] = [];
  for (const snap of snaps) {
    if (!snap?.ticker) continue;
    snapshotMem.set(snap.ticker, { snap, ts: now });
    writes.push(writeSnapshotThrough(snap.ticker, snap));
  }
  await Promise.all(writes);
}

/**
 * READ the warmed snapshot for an OCC: in-mem first, then Redis (cross-instance). Returns
 * null when absent OR stale (> SNAP_FRESH_MS) so the caller falls back to the chain path.
 * NEVER fabricates and NEVER makes an upstream call — pure cache reader (the scaling rule).
 */
export async function getOptionSnapshot(occ: string): Promise<OptionSnapshot | null> {
  if (!occ) return null;
  const now = Date.now();

  const local = snapshotMem.get(occ);
  if (local && now - local.ts <= SNAP_FRESH_MS) {
    return local.snap;
  }

  try {
    const { sharedCacheGet } = await import("../shared-cache");
    const hit = await sharedCacheGet<CachedSnapshot>(`${SNAP_REDIS_PREFIX}${occ}`);
    if (hit && hit.snap && typeof hit.ts === "number" && now - hit.ts <= SNAP_FRESH_MS) {
      // Re-seed the in-mem layer so subsequent reads skip Redis.
      if (!local || hit.ts > local.ts) snapshotMem.set(occ, hit);
      return hit.snap;
    }
  } catch {
    // Redis optional — fall through to null (chain fallback covers it).
  }
  return null;
}

/** Test-only: clear the in-mem snapshot cache between cases. Not used in production. */
export function _resetOptionSnapshotCacheForTest(): void {
  snapshotMem.clear();
}
