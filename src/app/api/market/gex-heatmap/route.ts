import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import type {
  GexFlowByStrike,
  GexDarkPoolLevel,
  GexHeatmapOverlays,
} from "@/lib/providers/polygon-options-gex";
import { validateGexAgainstUW } from "@/lib/providers/gex-cross-validation";
import { resolveNearTermExpiriesForCrossValidation } from "@/lib/providers/gex-cross-validation-core";
import { fetchUwFlowPerStrikeRows, fetchUwDarkPool } from "@/lib/providers/unusual-whales";
import { isUwCircuitOpen } from "@/lib/providers/uw-rate-limiter";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { requireAnyToolApi } from "@/lib/tool-access-server";
import { dbConfigured, fetchLatestNighthawkEdition } from "@/lib/db";
import { roundFloats, reconcileStrikeTotal } from "@/lib/round-floats";
import { isEtCashRth } from "@/lib/et-market-hours";

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
 * chain — shared at 40 RPS with the desk / Night Hawk / Largo. We throttle force refreshes
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

type NightHawkContext = {
  play_direction: string;
  target_strike: string | number | null;
  grade: string;
  summary: string;
} | null;

/**
 * Fetch the current Night Hawk play context for a ticker from the latest edition.
 * "Current" = most recent edition created within the last 24 hours.
 * Best-effort: any failure returns null (never throws, never fabricates).
 */
async function getNightHawkContext(ticker: string): Promise<NightHawkContext> {
  if (!dbConfigured()) return null;
  try {
    const edition = await fetchLatestNighthawkEdition();
    if (!edition) return null;
    // Only surface editions from the last 24 hours.
    const age = Date.now() - new Date(edition.published_at).getTime();
    if (age > 24 * 60 * 60 * 1000) return null;
    const plays = Array.isArray(edition.plays) ? edition.plays : [];
    const play = plays.find(
      (p) =>
        p &&
        typeof p === "object" &&
        String((p as Record<string, unknown>).ticker ?? "").toUpperCase() === ticker
    ) as Record<string, unknown> | undefined;
    if (!play) return null;
    return {
      play_direction: String(play.direction ?? ""),
      target_strike: (play.target ?? play.options_play ?? null) as string | number | null,
      grade: String(play.conviction ?? play.grade ?? ""),
      summary: String(play.thesis ?? play.key_signal ?? "").slice(0, 200),
    };
  } catch {
    return null;
  }
}

