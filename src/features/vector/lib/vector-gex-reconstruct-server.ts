import "server-only";
import { fetchIndexMinuteBars, fetchStockMinuteBars } from "@/lib/providers/polygon";
import { polygonRawJson, resolveOptionsRoot, type ChainContract } from "@/lib/providers/polygon-options-gex";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import {
  isVectorIndexTicker,
  normalizeVectorTicker,
  vectorPolygonMinuteSymbol,
} from "./vector-ticker";
import {
  reconstructGexRail,
  reconstructGexHeatmapGrid,
  type ReconstructContract,
  type SpotSample,
  type GexHeatmapGrid,
} from "./vector-gex-reconstruct";
import {
  barsToSpotSamples,
  chainToReconstructContracts,
  reconstructStrikeBand,
  type AggBarLike,
} from "./vector-gex-reconstruct-map";
import type { WallHistorySample } from "./vector-wall-history";

/**
 * Server wrapper for the honest dense-rail reconstruction (task #21).
 *
 * The engine (`vector-gex-reconstruct.ts`) is pure; this file is the thin network
 * shell that feeds it real data for a PAST session:
 *   1. underlying minute bars for `sessionYmd` (Polygon aggs) → downsampled spot path
 *   2. one strike-banded options-chain snapshot (Polygon) covering the traveled range
 *   3. reconstructGexRail(chain, spotPath) → dense WallHistorySample[] the chart renders
 *
 * Why this exists: the live universe recorder only writes wall history during RTH
 * for covered tickers. For a session with no recorded rail (before the recorder
 * existed, an un-covered ticker, or simply an off-hours review of an older date)
 * the chart otherwise falls back to a single seeded bead per strike. This
 * reconstructs a REAL dense rail from data Polygon serves for any past date —
 * no fabrication (gamma is closed-form BSM along the true observed price path;
 * OI/IV are the EOD snapshot, and the result is labeled a reconstruction).
 *
 * Result is Redis-cached: a past session's bars + EOD chain are final, so the
 * reconstruction is stable — the first off-hours viewer pays the fetch, the rest
 * are served from cache.
 */

const CACHE_PREFIX = "vector:gex-reconstruct";
/** A closed session's inputs are final; hold the reconstruction a few hours. */
const CACHE_TTL_SEC = 6 * 60 * 60;
/** Runaway-loop backstop for chain pagination — the loop stops on next_url exhaustion. */
const CHAIN_PAGE_GUARD = 60;

type ChainSnapshotResponse = { results?: ChainContract[]; next_url?: string };

function cacheKey(ticker: string, sessionYmd: string): string {
  return `${CACHE_PREFIX}:${ticker}:${sessionYmd}`;
}

/** One strike-banded chain snapshot across all expiries, following next_url to completion. */
async function fetchReconstructChain(
  optionsRoot: string,
  lo: number,
  hi: number
): Promise<ChainContract[]> {
  const params = new URLSearchParams({
    "strike_price.gte": String(lo),
    "strike_price.lte": String(hi),
    limit: "250",
  });
  let path: string | null = `/v3/snapshot/options/${optionsRoot}?${params.toString()}`;
  const out: ChainContract[] = [];
  let guard = 0;
  while (path && guard < CHAIN_PAGE_GUARD) {
    const page: ChainSnapshotResponse | null = await polygonRawJson<ChainSnapshotResponse>(
      path,
      "/v3/snapshot/options/{underlying}"
    );
    if (!page) break;
    out.push(...(page.results ?? []));
    path = page.next_url ?? null;
    guard += 1;
  }
  return out;
}

async function fetchUnderlyingBars(ticker: string, sessionYmd: string): Promise<AggBarLike[]> {
  const t = normalizeVectorTicker(ticker);
  if (isVectorIndexTicker(t)) {
    const sym = vectorPolygonMinuteSymbol(t); // I:SPX / I:VIX etc.
    return fetchIndexMinuteBars(sym, sessionYmd, sessionYmd).catch(() => []);
  }
  return fetchStockMinuteBars(t, sessionYmd, sessionYmd).catch(() => []);
}

