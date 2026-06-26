import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import type {
  GexFlowByStrike,
  GexDarkPoolLevel,
  GexHeatmapOverlays,
} from "@/lib/providers/polygon-options-gex";
import { fetchUwFlowPerStrikeRows, fetchUwDarkPool } from "@/lib/providers/unusual-whales";
import { isUwCircuitOpen } from "@/lib/providers/uw-rate-limiter";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { requireToolApi } from "@/lib/tool-access-server";
import { isHeatmapOverlayAllowed } from "@/lib/heatmap-allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Overlay cache. CRITICAL: fetchUwDarkPool is internally cached, but fetchUwFlowPerStrikeRows
 * is only request-COALESCED (concurrent calls collapse) — NOT cached, so staggered polls
 * would each hit UW. With UW capped at 2 RPS CLUSTER-WIDE (shared by every tool), an uncached
 * flow overlay at 500 users would starve the desk/Largo/Night Hawk. So we cache the whole
 * overlay payload per ticker (in-memory + Redis, ~30s) → the heatmap stays a true cache-reader,
 * one upstream flow fetch per ticker per TTL regardless of user count.
 */
const OVERLAY_TTL_MS = 30_000;
const overlayMem = new Map<string, { at: number; overlays: GexHeatmapOverlays }>();

/**
 * Server-side force-refresh gate. `?force=1` bypasses BOTH the in-memory and Redis matrix cache,
 * so a crafted/buggy client (or many users force-ing different tickers) could hammer the Polygon
 * chain — shared at 40 RPS with the desk / Night Hawk / Largo. We mirror the client's 8s throttle
 * server-side, PER TICKER: a force is honored only when ≥8s have elapsed since the last honored
 * force for that ticker; otherwise it's dropped and the request serves the normal cached read.
 */
const FORCE_THROTTLE_MS = 8_000;
const lastForceAt = new Map<string, number>();

/**
 * HELIX flow-per-strike overlay — net call/put premium hitting each gamma strike today.
 *
 * Reads the SHARED, server-side flow-per-strike accessor (request-coalesced upstream, so
 * 500 concurrent users collapse to one /api/stock/{ticker}/flow-per-strike-intraday call)
 * and projects it ONTO the heatmap's own strike axis — only strikes present on the matrix
 * are kept. Best-effort: any failure / empty feed → null (never fabricated, never throws).
 */