/**
 * Cached overlay enrichment — one upstream fetch per ticker per TTL, shared across all users.
 * In-memory first, then Redis (cross-replica), else compute + write both. Best-effort: a
 * Redis miss/error just recomputes; the builders themselves never throw.
 *
 * CLUSTER-WIDE UW BUDGET PROTECTION: the UW overlay fetches (flow-per-strike + dark-pool) are
 * the ONLY part of the heatmap that touches UW's 2-RPS budget. They are protected by a 30s
 * per-ticker overlay cache, single-flight coalescing, and the UW circuit breaker — so 1000
 * users on distinct tickers can't each mint a fresh UW fetch and starve the desk/Largo/Night
 * Hawk/HELIX. All tickers get overlays uniformly; the matrix itself is a pure Polygon
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

  // UW circuit breaker: degrade to matrix-only when UW is saturated (429 storm).
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

  // Launch gate — SPX Slayer left rail reads this matrix; allow spx OR heatmap launch.
  const locked = await requireAnyToolApi(["spx", "heatmap"]);
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

    // Night Hawk active-play context — best-effort Postgres read, never throws.
    const nighthawkContext = await getNightHawkContext(ticker);

    // UW cross-validation (WS-first, REST cached) — preset tickers only; never blocks response.
    //
    // heatmap.gex.call_wall/put_wall/flip are computed from Polygon's NEAR-TERM-ONLY expiries —
    // scoping the UW oracle side to match is required. This is the SAME fix gex-positioning.ts
    // got in PR #223 — this call site was missed, so the SPX matrix's "UW oracle diverges Npt"
    // banner (fed by THIS endpoint's cross_validation, not gex-positioning's) kept showing
    // scope-mismatch-inflated divergence (confirmed live 2026-07-01: 200-600pt here vs.
    // single-digit-to-low-double-digit on the already-fixed gex-positioning path for the same
    // moment — see docs/audit/FINDINGS.md). See resolveNearTermExpiriesForCrossValidation()'s
    // doc comment for why this must read `heatmap.near_term_expiries`, not a bare
    // `heatmap.expiries.slice(0, 8)`.
    let cross_validation = null;
    if (heatmap.gex) {
      const nearTermExpiries = resolveNearTermExpiriesForCrossValidation(heatmap);
      cross_validation = await validateGexAgainstUW(
        ticker,
        {
          callWall: heatmap.gex.call_wall,
          putWall: heatmap.gex.put_wall,
          gammaFlip: heatmap.gex.flip,
        },
        { spot: heatmap.spot, nearTermExpiries }
      ).catch(() => null);
    }

    // A non-null heatmap can still be UNUSABLE: fetchGexHeatmap's emptyHeatmap() fallback
    // (polygon-options-gex.ts ~2422) returns a real GexHeatmap object — never null — whenever
    // spot resolution fails (spot:0) and/or the options chain comes back with zero contracts
    // (strikes:[]). The `!heatmap` guard above only catches the null case, so this branch was
    // unconditionally stamping `available: true` on that unusable object too — a client (this
    // route's own GexHeatmap.tsx UI, plus validate-live-prod/live-fixes-audit) would see
    // available:true next to spot:0 and an empty strikes array, i.e. a "usable" flag on data
    // that has nothing real to show. Confirmed live for SPY/QQQ — see docs/audit/FINDINGS.md
    // (2026-07-05). Mirror the SAME "no usable data" contract as the `!heatmap` branch above:
    // available is true only when a real spot resolved AND the matrix actually has strikes.
    const heatmapUsable = heatmap.spot > 0 && heatmap.strikes.length > 0;

    const rounded = roundFloats({
      available: heatmapUsable,
      ...heatmap,
      cross_validation,
      overlays,
      // The overlay sample time (#9) — a painted dark-pool / flow-by-strike level can be
      // ~30s–2min stale on the same matrix; surface its real fetch time so the legend can
      // show "dark pool as of …" instead of implying it's as fresh as the matrix.
      overlays_at: overlaysAt != null ? new Date(overlaysAt).toISOString() : null,
      // Night Hawk context — null when no current play exists for this ticker.
      nighthawk_context: nighthawkContext,
    });

    // ── Off-hours shift gate (task #174, P1) ──────────────────────────────────────────
    // `shift`/`vex_shift` are diffed from the positioning-history ring ONLY when the matrix
    // cache refreshes (polygon-options-gex.ts's "SHIFT (intraday migration) — fresh compute
    // ONLY" block, ~line 2284) — that computation has ZERO market-hours awareness. Once the
    // matrix cache's last refresh happens to land during RTH, the cached shift object (with
    // its present-tense "Over the last Xh Ym: ... migrated..." summary) is served UNCHANGED
    // to every user through the entire closed period (evenings/weekends/holidays) until the
    // next refresh — reading as if the migration just happened when the market has actually
    // been closed the whole time. Confirmed live: SPX heatmap served shift.available:true
    // with a fresh-reading "Over the last 2h14m: gamma flip migrated..." summary on a closed
    // market (see docs/audit/FINDINGS.md). Same "stale content served as live" bug class as
    // task #173's market-regime staleness fix and spx-session.ts's isPremarketBriefFresh gate.
    //
    // Fix: whenever the market is NOT in cash RTH RIGHT NOW, override `available` to false on
    // BOTH shift objects — REGARDLESS of what the cached computation produced — and replace the
    // rest of the object with the same minimal { available:false, status:'collecting' } shape
    // the "not enough history yet" cold-start path already uses. Two deliberate choices:
    //   1. Applied HERE (the route), not in polygon-options-gex.ts's compute path. "Is the
    //      market closed RIGHT NOW" is a property of THIS READ (now), not of the moment the
    //      cache was (re)computed — the route already holds the freshest wall-clock read, and
    //      this override must re-apply on EVERY cache hit (every request during the closed
    //      window reads the SAME cached object), not just the refresh that computed it.
    //   2. We blank the WHOLE object (not just flip the boolean) so the misleading present-
    //      tense `summary` string, delta_by_strike, etc. never leave the server while closed —
    //      half-fixing this by leaving `available:false` next to a live-reading summary string
    //      would still leak the exact misleading text a raw-JSON consumer (or a future UI) could
    //      render. Reusing the existing 'collecting' status (rather than inventing a new one) is
    //      intentional: GexHeatmap.tsx's Shift panel branches ONLY on `shift.available` truthiness
    //      (never on `status`'s value — grepped), so a new status literal would add a type-surface
    //      change with zero behavioral effect; reusing the shape already proven by the cold-start
    //      path is the smaller, safer diff.
    // Out of scope (deliberately untouched): computeMetricShift's diff math, wall/flip-migration
    // calculations, and the cache-refresh trigger — those are correct; this is purely a "don't
    // present a stale/cached result as if it's happening right now" presentation-layer gate.
    if (!isEtCashRth()) {
      rounded.shift = { available: false, status: "collecting" };
      if (rounded.vex_shift) rounded.vex_shift = { available: false, status: "collecting" };
    }

    // Reconcile each metric's total AFTER rounding: independently rounding total and
    // each strike_totals entry can drift by a cent or two (live-caught P0: NVDA GEX
    // Σstrike_totals != total, docs/audit/FINDINGS.md 2026-07-03). The pre-rounding
    // totals were always mathematically identical (built in the same accumulation
    // loop); this makes the DISPLAYED total match what a member would get by manually
    // summing the displayed rows.
    // gex/vex are always present on a non-empty heatmap; dex/charm are optional
    // (older cached payloads, empty heatmap) — reconcileStrikeTotal is a no-op
    // passthrough on undefined, so the dex/charm assignments stay type-correct.
    rounded.gex = reconcileStrikeTotal(rounded.gex)!;
    rounded.vex = reconcileStrikeTotal(rounded.vex)!;
    rounded.dex = reconcileStrikeTotal(rounded.dex);
    rounded.charm = reconcileStrikeTotal(rounded.charm);

    return NextResponse.json(rounded, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
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
