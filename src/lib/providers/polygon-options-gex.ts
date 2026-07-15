import { polygonConfigured } from "./config";
import { fetchStockSnapshot, fetchIndexSnapshot } from "./polygon";
import { todayEtYmd } from "./spx-session";
import { polygonTrackedFetch } from "./polygon-rate-limiter";
import { isHeatmapPreset } from "../heatmap-allowlist";
import { isLiveOdteSession } from "./unusual-whales";
import { fmtPremium } from "@/lib/fmt-money";
import { persistGexRegimeEvents } from "./gex-regime-events";

const BASE = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const KEY = process.env.POLYGON_API_KEY ?? "";

/** Hostname only (never the apiKey query string) for safe diagnostic logging. */
function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return "?"; }
}

/** Options Advanced plan: chain snapshots, greeks, and quotes are real-time. */
export const POLYGON_OPTIONS_DATA_DELAY = "real-time (Massive Options Advanced plan)";

export function polygonOptionsMeta() {
  return { data_delay: POLYGON_OPTIONS_DATA_DELAY, source: "polygon", plan: "options_advanced" };
}

export type ChainContract = {
  details?: {
    strike_price?: number;
    contract_type?: string;
    expiration_date?: string;
    /**
     * Deliverable shares per contract (Massive `details.shares_per_contract`). Standard
     * listed options are 100; a corporate action (split/merger/special dividend) can mint
     * ADJUSTED contracts with a NON-100 multiplier. Carried so notional math uses the REAL
     * multiplier instead of a hardcoded 100. Optional/absent → callers default to 100.
     */
    shares_per_contract?: number;
  };
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number };
  implied_volatility?: number;
  open_interest?: number;
  last_quote?: { bid?: number; ask?: number };
  last_trade?: { price?: number };
  day?: { close?: number; volume?: number };
  underlying_asset?: { price?: number };
};

/**
 * Night's Watch chain fetch — the BATCHABLE valuation primitive. Returns a band of
 * contracts around spot for an underlying + expiry, plus the spot, so the caller can
 * match every saved strike for that (underlying, expiry) IN-MEMORY from a single call.
 *
 * This is intentionally NOT per-contract: it is wrapped by getNwChain() in
 * lib/nights-watch/chain-cache.ts with withServerCache, so 500 users holding contracts
 * on the same (underlying, expiry) collapse to ONE upstream fetch per TTL window.
 * Returns null when not configured or spot is unavailable — never fabricates.
 * (A future optimization can swap to /v3/snapshot/options/{underlying}/{contract}.)
 */
export async function fetchNwOptionChain(
  underlying: string,
  expiry: string, // YYYY-MM-DD
  bandPct = 0.35,
  /** Held strikes for this (underlying, expiry) — expands the fetch band so deep OTM/ITM legs are in-cache for chain fallback. */
  strikeHints: number[] = []
): Promise<{ contracts: ChainContract[]; spot: number } | null> {
  if (!polygonConfigured()) return null;
  const root = underlying.toUpperCase();
  const underlyingRoot = root === "SPX" ? "I:SPX" : root;

  // Index roots (I:*) need the indices snapshot — the stocks snapshot returns no row for them
  // (spot 0 → permanently null chain). resolveSpotSnapshot picks the right endpoint.
  const snap = await resolveSpotSnapshot(underlyingRoot);
  const spot = snap?.price ?? 0;
  if (!(spot > 0)) return null; // no spot → can't center a band; report unavailable

  const contracts = await fetchChainBand(underlyingRoot, spot, expiry, bandPct, strikeHints);
  if (!contracts.length) return null;
  return { contracts, spot };
}

type ChainResponse = {
  results?: ChainContract[];
  next_url?: string;
  status?: string;
};

let cachedOdteBundle: {
  at: number;
  spot: number;
  rows: Record<string, unknown>[];
  maxPain: number | null;
} | null = null;

// Single-flight guard: concurrent callers share one in-progress build instead of
// each independently hitting the Polygon API. Mirrors heatmapInflight above.
let odteBundleInflight: Promise<{ rows: Record<string, unknown>[]; maxPain: number | null }> | null = null;

const POLYGON_ODTE_CACHE_KEY = "polygon:odte_gex_bundle";

/**
 * Ring buffer of recent SPX spot prices used to detect fast moves.
 * Each entry is { price, at } where `at` is epoch-ms.
 */
const spxPriceHistory: Array<{ price: number; at: number }> = [];
const SPX_HISTORY_WINDOW_MS = 5 * 60_000; // 5 minutes

/** Record a new SPX spot price observation for volatility detection. */
export function recordSpxPriceObservation(price: number): void {
  const now = Date.now();
  spxPriceHistory.push({ price, at: now });
  // Purge entries older than the window to keep the buffer small.
  const cutoff = now - SPX_HISTORY_WINDOW_MS;
  while (spxPriceHistory.length > 0 && spxPriceHistory[0].at < cutoff) {
    spxPriceHistory.shift();
  }
}

/**
 * Returns true if SPX has moved more than 0.5% in the last 5 minutes,
 * indicating a fast-move / volatile market condition.
 */
function isSpxFastMove(currentSpot: number): boolean {
  if (spxPriceHistory.length === 0) return false;
  const oldest = spxPriceHistory[0].price;
  if (oldest <= 0) return false;
  return Math.abs(currentSpot - oldest) / oldest > 0.005;
}

// ── Per-ticker fast-move ring (heatmap presets) ────────────────────────────────
// The SPX ring above is single-global (it backs the SPX desk bundle only). The heatmap
// fast-move bypass needs PER-TICKER history so a >0.5% move in NVDA shortens NVDA's TTL
// without touching SPY. Bounded to the warm presets at the call site so an arbitrary spread
// of tickers can't grow this map. Mirrors the SPX ring's shape/window exactly.
const heatmapPriceHistory = new Map<string, Array<{ price: number; at: number }>>();
/** Fractional move that classifies a heatmap ticker as fast-moving (mirrors SPX's 0.5%). */
const HEATMAP_FAST_MOVE_PCT = 0.005;

/** Record a spot observation for a heatmap ticker's fast-move ring (preset tickers only). */
function recordHeatmapPriceObservation(ticker: string, price: number): void {
  if (!(price > 0)) return;
  const now = Date.now();
  const ring = heatmapPriceHistory.get(ticker) ?? [];
  ring.push({ price, at: now });
  const cutoff = now - SPX_HISTORY_WINDOW_MS;
  while (ring.length > 0 && ring[0].at < cutoff) ring.shift();
  heatmapPriceHistory.set(ticker, ring);
}

/**
 * True when `ticker` has moved more than 0.5% across its in-window ring (oldest→newest).
 * The newest ring entry is recorded on each fresh matrix compute, so this reflects the move
 * SINCE the cache entry being served was built — exactly the signal needed to decide whether
 * that cache entry is too stale to keep serving during a fast move. Returns false when the
 * ring is too thin to judge (never fabricates a move).
 */
function isHeatmapFastMove(ticker: string): boolean {
  const ring = heatmapPriceHistory.get(ticker);
  if (!ring || ring.length < 2) return false;
  const oldest = ring[0].price;
  const newest = ring[ring.length - 1].price;
  if (!(oldest > 0) || !(newest > 0)) return false;
  return Math.abs(newest - oldest) / oldest > HEATMAP_FAST_MOVE_PCT;
}

function polygonGexCacheMs(): number {
  const sec = Number(process.env.SPX_POLYGON_GEX_CACHE_SEC ?? 15);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 15_000;
}

async function loadOdteContracts(spot: number, expiry: string): Promise<ChainContract[]> {
  // SPX index options (both the SPX monthly and SPXW weekly roots) are listed under
  // the index underlying I:SPX on Polygon/Massive. A bare "SPX"/"SPXW" underlying
  // returns HTTP 200 with ZERO results — which is why GEX walls were always empty.
  return fetchChainBand("I:SPX", spot, expiry);
}

/** 0DTE GEX rows + max pain from one Polygon chain snapshot (SPX + SPXW). */
export async function fetchPolygonOdteDeskBundle(
  spot: number,
  expiry = todayEtYmd(),
  { forceRefresh = false }: { forceRefresh?: boolean } = {}
): Promise<{ rows: Record<string, unknown>[]; maxPain: number | null }> {
  if (!polygonConfigured() || spot <= 0) return { rows: [], maxPain: null };

  // Feed the fast-move ring buffer on every desk GEX fetch so isSpxFastMove can actually
  // fire — without this call spxPriceHistory stays empty and the fast-move cache bypass
  // below is dead code (GEX walls served stale during the exact move they matter for).
  recordSpxPriceObservation(spot);

  const now = Date.now();
  // During fast moves (SPX >0.5% in the last 5 min) bypass cache entirely so
  // GEX reflects the new price level. Also bypass when callers set forceRefresh.
  const fastMove = isSpxFastMove(spot);
  const skipCache = forceRefresh || fastMove;

  if (
    !skipCache &&
    cachedOdteBundle &&
    now - cachedOdteBundle.at < polygonGexCacheMs() &&
    Math.abs(cachedOdteBundle.spot - spot) < Math.max(spot * 0.003, 5)
  ) {
    return { rows: cachedOdteBundle.rows, maxPain: cachedOdteBundle.maxPain };
  }

  try {
    const { sharedCacheGet } = await import("../shared-cache");
    const redisHit = await sharedCacheGet<{
      at: number;
      spot: number;
      rows: Record<string, unknown>[];
      maxPain: number | null;
    }>(POLYGON_ODTE_CACHE_KEY);
    if (
      !skipCache &&
      redisHit &&
      now - redisHit.at < polygonGexCacheMs() &&
      Math.abs(redisHit.spot - spot) < Math.max(spot * 0.003, 5)
    ) {
      cachedOdteBundle = redisHit;
      return { rows: redisHit.rows, maxPain: redisHit.maxPain };
    }
  } catch {
    /* redis optional */
  }

  if (odteBundleInflight) return odteBundleInflight;

  const build = (async () => {
    const contracts = await loadOdteContracts(spot, expiry);
    if (!contracts.length) {
      if (isLiveOdteSession()) {
        console.warn(`[polygon-gex] 0 I:SPX contracts for ${expiry} @ ${spot} via ${hostOf(BASE)} — GEX walls will be empty. Verify POLYGON_API_KEY is a valid ${hostOf(BASE)} key with options-chain access (set POLYGON_API_BASE if your key is from a different provider, e.g. https://api.polygon.io).`);
      } else {
        console.info(`[polygon-gex] 0 I:SPX contracts for ${expiry} @ ${spot} — off-hours/holiday, expected (no listed 0DTE expiry today).`);
      }
    }
    const rows = aggregateGexRows(contracts, spot);
    const maxPain = computeMaxPainFromChain(contracts);
    if (rows.length) {
      cachedOdteBundle = { at: now, spot, rows, maxPain };
      void import("../shared-cache").then(({ sharedCacheSet }) =>
        sharedCacheSet(POLYGON_ODTE_CACHE_KEY, cachedOdteBundle, Math.ceil(polygonGexCacheMs() / 1000))
      );
    }
    return { rows, maxPain };
  })().finally(() => { odteBundleInflight = null; });

  odteBundleInflight = build;
  return build;
}

// ---------------------------------------------------------------------------
// GEX Heatmap — dealer gamma matrix (strike rows × expiry columns)
// ---------------------------------------------------------------------------

/**
 * GEX metric block — net dealer dollar-GAMMA matrix + gamma-specific levels.
 * Lives under `heatmap.gex`. Strike/expiry axes + spot are SHARED at the top level.
 */
export type GexMetricBlock = {
  /** Net dealer dollar-gamma per (strike, expiry). Sparse — absent = no data. */
  cells: Record<string, Record<string, number>>;
  /** Net dealer dollar-gamma summed across all expiries, per strike. */
  strike_totals: Record<string, number>;
  /** Strike with the LARGEST POSITIVE net dealer gamma (dealer long-gamma → resistance/pin), or null. */
  call_wall: number | null;
  /** Strike with the LARGEST NEGATIVE net dealer gamma (support), or null. */
  put_wall: number | null;
  /** Total net dealer dollar-gamma across the whole matrix. */
  total: number;
  /** Linear-interpolated zero-gamma flip strike, or null when undetermined. */
  flip: number | null;
  /** Regime read derived from spot vs the gamma flip. */
  regime: GexRegime;
};

/**
 * VEX metric block — net dealer dollar-VANNA matrix + vanna-specific levels.
 * Lives under `heatmap.vex`. Vanna is the sensitivity of delta to IV (∂Δ/∂σ);
 * dealer dollar-vanna says how dealer hedging flows respond as IV shifts.
 */
export type VexMetricBlock = {
  /** Net dealer dollar-vanna per (strike, expiry). Sparse — absent = no data. */
  cells: Record<string, Record<string, number>>;
  /** Net dealer dollar-vanna summed across all expiries, per strike. */
  strike_totals: Record<string, number>;
  /** Strike with the LARGEST POSITIVE net dealer vanna, or null. */
  pos_wall: number | null;
  /** Strike with the LARGEST NEGATIVE net dealer vanna, or null. */
  neg_wall: number | null;
  /** Total net dealer dollar-vanna across the whole matrix. */
  total: number;
  /** Zero-vanna flip strike (cumulative vanna sign change), or null. */
  flip: number | null;
  /** Regime read derived from the net vanna sign. */
  regime: VexRegime;
};

/**
 * Cross-tool overlays layered onto the gamma profile by the gex-heatmap ROUTE
 * (not by the cached matrix compute). Each overlay is independently best-effort
 * and read from its OWN shared cache upstream — null means "unavailable", never
 * fabricated. The cached GEX/VEX matrix is unaffected by overlay availability.
 */
export type GexFlowByStrike = {
  /** HELIX intraday call premium hitting this strike today (USD). */
  call_prem: number;
  /** HELIX intraday put premium hitting this strike today (USD). */
  put_prem: number;
  /** Net premium (call − put): positive = bullish flow, negative = bearish. */
  net_prem: number;
};

export type GexDarkPoolLevel = {
  /** Dark-pool print price level (rounded), drawn as a horizontal line on the profile. */
  price: number;
  /** Notional / size of the print(s) at this level (USD), drives the label + emphasis. */
  notional: number;
};

export type GexHeatmapOverlays = {
  /**
   * HELIX flow-per-strike keyed by strike string — ONLY strikes that exist on the
   * heatmap's shared `strikes` axis are present. Null when the flow feed is empty
   * or unavailable for this ticker.
   */
  flow_by_strike: Record<string, GexFlowByStrike> | null;
  /** Top dark-pool price levels (largest prints), descending by notional. Null when unavailable. */
  dark_pool_levels: GexDarkPoolLevel[] | null;
};

/**
 * One sampled GEX snapshot in the intraday positioning-history ring. Captured ONLY on a
 * fresh matrix compute (cache miss), throttled to ~1 per 5 min, and persisted to Redis
 * under `gex-history:{ticker}`. The SHIFT view diffs the newest vs the earliest snapshot
 * still in the window. GEX-only for now (VEX migration is future work).
 */
export type GexHistorySnapshot = {
  /** epoch-ms the snapshot was taken. */
  ts: number;
  /** spot at capture time. */
  spot: number;
  /** zero-gamma flip strike at capture, or null. */
  flip: number | null;
  /** per-strike NET dealer dollar-gamma totals at capture (sparse, keyed by strike string). */
  strike_totals: Record<string, number>;
  /**
   * Per-strike NET dealer dollar-VANNA totals at capture (sparse), for the VEX shift view.
   * OPTIONAL + additive: older snapshots written before this field simply omit it, so the
   * VEX shift is unavailable ('collecting') until ≥2 snapshots that DO carry vex totals exist.
   */
  vex_strike_totals?: Record<string, number>;
  /** zero-vanna flip strike at capture, or null. Paired with `vex_strike_totals`. */
  vex_flip?: number | null;
  /** Per-strike NET dealer dollar-DELTA totals at capture (sparse). Additive — cheap to carry. */
  dex_strike_totals?: Record<string, number>;
  /** Per-strike NET dealer dollar-CHARM totals at capture (sparse). Additive — cheap to carry. */
  charm_strike_totals?: Record<string, number>;
};

/** Gamma flip migration over the shift window — earlier flip → current flip. */
export type GexFlipMigration = {
  /** Earliest-snapshot flip strike, or null when undetermined then. */
  from: number | null;
  /** Current flip strike, or null when undetermined now. */
  to: number | null;
  /** Signed flip move in points (to − from); null when either end is null. */
  delta_pts: number | null;
};

/** How a single wall (call or put) moved over the shift window. */
export type GexWallChange = {
  /** Earliest-snapshot wall strike, or null. */
  from: number | null;
  /** Current wall strike, or null. */
  to: number | null;
  /** Signed strike move (to − from) in points; null when either end is null. */
  moved_pts: number | null;
  /**
   * Fractional change in the wall's |net gamma| at the CURRENT wall strike vs the same
   * strike earlier (grew/melted). null when not computable (e.g. strike absent earlier).
   */
  grew_pct: number | null;
};

/**
 * Intraday gamma MIGRATION — where dealer gamma is building vs melting and how the flip
 * is moving — diffed from the positioning-history ring. Computed once per fresh matrix
 * compute and cached with the matrix, so every user reads one shared shift (never per-user).
 * When fewer than 2 usable snapshots exist, `available` is false and only `status` is set —
 * never fabricated.
 */
export type GexShift = {
  /** True only when ≥2 usable snapshots span the window and a diff was computed. */
  available: boolean;
  /** 'collecting' while history is still filling in (available === false). */
  status?: "collecting";
  /** Per-strike Δ-gamma = current − earliest (union of strike keys; missing side = 0). */
  delta_by_strike?: Record<string, number>;
  /** Gamma-flip migration earlier → current. */
  flip_migration?: GexFlipMigration;
  /** Call/put wall movement earlier → current. */
  wall_changes?: { call_wall: GexWallChange; put_wall: GexWallChange };
  /** Computed one-liner with REAL numbers describing the migration. */
  summary?: string;
  /** Actual elapsed ms vs the earliest snapshot in the window. */
  since_ms?: number;
  /** epoch-ms of the earliest (baseline) snapshot. */
  baseline_ts?: number;
};