async function buildFlowByStrike(
  ticker: string,
  strikes: number[]
): Promise<Record<string, GexFlowByStrike> | null> {
  if (!strikes.length) return null;
  try {
    const rows = await fetchUwFlowPerStrikeRows(ticker, 250);
    if (!rows.length) return null;

    // Index the heatmap strikes for O(1) membership + nearest-int matching.
    const strikeSet = new Set(strikes.map((s) => String(s)));
    const byStrike: Record<string, GexFlowByStrike> = {};
    for (const row of rows) {
      const strikeRaw = Number(row.strike ?? row.strike_price);
      if (!Number.isFinite(strikeRaw) || strikeRaw <= 0) continue;
      // UW strikes can carry decimals; the heatmap axis is the canonical key. Match the
      // exact string first, then the integer form (e.g. "740.0" → "740").
      const key = strikeSet.has(String(strikeRaw))
        ? String(strikeRaw)
        : strikeSet.has(String(Math.round(strikeRaw)))
          ? String(Math.round(strikeRaw))
          : null;
      if (!key) continue;

      const callPrem = Number(row.call_premium ?? 0);
      const putPrem = Number(row.put_premium ?? 0);
      if (!Number.isFinite(callPrem) || !Number.isFinite(putPrem)) continue;
      if (callPrem === 0 && putPrem === 0) continue;

      // Multiple raw rows can map to one heatmap strike (decimal collapse) — accumulate.
      const prev = byStrike[key] ?? { call_prem: 0, put_prem: 0, net_prem: 0 };
      const call_prem = prev.call_prem + callPrem;
      const put_prem = prev.put_prem + putPrem;
      byStrike[key] = { call_prem, put_prem, net_prem: call_prem - put_prem };
    }
    return Object.keys(byStrike).length ? byStrike : null;
  } catch (err) {
    console.warn(
      `[market/gex-heatmap] flow-per-strike overlay skipped for ${ticker}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/**
 * Dark-pool overlay — top notable price levels from the SHARED, internally-cached
 * dark-pool accessor (fetchUwDarkPool uses uwCacheGet → Redis/L1, 2-min TTL). Returns
 * the largest prints by premium as price levels. Best-effort: failure / empty → null.
 */
async function buildDarkPoolLevels(ticker: string): Promise<GexDarkPoolLevel[] | null> {
  try {
    const snapshot = await fetchUwDarkPool(ticker, { limit: 50 });
    if (!snapshot || !snapshot.prints.length) return null;

    // Collapse prints to price levels (UW prints carry a bucketed `strike` = price level),
    // summing notional per level, then keep the top few by notional.
    const byLevel = new Map<number, number>();
    for (const print of snapshot.prints) {
      const price = Number(print.strike);
      const notional = Number(print.premium);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!Number.isFinite(notional) || notional <= 0) continue;
      byLevel.set(price, (byLevel.get(price) ?? 0) + notional);
    }
    if (!byLevel.size) return null;

    const levels: GexDarkPoolLevel[] = Array.from(byLevel.entries())
      .map(([price, notional]) => ({ price, notional }))
      .sort((a, b) => b.notional - a.notional)
      .slice(0, 5);
    return levels.length ? levels : null;
  } catch (err) {
    console.warn(
      `[market/gex-heatmap] dark-pool overlay skipped for ${ticker}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/** The overlay-free (matrix-only) contract — both overlays unavailable, never fabricated. */
const NO_OVERLAYS: GexHeatmapOverlays = { flow_by_strike: null, dark_pool_levels: null };

/**
 * Cached overlay enrichment — one upstream fetch per ticker per TTL, shared across all users.
 * In-memory first, then Redis (cross-replica), else compute + write both. Best-effort: a
 * Redis miss/error just recomputes; the builders themselves never throw.
 *
 * CLUSTER-WIDE UW BUDGET PROTECTION: the UW overlay fetches (flow-per-strike + dark-pool) are
 * the ONLY part of the heatmap that touches UW's 2-RPS budget. They are gated to a small
 * server-side allowlist (preset chips + known-liquid names) so 1000 users on distinct tickers
 * can't each mint a fresh UW fetch and starve the desk/Largo/Night Hawk/HELIX. Off-allowlist
 * symbols serve the overlay-free contract (matrix only) — the matrix itself is a pure Polygon
 * cache-reader and works for any ticker. A request-time circuit also drops overlays whenever the
 * UW breaker is open (a 429 storm), so the heatmap degrades to matrix-only instead of piling onto
 * a saturated UW. A warm overlay cache is STILL honored in both cases (it's already-paid data).
 */
async function getOverlays(
  ticker: string,
  strikes: number[]
): Promise<{ overlays: GexHeatmapOverlays; at: number | null }> {
  const now = Date.now();
  const mem = overlayMem.get(ticker);
  if (mem && now - mem.at < OVERLAY_TTL_MS) return { overlays: mem.overlays, at: mem.at };

  try {
    const hit = await sharedCacheGet<{ at: number; overlays: GexHeatmapOverlays }>(
      `gex-overlay:${ticker}`
    );
    if (hit && now - hit.at < OVERLAY_TTL_MS) {
      overlayMem.set(ticker, hit);
      return { overlays: hit.overlays, at: hit.at };
    }
  } catch {
    /* redis optional */
  }

  // No warm cache → decide whether we're allowed to spend a fresh UW overlay fetch.
  // (a) Off-allowlist tickers NEVER fetch overlays — serve the matrix-only contract. This is
  //     what keeps 1000 distinct-ticker users from each minting a UW fetch.
  // (b) Allowlisted tickers still drop overlays while the UW circuit breaker is open (429 storm)
  //     so the heatmap degrades to matrix-only instead of piling onto a saturated UW.
  // Neither case writes the overlay cache (we don't want to pin a `null` payload over a key that
  // a warm path could legitimately fill once the breaker clears / for a real allowlisted name).
  if (!isHeatmapOverlayAllowed(ticker)) return { overlays: NO_OVERLAYS, at: null };
  if (isUwCircuitOpen()) return { overlays: NO_OVERLAYS, at: null };

  const [flow_by_strike, dark_pool_levels] = await Promise.all([
    buildFlowByStrike(ticker, strikes),
    buildDarkPoolLevels(ticker),
  ]);
  const overlays: GexHeatmapOverlays = { flow_by_strike, dark_pool_levels };
  const entry = { at: now, overlays };
  // Bound the in-memory map so an unusual spread of tickers can't grow it unbounded.
  if (overlayMem.size > 200) overlayMem.clear();
  overlayMem.set(ticker, entry);
  void sharedCacheSet(`gex-overlay:${ticker}`, entry, Math.ceil(OVERLAY_TTL_MS / 1000)).catch(
    () => {}
  );
  return { overlays, at: now };
}

/**
 * GET /api/market/gex-heatmap?ticker=SPY
 *
 * Returns the server-cached dealer GEX heatmap (strike × expiry net dollar-gamma
 * matrix). The matrix is computed ONCE in fetchGexHeatmap and shared (in-memory +
 * Redis) across all callers — this route never triggers a per-user upstream chain
 * fetch. Premium Clerk session OR cron secret, matching the other market desk routes.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  // Launch gate — locked to non-admins until this tool ships.
  const locked = await requireToolApi("heatmap");
  if (locked) return locked;

  const ticker = (req.nextUrl.searchParams.get("ticker") || "SPY").toUpperCase();
  // Validate BEFORE any force bookkeeping or fetchGexHeatmap/getOverlays — on a cache miss
  // these trigger a paid per-ticker chain fetch + cache-key mint, so reject arbitrary input
  // up front (mirrors the quote route guard).
  if (!/^[A-Z0-9.\-]{1,8}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  // Fast-move escape hatch: `?force=1` bypasses the shared matrix cache and recomputes
  // immediately (then re-writes the cache fresh). The client only fires this on a >0.5%
  // spot divergence, throttled to ≤1/8s, so it can't pressure the chain API — a normal
  // request (no force) still reads the in-memory + Redis cache via fetchGexHeatmap.
  const forceRequested = req.nextUrl.searchParams.get("force") === "1";
  // Enforce the 8s throttle SERVER-SIDE per ticker — a buggy/crafted client can't bypass the
  // matrix cache faster than once per 8s, so force can't pressure the shared 40-RPS chain API.
  const now0 = Date.now();
  const lastForce = lastForceAt.get(ticker) ?? 0;
  const forceRefresh = forceRequested && now0 - lastForce >= FORCE_THROTTLE_MS;
  if (forceRefresh) {
    if (lastForceAt.size > 200) lastForceAt.clear();
    lastForceAt.set(ticker, now0);
  }

  try {
    const heatmap = await fetchGexHeatmap(ticker, { forceRefresh });
    if (!heatmap) {
      // Polygon unavailable / empty chain — never fabricate. Client renders empty state.
      return NextResponse.json(
        { available: false, underlying: ticker },
        {
          status: 200,
          headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
        }
      );
    }
    // Cross-tool overlays (HELIX flow-per-strike + dark-pool), cached per ticker (~30s) so the
    // route never pressures UW's 2-RPS cluster-wide budget regardless of user count.
    const { overlays, at: overlaysAt } = await getOverlays(ticker, heatmap.strikes);

    return NextResponse.json(
      {
        available: true,
        ...heatmap,
        overlays,
        // The overlay sample time (#9) — a painted dark-pool / flow-by-strike level can be
        // ~30s–2min stale on the same matrix; surface its real fetch time so the legend can
        // show "dark pool as of …" instead of implying it's as fresh as the matrix.
        overlays_at: overlaysAt != null ? new Date(overlaysAt).toISOString() : null,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("[market/gex-heatmap]", error);
    // Unify the "no data" contract: a build throw returns 200 { available:false } (same as a
    // null chain above and the quote/explain routes) so the client renders its graceful empty
    // state instead of a 502 red banner. The error is still logged server-side.
    return NextResponse.json(
      { available: false, underlying: ticker, error: "GEX heatmap build failed" },
      {
        status: 200,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
      }
    );
  }
}
