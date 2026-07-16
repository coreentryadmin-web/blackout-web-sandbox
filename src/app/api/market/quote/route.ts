import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { indexStore } from "@/lib/ws/polygon-socket";
import { resolveOptionsRoot } from "@/lib/providers/polygon-options-gex";
import { fetchStockSnapshot, fetchIndexSnapshot } from "@/lib/providers/polygon";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/market/quote?ticker=SPY
 *
 * A tiny, scalable spot-price tape for the Heat Maps GEX header — designed to be
 * polled fast (~1.5s) WITHOUT pressuring upstream, so the header price updates live
 * while the gamma matrix stays on its own 5s cache.
 *
 * Two resolution paths:
 *  - INDEX (SPX/NDX/RUT/VIX → I:*): when a TRUE real-time WS price exists in the
 *    `indexStore` (fed by wss://socket.massive.com/indices), read it directly →
 *    `source:'ws'`. No upstream call at all. If that store entry is missing/stale
 *    (socket cold, or an index like NDX/RUT that has no WS subscription), fall back
 *    to the index REST snapshot, shared-cached ~1.5s.
 *  - STOCK/ETF (SPY, QQQ, IWM, NVDA, …): `fetchStockSnapshot`, shared-cached ~1.5s
 *    (in-memory Map + Redis `quote:{ticker}`) so 500 users collapse to ~one REST
 *    call per ticker per ~1.5s → `source:'rest'`.
 *
 * Never throws, never fabricates: any failure/empty → `{ available:false }` (200).
 */

type QuotePayload = {
  available: true;
  ticker: string;
  price: number;
  change_pct: number;
  source: "ws" | "rest";
  asof: string;
};

/** Index roots that have a LIVE WS subscription in `indexStore`. */
const WS_INDEX_KEYS = new Set(Object.keys(indexStore));
/** A WS index entry older than this is treated as cold → REST fallback. */
const WS_STALE_MS = 10_000;
/** Shared REST cache window — one upstream call per ticker per 5s across all users. */
const QUOTE_CACHE_MS = 5_000;
/** Redis TTL must be an integer ≥1s; 6s comfortably covers the 5s window. */
const QUOTE_REDIS_TTL_SEC = 6;
/**
 * Negative-result cache window. Without this, a sustained upstream outage (vendor 404s,
 * timeouts) meant every poll from every open tab, on every replica, re-hit the upstream with
 * zero backoff — wasted vendor-call budget for the duration of the outage. Shorter than
 * QUOTE_CACHE_MS since a failure is more time-sensitive to clear than a healthy quote is to
 * refresh (a real recovery should be picked up quickly once the vendor is back).
 */
const QUOTE_FAILURE_CACHE_MS = 3_000;

/** Per-process REST cache (in-memory L1), shared across all concurrent requests. */
const quoteMem = new Map<string, { at: number; payload: QuotePayload }>();
/** Coalesce concurrent REST fetches for the same ticker into one upstream call. */
const inflight = new Map<string, Promise<QuotePayload | null>>();
/** Per-ticker timestamp of the most recent REST quote failure — see QUOTE_FAILURE_CACHE_MS. */
const quoteFailureMem = new Map<string, number>();
/**
 * Tickers currently mid-outage that have already logged a warning. Cleared on the next
 * success, so a genuine break still surfaces exactly one log line per outage (not silenced
 * forever), while a sustained vendor outage doesn't produce a wall of repeat warnings.
 */
const quoteFailureWarned = new Set<string>();

function isIndexRoot(optionsRoot: string): boolean {
  return optionsRoot.startsWith("I:");
}

/**
 * Records a REST quote failure for the negative cache and logs at most once per outage
 * (see quoteFailureWarned) — a sustained vendor outage (e.g. a snapshot-cache blip over a
 * long weekend) produces one warning at the start, not one per poll for the outage's duration.
 */
function recordQuoteFailure(ticker: string, detail: string): void {
  quoteFailureMem.set(ticker, Date.now());
  if (quoteFailureMem.size > 200) quoteFailureMem.clear();
  if (!quoteFailureWarned.has(ticker)) {
    quoteFailureWarned.add(ticker);
    console.warn(`[market/quote] REST quote failing for ${ticker} (further repeats suppressed until it recovers): ${detail}`);
  }
}

/**
 * Shared-cached REST quote: in-memory L1 → Redis L2 → coalesced upstream fetch.
 * Used for BOTH stocks (stock snapshot) and the index REST fallback (index snapshot).
 * Returns null on failure/empty (caller emits { available:false }). Never throws.
 */
async function getRestQuote(
  ticker: string,
  optionsRoot: string,
  isIndex: boolean
): Promise<QuotePayload | null> {
  const now = Date.now();

  // Negative cache — a recent failure for this ticker skips straight to { available:false }
  // instead of re-hitting a possibly-still-down upstream on every poll.
  const failedAt = quoteFailureMem.get(ticker);
  if (failedAt != null && now - failedAt < QUOTE_FAILURE_CACHE_MS) return null;

  // L1 — in-memory, fresh within the ~1.5s window.
  const mem = quoteMem.get(ticker);
  if (mem && now - mem.at < QUOTE_CACHE_MS) return mem.payload;

  // L2 — Redis (cross-replica), so staggered polls across instances also collapse.
  try {
    const hit = await sharedCacheGet<{ at: number; payload: QuotePayload }>(`quote:${ticker}`);
    if (hit && now - hit.at < QUOTE_CACHE_MS) {
      quoteMem.set(ticker, hit);
      return hit.payload;
    }
  } catch {
    /* redis optional — fall through to upstream */
  }

  // Coalesce concurrent upstream fetches for this ticker into one in-flight promise.
  const existing = inflight.get(ticker);
  if (existing) return existing;

  const task = (async (): Promise<QuotePayload | null> => {
    try {
      // Index REST fallback uses the indices snapshot endpoint (I:* roots aren't on
      // the stocks snapshot); stocks/ETFs use the stocks snapshot endpoint.
      const snap = isIndex
        ? await fetchIndexSnapshot(optionsRoot)
        : await fetchStockSnapshot(ticker);
      if (!snap || !(snap.price > 0)) {
        recordQuoteFailure(ticker, "empty/zero-price snapshot");
        return null;
      }

      const payload: QuotePayload = {
        available: true,
        ticker,
        price: snap.price,
        change_pct: snap.change_pct,
        source: "rest",
        asof: new Date().toISOString(),
      };
      const entry = { at: Date.now(), payload };
      // Bound the in-memory map so an unusual spread of tickers can't grow it unbounded.
      if (quoteMem.size > 200) quoteMem.clear();
      quoteMem.set(ticker, entry);
      void sharedCacheSet(`quote:${ticker}`, entry, QUOTE_REDIS_TTL_SEC).catch(() => {});
      quoteFailureMem.delete(ticker);
      quoteFailureWarned.delete(ticker);
      return payload;
    } catch (err) {
      recordQuoteFailure(ticker, err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      inflight.delete(ticker);
    }
  })();

  inflight.set(ticker, task);
  return task;
}

export async function GET(req: NextRequest) {
  const authResult = await authorizeMarketDeskApi(req);
  if (authResult instanceof Response) return authResult;

  // Boot the index WS lazily (same lazy init the other market routes use) so the
  // indexStore is live for the WS path. Idempotent and never throws.
  ensureDataSockets();

  const ticker = (req.nextUrl.searchParams.get("ticker") || "SPY").toUpperCase();
  // §3.4: validate BEFORE any paid upstream call / cache key / telemetry key. An arbitrary-length
  // or arbitrary-charset ticker would waste a paid Massive snapshot and inflate telemetry/cache
  // cardinality. Same allowlist as ticker-search; 400 so bad input is loud, not silently absorbed.
  if (!/^[A-Z0-9.\-]{1,8}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const { optionsRoot } = resolveOptionsRoot(ticker);
  const isIndex = isIndexRoot(optionsRoot);

  const noStore = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  } as const;

  try {
    // ── WS path: true real-time index price straight from the live indexStore. ──
    if (isIndex && WS_INDEX_KEYS.has(optionsRoot)) {
      const entry = indexStore[optionsRoot];
      const ageMs = Date.now() - entry.updatedAt;
      if (entry.price > 0 && ageMs < WS_STALE_MS) {
        const payload: QuotePayload = {
          available: true,
          ticker,
          price: entry.price,
          change_pct: entry.change_pct,
          source: "ws",
          asof: new Date(entry.updatedAt).toISOString(),
        };
        return NextResponse.json(payload, { headers: noStore });
      }
      // else: store cold/stale → fall through to the shared-cached index REST snapshot.
    }

    // ── REST path: stocks/ETFs, plus index roots without a live WS feed (NDX/RUT)
    //    or a cold index store. Shared-cached ~1.5s so 500 users → ~1 upstream/1.5s. ──
    const payload = await getRestQuote(ticker, optionsRoot, isIndex);
    if (payload) return NextResponse.json(payload, { headers: noStore });

    return NextResponse.json({ available: false, ticker }, { status: 200, headers: noStore });
  } catch (error) {
    // Defensive — getRestQuote already swallows; never throw, never fabricate.
    console.error("[market/quote]", error);
    return NextResponse.json({ available: false, ticker }, { status: 200, headers: noStore });
  }
}