export type ReconstructRailOptions = {
  ticker: string;
  /** Session date YYYY-MM-DD (ET) to reconstruct. */
  sessionYmd: string;
  /** Downsample cadence in seconds (default 5min — matches the live recorder). */
  everySec?: number;
  /** Bypass the Redis cache (for a fresh recompute / verification). */
  forceRefresh?: boolean;
};

/**
 * Shared network fetch for BOTH the rail and the heatmap reconstructions — the two
 * differ only in how they collapse the same (contracts, spot-path) inputs, so the
 * expensive Polygon calls (bars + banded chain snapshot) live here once. Returns null
 * (never throws, never fabricates) when the ticker isn't optionable, Polygon isn't
 * configured, or the session has no bars/chain.
 */
async function loadReconstructInputs(
  opts: ReconstructRailOptions
): Promise<{ contracts: ReconstructContract[]; spots: SpotSample[]; sessionYmd: string } | null> {
  const ticker = normalizeVectorTicker(opts.ticker);
  const sessionYmd = String(opts.sessionYmd ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionYmd)) return null;

  const { optionsRoot } = resolveOptionsRoot(ticker);
  if (!optionsRoot) return null;

  // 1) real intraday spot path
  const bars = await fetchUnderlyingBars(ticker, sessionYmd);
  const spots = barsToSpotSamples(bars, opts.everySec ?? 300);
  if (!spots.length) return null;

  // 2) chain snapshot banded to exactly the strikes the session traveled through
  const band = reconstructStrikeBand(spots);
  if (!band) return null;
  const rawChain = await fetchReconstructChain(optionsRoot, band.lo, band.hi);
  const contracts = chainToReconstructContracts(rawChain);
  if (!contracts.length) return null;

  return { contracts, spots, sessionYmd };
}

/**
 * Reconstruct a dense wall-history rail for one ticker + past session. Returns an
 * empty array (never throws, never fabricates) when the ticker isn't optionable,
 * Polygon isn't configured, or the session has no bars/chain.
 */
export async function reconstructSessionRail(
  opts: ReconstructRailOptions
): Promise<WallHistorySample[]> {
  const ticker = normalizeVectorTicker(opts.ticker);
  const sessionYmd = String(opts.sessionYmd ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionYmd)) return [];

  const key = cacheKey(ticker, sessionYmd);
  if (!opts.forceRefresh) {
    const hit = await sharedCacheGet<WallHistorySample[]>(key).catch(() => null);
    if (hit) return hit;
  }

  const inputs = await loadReconstructInputs(opts);
  if (!inputs) return [];

  // reconstruct the dense rail along the true price path (pure, deterministic)
  const rail = reconstructGexRail(inputs.contracts, inputs.spots, inputs.sessionYmd);
  if (rail.length) {
    await sharedCacheSet(key, rail, CACHE_TTL_SEC).catch(() => {});
  }
  return rail;
}

const HEATMAP_CACHE_PREFIX = "vector:gex-heatmap";

function heatmapCacheKey(ticker: string, sessionYmd: string): string {
  return `${HEATMAP_CACHE_PREFIX}:${ticker}:${sessionYmd}`;
}

/**
 * Reconstruct the strike×time GEX surface (task #14 heatmap) for one ticker + past
 * session — the full per-strike gamma grid, not just the top walls. Shares the exact
 * fetch + spot-path the rail uses (`loadReconstructInputs`), then keeps every strike's
 * signed net GEX per time bucket. Returns null (never throws, never fabricates) when
 * inputs are unavailable. Redis-cached like the rail: a past session's inputs are final.
 */
export async function reconstructSessionHeatmap(
  opts: ReconstructRailOptions
): Promise<GexHeatmapGrid | null> {
  const ticker = normalizeVectorTicker(opts.ticker);
  const sessionYmd = String(opts.sessionYmd ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionYmd)) return null;

  const key = heatmapCacheKey(ticker, sessionYmd);
  if (!opts.forceRefresh) {
    const hit = await sharedCacheGet<GexHeatmapGrid>(key).catch(() => null);
    if (hit) return hit;
  }

  const inputs = await loadReconstructInputs(opts);
  if (!inputs) return null;

  const grid = reconstructGexHeatmapGrid(inputs.contracts, inputs.spots, inputs.sessionYmd);
  if (grid.times.length) {
    await sharedCacheSet(key, grid, CACHE_TTL_SEC).catch(() => {});
  }
  return grid;
}