export type GexHeatmap = {
  underlying: string;
  spot: number;
  change_pct: number;
  asof: string;
  /**
   * Ascending expiry axis (SHARED by all metrics): the ~8 NEAREST expirations (dailies/weeklies)
   * FOLLOWED BY a bounded set of far-dated standard monthly / quarterly OpEx columns (3rd-Friday,
   * out ~6 months) — the strikes where the dominant dealer-gamma walls park. The near-term block is
   * unchanged; the far-dated columns are additive.
   */
  expiries: string[];
  /**
   * The exact near-term expiry subset that feeds strike_totals/total/walls/flip (the first
   * NEAR_TERM_EXPIRY_COUNT expiries captured BEFORE far-dated columns are merged). Auditors
   * and the client "All" scope must re-sum cells over THIS set — NOT `expiries.slice(0,8)`,
   * which silently back-fills with far-dated monthlies when the chain has <8 near dates.
   */
  near_term_expiries?: string[];
  /** Descending, strike-banded around spot (SHARED by both metrics). */
  strikes: number[];
  /** Max-pain strike (option-holder value minimizer), or null — GEX-only, shared at top. */
  max_pain: number | null;
  /** Net dealer dollar-GAMMA block. */
  gex: GexMetricBlock;
  /** Net dealer dollar-VANNA block. */
  vex: VexMetricBlock;
  /**
   * Net dealer dollar-DELTA block (DEX lens). OPTIONAL + additive — older cached payloads and
   * the empty heatmap omit it. Computed in the SAME contract pass as gex/vex (no extra fetch).
   */
  dex?: DexMetricBlock;
  /**
   * Net dealer dollar-CHARM block (delta-decay / pinning lens). OPTIONAL + additive — computed
   * in the SAME contract pass as gex/vex (no extra fetch).
   */
  charm?: CharmMetricBlock;
  /**
   * Intraday GEX migration (build/melt + flip drift) vs positioning history. GEX-only.
   * Always present; `available:false` (status 'collecting') until ≥2 snapshots accumulate.
   */
  shift: GexShift;
  /**
   * Intraday VEX (vanna) migration vs positioning history — same GexShift shape as `shift`.
   * OPTIONAL + additive: `available:false` (status 'collecting') until ≥2 snapshots carrying
   * `vex_strike_totals` exist. Never fabricated on cold/legacy history.
   */
  vex_shift?: GexShift;
  /**
   * Server-computed alert events for THIS sample vs the prior history snapshot. OPTIONAL +
   * additive. Empty array when nothing crossed (≥2 snapshots exist); omitted on cold history
   * (<2 snapshots) so the client can tell "nothing crossed" from "no prior to diff".
   */
  events?: GexEvent[];
  /**
   * Day-over-day HISTORICAL context — current levels diffed vs the most recent PRIOR-day EOD
   * snapshot ("vs prior close"). OPTIONAL + additive: present ONLY when ≥1 prior-day snapshot
   * exists in the `gex-eod:{ticker}` series; omitted otherwise (never fabricated). Read from a
   * cheap Redis list inside the already-cached matrix build (one read per ticker per TTL).
   */
  history_context?: GexHistoryContext;
  source: "polygon";
  data_delay: string;
};

/**
 * One end-of-day GEX close snapshot, persisted to the `gex-eod:{ticker}` rolling series (one
 * entry per trading day). Compact by design — just the levels pros anchor to "vs prior close".
 * Captured by the `gex-eod-snapshot` cron (~4:10pm ET) from the SHARED cached matrix.
 */
export type GexEodSnapshot = {
  /** ET trading day this close belongs to (YYYY-MM-DD). One snapshot per date (idempotent). */
  date: string;
  /** Underlying spot at capture. */
  spot: number;
  /** Zero-gamma flip strike at close, or null. */
  flip: number | null;
  /** Largest-positive net-gamma wall (call wall) at close, or null. */
  call_wall: number | null;
  /** Largest-negative net-gamma wall (put wall) at close, or null. */
  put_wall: number | null;
  /** Total net dealer dollar-gamma across the matrix at close. */
  net_gex: number;
  /** Max-pain strike at close, or null. */
  max_pain: number | null;
  /** Total net dealer dollar-DELTA (DEX) at close, or null when unavailable. */
  net_dex: number | null;
  /** Dealer delta posture at close: 'long' (stabilizing) | 'short' (destabilizing) | null. */
  dex_posture: "long" | "short" | null;
  /** Total net dealer dollar-CHARM at close, or null when unavailable. */
  net_charm: number | null;
  /** Dealer charm posture at close: 'positive' | 'negative' | null. */
  charm_posture: "positive" | "negative" | null;
};

/**
 * Day-over-day historical context surfaced on `GexHeatmap.history_context`. Diffs CURRENT values
 * against the most recent PRIOR-day EOD snapshot (a snapshot whose `date` ≠ today), plus min/max
 * over the rolling series. Deltas are null when either end is null — NEVER fabricated.
 */
export type GexHistoryContext = {
  /** The prior-day close levels the deltas are measured against, or null when no prior day exists. */
  prior_close: {
    date: string;
    flip: number | null;
    call_wall: number | null;
    put_wall: number | null;
    net_gex: number;
    max_pain: number | null;
  } | null;
  /** Current flip − prior-day flip (points); null when either end is null. */
  flip_delta_pts: number | null;
  /** Current call wall − prior-day call wall (points); null when either end is null. */
  call_wall_delta_pts: number | null;
  /** Current put wall − prior-day put wall (points); null when either end is null. */
  put_wall_delta_pts: number | null;
  /** Current net GEX − prior-day net GEX (dollars); null when prior is unavailable. */
  net_gex_delta: number | null;
  /** Min/max flip strike over the rolling EOD series (incl. today's snapshot if present), or null. */
  recent_flip_range: { min: number; max: number } | null;
  /** Min/max spot over the rolling EOD series, or null. */
  recent_spot_range: { min: number; max: number } | null;
  /** Number of EOD sessions in the rolling series. */
  sessions: number;
};

export type GexRegime = {
  /** The gamma flip the posture is measured against (mirrors gex.flip), or null. */
  flip: number | null;
  /** 'long' when spot is at/above the flip, 'short' when below, null when undetermined. */
  posture: "long" | "short" | null;
  /** Computed one-liner describing the regime — neutral string when data is missing. */
  read: string;
};

export type VexRegime = {
  /** Net dealer dollar-vanna sign: 'positive' | 'negative' | null when undetermined. */
  posture: "positive" | "negative" | null;
  /** Computed one-liner describing the vanna regime — neutral string when data is missing. */
  read: string;
};

/**
 * DEX regime read — derived from the net dealer dollar-DELTA sign.
 *
 * Directional convention: net dealer delta POSITIVE means dealers are net LONG delta, so to
 * stay hedged they SELL into rallies / BUY dips → mean-reverting → STABILIZING. NEGATIVE means
 * dealers are net SHORT delta, so they BUY rallies / SELL dips → trend-amplifying → DESTABILIZING.
 */
export type DexRegime = {
  /** Net dealer dollar-delta sign: 'long' (net long → stabilizing) | 'short' (net short → destabilizing) | null. */
  posture: "long" | "short" | null;
  /** Computed one-liner describing the delta regime — neutral string when data is missing. */
  read: string;
};

/**
 * DEX metric block — net dealer dollar-DELTA matrix + delta-specific levels.
 * Lives under `heatmap.dex`. Mirrors the gex block shape but with a `zero_level`
 * (per-strike net-delta sign-crossing nearest spot) in place of call/put walls.
 *
 * Net dealer dollar-delta per (strike, expiry) = −(delta · OI · 100 · spot), summed over
 * contracts. `delta` is ALREADY signed by option type (calls +, puts −), so Σ(delta · OI) is the
 * CUSTOMER/aggregate net option delta; dealers are the counterparty, so the dealer book is its
 * NEGATION (no extra gamma-style call/put sign — that would double-sign delta and pin DEX
 * permanently positive). Positive ⇒ dealers net LONG delta (stabilizing); negative ⇒ SHORT.
 */
export type DexMetricBlock = {
  /** Net dealer dollar-delta per (strike, expiry). Sparse — absent = no data. */
  cells: Record<string, Record<string, number>>;
  /** Net dealer dollar-delta summed across all expiries, per strike. */
  strike_totals: Record<string, number>;
  /** Total net dealer dollar-delta across the whole matrix. */
  total: number;
  /** Per-strike delta sign-crossing nearest spot (zero-delta level), or null. */
  zero_level: number | null;
  /** Regime read derived from the net dealer delta sign. */
  regime: DexRegime;
};

/**
 * CHARM regime read — derived from the net dealer dollar-CHARM sign. Charm (delta decay,
 * ∂Δ/∂time-to-expiry) drives the passive hedging flow that builds as time passes — the
 * mechanism behind pre-OPEX and end-of-day pinning toward heavy-OI strikes.
 */
export type CharmRegime = {
  /** Net dealer dollar-charm sign: 'positive' | 'negative' | null when undetermined. */
  posture: "positive" | "negative" | null;
  /** Computed one-liner describing the charm regime / pinning read — neutral string when data is missing. */
  read: string;
};

/**
 * CHARM metric block — net dealer dollar-CHARM matrix + charm-specific levels.
 * Lives under `heatmap.charm`. Mirrors the dex block shape.
 *
 * dollar-charm per (strike, expiry) = dealerSign · charmPerShare · OI · 100 · spot, where
 * charmPerShare is the closed-form per-share delta decay (∂Δ/∂time-to-expiry, per YEAR of
 * time-to-expiry, r=q=0). Scaling mirrors dollar-vanna (the `× spot` notional convention) so
 * CHARM magnitudes are broadly comparable to GEX/VEX; the per-unit-time is years (ACT/365).
 * Charm is type-independent (put charm = call charm at r=q=0, like gamma); the dealer call(+)/
 * put(−) sign is applied at accumulation, identical to the gamma/vanna pattern.
 */
export type CharmMetricBlock = {
  /** Net dealer dollar-charm per (strike, expiry). Sparse — absent = no data. */
  cells: Record<string, Record<string, number>>;
  /** Net dealer dollar-charm summed across all expiries, per strike. */
  strike_totals: Record<string, number>;
  /** Total net dealer dollar-charm across the whole matrix. */
  total: number;
  /** Per-strike charm sign-crossing nearest spot (zero-charm level), or null. */
  zero_level: number | null;
  /** Regime read derived from the net dealer charm sign + pinning context. */
  regime: CharmRegime;
};

/**
 * A server-computed alert event — emitted by `fetchGexHeatmap` when it diffs the PRIOR history
 * snapshot against the CURRENT freshly-computed values. PURE diff of values already computed /
 * stored — no extra upstream calls. Only emitted when ≥2 snapshots exist (a real prior to diff);
 * NEVER fabricated on the first sample. Cached WITH the matrix (it describes this sample vs the
 * last one), so all users read the same shared event list.
 */
export type GexEvent = {
  /** What crossed. */
  type:
    | "flip_crossed"
    | "wall_broken"
    | "regime_flipped"
    | "net_gex_sign_flipped";
  /** Display severity — 'warn' for destabilizing crosses, 'info' otherwise. */
  severity: "info" | "warn";
  /** Plain, ready-to-display one-liner with real numbers. */
  message: string;
  /** The level that was crossed (flip strike / wall strike), when applicable. */
  level?: number;
  /** Direction of the cross, e.g. 'into long gamma' / 'above call wall' / 'short → long'. */
  direction?: string;
  /**
   * Natural before/after numeric pair for this crossing (task #136, additive —
   * ADDED alongside the pre-existing fields above, never altering any of the
   * conditions that decide WHETHER an event fires). What the pair means depends
   * on `type`, since each event is a different kind of crossing:
   *   - flip_crossed / wall_broken: SPOT before/after — these events fire on
   *     spot moving across a level that itself is held FIXED as the shared
   *     reference (the prior sample's flip/wall), so spot is the value that
   *     actually changed, not the level.
   *   - regime_flipped: the gamma-flip level at the prior sample vs. the
   *     current sample — posture here is computed per-end against THAT end's
   *     own flip, so unlike flip_crossed the flip itself can differ between
   *     from_value/to_value.
   *   - net_gex_sign_flipped: total net dealer GEX dollars before/after.
   * Both null when not computable at the point of detection — never fabricated.
   */
  from_value?: number | null;
  to_value?: number | null;
  /** ISO timestamp of THIS sample (when the cross was detected). */
  at: string;
};

// ── Standard-normal pdf (for closed-form vanna) ────────────────────────────────
const INV_SQRT_2PI = 0.3989422804014327; // 1 / sqrt(2π)
/** Standard normal probability density function. */
function normPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

/** Year fraction (ACT/365) from today (ET) to an expiry YYYY-MM-DD. <=0 → not tradeable. */
function yearsToExpiry(expiry: string, todayYmd: string): number {
  const expMs = new Date(`${expiry}T16:00:00-04:00`).getTime(); // ~US market close ET
  const nowMs = new Date(`${todayYmd}T00:00:00-04:00`).getTime();
  if (!Number.isFinite(expMs) || !Number.isFinite(nowMs)) return 0;
  return (expMs - nowMs) / (365 * 86_400_000);
}

// ---------------------------------------------------------------------------
// FAR-DATED expiry selection — standard monthly (3rd-Friday) + quarterly OpEx.
//
// THE POINT: the dominant dealer-gamma walls park at the standard monthly / quarterly
// OpEx open interest (e.g. a huge wall on the Sept monthly OpEx), which the near-term
// 8-nearest view never sees. We add a BOUNDED set of standard monthly/quarterly TARGET
// dates out ~6 months as extra expiry columns. These are computed from the calendar (NOT
// every far-dated daily) and then MATCHED against the live chain, so the fetched + computed
// set stays small (~6-10 extra columns) and the warm cost stays inside the rate budget.
// ---------------------------------------------------------------------------

/** How many months of standard monthly OpEx (3rd Friday) to target ahead, inclusive of this month. */
const FAR_DATED_MONTHS_AHEAD = 6;
/** Hard cap on the far-dated target dates returned — bounds the extra fetch + column count. */
const FAR_DATED_MAX_TARGETS = 8;

/**
 * The standard US options monthly expiration for a given (year, month0): the THIRD FRIDAY.
 * Returns a YYYY-MM-DD string. (We intentionally use the 3rd-Friday calendar date — when a
 * holiday shifts settlement the listed contract is still keyed to this date on the chain, so
 * matching against the live chain's expiry strings below tolerates the rare shift.)
 */
function thirdFridayYmd(year: number, month0: number): string {
  // Day-of-week of the 1st (0=Sun..6=Sat), in UTC to avoid TZ drift on the date math.
  const first = new Date(Date.UTC(year, month0, 1));
  const dow = first.getUTCDay();
  // First Friday date-of-month, then + 14 days → third Friday.
  const firstFriday = 1 + ((5 - dow + 7) % 7);
  const thirdFriday = firstFriday + 14;
  const mm = String(month0 + 1).padStart(2, "0");
  const dd = String(thirdFriday).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Bounded set of FAR-DATED standard monthly (3rd-Friday) target expiries, ascending, that fall
 * STRICTLY AFTER `afterYmd` (the last near-term expiry we already keep) and within ~6 months of
 * `todayYmd`. Quarterly OpEx (Mar/Jun/Sep/Dec) are a subset of the monthlies, so they're included
 * automatically — they simply carry the heaviest OI. Capped at FAR_DATED_MAX_TARGETS so the extra
 * fetch + column count can never balloon. Pure calendar math (no upstream call).
 */
function farDatedTargetExpiries(todayYmd: string, afterYmd: string): string[] {
  const [ty, tm] = todayYmd.split("-").map(Number);
  if (!Number.isFinite(ty) || !Number.isFinite(tm)) return [];
  const out: string[] = [];
  for (let i = 0; i < FAR_DATED_MONTHS_AHEAD + 1; i++) {
    const month0 = tm - 1 + i; // tm is 1-based; Date handles month overflow into next year
    const d = new Date(Date.UTC(ty, month0, 1));
    const ymd = thirdFridayYmd(d.getUTCFullYear(), d.getUTCMonth());
    // Keep only standard monthlies AFTER the near-term window (and not in the past).
    if (ymd > afterYmd && ymd >= todayYmd) out.push(ymd);
  }
  // Ascending + de-duped + bounded.
  return Array.from(new Set(out)).sort().slice(0, FAR_DATED_MAX_TARGETS);
}

/**
 * Far-dated monthlies always get a dedicated per-expiry band fetch. The near-term paginated
 * snapshot may have *partially* populated an expiry (a handful of strikes that fell inside the
 * main band), which must NOT suppress the guaranteed fetch — otherwise QQQ/SPY far columns
 * stick at ~12 strikes instead of the full ±2% band.
 */
export function farDatedExpiriesToFetch(farTargets: readonly string[]): string[] {
  return [...farTargets];
}

/**
 * Splits the matrix's kept expiries into near-term (feeds strike_totals/total — the authoritative
 * walls/flip/net every downstream consumer reads) vs far-dated (matrix cells only). `nearTermAxis`
 * MUST be the near-term expiries captured BEFORE any far-dated contract was merged into the shared
 * expiry set — passing the post-merge set here instead reproduces a real, previously-shipped bug:
 * when a thin-chain ticker has fewer real near-term expiries than NEAR_TERM_EXPIRY_COUNT, an
 * under-filled slice of the post-merge set silently back-fills with far-dated monthly/quarterly
 * expiries (they sort after the real near dates but before nothing), so OI belonging to a wall
 * months out gets summed into "today's" near-term walls/flip/net exposure — the same class of bug
 * already fixed for max_pain (docs/audit/FINDINGS.md), recurring here for GEX/VEX/DEX/CHARM.
 */
export function resolveExpiryAxis(
  nearTermAxis: readonly string[],
  farTargets: readonly string[],
  expirySetAfterFarFetch: ReadonlySet<string>
): { nearKeep: string[]; farKeep: string[]; expiries: string[] } {
  const nearKeep = [...nearTermAxis];
  const farKeep = farTargets.filter((e) => expirySetAfterFarFetch.has(e));
  const expiries = Array.from(new Set([...nearKeep, ...farKeep])).sort();
  return { nearKeep, farKeep, expiries };
}

/** Stable dedupe key for heatmap contract accumulation (one row per listed contract). */
export function gexContractDedupeKey(c: ChainContract, minExpiryYmd: string): string | null {
  const strike = Number(c.details?.strike_price);
  const expiry = String(c.details?.expiration_date ?? "").slice(0, 10);
  const type = String(c.details?.contract_type ?? "").toLowerCase();
  if (!Number.isFinite(strike) || strike <= 0 || !expiry || expiry < minExpiryYmd) return null;
  if (type !== "call" && type !== "put") return null;
  return `${expiry}|${strike}|${type}`;
}

/**
 * Closed-form Black-Scholes VANNA per share: ∂²V/∂S∂σ = −φ(d1)·d2/σ.
 * Returns 0 (skip) when inputs are non-finite, T<=0, or σ<=0 — never fabricated.
 * Sign is the SAME for calls and puts (vanna is type-independent); the call/put
 * dealer-sign convention is applied by the caller, mirroring gamma.
 */
function vannaPerShare(spot: number, strike: number, t: number, sigma: number): number {
  if (!(spot > 0) || !(strike > 0) || !(t > 0) || !(sigma > 0)) return 0;
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + 0.5 * sigma * sigma * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const v = (-normPdf(d1) * d2) / sigma;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Closed-form Black-Scholes CHARM per share (delta decay) for r=q=0: φ(d1)·d2 / (2T).
 *
 * Derivation (verified against the textbook form): the standard charm for a CALL is
 *   charm_call = −φ(d1)·(2(r−q)T − d2·σ√T) / (2T·σ√T).
 * With r=q=0 the numerator collapses to −d2·σ√T, so
 *   charm_call = −φ(d1)·(−d2·σ√T)/(2T·σ√T) = φ(d1)·d2 / (2T).
 * This is "charm" in the standard sense: the change in delta per unit of CALENDAR time passing
 * (delta DECAY), i.e. −∂Δ/∂(time-to-expiry). NUMERICALLY VERIFIED: φ(d1)·d2/(2T) matches the
 * central finite-difference −∂Δ/∂T to ~1e-7 across S/K/T/σ test points (and equals +∂Δ/∂T's
 * negative — the same magnitude with the decay sign). Because Δ_put = Δ_call − 1, the two share
 * the same time-derivative → put charm EQUALS call charm at r=q=0, so charm is type-independent
 * exactly like gamma; the caller applies the dealer call(+)/put(−) sign at accumulation, identical
 * to the gamma/vanna pattern.
 *
 * Units: per-share charm per UNIT of time in YEARS (ACT/365), matching the year-fraction `t`
 * from yearsToExpiry → reads as delta decay per year. Returns 0 (skip) on non-finite inputs,
 * T<=0, or σ<=0 — SAME guard as vannaPerShare — never fabricated.
 */
function charmPerShare(spot: number, strike: number, t: number, sigma: number): number {
  if (!(spot > 0) || !(strike > 0) || !(t > 0) || !(sigma > 0)) return 0;
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + 0.5 * sigma * sigma * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const c = (normPdf(d1) * d2) / (2 * t);
  return Number.isFinite(c) ? c : 0;
}

/**
 * Derive the dealer-gamma regime levels (call wall, put wall, posture, read) from the
 * already-computed per-strike NET gamma totals + spot + flip. Never fabricates: when a
 * level can't be determined it is null and the `read` falls back to a neutral string.
 */
function computeGexRegime(
  strikeTotals: Record<string, number>,
  spot: number,
  flip: number | null,
  maxPain: number | null
): { callWall: number | null; putWall: number | null; regime: GexRegime } {
  let callWall: number | null = null;
  let putWall: number | null = null;
  let maxPos = 0;
  let maxNeg = 0;
  for (const [s, g] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    // Largest POSITIVE net gamma → call wall (resistance/pin).
    if (g > maxPos) {
      maxPos = g;
      callWall = strike;
    }
    // Largest NEGATIVE net gamma → put wall (support).
    if (g < maxNeg) {
      maxNeg = g;
      putWall = strike;
    }
  }

  const posture: "long" | "short" | null =
    flip != null && spot > 0 ? (spot >= flip ? "long" : "short") : null;

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

  let read: string;
  if (posture == null || flip == null || !(spot > 0)) {
    read = "Gamma flip undetermined — regime read unavailable until the chain prints a clean dealer-gamma profile.";
  } else if (posture === "long") {
    const resistance = callWall != null ? ` Resistance ${fmt(callWall)}` : "";
    const support = putWall != null ? `${resistance ? "," : ""} support ${fmt(putWall)}` : "";
    const tail = resistance || support ? `.${resistance}${support}.` : ".";
    read = `Spot ${fmt(spot)} is above the gamma flip (${fmt(flip)}) → long gamma: range-bound, fade extremes${tail}`;
  } else {
    const resistance = callWall != null ? ` Resistance ${fmt(callWall)}` : "";
    const support = putWall != null ? `${resistance ? "," : ""} support ${fmt(putWall)}` : "";
    const tail = resistance || support ? `.${resistance}${support}.` : ".";
    read = `Spot ${fmt(spot)} is below the gamma flip (${fmt(flip)}) → short gamma: momentum / vol expansion, moves accelerate${tail}`;
  }

  // Note: maxPain is surfaced as its own field; intentionally not folded into `read`.
  void maxPain;

  return { callWall, putWall, regime: { flip, posture, read } };
}

/**
 * Derive the dealer-vanna regime (positive/negative walls, posture, read) from the
 * per-strike NET vanna totals + the matrix total. Never fabricates: missing levels are
 * null and the read falls back to a neutral string.
 *
 * Sign read: net dealer vanna POSITIVE → as IV rises dealers must buy into the move
 * (hedging adds to / reinforces the move); NEGATIVE → dealers fade the move as IV rises.
 * Vanna matters most into OPEX and around vol spikes.
 */
function computeVexRegime(
  strikeTotals: Record<string, number>,
  total: number
): { posWall: number | null; negWall: number | null; regime: VexRegime } {
  let posWall: number | null = null;
  let negWall: number | null = null;
  let maxPos = 0;
  let maxNeg = 0;
  for (const [s, v] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    if (!Number.isFinite(strike) || !Number.isFinite(v)) continue;
    if (v > maxPos) {
      maxPos = v;
      posWall = strike;
    }
    if (v < maxNeg) {
      maxNeg = v;
      negWall = strike;
    }
  }

  const posture: "positive" | "negative" | null =
    Number.isFinite(total) && total !== 0 ? (total > 0 ? "positive" : "negative") : null;

  let read: string;
  if (posture == null) {
    read = "Net vanna ~flat — dealer hedging is broadly insensitive to IV shifts here; little vol-driven flow to expect.";
  } else if (posture === "positive") {
    read = "Net vanna positive — dealer hedging ADDS to moves as IV rises (and fades them as IV falls); matters into OPEX / vol spikes.";
  } else {
    read = "Net vanna negative — dealers FADE moves as IV rises (cushioning) and lean into them as IV falls; watch into OPEX / vol spikes.";
  }

  return { posWall, negWall, regime: { posture, read } };
}

/**
 * Derive the dealer-DELTA regime (posture + plain read) from the net dealer dollar-delta total.
 * Never fabricates: a ~flat / undeterminable total → posture null + neutral read.
 *
 * Directional convention (get this right): net dealer delta POSITIVE → dealers net LONG delta →
 * to stay hedged they SELL rallies / BUY dips → mean-reverting → STABILIZING. NEGATIVE → dealers
 * net SHORT delta → BUY rallies / SELL dips → trend-amplifying → DESTABILIZING.
 */
function computeDexRegime(total: number): DexRegime {
  const posture: "long" | "short" | null =
    Number.isFinite(total) && total !== 0 ? (total > 0 ? "long" : "short") : null;

  let read: string;
  if (posture == null) {
    read = "Net dealer delta ~flat — little directional hedging pressure; neither stabilizing nor amplifying.";
  } else if (posture === "long") {
    read = "Net dealer delta positive (dealers net LONG delta) — they SELL rallies and BUY dips to stay hedged → mean-reverting, STABILIZING.";
  } else {
    read = "Net dealer delta negative (dealers net SHORT delta) — they BUY rallies and SELL dips to stay hedged → trend-amplifying, DESTABILIZING.";
  }
  return { posture, read };
}

/**
 * Derive the dealer-CHARM regime (posture + plain pinning read) from the net dealer dollar-charm
 * total. Charm is the passive delta-decay flow that GROWS as expiry nears — the engine of
 * pre-OPEX and end-of-day pinning toward heavy-OI strikes. Never fabricates: ~flat → null + neutral.
 *
 * Direction (get this right — same dealer sign convention as computeDexRegime, calls +1/puts -1):
 * charm = ∂Δ/∂t, so a POSITIVE total means the dealer book's assumed delta INCREASES as time
 * passes → dealers must SELL stock to stay hedged → DOWNWARD pressure. NEGATIVE → delta
 * decreases → dealers must BUY → UPWARD pressure. (Independently corroborated against
 * published dealer-charm-exposure methodology, e.g. "positive CHEX → dealers sell shares daily,
 * a headwind.") The read text below was previously backwards (positive said "pins upward").
 */
export function computeCharmRegime(total: number): CharmRegime {
  const posture: "positive" | "negative" | null =
    Number.isFinite(total) && total !== 0 ? (total > 0 ? "positive" : "negative") : null;

  let read: string;
  if (posture == null) {
    read = "Net charm ~flat — minimal delta-decay flow; little time-driven pinning pressure expected.";
  } else if (posture === "positive") {
    read = "Net charm positive — as expiry nears, delta decay pushes dealer hedging that DRAGS price downward toward heavy strikes; strongest pre-OPEX and into the close.";
  } else {
    read = "Net charm negative — delta decay pushes dealer hedging that PINS price upward toward heavy strikes as expiry nears; strongest pre-OPEX and into the close.";
  }
  return { posture, read };
}

/**
 * Resolve a user-supplied ticker to its Polygon/Massive options-chain & quote root.
 * Index tickers live under an `I:` index underlying; equities/ETFs are used directly.
 * Input is uppercased/normalized. Unknown symbols pass through untouched (best-effort).
 */
const INDEX_ROOTS: Record<string, string> = {
  SPX: "I:SPX",
  NDX: "I:NDX",
  RUT: "I:RUT",
  VIX: "I:VIX",
};

const OPTIONS_ROOT_CHARSET_RE = /^[A-Z0-9.]{1,20}$/;

/**
 * `ticker` is untrusted, user-supplied input on every /api/market/gex-* route (query param, at
 * most uppercased before reaching here) and `optionsRoot` becomes a URL PATH segment in every
 * downstream Polygon chain fetch (fetchHeatmapBand, fetchPolygonOiByExpiry,
 * fetchPolygonIvTermStructure — all splice it into `/v3/.../${optionsRoot}?...` via template
 * literal, not URL-encoded).
 *
 * Validates against an allowlist charset and REJECTS (returns "") anything that doesn't already
 * conform, rather than stripping bad characters and passing the mangled remainder through. A
 * strip-then-pass-through version of this function was flagged by CodeQL as a request-forgery
 * sink and — critically — REMAINED flagged as a live critical alert after shipping, because
 * CodeQL's taint tracking doesn't treat `String.replace()` as clearing taint (it's a value
 * transform, not a validating guard). A `RegExp.test()` guard with a hardcoded fallback on the
 * failing branch is the pattern its sanitizer-guard recognition is built for, and it's strictly
 * safer besides: a malformed ticker now fails closed (empty path segment → clean 404/miss
 * upstream) instead of reaching Polygon with attacker-influenced-but-mangled content.
 */
export function resolveOptionsRoot(ticker: string): { root: string; optionsRoot: string } {
  const upper = String(ticker ?? "").trim().toUpperCase();
  const root = OPTIONS_ROOT_CHARSET_RE.test(upper) ? upper : "";
  const optionsRoot = INDEX_ROOTS[root] ?? root;
  return { root, optionsRoot };
}

/**
 * How long a live Polygon WS index tick (I:SPX, I:VIX) stays preferred over the DELAYED REST
 * indices snapshot when resolving the GEX/positioning spot. Mirrors spx-desk's INDEX_STORE_STALE_MS
 * intent: the index aggregate ticks are naturally sparse on quiet tape, and the REST `/v3/snapshot/
 * indices` is a delayed snapshot — so a 30-120s-old REAL WS print is far fresher than the REST one.
 * Env-tunable (shares the desk's knob so they stay aligned); defaults to 120s.
 */
const GEX_INDEX_WS_STALE_MS = (() => {
  const raw = process.env.SPX_INDEX_WS_STALE_SEC?.trim();
  const sec = raw ? Number(raw) : 120;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 120_000;
})();

/**
 * Best-effort live WS spot for an index options root (only I:SPX / I:VIX are on the indices socket).
 *
 * FRESHNESS FIX: the GEX matrix + positioning spot otherwise came from the DELAYED REST indices
 * snapshot, so the SPX "spot" the Heat Maps / gex-positioning surface lagged the live underlying
 * (and the desk header, which already prefers the WS price via mergeWsIndexSnapshots) by a couple
 * of points even right after a warm. Reading the same in-process `indexStore` the desk reads aligns
 * the GEX spot with the live desk price from ONE shared source — no extra upstream call.
 *
 * Returns null (→ caller falls back to REST) unless the WS tick is present, fresh (within
 * GEX_INDEX_WS_STALE_MS), and > 0. The change% is taken from the WS entry ONLY when its session
 * anchor is REST-seeded/authoritative (open_source === "rest"); on a mid-session cold start where
 * the anchor is still a raw boot-time bar open ("ws-bar") the WS change% is wrong, so we report
 * null there and let the caller keep the authoritative REST change% — identical to the desk's
 * mergeWsIndexSnapshots guard. Entirely best-effort: any import/read error → null (REST path).
 */
async function liveWsIndexSpot(
  root: string,
  now = Date.now()
): Promise<{ price: number; change_pct: number | null } | null> {
  try {
    const { indexStore } = await import("../ws/polygon-socket");
    const ws = indexStore[root];
    if (!ws || !(ws.price > 0) || !ws.updatedAt) return null;
    if (now - ws.updatedAt >= GEX_INDEX_WS_STALE_MS) return null;
    const changeAuthoritative = ws.open_source === "rest";
    return {
      price: ws.price,
      change_pct: changeAuthoritative && Number.isFinite(ws.change_pct) ? ws.change_pct : null,
    };
  } catch {
    return null;
  }
}

/**
 * Live WS stock spot — reads from the stock-candle-store fed by the stocks WS A.* subscription.
 * Returns null when no fresh tick exists.
 */
async function liveWsStockSpot(
  ticker: string,
  now = Date.now()
): Promise<{ price: number } | null> {
  try {
    const { getStockLiveCandle } = await import("../ws/stock-candle-store");
    const snap = getStockLiveCandle(ticker);
    if (!snap.current || !(snap.current.close > 0)) return null;
    if (now - snap.updatedAt >= GEX_INDEX_WS_STALE_MS) return null;
    return { price: snap.current.close };
  } catch {
    return null;
  }
}

/**
 * Resolve the underlying SPOT for an options root, choosing the correct snapshot endpoint.
 *
 * CRITICAL: index roots (`I:SPX`, `I:NDX`, …) are NOT on the stocks-snapshot endpoint —
 * `fetchStockSnapshot("I:SPX")` returns no row → spot 0 → an empty matrix for SPX/NDX/RUT/VIX
 * (the flagship "live header price, dead matrix" break). Index roots must go through the
 * indices snapshot (`fetchIndexSnapshot`), exactly as the quote route does. Equities/ETFs
 * use the stocks snapshot. Both snapshots share the `{ price, change_pct }` shape, so this
 * normalizes to that single shape every caller in this file expects. Null when unavailable —
 * never fabricated.
 *
 * FRESHNESS: for index roots on the live indices WS (I:SPX / I:VIX) we PREFER the in-process
 * `indexStore` tick when it's fresh — the SAME live price the SPX desk header shows — so the GEX
 * spot no longer lags the underlying by the REST-snapshot delay. The REST snapshot is still fetched
 * (it provides the authoritative day change% and is the fallback when the WS tick is stale/absent);
 * we only overlay the fresher WS PRICE on top of it.
 */
async function resolveSpotSnapshot(
  optionsRoot: string
): Promise<{ price: number; change_pct: number } | null> {
  const root = optionsRoot.toUpperCase();
  const isIndex = root.startsWith("I:") || Object.values(INDEX_ROOTS).includes(root);

  // --- WS-first: try the live candle store BEFORE any REST call ---
  // Stocks WS A.* and indices WS both feed into candle stores with sub-second updates.
  // Use the WS price as primary; fall through to REST only when WS has no fresh tick.
  if (isIndex) {
    const ws = await liveWsIndexSpot(root);
    if (ws) {
      // REST still needed for change_pct when the WS doesn't carry it authoritatively.
      const restSnap = await fetchIndexSnapshot(root).catch(() => null);
      return { price: ws.price, change_pct: ws.change_pct ?? restSnap?.change_pct ?? 0 };
    }
  } else {
    const ws = await liveWsStockSpot(root);
    if (ws) {
      const restSnap = await fetchStockSnapshot(root).catch(() => null);
      return { price: ws.price, change_pct: restSnap?.change_pct ?? 0 };
    }
  }

  // Fallback: REST snapshot (Polygon unlimited, no rate-limit concern).
  const snap = isIndex
    ? await fetchIndexSnapshot(root).catch(() => null)
    : await fetchStockSnapshot(root).catch(() => null);
  const restPrice = snap && snap.price > 0 ? snap.price : 0;
  if (!(restPrice > 0)) return null;
  return { price: restPrice, change_pct: snap?.change_pct ?? 0 };
}

const GEX_HEATMAP_CACHE_PREFIX = "gex-heatmap";
/**
 * How many NEAR-TERM expiries (the nearest dailies/weeklies, ascending) the matrix keeps — the
 * UNCHANGED legacy "8 nearest" behavior. The far-dated monthly/quarterly columns are ADDED to this
 * block (never replace it), so the near-term view is preserved exactly.
 */
const NEAR_TERM_EXPIRY_COUNT = 8;
/** In-memory mirror of the Redis matrix so co-located requests skip Redis too. */
const cachedHeatmaps = new Map<string, { at: number; data: GexHeatmap }>();

/**
 * Single-flight guard for the matrix BUILD (cache-miss compute), keyed by cacheKey. Without it a
 * cold preset under organic burst (or the warm cron racing a user GET) fires N concurrent
 * resolveSpotSnapshot + fetchHeatmapBand chains for the SAME ticker — N× the upstream cost for
 * one shared result. Concurrent callers that miss the cache AWAIT the in-flight build and read its
 * result. Mirrors the coalescedInflight pattern in uw-rate-limiter. The entry is always cleared in
 * a finally so a thrown build can't wedge the key. A forceRefresh build is NOT coalesced onto a
 * normal in-flight build (it intentionally bypasses cache), but concurrent forceRefresh callers on
 * the same key DO share one build.
 */
const heatmapInflight = new Map<string, Promise<GexHeatmap | null>>();

// Bound the ticker dimension so an unusual spread of (garbage) tickers can't leak
// memory. Insertion-order LRU + delete-oldest eviction, same pattern as
// server-cache.ts:setStoreEntry / shared-cache.ts:setMemoryEntry. TTL/semantics
// are unchanged — this only caps how many distinct keys can live at once.
const MAX_HEATMAP_CACHE = 500;
function setCachedHeatmap(key: string, entry: { at: number; data: GexHeatmap }): void {
  cachedHeatmaps.delete(key); // re-insert → most-recently-used position
  while (cachedHeatmaps.size >= MAX_HEATMAP_CACHE) {
    const oldest = cachedHeatmaps.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cachedHeatmaps.delete(oldest);
  }
  cachedHeatmaps.set(key, entry);
}

function gexHeatmapCacheMs(): number {
  const sec = Number(process.env.GEX_HEATMAP_CACHE_SEC ?? 5);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 5_000;
}

/** SPX Slayer / desk hot path — same 5s TTL as the global default now. */
function gexHeatmapCacheMsFor(root: string): number {
  if (root === "SPX") {
    const sec = Number(process.env.SPX_GEX_HEATMAP_CACHE_SEC ?? 5);
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 5_000;
  }
  return gexHeatmapCacheMs();
}

/**
 * Max age of a matrix entry we'll still SERVE while refreshing in the background.
 * Covers the heatmap-warm cron gap so a cold replica or TTL-boundary miss returns the
 * last good matrix instantly instead of blocking 20–35s on a chain rebuild. Always
 * enabled — including preset fast-move — so a cache miss never forces every member GET
 * to block on a full chain rebuild
 * (live-caught 2026-07-06: SPX /gex-heatmap 502 + dashboard matrix stuck loading).
 */
function gexHeatmapMaxStaleMs(): number {
  const sec = Number(process.env.GEX_HEATMAP_MAX_STALE_SEC ?? 90);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 90_000;
}

/** Serve an expired matrix immediately and kick off a background rebuild (single-flight). */
function tryStaleWhileRevalidateHeatmap(
  cacheKey: string,
  root: string,
  optionsRoot: string,
  now: number,
  ttlMs: number,
  baseTtlMs: number,
  mem: { at: number; data: GexHeatmap } | undefined,
  redisHit: { at: number; data: GexHeatmap } | null
): GexHeatmap | null {
  const maxStaleMs = gexHeatmapMaxStaleMs();
  let best: { at: number; data: GexHeatmap } | null = null;
  for (const entry of [mem, redisHit]) {
    if (!entry) continue;
    const age = now - entry.at;
    if (age >= ttlMs && age < maxStaleMs && (!best || entry.at > best.at)) {
      best = entry;
    }
  }
  if (!best) return null;

  if (!heatmapInflight.has(cacheKey)) {
    const build = buildGexHeatmapUncached(root, optionsRoot, cacheKey, now, baseTtlMs).finally(() => {
      heatmapInflight.delete(cacheKey);
    });
    heatmapInflight.set(cacheKey, build);
    void build.catch(() => {
      /* stale already returned — background refresh failure is non-fatal */
    });
  }

  if (redisHit && (!mem || redisHit.at >= mem.at)) {
    setCachedHeatmap(cacheKey, redisHit);
  }
  return best.data;
}

/**
 * Negative-cache window for a NO-SPOT result (dead/unknown/transiently-quoteless ticker). Short
 * by design: long enough to absorb a client's poll storm (so we don't re-fetch the spot snapshot
 * every poll for a name with no quote), short enough that a name which momentarily had no spot
 * isn't frozen empty for the full matrix TTL once it starts quoting again.
 */
const EMPTY_SPOT_NEGATIVE_TTL_MS = 10_000;

/**
 * Shortened accept-age for a SERVED heatmap entry during a preset fast move (>0.5% in-window).
 * Mirrors the desk's fast-move intent: re-sync the matrix to the new price level quickly without
 * abandoning caching entirely. Overridable via env; defaults to 5s.
 */
function gexHeatmapFastMoveTtlMs(): number {
  const sec = Number(process.env.GEX_HEATMAP_FAST_MOVE_SEC ?? 5);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 5_000;
}
const GEX_HEATMAP_FAST_MOVE_TTL_MS = gexHeatmapFastMoveTtlMs();

/**
 * Signal silent chain truncation. A banded options-chain pagination loop exited because
 * it hit its page-guard cap while `next_url` was STILL set — so the chain was cut short
 * and the derived walls / OI / IV-term are UNDERSTATED with (previously) no signal at all.
 * Observability only: emits one warning so the truncation is no longer invisible. Raising
 * the cap / fully following next_url is a value-changing follow-up (API_INTEGRATION_MAP →
 * "Pagination guards can silently truncate the chain").
 */
function warnChainTruncated(label: string, underlying: string, pages: number): void {
  console.warn(
    `[polygon-gex] ${label}(${underlying}) truncated: hit ${pages}-page guard with next_url still set — chain incomplete, walls/OI/IV understated. Raise the page guard or paginate fully if this recurs.`
  );
}

/**
 * Strike-banded options chain snapshot across ALL expiries in one paginated pass
 * (NO expiration_date filter — the snapshot returns every expiry inside the strike
 * window). Reuses polygonFetchUrl + the next_url pagination exactly like fetchChainBand.
 */
/**
 * Safety BACKSTOP for the banded heatmap chain pull, not a tuned-to-fit page count. This was
 * previously raised 16 → 40 to fit SPX's chain "for now," and 40 truncated again within the same
 * day as more strikes/expiries populated (measured live: SPX's ±6% band needs 46 pages / 11,254
 * contracts to fully paginate — see FINDINGS.md). Chasing the live chain size with another static
 * number is the same bug recurring on a slower clock, so this is set with generous headroom
 * (~4x today's measured need) and the loop below follows next_url until Polygon says the chain is
 * done, rather than stopping at an arbitrary count. The build is a cached warm path (heatmap-warm
 * cron) paced by the cluster rate-limiter (polygonTrackedFetch), so extra pages cost latency on
 * that warm path, not per-user request budget. Floored at 40 (the OLD cap) so a misconfigured/blank
 * env value can never sink below the level that was already proven insufficient.
 */
export function resolveHeatmapPageGuard(envValue: string | undefined): number {
  return Math.max(40, Number(envValue) || 200);
}
const HEATMAP_PAGE_GUARD = resolveHeatmapPageGuard(process.env.OPTIONS_HEATMAP_PAGE_GUARD);

/**
 * Page backstop for the per-expiry banded chain pull (`fetchChainBand`). A single expiry within a
 * ~±1.5% band is normally 1–2 pages, but `strikeHints` can widen the band to cover deep ITM/OTM
 * held legs, pushing past the old bare `guard < 8` cap — which truncated the chain and only WARNED,
 * silently understating OI/walls for that (underlying, expiry). Like the heatmap guard this is a
 * runaway-loop backstop, not the stop condition (that's `!next_url`); floored at the OLD cap of 8
 * so a blank/misconfigured env can never sink below what already shipped, default 40 (~5× headroom).
 */
export function resolveChainBandPageGuard(envValue: string | undefined): number {
  return Math.max(8, Number(envValue) || 40);
}
const CHAIN_BAND_PAGE_GUARD = resolveChainBandPageGuard(process.env.OPTIONS_CHAIN_BAND_PAGE_GUARD);

/**
 * SPX default strike band: ±6%. SPX's chain is DENSE (5-pt strikes → ~180 strikes/expiry inside
 * ±6% at a 7500 spot), so a tight band already yields a rich ladder AND keeps the hot, cron-warmed
 * SPX payload small. Widening SPX would balloon its contract count with no wall-count benefit.
 */
const SPX_HEATMAP_BAND_PCT = 0.06;

/**
 * Default strike band for every OTHER ticker: ±20%. ±6% was too narrow for sparse chains (ASTS @
 * $73: only 10 strikes, 2 call walls — real walls at 90/100/125 never fetched). ±12% improved it
 * (22 strikes) but still missed round-number gamma walls that sit 20-70% above spot on low-priced
 * names. ±20% aligns with the Vector chart's BEAD_VIEW_MAX_PCT (0.20) and stays well under the
 * DTE-scoped path's -30%/+35% band, so the shared heatmap no longer fetches a narrower window than
 * either the chart or the per-expiry walls are willing to draw. Env-overridable up to 25%.
 */
const DEFAULT_HEATMAP_BAND_PCT = 0.20;

/** Strike band around spot for the shared heatmap chain pull. SPX stays tight (dense); everything
 *  else uses ±20% so sparse/low-priced names surface round-number walls (ASTS 90/100/125 @ $73). */
function heatmapBandPct(root: string): number {
  const clamp = (n: number) => (Number.isFinite(n) && n > 0 && n <= 0.25 ? n : null);
  if (root === "SPX") {
    return clamp(Number(process.env.SPX_GEX_HEATMAP_BAND_PCT)) ?? SPX_HEATMAP_BAND_PCT;
  }
  return clamp(Number(process.env.GEX_HEATMAP_BAND_PCT)) ?? DEFAULT_HEATMAP_BAND_PCT;
}

export const __test_heatmapBandPct = heatmapBandPct;

async function fetchHeatmapBand(
  underlying: string,
  spot: number,
  bandPct: number
): Promise<ChainContract[]> {
  const band = Math.max(spot * bandPct, 1);
  const lo = Math.floor(spot - band);
  const hi = Math.ceil(spot + band);

  const params = new URLSearchParams({
    "strike_price.gte": String(lo),
    "strike_price.lte": String(hi),
    limit: "250",
    apiKey: KEY,
  });

  const out: ChainContract[] = [];
  let page = await polygonFetchUrl(`/v3/snapshot/options/${underlying}?${params}`);
  // ~15 stored expiries × banded strikes × calls+puts routinely exceeds even a generous static
  // page cap (see HEATMAP_PAGE_GUARD above) — this loop follows next_url until Polygon reports
  // the chain is exhausted; HEATMAP_PAGE_GUARD is a runaway-loop backstop, not the expected stop
  // condition.
  let guard = 0;
  while (page && guard < HEATMAP_PAGE_GUARD) {
    out.push(...(page.results ?? []));
    if (!page.next_url) break;
    page = await polygonFetchUrl(page.next_url);
    guard += 1;
  }
  if (page?.next_url) warnChainTruncated("fetchHeatmapBand", underlying, guard);
  return out;
}

/**
 * Compute the zero-gamma flip from per-strike NET dealer gamma totals.
 *
 * PRIMARY: the strike (linear-interpolated to gamma=0) where per-strike net gamma changes
 * sign — in EITHER direction — choosing the crossing NEAREST spot. Real per-strike gamma
 * profiles are lumpy (OI concentrates in specific strikes), so positive→negative transitions
 * are just as common as negative→positive and can legitimately be the crossing closest to
 * spot; restricting to one direction made the function structurally blind to half of the real
 * crossings, silently picking a farther, wrong-direction level whenever the true nearest
 * crossing ran the other way. This is robust on heavily one-sided books (a deep net-short
 * profile still has a clean sign flip), where the old cumulative-sum crossing returned null
 * because the running total never crossed back through zero.
 * FALLBACK: the legacy cumulative-crossing, then null.
 */
export function computeZeroGammaFlip(strikeTotals: Record<string, number>, spot = 0): number | null {
  const rows = Object.entries(strikeTotals)
    .map(([s, g]) => ({ strike: Number(s), gamma: g }))
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.gamma))
    .sort((a, b) => a.strike - b.strike);
  if (rows.length < 2) return null;

  // Primary: per-strike sign transitions in EITHER direction, interpolated to gamma = 0.
  const crossings: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if ((a.gamma < 0 && b.gamma > 0) || (a.gamma > 0 && b.gamma < 0)) {
      const frac = (0 - a.gamma) / (b.gamma - a.gamma); // 0..1 where gamma crosses 0 (direction-agnostic)
      crossings.push(Number((a.strike + (b.strike - a.strike) * frac).toFixed(2)));
    }
  }
  if (crossings.length) {
    return spot > 0
      ? crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best))
      : crossings[crossings.length - 1];
  }

  // Fallback: cumulative-sum crossing (legacy) — for unusual profiles with no clean flip.
  // Build the running cumulative sum per strike, then scan strictly ADJACENT pairs (cum[i-1],
  // cum[i]) for a sign change and interpolate across that SAME i-1..i strike segment. (The
  // prior version updated prevCum after the check, so it compared cum[i] vs cum[i-2] while
  // interpolating i-1..i — the first segment could never flip.)
  const cum: number[] = [];
  let running = 0;
  for (const r of rows) {
    running += r.gamma;
    cum.push(running);
  }
  for (let i = 1; i < cum.length; i++) {
    const prevCum = cum[i - 1];
    const nextCum = cum[i];
    if (prevCum !== 0 && nextCum !== 0 && Math.sign(nextCum) !== Math.sign(prevCum)) {
      const span = rows[i].strike - rows[i - 1].strike;
      const frac = prevCum / (prevCum - nextCum); // 0..1 along the i-1..i segment
      return Number((rows[i - 1].strike + span * frac).toFixed(2));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// SHIFT — intraday gamma migration (positioning-history ring + diff)
// ---------------------------------------------------------------------------

const GEX_HISTORY_PREFIX = "gex-history";
/** Min spacing between sampled snapshots (~5 min) so the ring spans real time, not poll noise. */
const GEX_HISTORY_SAMPLE_MS = 5 * 60_000;
/** Max snapshots kept (~24 × 5 min ≈ 2h of intraday positioning history). */
const GEX_HISTORY_MAX = 24;
/** Redis TTL for the history ring (~3h) — outlives the window so a quiet patch doesn't drop it. */
const GEX_HISTORY_TTL_SEC = 3 * 60 * 60;

/**
 * Best-effort: append a sampled GEX snapshot to the `gex-history:{ticker}` ring and return
 * the resulting (trimmed) ring. THROTTLED — a new entry is only appended when the last one is
 * ≥5 min old (or the ring is empty); otherwise the ring is returned unchanged. Read-modify-write
 * races are benign (worst case a duplicate/near-dupe sample). Any Redis miss/error returns the
 * snapshots read so far (or just the fresh one) and NEVER throws — the matrix must not break.
 *
 * Called ONLY on a fresh matrix compute (cache miss) → one history read/write per ticker per
 * compute, never per user.
 */
async function appendGexHistory(
  cacheKey: string,
  snapshot: GexHistorySnapshot
): Promise<GexHistorySnapshot[]> {
  const key = `${GEX_HISTORY_PREFIX}:${cacheKey}`;
  try {
    const { sharedCacheGet, sharedCacheSet } = await import("../shared-cache");
    const prior = (await sharedCacheGet<GexHistorySnapshot[]>(key)) ?? [];
    const ring = Array.isArray(prior) ? prior.filter((s) => s && typeof s.ts === "number") : [];
    const last = ring[ring.length - 1];
    // Throttle: keep existing ring if the most recent sample is younger than the sample window.
    if (last && snapshot.ts - last.ts < GEX_HISTORY_SAMPLE_MS) {
      return ring;
    }
    ring.push(snapshot);
    // Trim to the most-recent GEX_HISTORY_MAX (~2h).
    const trimmed = ring.slice(-GEX_HISTORY_MAX);
    await sharedCacheSet(key, trimmed, GEX_HISTORY_TTL_SEC);
    return trimmed;
  } catch {
    // Redis unavailable → at least let the diff see the current snapshot (still <2 → collecting).
    return [snapshot];
  }
}

// ---------------------------------------------------------------------------
// EOD SNAPSHOT — day-over-day historical context ("vs prior close")
// ---------------------------------------------------------------------------

const GEX_EOD_PREFIX = "gex-eod";
/** Rolling EOD snapshots kept (~10 trading days ≈ two weeks of "vs prior close" anchors). */
const GEX_EOD_MAX = 10;
/** Redis TTL for the EOD series (~20 days) — outlives the rolling window so a long weekend/holiday gap doesn't drop it. */
const GEX_EOD_TTL_SEC = 20 * 24 * 60 * 60;

/**
 * Best-effort: capture the close GEX snapshot for `ticker` into the `gex-eod:{ticker}` rolling
 * series (one entry per trading day). CACHE-READER — reads the SHARED cached matrix via
 * fetchGexHeatmap(ticker) (NO new upstream beyond what the matrix already does) and persists the
 * compact close levels.
 *
 * IDEMPOTENT per day: if a snapshot for today's ET date already exists in the series it is
 * REPLACED (not duplicated), so cron re-runs / manual "Run now" are safe. Trims to the most-recent
 * GEX_EOD_MAX dates. NEVER throws — a Redis miss / unconfigured matrix / empty heatmap is a no-op
 * that returns null so the cron can record it as "skipped" without aborting the rest of the batch.
 */
export async function appendGexEodSnapshot(ticker: string): Promise<GexEodSnapshot | null> {
  try {
    const { root } = resolveOptionsRoot(ticker);
    if (!root) return null;
    // Cache-reader: the matrix is mostly warm from the trading day; a cold one is ONE shared compute.
    const heatmap = await fetchGexHeatmap(root);
    // No spot / empty chain → nothing meaningful to anchor; skip (never fabricate a close).
    if (!heatmap || !(heatmap.spot > 0) || heatmap.strikes.length === 0) return null;

    const snapshot: GexEodSnapshot = {
      date: todayEtYmd(),
      spot: heatmap.spot,
      flip: heatmap.gex.flip,
      call_wall: heatmap.gex.call_wall,
      put_wall: heatmap.gex.put_wall,
      net_gex: heatmap.gex.total,
      max_pain: heatmap.max_pain,
      // DEX + CHARM — optional blocks; older cached payloads may omit them (null safe).
      net_dex: heatmap.dex?.total ?? null,
      dex_posture: heatmap.dex?.regime?.posture ?? null,
      net_charm: heatmap.charm?.total ?? null,
      charm_posture: heatmap.charm?.regime?.posture ?? null,
    };

    const key = `${GEX_EOD_PREFIX}:${root}`;
    const { sharedCacheGet, sharedCacheSet } = await import("../shared-cache");
    const prior = (await sharedCacheGet<GexEodSnapshot[]>(key)) ?? [];
    const series = Array.isArray(prior)
      ? prior.filter((s) => s && typeof s.date === "string")
      : [];
    // Idempotent per-day: drop any existing entry for today's date, then append the fresh one.
    const deduped = series.filter((s) => s.date !== snapshot.date);
    deduped.push(snapshot);
    // Keep the most-recent GEX_EOD_MAX dates (series is chronological by construction).
    const trimmed = deduped.slice(-GEX_EOD_MAX);
    await sharedCacheSet(key, trimmed, GEX_EOD_TTL_SEC);
    return snapshot;
  } catch {
    // Redis unavailable / unexpected error → best-effort no-op; the matrix path is unaffected.
    return null;
  }
}

/**
 * Read the rolling `gex-eod:{ticker}` series, MOST-RECENT-FIRST. Parses defensively (skips
 * malformed entries) and returns [] on any miss/error — never throws.
 */
export async function getGexEodHistory(ticker: string): Promise<GexEodSnapshot[]> {
  try {
    const { root } = resolveOptionsRoot(ticker);
    if (!root) return [];
    const { sharedCacheGet } = await import("../shared-cache");
    const raw = (await sharedCacheGet<GexEodSnapshot[]>(`${GEX_EOD_PREFIX}:${root}`)) ?? [];
    const series = Array.isArray(raw) ? raw.filter((s) => s && typeof s.date === "string") : [];
    // Stored chronological → reverse for most-recent-first.
    return series.slice().reverse();
  } catch {
    return [];
  }
}

/**
 * Build the day-over-day `history_context` for the CURRENT matrix values by diffing against the
 * most recent PRIOR-DAY EOD snapshot (a snapshot whose date ≠ today), plus min/max over the
 * rolling series. Returns undefined when the series is empty (NO prior snapshot at all) so the
 * caller can OMIT the field — never fabricated. Deltas are null when either end is null.
 *
 * `series` is the rolling EOD series MOST-RECENT-FIRST (as returned by getGexEodHistory).
 */
function buildGexHistoryContext(
  series: GexEodSnapshot[],
  current: {
    flip: number | null;
    call_wall: number | null;
    put_wall: number | null;
    net_gex: number;
    spot: number;
  }
): GexHistoryContext | undefined {
  const usable = series.filter((s) => s && typeof s.date === "string");
  if (usable.length === 0) return undefined; // no prior close → omit, never fabricate

  const today = todayEtYmd();
  // Most-recent snapshot whose date is a PRIOR trading day (≠ today). `usable` is most-recent-first.
  const priorSnap = usable.find((s) => s.date !== today) ?? null;

  const diff = (a: number | null, b: number | null): number | null =>
    a != null && b != null && Number.isFinite(a) && Number.isFinite(b)
      ? Number((a - b).toFixed(2))
      : null;

  const prior_close = priorSnap
    ? {
        date: priorSnap.date,
        flip: priorSnap.flip,
        call_wall: priorSnap.call_wall,
        put_wall: priorSnap.put_wall,
        net_gex: priorSnap.net_gex,
        max_pain: priorSnap.max_pain,
      }
    : null;

  // Min/max over the WHOLE rolling series (includes today's snapshot if already persisted).
  const flips = usable.map((s) => s.flip).filter((f): f is number => f != null && Number.isFinite(f));
  const spots = usable.map((s) => s.spot).filter((p): p is number => Number.isFinite(p) && p > 0);
  const recent_flip_range = flips.length ? { min: Math.min(...flips), max: Math.max(...flips) } : null;
  const recent_spot_range = spots.length ? { min: Math.min(...spots), max: Math.max(...spots) } : null;

  return {
    prior_close,
    flip_delta_pts: diff(current.flip, priorSnap?.flip ?? null),
    call_wall_delta_pts: diff(current.call_wall, priorSnap?.call_wall ?? null),
    put_wall_delta_pts: diff(current.put_wall, priorSnap?.put_wall ?? null),
    net_gex_delta:
      priorSnap && Number.isFinite(current.net_gex) && Number.isFinite(priorSnap.net_gex)
        ? current.net_gex - priorSnap.net_gex
        : null,
    recent_flip_range,
    recent_spot_range,
    sessions: usable.length,
  };
}

/** Human elapsed label from ms, e.g. "1h47m" / "12m". */
function fmtElapsed(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

/** Largest-positive (call) and largest-negative (put) wall strikes from per-strike totals. */
function wallsOf(strikeTotals: Record<string, number>): {
  callWall: number | null;
  putWall: number | null;
} {
  let callWall: number | null = null;
  let putWall: number | null = null;
  let maxPos = 0;
  let maxNeg = 0;
  for (const [s, g] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    if (g > maxPos) {
      maxPos = g;
      callWall = strike;
    }
    if (g < maxNeg) {
      maxNeg = g;
      putWall = strike;
    }
  }
  return { callWall, putWall };
}

/**
 * Build a single wall-change record (earlier vs current). `grew_pct` compares the CURRENT
 * wall strike's |net gamma| now vs at that same strike earlier — null when not computable.
 */
function wallChange(
  toWall: number | null,
  fromWall: number | null,
  current: Record<string, number>,
  earlier: Record<string, number>
): GexWallChange {
  const moved_pts =
    toWall != null && fromWall != null ? Number((toWall - fromWall).toFixed(2)) : null;
  let grew_pct: number | null = null;
  if (toWall != null) {
    const nowMag = Math.abs(current[String(toWall)] ?? 0);
    const thenMag = Math.abs(earlier[String(toWall)] ?? 0);
    if (thenMag > 0) grew_pct = Number((((nowMag - thenMag) / thenMag) * 100).toFixed(1));
  }
  return { from: fromWall, to: toWall, moved_pts, grew_pct };
}

/**
 * Per-metric phrasing for the (generic) shift summary — keeps GEX wording byte-identical while
 * letting VEX/DEX/CHARM describe their own walls + net-flow read.
 */
type ShiftMetricSpec = {
  /** Noun for the level whose drift is reported, e.g. "gamma flip" / "vanna flip". */
  flipLabel: string;
  /** Noun for the largest-positive wall, e.g. "call wall" / "pos wall". */
  wallLabel: string;
  /** Net-flow read for positive / negative / ~flat net Δ over the window. */
  netRead: (netDelta: number) => string;
  /** Phrase used in the no-walls/no-flip fallback, e.g. "net dealer gamma". */
  netNoun: string;
};

const GEX_SHIFT_SPEC: ShiftMetricSpec = {
  flipLabel: "gamma flip",
  wallLabel: "call wall",
  netRead: (n) =>
    n > 0
      ? "dealers getting longer → vol compressing"
      : n < 0
      ? "dealers getting shorter → vol expansion risk"
      : "net dealer gamma roughly flat",
  netNoun: "net dealer gamma",
};

const VEX_SHIFT_SPEC: ShiftMetricSpec = {
  flipLabel: "vanna flip",
  wallLabel: "pos-vanna wall",
  netRead: (n) =>
    n > 0
      ? "net dealer vanna rising → hedging more additive into IV moves"
      : n < 0
      ? "net dealer vanna falling → hedging more cushioning into IV moves"
      : "net dealer vanna roughly flat",
  netNoun: "net dealer vanna",
};

/**
 * GENERIC shift diff over ANY metric's per-strike totals + flip — produces the GexShift shape.
 * `pick` extracts (strike_totals, flip) from a snapshot for THIS metric; a snapshot is only a
 * usable baseline when `pick` returns non-null totals (so VEX/legacy snapshots without vex totals
 * are skipped → 'collecting', never fabricated). `spec` controls only the summary wording.
 *
 * `computeGexShift` delegates here with the GEX spec, so GEX output is unchanged.
 */
function computeMetricShift(
  ring: GexHistorySnapshot[],
  current: { ts: number; flip: number | null; strike_totals: Record<string, number> },
  pick: (s: GexHistorySnapshot) => { strike_totals: Record<string, number>; flip: number | null } | null,
  spec: ShiftMetricSpec
): GexShift {
  const usable = ring
    .filter((s) => s && typeof s.ts === "number" && pick(s) != null)
    .sort((a, b) => a.ts - b.ts);
  // Earliest snapshot strictly before "now" carrying THIS metric's totals — need ≥2 to diff.
  const baselineSnap = usable.find((s) => s.ts < current.ts) ?? null;
  if (!baselineSnap || usable.length < 2) {
    return { available: false, status: "collecting" };
  }
  const baseline = pick(baselineSnap)!;

  const earlier = baseline.strike_totals;
  const now = current.strike_totals;

  // Per-strike Δ = current − earlier, UNION of keys (missing side = 0 → built-from-0 / melted-to-0).
  const delta_by_strike: Record<string, number> = {};
  const keys = new Set<string>(Object.keys(now).concat(Object.keys(earlier)));
  for (const k of Array.from(keys)) {
    const d = (Number(now[k]) || 0) - (Number(earlier[k]) || 0);
    if (Number.isFinite(d) && d !== 0) delta_by_strike[k] = d;
  }

  // Flip migration.
  const flip_migration: GexFlipMigration = {
    from: baseline.flip,
    to: current.flip,
    delta_pts:
      current.flip != null && baseline.flip != null
        ? Number((current.flip - baseline.flip).toFixed(2))
        : null,
  };

  // Wall changes (current walls recomputed from totals; earlier from the snapshot's totals).
  const curWalls = wallsOf(now);
  const earWalls = wallsOf(earlier);
  const wall_changes = {
    call_wall: wallChange(curWalls.callWall, earWalls.callWall, now, earlier),
    put_wall: wallChange(curWalls.putWall, earWalls.putWall, now, earlier),
  };

  const since_ms = current.ts - baselineSnap.ts;
  const elapsed = fmtElapsed(since_ms);

  // ── Summary: real numbers + a directional net-flow read. ──
  let netDelta = 0;
  for (const d of Object.values(delta_by_strike)) netDelta += d;
  const fmtK = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  const parts: string[] = [];
  const cw = wall_changes.call_wall;
  if (cw.to != null && cw.grew_pct != null) {
    const verb = cw.grew_pct >= 0 ? "built" : "melted";
    parts.push(`the ${fmtK(cw.to)} ${spec.wallLabel} ${verb} ${cw.grew_pct >= 0 ? "+" : ""}${cw.grew_pct}%`);
  } else if (cw.to != null && cw.moved_pts != null && cw.moved_pts !== 0) {
    parts.push(`the ${spec.wallLabel} slid ${cw.moved_pts > 0 ? "up" : "down"} to ${fmtK(cw.to)}`);
  }
  if (flip_migration.delta_pts != null && flip_migration.delta_pts !== 0) {
    const dir = flip_migration.delta_pts > 0 ? "up" : "down";
    parts.push(`${spec.flipLabel} migrated ${dir} ${Math.abs(flip_migration.delta_pts)} pts`);
  } else if (flip_migration.to != null && flip_migration.from == null) {
    parts.push(`a ${spec.flipLabel} formed at ${fmtK(flip_migration.to)}`);
  }

  const lengthRead = spec.netRead(netDelta);
  const body =
    parts.length > 0
      ? `${parts.join(", ")} (${lengthRead}).`
      : `${spec.netNoun} moved ${fmtPremium(netDelta)} (${lengthRead}).`;
  const summary = `Over the last ${elapsed}: ${body}`;

  return {
    available: true,
    delta_by_strike,
    flip_migration,
    wall_changes,
    summary,
    since_ms,
    baseline_ts: baselineSnap.ts,
  };
}

/**
 * Diff the current GEX state against the EARLIEST snapshot still in the window to produce the
 * shift payload. `ring` is the full positioning-history ring (ascending by ts) INCLUDING the
 * just-appended current snapshot. With <2 usable snapshots → { available:false, status:'collecting' }
 * (never fabricated). Thin delegate over computeMetricShift with the GEX spec.
 */
function computeGexShift(
  ring: GexHistorySnapshot[],
  current: { ts: number; spot: number; flip: number | null; strike_totals: Record<string, number> }
): GexShift {
  return computeMetricShift(
    ring,
    current,
    (s) => (s.strike_totals ? { strike_totals: s.strike_totals, flip: s.flip } : null),
    GEX_SHIFT_SPEC
  );
}

/**
 * VEX shift — same diff over each snapshot's `vex_strike_totals` / `vex_flip`. A snapshot is only
 * a usable baseline when it carries vex totals (legacy snapshots without them are skipped), so the
 * VEX shift stays 'collecting' until ≥2 snapshots written WITH vex totals exist. Never fabricated.
 */
function computeVexShift(
  ring: GexHistorySnapshot[],
  current: { ts: number; flip: number | null; strike_totals: Record<string, number> }
): GexShift {
  return computeMetricShift(
    ring,
    current,
    (s) =>
      s.vex_strike_totals
        ? { strike_totals: s.vex_strike_totals, flip: s.vex_flip ?? null }
        : null,
    VEX_SHIFT_SPEC
  );
}

/**
 * Server-computed alert events — a PURE diff of the PRIOR history snapshot (the most recent one
 * BEFORE this sample) vs the CURRENT freshly-computed values. No new upstream calls/passes: every
 * input is already computed (current) or already stored (prior).
 *
 * Emits ONLY when ≥2 usable snapshots exist (so `ring` contains a real prior to diff) — NEVER
 * fabricated on the first sample. Returns:
 *   • undefined → cold history (<2 snapshots): client can't tell direction yet → omit the field.
 *   • []        → a prior exists but nothing crossed this sample.
 *
 * `ring` is the full positioning-history ring INCLUDING the just-appended current snapshot; the
 * prior is the latest snapshot strictly before `current.ts`.
 *
 * Exported (task #136) so polygon-options-gex.test.ts can exercise this pure diff directly with
 * ring/current fixtures — same "export a pure internal helper purely for direct unit testing"
 * precedent this file already sets with resolveHeatmapPageGuard/gexContractDedupeKey above. This
 * is the ONE place regime-transition events are derived; gex-regime-events.ts's
 * persistGexRegimeEvents and /api/cron/gex-alerts both consume this function's output rather than
 * re-deriving it, per the task's "one derivation, not two" requirement.
 */
export function computeGexEvents(
  ring: GexHistorySnapshot[],
  current: {
    ts: number;
    spot: number;
    flip: number | null;
    call_wall: number | null;
    put_wall: number | null;
    total: number;
  }
): GexEvent[] | undefined {
  const usable = ring
    .filter((s) => s && typeof s.ts === "number" && s.strike_totals)
    .sort((a, b) => a.ts - b.ts);
  // Prior = the most recent snapshot strictly before this sample. Need ≥2 to have a real prior.
  const prior = [...usable].reverse().find((s) => s.ts < current.ts) ?? null;
  if (!prior || usable.length < 2) return undefined; // cold → omit, never fabricate

  const events: GexEvent[] = [];
  const at = new Date(current.ts).toISOString();
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

  // Recompute the prior's walls + net total from its stored per-strike totals (no extra calls).
  const priorWalls = wallsOf(prior.strike_totals);
  let priorTotal = 0;
  for (const v of Object.values(prior.strike_totals)) {
    const n = Number(v);
    if (Number.isFinite(n)) priorTotal += n;
  }
  const priorSpot = prior.spot;
  const curSpot = current.spot;

  // ── flip_crossed — spot moved across the gamma flip since the prior snapshot. ──
  // Use the prior flip as the shared reference level both ends are measured against, so a side
  // change is an unambiguous crossing of one stable level (not an artifact of the flip drifting).
  if (prior.flip != null && priorSpot > 0 && curSpot > 0) {
    const wasAbove = priorSpot >= prior.flip;
    const isAbove = curSpot >= prior.flip;
    if (wasAbove !== isAbove) {
      const intoLong = isAbove; // above flip = long-gamma regime
      events.push({
        type: "flip_crossed",
        severity: intoLong ? "info" : "warn",
        message: `Spot crossed the gamma flip (${fmt(prior.flip)}) ${intoLong ? "into LONG gamma — range-bound, fade extremes" : "into SHORT gamma — momentum / vol expansion, moves accelerate"}.`,
        level: prior.flip,
        direction: intoLong ? "into long gamma" : "into short gamma",
        from_value: priorSpot,
        to_value: curSpot,
        at,
      });
    }
  }

  // ── wall_broken — spot crossed ABOVE the call wall or BELOW the put wall. ──
  // Reference the PRIOR snapshot's walls (the level that was in place when the move started).
  if (priorWalls.callWall != null && priorSpot > 0 && curSpot > 0) {
    if (priorSpot <= priorWalls.callWall && curSpot > priorWalls.callWall) {
      events.push({
        type: "wall_broken",
        severity: "warn",
        message: `Spot broke ABOVE the call wall (${fmt(priorWalls.callWall)}) — gamma resistance gave way; room higher opens up.`,
        level: priorWalls.callWall,
        direction: "above call wall",
        from_value: priorSpot,
        to_value: curSpot,
        at,
      });
    }
  }
  if (priorWalls.putWall != null && priorSpot > 0 && curSpot > 0) {
    if (priorSpot >= priorWalls.putWall && curSpot < priorWalls.putWall) {
      events.push({
        type: "wall_broken",
        severity: "warn",
        message: `Spot broke BELOW the put wall (${fmt(priorWalls.putWall)}) — gamma support gave way; downside opens up.`,
        level: priorWalls.putWall,
        direction: "below put wall",
        from_value: priorSpot,
        to_value: curSpot,
        at,
      });
    }
  }

  // ── regime_flipped — gex posture (long↔short) changed since the prior snapshot. ──
  // Posture is spot-vs-flip measured at EACH end with that end's own flip (the live regime read).
  const priorPosture =
    prior.flip != null && priorSpot > 0 ? (priorSpot >= prior.flip ? "long" : "short") : null;
  const curPosture =
    current.flip != null && curSpot > 0 ? (curSpot >= current.flip ? "long" : "short") : null;
  if (priorPosture != null && curPosture != null && priorPosture !== curPosture) {
    const intoLong = curPosture === "long";
    events.push({
      type: "regime_flipped",
      severity: intoLong ? "info" : "warn",
      message: `Gamma regime flipped ${priorPosture} → ${curPosture}${current.flip != null ? ` (flip ${fmt(current.flip)})` : ""} — ${intoLong ? "dealers now long gamma, expect mean-reversion" : "dealers now short gamma, expect trend / vol expansion"}.`,
      direction: `${priorPosture} → ${curPosture}`,
      from_value: prior.flip,
      to_value: current.flip,
      at,
    });
  }

  // ── net_gex_sign_flipped — total net GEX changed sign (market-wide regime shift). ──
  if (
    Number.isFinite(priorTotal) &&
    Number.isFinite(current.total) &&
    priorTotal !== 0 &&
    current.total !== 0 &&
    Math.sign(priorTotal) !== Math.sign(current.total)
  ) {
    const toPos = current.total > 0;
    events.push({
      type: "net_gex_sign_flipped",
      severity: toPos ? "info" : "warn",
      message: `Net dealer GEX flipped ${toPos ? "NEGATIVE → POSITIVE — book now net long gamma (stabilizing)" : "POSITIVE → NEGATIVE — book now net short gamma (destabilizing)"}.`,
      direction: toPos ? "negative → positive" : "positive → negative",
      from_value: priorTotal,
      to_value: current.total,
      at,
    });
  }

  return events; // [] when a prior exists but nothing crossed
}

/**
 * Dealer GEX heatmap for `underlying` (default SPY): a (strike × expiry) matrix of
 * NET dealer dollar-gamma, computed ONCE and cached server-side (in-memory + Redis)
 * so 500 concurrent users read one matrix and never trigger a per-user chain fetch.
 *
 * Sign convention MIRRORS aggregateGexRows exactly: per contract dollar gamma is
 * `gamma × open_interest × 100 × spot`; calls add it, puts subtract it. Summed per
 * (strike, expiry) cell → net dealer gamma. On any Polygon failure / empty chain this
 * returns null (never fabricates gamma).
 *
 * NOTE: SPY (equity ETF options) is used by default — listed directly under "SPY".
 * SPX index options live under I:SPX; this fn supports it but the desk GEX walls use
 * SPX, so SPY here gives a liquid, broadly-comparable dealer gamma surface.
 */
export async function fetchGexHeatmap(
  underlying = "SPX",
  { forceRefresh = false }: { forceRefresh?: boolean } = {}
): Promise<GexHeatmap | null> {
  if (!polygonConfigured()) return null;
  // Multi-ticker: index tickers → I:* index roots; equities/ETFs used directly.
  const { root, optionsRoot } = resolveOptionsRoot(underlying);
  if (!root) return null;
  // ONE cache key per ticker → GEX + VEX share a single cached chain fetch.
  const cacheKey = `${GEX_HEATMAP_CACHE_PREFIX}:${root}`;
  const now = Date.now();
  const baseTtlMs = gexHeatmapCacheMsFor(root);

  // ── Fast-move freshness bypass (WARM PRESETS ONLY) ───────────────────────────
  // Dealer GEX is otherwise served on a flat ~20s TTL even while price runs. For the ~11 warm
  // presets we SHORTEN the acceptable cache age when that ticker has moved >0.5% across its
  // in-window ring (recorded on each fresh compute below) so the matrix re-syncs to the new
  // level sooner. Off-preset tickers keep the full 20s TTL — they have no per-ticker ring and
  // aren't worth the extra recompute pressure. (DOCUMENTED tradeoff: a fast-moving off-preset
  // name can serve up to ~20s-stale GEX.)
  const fastMove = isHeatmapPreset(root) && isHeatmapFastMove(root);
  const ttlMs = fastMove ? Math.min(baseTtlMs, GEX_HEATMAP_FAST_MOVE_TTL_MS) : baseTtlMs;

  if (!forceRefresh) {
    const mem = cachedHeatmaps.get(cacheKey);
    if (mem && now - mem.at < ttlMs) return mem.data;

    let redisHit: { at: number; data: GexHeatmap } | null = null;
    try {
      const { sharedCacheGet } = await import("../shared-cache");
      redisHit = await sharedCacheGet<{ at: number; data: GexHeatmap }>(cacheKey);
      if (redisHit && now - redisHit.at < ttlMs) {
        setCachedHeatmap(cacheKey, redisHit);
        return redisHit.data;
      }
    } catch {
      /* redis optional */
    }

    // Stale-while-revalidate: cron warms once/min but fresh TTL is ~20s (5s during fast-move).
    // Without this, every TTL-boundary miss blocks callers on a full chain rebuild (cold desk
    // 20–120s → Cloudflare 502). Fast-move shortens accept-age, not whether we may block.
    const stale = tryStaleWhileRevalidateHeatmap(
      cacheKey,
      root,
      optionsRoot,
      now,
      ttlMs,
      baseTtlMs,
      mem,
      redisHit
    );
    if (stale) return stale;
  }

  // ── Single-flight (#9): coalesce concurrent cache-miss builds for this ticker ──
  // A cold preset under organic burst (or the warm cron racing a user GET) would otherwise fire
  // N concurrent chain fetches for the SAME ticker. Share ONE in-flight build. forceRefresh shares
  // with other forceRefresh callers but not with normal builds (it intentionally bypasses cache).
  const inflightKey = forceRefresh ? `${cacheKey}:force` : cacheKey;
  const existing = heatmapInflight.get(inflightKey);
  if (existing) return existing;

  const build = buildGexHeatmapUncached(root, optionsRoot, cacheKey, now, baseTtlMs).finally(
    () => {
      heatmapInflight.delete(inflightKey);
    }
  );
  heatmapInflight.set(inflightKey, build);
  return build;
}

/**
 * The uncached matrix BUILD: resolve spot, fetch the banded chain, compute the full GEX/VEX/DEX/
 * CHARM matrix + levels + shift + history context, then cache it (in-memory + Redis). Always
 * caches via the FULL base TTL (`baseTtlMs`) — the fast-move bypass only shortens how long a
 * SERVED entry is accepted, never how long it's stored. Wrapped by fetchGexHeatmap's single-flight
 * so only one of these runs per ticker at a time.
 */
async function buildGexHeatmapUncached(
  root: string,
  optionsRoot: string,
  cacheKey: string,
  now: number,
  ttlMs: number
): Promise<GexHeatmap | null> {
  // Resolve spot + day change% from the same root. INDEX roots (I:SPX/NDX/RUT/VIX) must use
  // the indices snapshot — the stocks snapshot returns no row for I:* and yields spot 0.
  const snap = await resolveSpotSnapshot(optionsRoot);
  const spot = snap?.price ?? 0;
  // Graceful empty: no spot (thin / unknown / dead name) → valid empty payload, NOT a throw.
  // CRITICAL: cache this empty result with the SAME ctx the sibling empty paths pass (below),
  // otherwise a dead/unknown ticker re-runs resolveSpotSnapshot — a fresh Polygon spot fetch —
  // on EVERY poll (a per-poll upstream spot leak). A short negative-cache TTL is enough to absorb
  // the poll storm without pinning a transient outage too long: a name that just had no spot this
  // instant shouldn't be frozen empty for the full 20s matrix TTL once it recovers.
  if (!(spot > 0)) {
    return emptyHeatmap(root, {
      spot: 0,
      changePct: 0,
      now,
      cacheKey,
      ttlMs: Math.min(ttlMs, EMPTY_SPOT_NEGATIVE_TTL_MS),
    });
  }
  const changePct = snap?.change_pct ?? 0;

  // Feed the per-ticker fast-move ring on every fresh PRESET compute so isHeatmapFastMove can
  // actually fire on the next cache-read; without this the ring stays empty and the bypass above
  // is dead code (the SAME bug the SPX desk bundle's recordSpxPriceObservation call guards against).
  // Preset-only — keeps the ring map bounded to ~11 keys.
  if (isHeatmapPreset(root)) recordHeatmapPriceObservation(root, spot);

  // Band sizing stays RELATIVE (% of spot) so it works for $5 and $900 names.
  const contracts = await fetchHeatmapBand(optionsRoot, spot, heatmapBandPct(root));
  if (!contracts.length) {
    console.warn(
      `[gex-heatmap] 0 contracts for ${optionsRoot} @ ${spot} via ${hostOf(BASE)} — heatmap empty (no/thin options chain).`
    );
    // Graceful empty (with spot so the header still renders the quote).
    return emptyHeatmap(root, { spot, changePct, now, cacheKey, ttlMs });
  }

  const today = todayEtYmd();
  // Net dealer GAMMA + VANNA + DELTA + CHARM per (strike, expiry) in ONE chain pass. ALL four use
  // the SAME call(+)/put(−) dealer-sign convention as aggregateGexRows — NO extra fetch/pass.
  const gammaCellMap = new Map<number, Map<string, number>>();
  const vannaCellMap = new Map<number, Map<string, number>>();
  const deltaCellMap = new Map<number, Map<string, number>>();
  const charmCellMap = new Map<number, Map<string, number>>();
  const expirySet = new Set<string>();
  const seenContracts = new Set<string>();
  let totalGamma = 0;
  let totalVanna = 0;
  let totalDelta = 0;
  let totalCharm = 0;

  /**
   * Accumulate ONE contract into all four metric cell-maps using the SAME math/sign convention
   * the matrix has always used (UNCHANGED — including the #92 spot²·0.01 GEX scale). Factored into
   * a closure so the IDENTICAL accumulation runs over BOTH the main banded snapshot AND the bounded
   * far-dated targeted fetches below, without duplicating the per-greek math (a copy would risk the
   * two paths drifting). Returns nothing; mutates the cell-maps + running totals captured above.
   */
  function accumulateContract(c: ChainContract): void {
    const dedupeKey = gexContractDedupeKey(c, today);
    if (!dedupeKey) return;
    if (seenContracts.has(dedupeKey)) return;
    seenContracts.add(dedupeKey);

    const strike = Number(c.details?.strike_price);
    const expiry = String(c.details?.expiration_date ?? "").slice(0, 10);
    const gamma = Number(c.greeks?.gamma ?? 0);
    const delta = Number(c.greeks?.delta ?? 0);
    const oi = Number(c.open_interest ?? 0);
    const iv = Number(c.implied_volatility ?? 0);
    const type = String(c.details?.contract_type ?? "").toLowerCase();
    if (!Number.isFinite(strike) || strike <= 0 || !expiry || expiry < today) return;
    if (!oi) return; // no open interest → skip, never fabricate
    const sign = type === "call" ? 1 : type === "put" ? -1 : 0;
    if (sign === 0) return;

    // Deliverable shares per contract — 100 for standard listed options, but a corporate
    // action (split/merger/special dividend) can mint ADJUSTED contracts with a non-100
    // multiplier. Use the REAL value from the snapshot `details` so GEX/VEX/DEX/CHARM notional
    // is correct for those; default to 100 when the field is absent/invalid (the overwhelming
    // common case → byte-identical to the previous hardcoded ×100).
    const sharesPerContract =
      Number.isFinite(c.details?.shares_per_contract) && (c.details?.shares_per_contract ?? 0) > 0
        ? Number(c.details?.shares_per_contract)
        : 100;

    // ── GEX: gamma × oi × 100 × spot² × 0.01 (SpotGamma per-1%-move $-gamma), call +/put − ──
    // The extra `× spot × 0.01` converts raw dollar-gamma (per $1 underlying move) into the
    // industry-standard dealer $-gamma per 1% move (SpotGamma/Barchart convention), so our GEX
    // magnitudes match competitor scale. NOTE: VEX (~below) and CHARM use the distinct notional
    // `× 100 × spot` convention (per-1-unit-σ / per-year) — they are NOT on this per-1%-move scale.
    if (gamma) {
      const signedGamma = sign * gamma * oi * sharesPerContract * spot * spot * 0.01;
      if (signedGamma !== 0) {
        expirySet.add(expiry);
        const byExpiry = gammaCellMap.get(strike) ?? new Map<string, number>();
        byExpiry.set(expiry, (byExpiry.get(expiry) ?? 0) + signedGamma);
        gammaCellMap.set(strike, byExpiry);
        totalGamma += signedGamma;
      }
    }

    // ── DEX: net DEALER dollar-delta = −(net option delta of OI) × 100 × spot ─────────────────
    // UNLIKE gamma (always ≥0, so the call(+)/put(−) dealer sign is what creates the bipolar
    // signal), `delta` is ALREADY signed by option type (calls 0..1, puts −1..0). So the net
    // option delta of the open interest is simply Σ(delta · OI) — applying the gamma-style
    // `sign` here too would DOUBLE-SIGN it (puts: (−1)·negative = positive), forcing net DEX
    // permanently positive (posture stuck "long", no zero-level, one-color cells).
    //
    // Convention (SpotGamma/FlashAlpha dealer-DEX): Σ(delta · OI) is the CUSTOMER/aggregate net
    // option delta; dealers are the COUNTERPARTY to that open interest, so the dealer's delta
    // book is the NEGATION: dealerDelta = −Σ(delta · OI). We negate explicitly here so the
    // posture read is oriented correctly — positive dealer delta ⇒ dealers net LONG delta ⇒ they
    // SELL rallies / BUY dips ⇒ mean-reverting ⇒ STABILIZING (and negative ⇒ DESTABILIZING).
    if (Number.isFinite(delta) && delta !== 0) {
      const signedDelta = -(delta * oi * sharesPerContract * spot);
      if (signedDelta !== 0 && Number.isFinite(signedDelta)) {
        expirySet.add(expiry);
        const byExpiry = deltaCellMap.get(strike) ?? new Map<string, number>();
        byExpiry.set(expiry, (byExpiry.get(expiry) ?? 0) + signedDelta);
        deltaCellMap.set(strike, byExpiry);
        totalDelta += signedDelta;
      }
    }

    // ── VEX + CHARM: closed-form greeks needing T + σ. Compute the year-fraction ONCE. ──
    const t = yearsToExpiry(expiry, today);

    // VEX: closed-form vanna × oi × 100 × spot, call +/put −.
    // Skip contracts with missing IV, T<=0, or σ<=0 (vannaPerShare returns 0 → skipped).
    // dollar_vanna is per 1.00 change in sigma (= 100 vol-points; IV is decimal here).
    // CONVENTION: VEX keeps the notional `× 100 × spot` scaling (its own per-1-unit-σ standard) —
    // DISTINCT from GEX's per-1%-move scale (× spot² × 0.01) above. Do not align the two.
    const vps = vannaPerShare(spot, strike, t, iv);
    if (vps !== 0) {
      const signedVanna = sign * vps * oi * sharesPerContract * spot;
      if (signedVanna !== 0 && Number.isFinite(signedVanna)) {
        expirySet.add(expiry);
        const byExpiry = vannaCellMap.get(strike) ?? new Map<string, number>();
        byExpiry.set(expiry, (byExpiry.get(expiry) ?? 0) + signedVanna);
        vannaCellMap.set(strike, byExpiry);
        totalVanna += signedVanna;
      }
    }

    // CHARM: closed-form charm × oi × 100 × spot, call +/put −. SAME guard as vanna (skip when
    // T<=0 or σ<=0 → charmPerShare returns 0). dollar-charm scaling MIRRORS dollar-vanna (the
    // notional `× 100 × spot` convention, per-year — DISTINCT from GEX's per-1%-move × spot² × 0.01
    // scale above); the per-unit-time is YEARS of time-to-expiry (ACT/365), so
    // it reads as net dealer delta decay per year. Charm is type-independent (put charm = call
    // charm at r=q=0, like gamma); the dealer call(+)/put(−) sign is applied here at accumulation.
    const cps = charmPerShare(spot, strike, t, iv);
    if (cps !== 0) {
      const signedCharm = sign * cps * oi * sharesPerContract * spot;
      if (signedCharm !== 0 && Number.isFinite(signedCharm)) {
        expirySet.add(expiry);
        const byExpiry = charmCellMap.get(strike) ?? new Map<string, number>();
        byExpiry.set(expiry, (byExpiry.get(expiry) ?? 0) + signedCharm);
        charmCellMap.set(strike, byExpiry);
        totalCharm += signedCharm;
      }
    }
  }

  // Main banded snapshot — every expiry inside the heatmap strike band (near-term dailies /
  // weeklies dominate this single paginated pass).
  for (const c of contracts) accumulateContract(c);

  // ── FAR-DATED expiries (monthly / quarterly OpEx) ─────────────────────────────
  // The near-term pass above is dominated by dailies/weeklies; the dominant dealer-gamma walls
  // park at the standard monthly / quarterly OpEx OI (e.g. a huge wall on the Sept monthly), which
  // a near-only view never shows. We add a BOUNDED set of standard 3rd-Friday monthlies (quarterly
  // OpEx is a subset) out ~6 months as extra columns. The paginated main-band fetch may have
  // *partially* touched one of these expiries (a few strikes inside the band) — that must NOT
  // skip the dedicated per-expiry fetch or far columns stay sparse (QQQ: ~12/67 strikes). Contract-
  // level dedupe in accumulateContract prevents double-counting overlap between the two passes.
  // Bounded to FAR_DATED_MAX_TARGETS; each is a cheap ±2% single-expiry band. Best-effort.
  const nearestSorted = Array.from(expirySet).sort();
  const nearTermAxis = nearestSorted.slice(0, NEAR_TERM_EXPIRY_COUNT);
  const lastNearTerm = nearTermAxis[nearTermAxis.length - 1] ?? today;
  const farTargets = farDatedTargetExpiries(today, lastNearTerm);
  const farToFetch = farDatedExpiriesToFetch(farTargets);
  if (farToFetch.length > 0) {
    // Bounded fan-out (≤ FAR_DATED_MAX_TARGETS per ticker) through the SHARED rate-limited funnel
    // (every fetchChainBand call goes via polygonTrackedFetch), so even with the warm cron firing
    // all presets at once these can't trip the 429 breaker on the live desk / GEX path. Each is a
    // tight ±2% single-expiry band → ~1 page. Settled independently so one empty/failed far date
    // can't abort the rest — best-effort, the near-term matrix is never blocked.
    const farResults = await Promise.allSettled(
      farToFetch.map((expiry) => fetchChainBand(optionsRoot, spot, expiry, 0.02))
    );
    for (const r of farResults) {
      if (r.status !== "fulfilled") continue;
      for (const c of r.value) accumulateContract(c);
    }
  }

  if (expirySet.size === 0) {
    return emptyHeatmap(root, { spot, changePct, now, cacheKey, ttlMs });
  }

  // SHARED expiry axis (ascending) = the nearest NEAR_TERM_EXPIRY_COUNT expiries (UNCHANGED
  // near-term behavior) UNION the far-dated monthly/quarterly targets that actually printed.
  // De-duped + sorted ascending so the matrix columns read left→right in calendar order, with the
  // far-dated columns appended after the near-term block. Bounded by construction (near cap + the
  // far-target cap), so the column count can never balloon.
  const sortedAll = Array.from(expirySet).sort();
  const { nearKeep, expiries } = resolveExpiryAxis(nearTermAxis, farTargets, expirySet);
  const expirySetKeep = new Set(expiries);
  // The authoritative STRUCTURAL levels (walls / flip / net / posture) and ALL downstream
  // consumers (gex-positioning → desk / Largo / Night's Watch, the shift ring, EOD history) are
  // computed on the NEAR-TERM expiries ONLY. The far-dated monthly/quarterly OI is enormous and
  // would otherwise swamp the actionable near-term walls (e.g. a −$66.7B Sept wall would always
  // win call/put wall + dominate net GEX), REGRESSING every level consumer. So far-dated lives in
  // the MATRIX CELLS for the new columns, while strike_totals stay near-term — exactly preserving
  // today's levels. The client re-sums `cells` per chosen expiry (ExpiryScopeBar + recomputeLevels)
  // to surface the far-dated walls on demand without changing the server-authoritative defaults.
  const nearTermKeep = new Set(nearKeep);
  // SHARED strike axis = union of strikes touched by ANY metric, descending.
  const allStrikes = new Set<number>([
    ...Array.from(gammaCellMap.keys()),
    ...Array.from(vannaCellMap.keys()),
    ...Array.from(deltaCellMap.keys()),
    ...Array.from(charmCellMap.keys()),
  ]);
  const strikes = Array.from(allStrikes).sort((a, b) => b - a);

  // Prune a per-metric cell map → cells (FULL near+far axis) + strike_totals/total (NEAR-TERM only).
  // `cells` carry every kept expiry so the matrix renders the far-dated columns; `strike_totals`
  // sum the NEAR-TERM subset so the structural levels + every downstream consumer are UNCHANGED.
  function buildMetric(cellMap: Map<number, Map<string, number>>): {
    cells: Record<string, Record<string, number>>;
    strikeTotals: Record<string, number>;
    total: number;
  } {
    const cells: Record<string, Record<string, number>> = {};
    const strikeTotals: Record<string, number> = {};
    let total = 0;
    for (const strike of strikes) {
      const byExpiry = cellMap.get(strike);
      if (!byExpiry) continue;
      const row: Record<string, number> = {};
      let nearStrikeSum = 0;
      for (const [expiry, val] of Array.from(byExpiry.entries())) {
        if (!expirySetKeep.has(expiry)) continue;
        row[expiry] = val; // matrix cell: full near+far axis
        if (nearTermKeep.has(expiry)) nearStrikeSum += val; // levels: near-term only
      }
      if (Object.keys(row).length === 0) continue;
      cells[String(strike)] = row;
      // A far-only strike (no near-term cell) contributes 0 to strike_totals so it never appears
      // as a near-term wall — it's still present in `cells` for the far-dated matrix columns.
      if (nearStrikeSum !== 0) {
        strikeTotals[String(strike)] = nearStrikeSum;
        total += nearStrikeSum;
      }
    }
    return { cells, strikeTotals, total };
  }

  const gexBuilt = buildMetric(gammaCellMap);
  const vexBuilt = buildMetric(vannaCellMap);
  const dexBuilt = buildMetric(deltaCellMap);
  const charmBuilt = buildMetric(charmCellMap);

  // Final shared strike axis = strikes present in ANY metric's pruned cells.
  const finalStrikes = strikes.filter(
    (s) =>
      gexBuilt.cells[String(s)] != null ||
      vexBuilt.cells[String(s)] != null ||
      dexBuilt.cells[String(s)] != null ||
      charmBuilt.cells[String(s)] != null
  );

  // Max pain must be scoped to ONE expiry — unlike GEX/VEX/DEX/CHARM (which legitimately SUM
  // dealer exposure across several coexisting near-term expiries), max pain asks "at what price
  // does THIS expiry's holders collectively lose the most," a question tied to one settlement
  // date. `contracts` here spans every expiry inside the strike band (fetchHeatmapBand has no
  // expiration_date filter), so passing it straight to computeMaxPainFromChain blended OI across
  // unrelated settlement dates into a number that looked like max pain but wasn't scoped to
  // anything a trader could act on (docs/audit/FINDINGS.md). Scope to the front/nearest expiry,
  // matching how fetchPolygonOdteDeskBundle and fetchPolygonPositioningBundle already correctly
  // compute max pain from a single-expiry chain.
  const frontExpiry = sortedAll[0];
  const frontExpiryContracts = contracts.filter(
    (c) => String(c.details?.expiration_date ?? "").slice(0, 10) === frontExpiry
  );
  const maxPain = computeMaxPainFromChain(frontExpiryContracts);

  // GEX levels + regime.
  const gexFlip = computeZeroGammaFlip(gexBuilt.strikeTotals, spot);
  const { callWall, putWall, regime: gexRegime } = computeGexRegime(
    gexBuilt.strikeTotals,
    spot,
    gexFlip,
    maxPain
  );

  // VEX levels + regime (zero-vanna flip reuses the generic cumulative-cross helper).
  // NOTE: this intentionally reuses the gamma-style neg→pos crossing on cumulative vanna; it
  // marks where net dealer vanna flips sign, NOT a hard vanna support/resistance level.
  const vexFlip = computeZeroGammaFlip(vexBuilt.strikeTotals, spot);
  const { posWall, negWall, regime: vexRegime } = computeVexRegime(
    vexBuilt.strikeTotals,
    vexBuilt.total ?? totalVanna
  );

  // DEX zero_level = per-strike net-delta sign-crossing nearest spot (reuse the gamma cross
  // helper on the delta totals) + posture/read from the net dollar-delta sign.
  const dexZeroLevel = computeZeroGammaFlip(dexBuilt.strikeTotals, spot);
  const dexRegime = computeDexRegime(dexBuilt.total ?? totalDelta);
  const dexBlock: DexMetricBlock = {
    cells: dexBuilt.cells,
    strike_totals: dexBuilt.strikeTotals,
    total: dexBuilt.total ?? totalDelta,
    zero_level: dexZeroLevel,
    regime: dexRegime,
  };

  // CHARM zero_level = per-strike charm sign-crossing nearest spot + posture/read (pinning).
  const charmZeroLevel = computeZeroGammaFlip(charmBuilt.strikeTotals, spot);
  const charmRegime = computeCharmRegime(charmBuilt.total ?? totalCharm);
  const charmBlock: CharmMetricBlock = {
    cells: charmBuilt.cells,
    strike_totals: charmBuilt.strikeTotals,
    total: charmBuilt.total ?? totalCharm,
    zero_level: charmZeroLevel,
    regime: charmRegime,
  };

  // ── SHIFT (intraday migration) — fresh compute ONLY ──────────────────────────
  // Append a throttled snapshot (now carrying gex + vex [+ dex/charm] totals) to the
  // positioning-history ring, then diff current vs the earliest snapshot in the window for BOTH
  // gex and vex. Entirely best-effort: any failure → 'collecting' so the matrix is never blocked.
  // Computed once here and cached with the matrix (all users read the cached shift — never per user).
  let shift: GexShift = { available: false, status: "collecting" };
  let vexShift: GexShift = { available: false, status: "collecting" };
  let events: GexEvent[] | undefined;
  try {
    const snapshot: GexHistorySnapshot = {
      ts: now,
      spot,
      flip: gexFlip,
      strike_totals: gexBuilt.strikeTotals,
      vex_strike_totals: vexBuilt.strikeTotals,
      vex_flip: vexFlip,
      dex_strike_totals: dexBuilt.strikeTotals,
      charm_strike_totals: charmBuilt.strikeTotals,
    };
    // Events diff the PRIOR snapshot (before append) vs current — compute on the ring INCLUDING
    // the fresh snapshot (the prior is then the latest entry strictly before `now`).
    const ring = await appendGexHistory(cacheKey, snapshot);
    shift = computeGexShift(ring, {
      ts: now,
      spot,
      flip: gexFlip,
      strike_totals: gexBuilt.strikeTotals,
    });
    vexShift = computeVexShift(ring, {
      ts: now,
      flip: vexFlip,
      strike_totals: vexBuilt.strikeTotals,
    });
    events = computeGexEvents(ring, {
      ts: now,
      spot,
      flip: gexFlip,
      call_wall: callWall,
      put_wall: putWall,
      total: gexBuilt.total ?? totalGamma,
    });
  } catch {
    shift = { available: false, status: "collecting" };
    vexShift = { available: false, status: "collecting" };
    events = undefined;
  }

  // ── DURABLE REGIME-TRANSITION LOG (task #136) ────────────────────────────────
  // Fire-and-forget persistence of the SAME `events` array just computed above —
  // no re-derivation, no new detection logic, no new threshold (see
  // gex-regime-events.ts's module doc for the full "one derivation, not two"
  // rationale). Deliberately OUTSIDE the try/catch above and never awaited: a
  // slow/unavailable Postgres must not add latency to this hot matrix-build path,
  // and a persistence failure must never affect the events/shift this function
  // returns to its caller (identical contract to appendGexHistory/
  // appendGexEodSnapshot's own best-effort, never-throws guarantees).
  if (events && events.length > 0) {
    void persistGexRegimeEvents(root, events).catch((err) => {
      console.error(
        "[gex-regime-events] persist failed:",
        err instanceof Error ? err.message : err
      );
    });
  }

  // ── DAY-OVER-DAY HISTORY CONTEXT ("vs prior close") ──────────────────────────
  // Cheap Redis read of the rolling EOD series (written once/day by the gex-eod-snapshot cron),
  // diffed against the most recent PRIOR-day close. Best-effort + additive: any failure or an
  // empty series leaves history_context undefined → the field is OMITTED (never fabricated).
  let historyContext: GexHistoryContext | undefined;
  try {
    const eodSeries = await getGexEodHistory(root);
    historyContext = buildGexHistoryContext(eodSeries, {
      flip: gexFlip,
      call_wall: callWall,
      put_wall: putWall,
      net_gex: gexBuilt.total ?? totalGamma,
      spot,
    });
  } catch {
    historyContext = undefined;
  }

  const heatmap: GexHeatmap = {
    underlying: root,
    spot,
    change_pct: changePct,
    asof: new Date().toISOString(),
    expiries,
    near_term_expiries: nearKeep,
    strikes: finalStrikes,
    max_pain: maxPain,
    gex: {
      cells: gexBuilt.cells,
      strike_totals: gexBuilt.strikeTotals,
      call_wall: callWall,
      put_wall: putWall,
      total: gexBuilt.total ?? totalGamma,
      flip: gexFlip,
      regime: gexRegime,
    },
    vex: {
      cells: vexBuilt.cells,
      strike_totals: vexBuilt.strikeTotals,
      pos_wall: posWall,
      neg_wall: negWall,
      total: vexBuilt.total ?? totalVanna,
      flip: vexFlip,
      regime: vexRegime,
    },
    dex: dexBlock,
    charm: charmBlock,
    shift,
    vex_shift: vexShift,
    // Omit `events` on cold history (undefined) so the client distinguishes "nothing crossed" ([])
    // from "no prior to diff yet".
    ...(events !== undefined ? { events } : {}),
    // Omit `history_context` when no EOD snapshot exists yet (never fabricated).
    ...(historyContext !== undefined ? { history_context: historyContext } : {}),
    source: "polygon",
    data_delay: POLYGON_OPTIONS_DATA_DELAY,
  };

  // Cache once for everyone: in-memory + Redis. 500 users → one matrix, zero per-user fetch.
  const entry = { at: now, data: heatmap };
  setCachedHeatmap(cacheKey, entry);
  void import("../shared-cache").then(({ sharedCacheSet }) =>
    sharedCacheSet(cacheKey, entry, Math.ceil(ttlMs / 1000))
  );

  return heatmap;
}

/**
 * A valid, empty GEX/VEX heatmap payload — used for thin/unknown tickers so the route
 * returns 200 with empty cells instead of throwing. Never fabricates any value.
 * When spot/cache context is supplied the empty result is cached too (so we don't
 * re-hit a thin chain every request inside the TTL window).
 */
function emptyHeatmap(
  underlying: string,
  ctx?: { spot?: number; changePct?: number; now?: number; cacheKey?: string; ttlMs?: number }
): GexHeatmap {
  const heatmap: GexHeatmap = {
    underlying,
    spot: ctx?.spot ?? 0,
    change_pct: ctx?.changePct ?? 0,
    asof: new Date().toISOString(),
    expiries: [],
    strikes: [],
    max_pain: null,
    gex: {
      cells: {},
      strike_totals: {},
      call_wall: null,
      put_wall: null,
      total: 0,
      flip: null,
      regime: {
        flip: null,
        posture: null,
        read: "No options-chain data for this ticker — dealer gamma profile unavailable.",
      },
    },
    vex: {
      cells: {},
      strike_totals: {},
      pos_wall: null,
      neg_wall: null,
      total: 0,
      flip: null,
      regime: {
        posture: null,
        read: "No options-chain data for this ticker — dealer vanna profile unavailable.",
      },
    },
    dex: {
      cells: {},
      strike_totals: {},
      total: 0,
      zero_level: null,
      regime: {
        posture: null,
        read: "No options-chain data for this ticker — dealer delta profile unavailable.",
      },
    },
    charm: {
      cells: {},
      strike_totals: {},
      total: 0,
      zero_level: null,
      regime: {
        posture: null,
        read: "No options-chain data for this ticker — dealer charm profile unavailable.",
      },
    },
    // No matrix → no positioning to migrate; the shift views stay in their collecting state.
    shift: { available: false, status: "collecting" },
    vex_shift: { available: false, status: "collecting" },
    // No prior history to diff → no events (omitted, never fabricated).
    source: "polygon",
    data_delay: POLYGON_OPTIONS_DATA_DELAY,
  };
  if (ctx?.cacheKey && ctx.now != null && ctx.ttlMs != null) {
    const entry = { at: ctx.now, data: heatmap };
    setCachedHeatmap(ctx.cacheKey, entry);
    void import("../shared-cache").then(({ sharedCacheSet }) =>
      sharedCacheSet(ctx.cacheKey!, entry, Math.ceil(ctx.ttlMs! / 1000))
    );
  }
  return heatmap;
}

/** One ticker's shared-cache freshness, as reported by peekGexHeatmapCache. */
export type GexHeatmapCachePeek = {
  ticker: string;
  /** True when a cached matrix entry exists at all (in-memory or Redis) — false is a COLD ticker,
   *  not necessarily a failure (e.g. never warmed, or evicted past the Redis TTL). */
  cached: boolean;
  /** ISO timestamp of the cached entry's build, or null when cold. */
  last_compute_at: string | null;
  /** Age of the cached entry in seconds, or null when cold. */
  age_sec: number | null;
  /** The base TTL this ticker's matrix is cached under (gexHeatmapCacheMsFor), in seconds. */
  ttl_sec: number;
  /** True when cold, OR when the cached entry is older than the stale-while-revalidate ceiling
   *  (gexHeatmapMaxStaleMs) — i.e. even a background-refresh-tolerant caller would refuse to serve
   *  it. A cached entry that is merely past its base TTL (but under the SWR ceiling) is NOT stale
   *  here — fetchGexHeatmap would still serve it while kicking off a background rebuild. */
  stale: boolean;
  /** Spot at the cached entry's build time, or null when cold / unavailable. */
  spot: number | null;
  /** Event count on the cached entry's last computed sample — 0 means "diffed, nothing crossed",
   *  null means either cold (no entry) or cold history (fetchGexHeatmap hadn't yet accumulated
   *  ≥2 positioning-history snapshots when that entry was built) — never conflated. */
  events_count: number | null;
};

/**
 * Admin-health PEEK at the shared `gex-heatmap:{ticker}` cache entry — READ-ONLY, and
 * DELIBERATELY does not call fetchGexHeatmap: a cache miss here reports `cached:false`
 * rather than building a fresh matrix, which would cost a live Polygon chain fetch on
 * every admin-panel poll just from being viewed. Checks the in-memory mirror first (same
 * `cachedHeatmaps` map fetchGexHeatmap itself checks first), then falls back to a single
 * Redis read — no upstream call, no write, no single-flight registration. Used by
 * src/lib/admin-gex-health.ts (task #138, BlackOut Thermal admin health panel) to report
 * per-ticker cache freshness without adding any cost of its own — the same CACHE-READER
 * discipline appendGexEodSnapshot/getGexEodHistory already follow in this file, just
 * skipping even fetchGexHeatmap's own cache-then-build fallback.
 */
export async function peekGexHeatmapCache(ticker: string): Promise<GexHeatmapCachePeek> {
  const { root } = resolveOptionsRoot(ticker);
  const cacheKey = `${GEX_HEATMAP_CACHE_PREFIX}:${root}`;
  const ttlMs = gexHeatmapCacheMsFor(root);

  let entry = cachedHeatmaps.get(cacheKey) ?? null;
  if (!entry) {
    try {
      const { sharedCacheGet } = await import("../shared-cache");
      entry = await sharedCacheGet<{ at: number; data: GexHeatmap }>(cacheKey);
    } catch {
      entry = null; // Redis optional — a miss/error here is just "cold", never thrown.
    }
  }

  if (!entry) {
    return {
      ticker: root,
      cached: false,
      last_compute_at: null,
      age_sec: null,
      ttl_sec: Math.round(ttlMs / 1000),
      stale: true,
      spot: null,
      events_count: null,
    };
  }

  const ageMs = Date.now() - entry.at;
  return {
    ticker: root,
    cached: true,
    last_compute_at: new Date(entry.at).toISOString(),
    age_sec: Math.round(ageMs / 1000),
    ttl_sec: Math.round(ttlMs / 1000),
    stale: ageMs > gexHeatmapMaxStaleMs(),
    spot: entry.data.spot > 0 ? entry.data.spot : null,
    events_count: entry.data.events ? entry.data.events.length : null,
  };
}

async function polygonFetchUrl(url: string): Promise<ChainResponse | null> {
  if (!polygonConfigured()) return null;
  const sep = url.includes("?") ? "&" : "?";
  const full = url.startsWith("http")
    ? `${url}${sep}apiKey=${KEY}`
    : `${BASE}${url}${sep}apiKey=${KEY}`;
  const endpointKey = url.startsWith("http")
    ? "/v3/snapshot/options/{underlying}"
    : url.split("?")[0] || "/v3/snapshot/options/{underlying}";
  try {
    const res = await polygonTrackedFetch(endpointKey, full, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      // Surface silent provider failures (invalid/non-Massive key, plan without
      // options-chain access, bad symbol). Host + status only — never the apiKey.
      console.warn(`[polygon-gex] chain fetch ${res.status} ${res.statusText || ""} from ${hostOf(full)} ${endpointKey}`.trim());
      return null;
    }
    return (await res.json()) as ChainResponse;
  } catch (err) {
    console.warn(`[polygon-gex] chain fetch threw from ${hostOf(full)} ${endpointKey}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Reusable raw Polygon/Massive REST JSON fetch — SAME BASE/KEY/rate-limited funnel
 * (polygonTrackedFetch) + host-only logging as polygonFetchUrl, but returns the raw
 * decoded JSON for callers that map a DIFFERENT response shape (e.g. the unified
 * /v3/snapshot endpoint). `path` is an app-relative path beginning with `/` (the
 * apiKey + BASE are appended here) OR a full http(s) next_url. `endpointKey` groups
 * the call for tracked-fetch metrics. Returns null on any non-2xx / throw — never
 * throws, so best-effort callers degrade cleanly to their fallback.
 */
export async function polygonRawJson<T = unknown>(
  path: string,
  endpointKey: string
): Promise<T | null> {
  if (!polygonConfigured()) return null;
  const sep = path.includes("?") ? "&" : "?";
  const full = path.startsWith("http")
    ? `${path}${sep}apiKey=${KEY}`
    : `${BASE}${path}${sep}apiKey=${KEY}`;
  try {
    const res = await polygonTrackedFetch(endpointKey, full, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[polygon-snapshot] fetch ${res.status} ${res.statusText || ""} from ${hostOf(full)} ${endpointKey}`.trim());
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[polygon-snapshot] fetch threw from ${hostOf(full)} ${endpointKey}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function fetchChainBand(
  underlying: string,
  spot: number,
  expiry: string,
  bandPct = 0.015,
  strikeHints: number[] = []
): Promise<ChainContract[]> {
  const band = Math.max(spot * bandPct, bandPct >= 0.04 ? spot * 0.02 : 80);
  let lo = Math.floor(spot - band);
  let hi = Math.ceil(spot + band);
  const finiteHints = strikeHints.filter((s) => Number.isFinite(s) && s > 0);
  if (finiteHints.length) {
    lo = Math.min(lo, Math.floor(Math.min(...finiteHints)));
    hi = Math.max(hi, Math.ceil(Math.max(...finiteHints)));
  }

  const params = new URLSearchParams({
    expiration_date: expiry,
    "strike_price.gte": String(lo),
    "strike_price.lte": String(hi),
    limit: "250",
    apiKey: KEY,
  });

  const out: ChainContract[] = [];
  let page = await polygonFetchUrl(`/v3/snapshot/options/${underlying}?${params}`);
  let guard = 0;

  // Follow next_url to completion; the guard is a runaway-loop backstop, NOT the expected stop
  // condition (that's !next_url). The old bare `guard < 8` silently truncated a strikeHints-widened
  // band — deep ITM/OTM legs pushed past ~2k contracts — and only WARNED, understating OI/walls.
  while (page && guard < CHAIN_BAND_PAGE_GUARD) {
    out.push(...(page.results ?? []));
    if (!page.next_url) break;
    page = await polygonFetchUrl(page.next_url);
    guard += 1;
  }
  if (page?.next_url) warnChainTruncated("fetchChainBand", underlying, guard);

  return out;
}

export function summarizeGexFromChain(contracts: ChainContract[], spot: number) {
  return aggregateGexRows(contracts, spot);
}

/**
 * Per-strike GAMMA coefficient for ONE specified expiry (intended: the FRONT / 0DTE / nearest) —
 * the dollar gamma ONE long contract contributes on the SAME per-1%-move scale the GEX matrix uses
 * (`γ · shares_per_contract · spot² · 0.01`). This is the conversion factor the intraday-adjusted
 * GEX model needs to turn today's SIGNED net customer contracts (from the Massive Trades tape) into
 * a dollar-gamma nudge that is dimensionally identical to `gex.strike_totals`.
 *
 * BOUNDED + RATE-LIMITED + CACHED: exactly ONE `fetchChainBand` (the SINGLE given expiry, ~±4%
 * strike band, ~1 page, through the shared Polygon funnel), wrapped in serverCache (OPTIONS_CHAIN
 * TTL) so concurrent callers collapse to one fetch per window. It does NOT touch the canonical
 * matrix build or its cache — an isolated, additive read used only by the intraday-adjust lens.
 * Returns null when not configured / no spot / no contracts at that expiry (never fabricates).
 */
export type FrontExpiryGammaCoeffs = {
  ticker: string;
  optionsRoot: string;
  /** The expiry these coefficients are for (YYYY-MM-DD) — caller passes the front/0DTE expiry. */
  frontExpiry: string;
  spot: number;
  /**
   * Per-strike GAMMA-per-long-contract dollar coefficient on the GEX per-1%-move scale
   * (`γ · spc · spot² · 0.01`), keyed by strike string. Gamma is type-independent (call γ ≈ put γ
   * at the same strike), so ONE coefficient per strike suffices; we keep the larger-OI side's value
   * when both exist. Always ≥ 0. Absent strike = no usable gamma there.
   */
  gammaCoeffByStrike: Record<string, number>;
};

export async function fetchFrontExpiryGammaCoeffs(
  underlying: string,
  frontExpiry: string
): Promise<FrontExpiryGammaCoeffs | null> {
  if (!polygonConfigured()) return null;
  const { root, optionsRoot } = resolveOptionsRoot(underlying);
  if (!root) return null;
  const expiry = String(frontExpiry ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;

  const { serverCache, TTL } = await import("../server-cache");
  return serverCache(`front-gamma-coeffs:${optionsRoot}:${expiry}`, TTL.OPTIONS_CHAIN, async () => {
    const snap = await resolveSpotSnapshot(optionsRoot);
    const spot = snap?.price ?? 0;
    if (!(spot > 0)) return null;

    // ONE tight single-expiry ±4% band (rate-limited, ~1 page). Never fabricates.
    const contracts = await fetchChainBand(optionsRoot, spot, expiry, 0.04).catch(
      () => [] as ChainContract[]
    );
    if (!contracts.length) return null;

    const gammaCoeffByStrike: Record<string, number> = {};
    const oiByStrike: Record<string, number> = {};
    for (const c of contracts) {
      const e = String(c.details?.expiration_date ?? "").slice(0, 10);
      if (e !== expiry) continue;
      const strike = Number(c.details?.strike_price);
      const gamma = Number(c.greeks?.gamma ?? 0);
      const oi = Number(c.open_interest ?? 0);
      if (!Number.isFinite(strike) || strike <= 0 || !Number.isFinite(gamma) || gamma <= 0) continue;
      const spc =
        Number.isFinite(c.details?.shares_per_contract) && (c.details?.shares_per_contract ?? 0) > 0
          ? Number(c.details?.shares_per_contract)
          : 100;
      // Dollar gamma per ONE long contract, same per-1%-move scale as the matrix GEX cells.
      const coeff = gamma * spc * spot * spot * 0.01;
      const key = String(strike);
      // Gamma is ~type-independent; keep the deeper-OI leg's coeff (more reliable γ at that strike).
      if (gammaCoeffByStrike[key] == null || oi > (oiByStrike[key] ?? -1)) {
        gammaCoeffByStrike[key] = coeff;
        oiByStrike[key] = oi;
      }
    }
    if (Object.keys(gammaCoeffByStrike).length === 0) return null;

    return { ticker: root, optionsRoot, frontExpiry: expiry, spot, gammaCoeffByStrike };
  });
}

function aggregateGexRows(contracts: ChainContract[], spot: number): Record<string, unknown>[] {
  const byStrike = new Map<number, { call: number; put: number }>();

  for (const c of contracts) {
    const strike = Number(c.details?.strike_price);
    const gamma = Number(c.greeks?.gamma ?? 0);
    const oi = Number(c.open_interest ?? 0);
    const type = String(c.details?.contract_type ?? "").toLowerCase();
    const sharesPerContract =
      Number.isFinite(c.details?.shares_per_contract) && (c.details?.shares_per_contract ?? 0) > 0
        ? Number(c.details?.shares_per_contract)
        : 100;
    if (!Number.isFinite(strike) || strike <= 0 || !oi || !gamma) continue;

    // gamma × oi × shares_per_contract × spot² × 0.01 — SpotGamma per-1%-move dealer $-gamma.
    const contrib = gamma * oi * sharesPerContract * spot * spot * 0.01;
    const row = byStrike.get(strike) ?? { call: 0, put: 0 };
    if (type === "call") row.call += contrib;
    else if (type === "put") row.put -= contrib;
    byStrike.set(strike, row);
  }

  return Array.from(byStrike.entries()).map(([strike, g]) => ({
    strike,
    call_gamma_oi: g.call,
    put_gamma_oi: g.put,
  }));
}

/** 0DTE GEX strike rows from Polygon chain snapshot (SPX + SPXW). UW fallback if empty. */
export async function fetchPolygonOdteGexRows(
  spot: number,
  expiry = todayEtYmd(),
  { forceRefresh = false }: { forceRefresh?: boolean } = {}
): Promise<Record<string, unknown>[]> {
  const { rows } = await fetchPolygonOdteDeskBundle(spot, expiry, { forceRefresh });
  return rows;
}

/** Options chain near the money for Largo terminal tools. */
export async function fetchPolygonOptionsChain(
  underlying: string,
  spot: number,
  expiry: string
): Promise<ChainContract[]> {
  if (!polygonConfigured() || spot <= 0) return [];
  const root = underlying.toUpperCase();
  if (root === "SPX") {
    // SPX + SPXW options both live under the I:SPX index underlying on Polygon/Massive.
    return fetchChainBand("I:SPX", spot, expiry, 0.015);
  }
  return fetchChainBand(root, spot, expiry, 0.015);
}

/** ATM ± bandPct chain snapshot for Night Hawk playbook validation. */
export async function fetchPolygonAtmOptionsChain(
  underlying: string,
  spot: number,
  expiry: string,
  bandPct = 0.05
): Promise<ChainContract[]> {
  if (!polygonConfigured() || spot <= 0) return [];
  const root = underlying.toUpperCase();
  if (root === "SPX") {
    // SPX + SPXW options both live under the I:SPX index underlying on Polygon/Massive.
    return fetchChainBand("I:SPX", spot, expiry, bandPct);
  }
  return fetchChainBand(root, spot, expiry, bandPct);
}

export function summarizeOiByStrike(contracts: ChainContract[], limit = 20) {
  const byStrike = new Map<number, { call_oi: number; put_oi: number }>();
  for (const c of contracts) {
    const strike = Number(c.details?.strike_price);
    const oi = Number(c.open_interest ?? 0);
    const type = String(c.details?.contract_type ?? "").toLowerCase();
    if (!Number.isFinite(strike) || strike <= 0 || !oi) continue;
    const row = byStrike.get(strike) ?? { call_oi: 0, put_oi: 0 };
    if (type === "call") row.call_oi += oi;
    else if (type === "put") row.put_oi += oi;
    byStrike.set(strike, row);
  }
  return Array.from(byStrike.entries())
    .map(([strike, oi]) => ({ strike, ...oi, total_oi: oi.call_oi + oi.put_oi }))
    .sort((a, b) => b.total_oi - a.total_oi)
    .slice(0, limit);
}

export function computeMaxPainFromChain(contracts: ChainContract[]): number | null {
  const byStrike = summarizeOiByStrike(contracts, 500);
  if (!byStrike.length) return null;
  let bestStrike: number | null = null;
  let bestPain = Infinity;
  for (const candidate of byStrike) {
    let pain = 0;
    for (const row of byStrike) {
      if (row.strike < candidate.strike) pain += (candidate.strike - row.strike) * row.call_oi;
      if (row.strike > candidate.strike) pain += (row.strike - candidate.strike) * row.put_oi;
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = candidate.strike;
    }
  }
  return bestStrike;
}

export function formatChainContracts(
  contracts: ChainContract[],
  spot: number,
  optionType?: "call" | "put",
  limit = 24
) {
  const want = optionType?.toLowerCase();
  return contracts
    .filter((c) => {
      const type = String(c.details?.contract_type ?? "").toLowerCase();
      if (want && type !== want) return false;
      return Number(c.details?.strike_price) > 0;
    })
    .sort(
      (a, b) =>
        Math.abs(Number(a.details?.strike_price) - spot) -
        Math.abs(Number(b.details?.strike_price) - spot)
    )
    .slice(0, limit)
    .map((c) => ({
      strike: Number(c.details?.strike_price),
      type: c.details?.contract_type,
      expiry: c.details?.expiration_date,
      oi: Number(c.open_interest ?? 0),
      iv: Number((c as { implied_volatility?: number }).implied_volatility ?? 0),
      delta: Number((c as { greeks?: { delta?: number } }).greeks?.delta ?? 0),
      gamma: Number(c.greeks?.gamma ?? 0),
      bid: Number((c as { last_quote?: { bid?: number } }).last_quote?.bid ?? 0),
      ask: Number((c as { last_quote?: { ask?: number } }).last_quote?.ask ?? 0),
    }));
}

type RefContract = {
  expiration_date?: string;
  contract_type?: string;
  open_interest?: number;
};

type RefContractsResponse = {
  results?: RefContract[];
  next_url?: string;
};

const positioningCache = new Map<string, { at: number; bundle: PolygonPositioningBundle }>();

function positioningCacheMs(): number {
  const sec = Number(process.env.POLYGON_POSITIONING_CACHE_SEC ?? 30);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 30_000;
}

export type PolygonPositioningBundle = {
  rows: Record<string, unknown>[];
  maxPain: number | null;
  spot: number;
  source: "polygon";
  expiry: string;
};

/** GEX rows + max pain from Polygon options chain — any underlying (SPX uses SPX+SPXW). */
export async function fetchPolygonPositioningBundle(
  underlying: string,
  opts?: { spot?: number; expiry?: string }
): Promise<PolygonPositioningBundle> {
  const sym = underlying.toUpperCase();
  const expiry = opts?.expiry ?? todayEtYmd();
  const cacheKey = `${sym}:${expiry}`;
  const now = Date.now();
  const cached = positioningCache.get(cacheKey);
  if (cached && now - cached.at < positioningCacheMs()) {
    return cached.bundle;
  }

  if (!polygonConfigured()) {
    return { rows: [], maxPain: null, spot: 0, source: "polygon", expiry };
  }

  let spot = opts?.spot ?? 0;
  if (spot <= 0) {
    // Resolve via the OPTIONS root so index names (SPX→I:SPX, etc.) hit the indices snapshot;
    // fetchStockSnapshot(sym) returns no row for an index and would leave spot 0.
    const { optionsRoot } = resolveOptionsRoot(sym);
    const snap = await resolveSpotSnapshot(optionsRoot);
    spot = snap?.price ?? 0;
  }
  if (spot <= 0) {
    return { rows: [], maxPain: null, spot: 0, source: "polygon", expiry };
  }

  const contracts = await fetchPolygonOptionsChain(sym, spot, expiry);
  const rows = aggregateGexRows(contracts, spot);
  const maxPain = computeMaxPainFromChain(contracts);
  const bundle: PolygonPositioningBundle = { rows, maxPain, spot, source: "polygon", expiry };
  if (rows.length) {
    // Bound: keyed by user-supplied ticker → cap so garbage symbols can't leak memory.
    if (positioningCache.size > 200) positioningCache.clear();
    positioningCache.set(cacheKey, { at: now, bundle });
  }
  return bundle;
}

/** OI aggregated by expiry from Polygon reference contracts (unlimited plan).
 *
 * Live-caught (2026-07-03, docs/audit/FINDINGS.md): a flat 12-page guard truncated
 * AAPL's chain every poll ("chain incomplete, walls/OI/IV understated") — the same
 * "chasing the live chain size with a static number" bug fetchHeatmapBand already
 * hit once for SPX (see comment on HEATMAP_PAGE_GUARD above). But this function is
 * called from a LIVE per-request path (Largo tool), unlike the cron-warmed heatmap,
 * so the fix isn't "raise to an unbounded backstop" — it's "stop on the actual
 * completion condition": contracts arrive sorted by expiration_date ascending, so
 * once we've seen `limit + 1` DISTINCT expiries, every one of the target `limit`
 * nearest expiries is provably closed out (a later expiry has started, so no more
 * contracts for an earlier one can arrive). A generous page backstop still bounds
 * worst-case latency on this live path.
 */
export async function fetchPolygonOiByExpiry(
  underlying: string,
  limit = 12
): Promise<Array<{ expiry: string; call_oi: number; put_oi: number; total_oi: number }>> {
  if (!polygonConfigured()) return [];
  const root = underlying.toUpperCase();
  const today = todayEtYmd();
  const params = new URLSearchParams({
    underlying_ticker: root,
    expired: "false",
    limit: "250",
    sort: "expiration_date",
    order: "asc",
    "expiration_date.gte": today,
    apiKey: KEY,
  });

  const PAGE_GUARD = 40; // bounded backstop — this is a live per-request path, not a cron warm path
  const byExpiry = new Map<string, { call_oi: number; put_oi: number }>();
  let page: RefContractsResponse | null = await polygonRefFetch(`/v3/reference/options/contracts?${params}`);
  let guard = 0;

  while (page && guard < PAGE_GUARD && byExpiry.size <= limit) {
    for (const c of page.results ?? []) {
      const expiry = String(c.expiration_date ?? "").slice(0, 10);
      if (!expiry) continue;
      const oi = Number(c.open_interest ?? 0);
      if (!oi) continue;
      const type = String(c.contract_type ?? "").toLowerCase();
      const row = byExpiry.get(expiry) ?? { call_oi: 0, put_oi: 0 };
      if (type === "call") row.call_oi += oi;
      else if (type === "put") row.put_oi += oi;
      byExpiry.set(expiry, row);
    }
    if (!page.next_url) break;
    if (byExpiry.size > limit) break; // target range provably complete — stop before fetching another page
    page = await polygonRefFetch(page.next_url);
    guard += 1;
  }
  if (page?.next_url && byExpiry.size <= limit) warnChainTruncated("fetchPolygonOiByExpiry", underlying, guard);

  return Array.from(byExpiry.entries())
    .map(([expiry, oi]) => ({
      expiry,
      call_oi: oi.call_oi,
      put_oi: oi.put_oi,
      total_oi: oi.call_oi + oi.put_oi,
    }))
    .sort((a, b) => a.expiry.localeCompare(b.expiry))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// IV Term Structure
// ---------------------------------------------------------------------------

export type PolygonIvTermPoint = {
  expiry: string;
  avg_iv: number;
  call_iv: number;
  put_iv: number;
  dte: number;
};

type SnapshotContract = {
  details?: {
    expiration_date?: string;
    contract_type?: string;
  };
  implied_volatility?: number;
};

type SnapshotResponse = {
  results?: SnapshotContract[];
  next_url?: string;
};

const ivTermCache = new Map<string, { at: number; data: PolygonIvTermPoint[] }>();
const IV_TERM_CACHE_MS = 5 * 60_000; // 5 minutes

/**
 * Fetch IV term structure for a ticker from Polygon options chain snapshot.
 * Groups all contracts by expiry date and averages call + put IV per expiry.
 * Results are sorted ascending by expiry date and cached for 5 minutes.
 *
 * Live-caught (docs/audit/FINDINGS.md): this loop had its OWN hardcoded 20-page
 * guard — the exact "chasing the live chain size with a static number" bug class
 * fetchHeatmapBand and fetchPolygonOiByExpiry already hit for SPX/AAPL (see the
 * comments on HEATMAP_PAGE_GUARD and fetchPolygonOiByExpiry above) — except this
 * instance was never migrated to the shared, already-fixed guard when those were
 * raised, so it kept truncating SPX's full chain on every 5-min cache miss ("chain
 * incomplete, walls/OI/IV understated" firing live in production). Unlike
 * fetchPolygonOiByExpiry, there's no "N distinct expiries seen" early-exit here —
 * this function needs the WHOLE term structure, not just the nearest few expiries —
 * so it shares HEATMAP_PAGE_GUARD directly rather than inventing a third bound.
 */
export async function fetchPolygonIvTermStructure(
  ticker: string
): Promise<PolygonIvTermPoint[]> {
  if (!polygonConfigured()) return [];
  const root = ticker.toUpperCase();
  const now = Date.now();
  const cached = ivTermCache.get(root);
  if (cached && now - cached.at < IV_TERM_CACHE_MS) return cached.data;

  const today = todayEtYmd();
  const todayMs = new Date(today).getTime();

  const params = new URLSearchParams({
    limit: "250",
    apiKey: KEY,
  });

  const byExpiry = new Map<
    string,
    { callIvSum: number; callCount: number; putIvSum: number; putCount: number }
  >();

  let page: SnapshotResponse | null = await polygonFetchUrl(
    `/v3/snapshot/options/${root}?${params}`
  ) as SnapshotResponse | null;
  let guard = 0;

  while (page && guard < HEATMAP_PAGE_GUARD) {
    for (const c of page.results ?? []) {
      const expiry = String(c.details?.expiration_date ?? "").slice(0, 10);
      if (!expiry || expiry < today) continue;
      const iv = Number(c.implied_volatility ?? 0);
      if (!iv || !Number.isFinite(iv)) continue;
      const type = String(c.details?.contract_type ?? "").toLowerCase();
      const row = byExpiry.get(expiry) ?? {
        callIvSum: 0,
        callCount: 0,
        putIvSum: 0,
        putCount: 0,
      };
      if (type === "call") {
        row.callIvSum += iv;
        row.callCount += 1;
      } else if (type === "put") {
        row.putIvSum += iv;
        row.putCount += 1;
      }
      byExpiry.set(expiry, row);
    }
    if (!page.next_url) break;
    page = await polygonFetchUrl(page.next_url) as SnapshotResponse | null;
    guard += 1;
  }
  if (page?.next_url) warnChainTruncated("fetchPolygonIvTermStructure", root, guard);

  const data: PolygonIvTermPoint[] = Array.from(byExpiry.entries())
    .map(([expiry, row]) => {
      const callIv = row.callCount > 0 ? row.callIvSum / row.callCount : 0;
      const putIv = row.putCount > 0 ? row.putIvSum / row.putCount : 0;
      const count = (row.callCount > 0 ? 1 : 0) + (row.putCount > 0 ? 1 : 0);
      const avg_iv = count > 0 ? (callIv + putIv) / count : 0;
      const expiryMs = new Date(expiry).getTime();
      const dte = Math.max(0, Math.round((expiryMs - todayMs) / 86_400_000));
      return {
        expiry,
        avg_iv: Number(avg_iv.toFixed(4)),
        call_iv: Number(callIv.toFixed(4)),
        put_iv: Number(putIv.toFixed(4)),
        dte,
      };
    })
    .filter((p) => p.avg_iv > 0)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));

  if (data.length) {
    // Bound: keyed by user-supplied ticker → cap so garbage symbols can't leak memory.
    if (ivTermCache.size > 200) ivTermCache.clear();
    ivTermCache.set(root, { at: now, data });
  }
  return data;
}

// ---------------------------------------------------------------------------
// Realized Volatility
// ---------------------------------------------------------------------------

export type PolygonRealizedVol = {
  realized_vol_30d: number;
  realized_vol_10d: number;
};

const realizedVolCache = new Map<string, { at: number; data: PolygonRealizedVol }>();
const REALIZED_VOL_CACHE_MS = 5 * 60_000; // 5 minutes

function annualizedVol(closes: number[], window: number): number {
  const slice = closes.slice(-window);
  if (slice.length < 2) return 0;
  const logReturns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] > 0 && slice[i] > 0) {
      logReturns.push(Math.log(slice[i] / slice[i - 1]));
    }
  }
  if (logReturns.length < 2) return 0;
  const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
  const variance =
    logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (logReturns.length - 1);
  return Number((Math.sqrt(variance) * Math.sqrt(252)).toFixed(6));
}

/**
 * Compute annualized realized volatility for a ticker using Polygon daily bars.
 * Returns 30-day and 10-day realized vol. Cached for 5 minutes.
 */
export async function fetchPolygonRealizedVol(
  ticker: string,
  days = 30
): Promise<PolygonRealizedVol> {
  if (!polygonConfigured()) return { realized_vol_30d: 0, realized_vol_10d: 0 };
  const root = ticker.toUpperCase();
  const now = Date.now();
  const cached = realizedVolCache.get(root);
  if (cached && now - cached.at < REALIZED_VOL_CACHE_MS) return cached.data;

  // Import fetchAggBars from polygon-largo to avoid duplicating the bar-fetch logic.
  const { fetchAggBars } = await import("./polygon-largo");
  const today = todayEtYmd();
  // Fetch enough bars: max(days, 30) + buffer for weekends/holidays.
  const lookback = Math.max(days, 30);
  const fromDays = Math.ceil(lookback * 1.5) + 10;
  const fromDate = new Date(Date.now() - fromDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // For SPX use the Polygon index ticker prefix.
  const polyTicker = root === "SPX" ? "I:SPX" : root;
  const bars = await fetchAggBars(polyTicker, 1, "day", fromDate, today, String(lookback + 20)).catch(
    () => []
  );

  const closes = bars.map((b) => b.c).filter((c) => c > 0);
  const data: PolygonRealizedVol = {
    realized_vol_30d: annualizedVol(closes, 31), // 31 closes = 30 log-returns
    realized_vol_10d: annualizedVol(closes, 11), // 11 closes = 10 log-returns
  };

  if (data.realized_vol_30d > 0 || data.realized_vol_10d > 0) {
    // Bound: keyed by user-supplied ticker → cap so garbage symbols can't leak memory.
    if (realizedVolCache.size > 200) realizedVolCache.clear();
    realizedVolCache.set(root, { at: now, data });
  }
  return data;
}

// ---------------------------------------------------------------------------

async function polygonRefFetch(url: string): Promise<RefContractsResponse | null> {
  if (!polygonConfigured()) return null;
  const sep = url.includes("?") ? "&" : "?";
  const full = url.startsWith("http")
    ? `${url}${sep}apiKey=${KEY}`
    : `${BASE}${url}${sep}apiKey=${KEY}`;
  const endpointKey = url.startsWith("http")
    ? "/v3/reference/options/contracts"
    : url.split("?")[0] || "/v3/reference/options/contracts";
  try {
    const res = await polygonTrackedFetch(endpointKey, full, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as RefContractsResponse;
  } catch {
    return null;
  }
}
