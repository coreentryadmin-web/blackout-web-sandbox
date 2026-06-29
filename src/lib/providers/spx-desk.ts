import { polygonConfigured, engineIntelOverlayEnabled, uwConfigured, deskPulseStructureCacheTtlMs } from "./config";
import { serverCache } from "@/lib/server-cache";
import { safeTime } from "@/lib/safe-time";
import { tapeDedupKey } from "@/lib/tape-dedup-key";
import { fetchGexHeatmap } from "./polygon-options-gex";
import { gexPositioningFromHeatmap } from "./gex-positioning";
import { dbConfigured, fetchRecentFlows } from "@/lib/db";
import { markFlowDataFromBriefs, resolveFlowDataAgeMs } from "@/lib/flow-data-freshness";
import { isFlowFrameFreshAnywhere } from "@/lib/flow-liveness";
import {
  computeFlowStrikeStacks,
  type FlowStrikeStack,
} from "@/lib/largo/flow-strike-stacks";
import { mergeMacroEventsToday, type MacroEvent } from "./macro-events";
import { resolveDeskGap } from "./gap-proxy";
import {
  gammaRegime,
  topGexWalls,
  type GexStrikeLevel,
  type GexWall,
} from "./gamma-desk";
import {
  computeVixTermStructure,
  fetchBenzingaNews,
  fetchBreadthUniverseSnapshots,
  computeMarketBreadthFromSummary,
  fetchDailyMarketSummary,
  fetchPriorDayCloses,
  type MarketBreadthMetrics,
  fetchIndexDailyBars,
  fetchIndexEma,
  fetchIndexMinuteBars,
  fetchIndexSma,
  fetchIndexSnapshots,
  fetchMarketStatusNow,
  fetchVixIvRankPercentile,
} from "./polygon";
import { resolveMarketInternals } from "@/lib/market-internals";
import { summarizeGreekExposureByExpiry, type GreekExposureSummary } from "@/lib/greek-exposure-summary";
import { summarizeGroupGreekFlow, type GroupGreekFlowSummary } from "@/lib/group-greek-flow-summary";
import {
  isSpxRthActive,
  marketStatusLabel,
} from "@/lib/spx-market-session";
import { isPremarketPlanningWindow } from "@/lib/spx-play-session-guards";
import {
  distancePct,
  inferRegime,
  priorDayFromDailyBars,
  priorEtYmd,
  sessionStatsFromMinuteBars,
  todayEtYmd,
} from "./spx-session";
import {
  fetchUwDarkPool,
  fetchUwFlow0dte,
  fetchUwFlowPerExpiry,
  fetchUwGroupGreekFlow,
  fetchUwGreekExposureExpiry,
  fetchUwIvRank,
  fetchUwMacroIndicators,
  fetchUwMarketTide,
  fetchUwMaxPain,
  fetchUwNetFlowExpiry,
  fetchUwNetPremTicks,
  fetchUwNope,
  fetchUwTickerFlowAlerts,
  type DarkPoolSnapshot,
  type IvTermPoint,
  type NetPremTick,
  type OiChangeItem,
  type UwMacroIndicatorSnapshot,
} from "./unusual-whales";
import { runUwSequential } from "./uw-rate-limiter";
import { fetchEngine } from "@/lib/engine";
import { indexStore, getIndexFeedFreshness } from "@/lib/ws/polygon-socket";
import { getActiveTradingHalts, isTradingHaltChannelStale } from "@/lib/ws/uw-socket";

/** GEX-wall ladder size — a balanced ~5-per-side two-sided ladder (call wall above spot,
 *  put wall below). 10 fits the scrollable panel without crushing the Live Tape (bug #93). */
const GEX_WALL_LADDER_LIMIT = 10;

let lastGoodGexWalls: GexWall[] = [];
let lastGoodStrikeLevels: GexStrikeLevel[] = [];
let lastGoodGammaFlip: number | null = null;
let lastGoodGammaRegime = "unknown";
let lastGoodUnifiedTape: SpxTapeItem[] = [];
let lastGoodSpxFlowBriefs: SpxFlowBrief[] = [];
let lastPulseForSignals: SpxDeskPulse | null = null;

// Audit gap #7a (truth mandate): when the Massive chain comes back empty (key/plan issue,
// gateway outage) the desk serves the LAST-GOOD walls/flip/regime/structure. Without a stamp
// those re-derive distances against the live price and look LIVE — a 2-min-old wall presented
// as current. Stamp the moment fresh GEX levels last landed so the payload can carry a gex age
// and the UI can age-badge stale walls. Updated ONLY when a fresh chain produces ranked levels.
let lastGoodGexComputedAt = 0;
/** Age (ms) of the freshest GEX strike ladder; null until one has ever been computed. */
function gexDataAgeMs(now = Date.now()): number | null {
  return lastGoodGexComputedAt > 0 ? Math.max(0, now - lastGoodGexComputedAt) : null;
}
/**
 * Beyond this age the served GEX walls/flip/regime are treated as STALE (sticky fallback
 * during a chain outage), so the UI grays them / shows an age badge instead of presenting a
 * day-stale wall as a live node. ~30s per the audit. Env-tunable without a deploy.
 */
const GEX_STALE_MS = (() => {
  const raw = process.env.SPX_GEX_STALE_SEC?.trim();
  const sec = raw ? Number(raw) : 30;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 30_000;
})();

type CanonicalDeskGexSnapshot = {
  gex_net: number | null;
  gex_king: number | null;
  max_pain: number | null;
  gamma_flip: number | null;
  above_gamma_flip: boolean;
  gamma_regime: string;
  gex_walls: GexWall[];
  gex_age_ms: number | null;
  gex_stale: boolean;
  fresh_this_cycle: boolean;
};

/** Map the shared matrix strike_totals into the gamma-desk ladder shape for wall rendering. */
function strikeTotalsToLevels(totals: Record<string, number>): GexStrikeLevel[] {
  return Object.entries(totals)
    .map(([s, net]) => {
      const strike = Number(s);
      if (!Number.isFinite(strike) || net === 0) return null;
      return {
        strike,
        net_gex: net,
        call_gex: net > 0 ? net : 0,
        put_gex: net < 0 ? net : 0,
      };
    })
    .filter((l): l is GexStrikeLevel => l != null)
    .sort((a, b) => Math.abs(b.net_gex) - Math.abs(a.net_gex));
}

/** King strike = argmax |net_gex| — same rule as Heat Maps ANCHOR / desk GEX Anchor. */
function kingFromStrikeTotals(totals: Record<string, number>): number | null {
  let king: number | null = null;
  let best = 0;
  const entries = Object.entries(totals)
    .map(([s, v]) => ({ strike: Number(s), value: v }))
    .filter((e) => Number.isFinite(e.strike))
    .sort((a, b) => a.strike - b.strike);
  for (const e of entries) {
    const mag = Math.abs(e.value);
    if (mag > best) {
      best = mag;
      king = e.strike;
    }
  }
  return king;
}

function stickyDeskGexFallback(spot: number): CanonicalDeskGexSnapshot {
  const flip = lastGoodGammaFlip;
  const gRegime = gammaRegime(spot, flip);
  const wallsFromLevels = lastGoodStrikeLevels.length
    ? topGexWalls(lastGoodStrikeLevels, spot, GEX_WALL_LADDER_LIMIT)
    : [];
  const finalWalls = wallsFromLevels.length ? wallsFromLevels : lastGoodGexWalls;
  const gexAgeMs = gexDataAgeMs();
  return {
    gex_net: null,
    gex_king: null,
    max_pain: null,
    gamma_flip: flip,
    above_gamma_flip: flip != null ? spot > flip : false,
    gamma_regime: gRegime !== "unknown" ? gRegime : lastGoodGammaRegime,
    gex_walls: finalWalls,
    gex_age_ms: gexAgeMs,
    gex_stale: gexAgeMs == null || gexAgeMs > GEX_STALE_MS,
    fresh_this_cycle: false,
  };
}

/**
 * Single-source SPX desk structural GEX through the shared heatmap matrix
 * (`getGexPositioning` / `gex-heatmap:SPX` cache). Replaces the old 0DTE-only
 * `fetchPolygonOdteDeskBundle` dual path (audit F-1).
 */
async function resolveCanonicalDeskGex(spot: number): Promise<CanonicalDeskGexSnapshot> {
  const hm = await fetchGexHeatmap("SPX").catch(() => null);
  const pos = gexPositioningFromHeatmap("SPX", hm);
  if (!pos || !hm) return stickyDeskGexFallback(spot);

  const levels = strikeTotalsToLevels(hm.gex.strike_totals);
  const king = kingFromStrikeTotals(hm.gex.strike_totals);
  const flip = pos.flip;
  const regime = gammaRegime(spot, flip);
  const walls = levels.length ? topGexWalls(levels, spot, GEX_WALL_LADDER_LIMIT) : [];

  if (levels.length) {
    lastGoodStrikeLevels = levels;
    const asofMs = Date.parse(pos.asof);
    lastGoodGexComputedAt = Number.isFinite(asofMs) ? asofMs : Date.now();
  }
  if (walls.length) lastGoodGexWalls = walls;
  if (flip != null) lastGoodGammaFlip = flip;
  if (regime !== "unknown") lastGoodGammaRegime = regime;

  const asofMs = Date.parse(pos.asof);
  const gexAgeMs = Number.isFinite(asofMs) ? Math.max(0, Date.now() - asofMs) : gexDataAgeMs();

  return {
    gex_net: pos.net_gex,
    gex_king: king,
    max_pain: pos.max_pain,
    gamma_flip: flip,
    above_gamma_flip: flip != null ? spot > flip : false,
    gamma_regime: regime !== "unknown" ? regime : lastGoodGammaRegime,
    gex_walls: walls.length ? walls : lastGoodGexWalls,
    gex_age_ms: gexAgeMs,
    gex_stale: false,
    fresh_this_cycle: levels.length > 0,
  };
}

const DARK_POOL_CACHE_MS = 10_000;
const TIDE_STALE_MS = 10_000;
const DARK_POOL_WS_STALE_MS = 15_000;
const INTERVAL_FLOW_WS_STALE_MS = 10_000;
// How long a Polygon WS index tick (I:SPX, VIX, internals) stays preferred over the
// REST snapshot in mergeWsIndexSnapshots. SPX *index* aggregate ticks are naturally
// sparse (often >5s apart on quiet tape), and the REST fallback (fetchIndexSnapshots)
// is a DELAYED index snapshot — so a tight 5s window made the play/desk price drop to
// a stale REST level whenever ticks were quiet, pinning the suggested strike to a stale
// node (e.g. 7400) while the live header showed the real last WS print. Keep the last
// real WS tick for up to ~2 min (env-tunable) before ever falling back to delayed REST:
// a 30-120s-old REAL print is far better than a 15-min-delayed one for strike + exits.
const INDEX_STORE_STALE_MS = (() => {
  const raw = process.env.SPX_INDEX_WS_STALE_SEC?.trim();
  const sec = raw ? Number(raw) : 120;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 120_000;
})();

let cachedDarkPool: { data: DarkPoolSnapshot | null; fetchedAt: number; key: string } = {
  data: null,
  fetchedAt: 0,
  key: "",
};

async function resolveMarketTide(): Promise<Awaited<ReturnType<typeof fetchUwMarketTide>>> {
  if (!uwConfigured()) return null;
  try {
    const { tideStore } = await import("../ws/uw-socket");
    if (Date.now() - tideStore.updatedAt < TIDE_STALE_MS) {
      return tideStore;
    }
  } catch {
    /* WS optional */
  }
  return fetchUwMarketTide().catch(() => null);
}

async function resolveFlow0dte(ticker = "SPX"): Promise<{
  call_premium: number;
  put_premium: number;
  net: number;
} | null> {
  try {
    const { intervalFlowStore } = await import("../ws/uw-socket");
    if (Date.now() - intervalFlowStore.updatedAt < INTERVAL_FLOW_WS_STALE_MS && intervalFlowStore.rows.length) {
      let calls = 0;
      let puts = 0;
      for (const row of intervalFlowStore.rows) {
        calls += Number(row.call_premium ?? 0);
        puts += Number(row.put_premium ?? 0);
      }
      return { call_premium: calls, put_premium: puts, net: calls - puts };
    }
  } catch {
    /* WS optional */
  }
  return fetchUwFlow0dte(ticker).catch(() => null);
}

async function resolveDarkPool(
  ticker: string,
  opts?: { limit?: number; min_premium?: number }
): Promise<DarkPoolSnapshot | null> {
  if (!uwConfigured()) return null;
  const key = `${ticker}:${opts?.limit ?? 20}:${opts?.min_premium ?? 500_000}`;
  const now = Date.now();
  try {
    const { darkPoolStore } = await import("../ws/uw-socket");
    if (Date.now() - darkPoolStore.updatedAt < DARK_POOL_WS_STALE_MS && darkPoolStore.data) {
      return darkPoolStore.data;
    }
  } catch {
    /* WS optional */
  }
  if (cachedDarkPool.key === key && now - cachedDarkPool.fetchedAt < DARK_POOL_CACHE_MS) {
    return cachedDarkPool.data;
  }
  const fresh = await fetchUwDarkPool(ticker, opts).catch(() => null);
  if (fresh !== null) {
    cachedDarkPool = { data: fresh, fetchedAt: now, key };
    return fresh;
  }
  return cachedDarkPool.data;
}

function mergeWsIndexSnapshots(
  snaps: Awaited<ReturnType<typeof fetchIndexSnapshots>>
): Awaited<ReturnType<typeof fetchIndexSnapshots>> {
  const now = Date.now();
  const out = { ...snaps };
  for (const sym of [SPX, VIX, VIX9D, VIX3M, TICK, TRIN, ADD]) {
    const ws = indexStore[sym];
    if (ws?.updatedAt && now - ws.updatedAt < INDEX_STORE_STALE_MS && ws.price > 0) {
      // FIX-A: the live WS PRICE is always preferred (sub-second fresh). For the day CHANGE%,
      // trust the WS value ONLY when its session_open is authoritative — i.e. REST-seeded
      // (open_source === "rest"). When the anchor is still a raw first-seen bar open ("ws-bar")
      // — the mid-session cold-start case — that change% is computed against the price AT BOOT and
      // is WRONG, so keep the authoritative REST snapshot change_pct (out[sym]) until the anchor is
      // reconciled. This stops a deploy-time bar open from clobbering the true day change for ~120s.
      const wsChangeAuthoritative = ws.open_source === "rest";
      const restChangePct = out[sym]?.change_pct ?? 0;
      out[sym] = {
        symbol: sym,
        price: ws.price,
        change_pct: wsChangeAuthoritative ? ws.change_pct ?? restChangePct : restChangePct,
      };
    }
  }
  return out;
}

async function syncDeskStickyFromRedis(): Promise<void> {
  if (!process.env.REDIS_URL?.trim()) return;
  try {
    const { sharedCacheGet, DESK_STICKY_KEYS } = await import("../shared-cache");
    const [walls, tape, flip, regime, strikes, flows] = await Promise.all([
      sharedCacheGet<GexWall[]>(DESK_STICKY_KEYS.gexWalls),
      sharedCacheGet<SpxTapeItem[]>(DESK_STICKY_KEYS.unifiedTape),
      sharedCacheGet<number | null>(DESK_STICKY_KEYS.gammaFlip),
      sharedCacheGet<string>(DESK_STICKY_KEYS.gammaRegime),
      sharedCacheGet<GexStrikeLevel[]>(DESK_STICKY_KEYS.strikeLevels),
      sharedCacheGet<SpxFlowBrief[]>(DESK_STICKY_KEYS.spxFlowBriefs),
    ]);
    if (walls?.length) lastGoodGexWalls = walls;
    if (tape?.length) lastGoodUnifiedTape = tape;
    if (flip != null) lastGoodGammaFlip = flip;
    if (regime) lastGoodGammaRegime = regime;
    if (strikes?.length) lastGoodStrikeLevels = strikes;
    if (flows?.length) lastGoodSpxFlowBriefs = flows;
  } catch {
    // keep in-process sticky state
  }
}

function publishDeskStickyToRedis(): void {
  if (!process.env.REDIS_URL?.trim()) return;
  void import("../shared-cache").then(({ sharedCacheSet, DESK_STICKY_KEYS, DESK_STICKY_TTL_SEC }) =>
    Promise.all([
      sharedCacheSet(DESK_STICKY_KEYS.gexWalls, lastGoodGexWalls, DESK_STICKY_TTL_SEC.gex),
      sharedCacheSet(DESK_STICKY_KEYS.unifiedTape, lastGoodUnifiedTape, DESK_STICKY_TTL_SEC.tape),
      sharedCacheSet(DESK_STICKY_KEYS.gammaFlip, lastGoodGammaFlip, DESK_STICKY_TTL_SEC.gex),
      sharedCacheSet(DESK_STICKY_KEYS.gammaRegime, lastGoodGammaRegime, DESK_STICKY_TTL_SEC.gex),
      sharedCacheSet(DESK_STICKY_KEYS.strikeLevels, lastGoodStrikeLevels, DESK_STICKY_TTL_SEC.gex),
      sharedCacheSet(DESK_STICKY_KEYS.spxFlowBriefs, lastGoodSpxFlowBriefs, DESK_STICKY_TTL_SEC.tape),
    ])
  );
}

export function getLastPulseForSignals(): SpxDeskPulse | null {
  return lastPulseForSignals;
}
let cachedPriorDay = {
  pdh: null as number | null,
  pdl: null as number | null,
  pdc: null as number | null,
  fetchedAt: 0,
};

type PulseStructureCache = {
  fetchedAt: number;
  lod: number | null;
  hod: number | null;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  sma50: number | null;
  sma200: number | null;
  leader_stocks: Array<{ name: string; ticker: string; change_pct: number }>;
  breadth_samples: Array<{ change_pct: number }>;
};

let cachedPulseStructure: PulseStructureCache = {
  fetchedAt: 0,
  lod: null,
  hod: null,
  vwap: null,
  ema20: null,
  ema50: null,
  ema200: null,
  sma50: null,
  sma200: null,
  leader_stocks: [],
  breadth_samples: [],
};

const SPX = "I:SPX";
const VIX = "I:VIX";
const VIX9D = "I:VIX9D";
const VIX3M = "I:VIX3M";
const TICK = "I:TICK";
const TRIN = "I:TRIN";
const ADD = "I:ADD";
const LEADER_TICKERS = new Set(["AAPL", "NVDA", "MSFT", "GOOG", "TSLA", "META"]);

function buildDeskDataQuality(
  snaps: Awaited<ReturnType<typeof fetchIndexSnapshots>>,
  vixTerm: ReturnType<typeof computeVixTermStructure>
): DeskDataQuality {
  const missing: string[] = [];
  if ((snaps[VIX]?.price ?? 0) <= 0) missing.push("VIX");
  if ((snaps[VIX9D]?.price ?? 0) <= 0) missing.push("VIX9D");
  if ((snaps[VIX3M]?.price ?? 0) <= 0) missing.push("VIX3M");
  const vix_term_partial =
    Boolean(vixTerm.partial) || (missing.includes("VIX9D") && !missing.includes("VIX3M"));
  return { vix_term_partial, missing };
}

function leaderStocksFromBreadth(
  samples: Array<{ name: string; ticker: string; change_pct: number }>
) {
  return samples.filter((s) => LEADER_TICKERS.has(s.ticker));
}

export type SpxDeskLevel = {
  label: string;
  value: number | null;
  kind: "support" | "resistance" | "neutral";
  distance_pct: number | null;
};

export type SpxFlowBrief = {
  ticker: string;
  premium: number;
  option_type: string;
  strike: number;
  expiry: string;
  direction: string;
  alerted_at: string;
  alert_rule: string | null;
  trade_count: number | null;
  has_sweep: boolean;
};

export type SpxTapeItem = {
  kind: "flow" | "darkpool";
  side: "call" | "put" | "neutral";
  time: string;
  label: string;
  premium: number;
  detail: string;
};

export type DeskNewsHeadline = {
  title: string;
  published: string;
  tickers: string[];
};

export type SpxDeskPayload = {
  available: boolean;
  as_of: string;
  source: string;
  price: number;
  spx_change_pct: number;
  vix: number | null;
  vix_change_pct: number | null;
  above_vwap: boolean;
  lod: number | null;
  hod: number | null;
  vwap: number | null;
  pdh: number | null;
  pdl: number | null;
  prior_close: number | null;
  gap_pct: number | null;
  gap_source: "SPY" | "SPX" | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  sma50: number | null;
  sma200: number | null;
  tick: number | null;
  trin: number | null;
  add: number | null;
  /**
   * Provenance of tick/trin/add (FIX-C, truth mandate): true = a breadth-derived PROXY was
   * substituted because Polygon returned no real I:TICK/I:TRIN/I:ADD. The UI badges 'est.' on any
   * estimated reading so a computed proxy is never presented as a real internal. Optional so
   * legacy full-payload literals (stubs/fixtures/merge) compile unchanged — buildSpxDesk /
   * buildSpxDeskPulse always populate it, and the spx-desk-merge `...base` spread carries it.
   */
  internals_estimated?: { tick: boolean; trin: boolean; add: boolean };
  gex_net: number | null;
  gex_king: number | null;
  max_pain: number | null;
  gamma_flip: number | null;
  above_gamma_flip: boolean;
  gamma_regime: string;
  gex_walls: GexWall[];
  flow_0dte_call_premium: number | null;
  flow_0dte_put_premium: number | null;
  flow_0dte_net: number | null;
  tide_bias: string | null;
  tide_call_premium: number | null;
  tide_put_premium: number | null;
  tide_net: number | null;
  nope: number | null;
  nope_net_delta: number | null;
  uw_iv_rank: number | null;
  regime: string;
  levels: SpxDeskLevel[];
  dark_pool: DarkPoolSnapshot | null;
  spx_flows: SpxFlowBrief[];
  unified_tape: SpxTapeItem[];
  /** UW Repeated Hits + same-strike multi-alert stacks on SPX flow. */
  strike_stacks: FlowStrikeStack[];
  net_prem_ticks: NetPremTick[];
  vix_term: {
    vix9d: number | null;
    vix3m: number | null;
    structure: string;
    detail: string;
  };
  sector_heat: Array<{ name: string; ticker: string; change_pct: number }>;
  leader_stocks: Array<{ name: string; ticker: string; change_pct: number }>;
  oi_changes: OiChangeItem[];
  iv_term_structure: IvTermPoint[];
  macro_events: MacroEvent[];
  news_headlines: DeskNewsHeadline[];
  /** Set on each API response so clients can detect fresh polls. */
  polled_at?: string;
  /** Cash RTH active (Mon–Fri 6:30 AM – 1:00 PM PT). */
  market_open?: boolean;
  market_status?: string;
  market_label?: string;
  /** Flags partial/missing index feeds so clients can surface data quality warnings. */
  data_quality?: DeskDataQuality;
  /** Milliseconds since last UW flow alert (WS or REST). Null if unknown. */
  flow_data_age_ms?: number | null;
  /** True when ANY replica delivered a UW flow WS frame within ~2m (cluster heartbeat). */
  flow_cluster_live?: boolean;
  /**
   * Age (ms) of the live SPX index tick backing `price` (gap #11). Null when no tick has
   * landed. When `feed_stalled` is true the index feed is FROZEN (TCP half-open / gateway
   * hiccup) and the price must NOT be presented as live even though it is non-zero.
   */
  price_age_ms?: number | null;
  feed_stalled?: boolean;
  /**
   * Age (ms) of the GEX strike ladder backing gex_walls / gamma_flip / gamma_regime (gap #7a),
   * and whether it is STALE (sticky last-good served during a Massive chain outage). When
   * `gex_stale` is true the walls are REAL but not live — the UI age-badges / grays them so a
   * minutes-old wall is never shown as a current node. Null age = never computed this process.
   */
  gex_age_ms?: number | null;
  gex_stale?: boolean;
  /**
   * Active trading halts on watched symbols (SPX/SPY/QQQ) — read from the
   * UW WebSocket halt store. Empty array = no active halts. Populated on every
   * pulse tick so the desk and Largo both see halt state without extra RPS.
   */
  active_halts?: Array<{ symbol: string; halt_type: string; reason: string | null }>;
  /** True when the UW trading_halts WS channel is stale (auth failure or disconnected). */
  halt_channel_stale?: boolean;
  /** Dealer gamma concentration by expiry (UW greek-exposure/expiry). */
  greek_exposure: GreekExposureSummary | null;
  /** SPX premium flow by expiry bucket. */
  flow_by_expiry: Record<string, unknown>[];
  /** Market-wide net flow by DTE bucket. */
  net_flow_by_expiry: Record<string, unknown>[];
  /** Full-market breadth from Polygon daily grouped aggs. */
  market_breadth: MarketBreadthMetrics | null;
  /** Mega-cap dealer greek flow overlay (UW group-flow/mag7). */
  mag7_greek_flow: GroupGreekFlowSummary | null;
  /** UW economy indicator snapshots (GDP, CPI, unemployment). */
  macro_indicators: UwMacroIndicatorSnapshot[];
};

export type DeskDataQuality = {
  vix_term_partial: boolean;
  missing: string[];
};

/** Fast-moving Polygon fields — merged over the full desk on the client every ~2s. */
export type SpxDeskPulse = Pick<
  SpxDeskPayload,
  | "available"
  | "price"
  | "spx_change_pct"
  | "vix"
  | "vix_change_pct"
  | "above_vwap"
  | "lod"
  | "hod"
  | "vwap"
  | "pdh"
  | "pdl"
  | "prior_close"
  | "gap_pct"
  | "gap_source"
  | "ema20"
  | "ema50"
  | "ema200"
  | "sma50"
  | "sma200"
  | "tick"
  | "trin"
  | "add"
  | "internals_estimated"
  | "regime"
  | "leader_stocks"
  | "vix_term"
  | "data_quality"
  | "market_open"
  | "market_status"
  | "market_label"
  | "price_age_ms"
  | "feed_stalled"
> & {
  polled_at: string;
  /** UW market tide — optionally pushed via SSE overlay when fresh. */
  tide_bias?: string | null;
  tide_call_premium?: number | null;
  tide_put_premium?: number | null;
  /** Active trading halts on watched symbols from the UW WS halt store. */
  active_halts?: Array<{ symbol: string; halt_type: string; reason: string | null }>;
  /** True when the UW trading_halts channel is stale (auth failure / WS down). */
  halt_channel_stale?: boolean;
};

/** UW fast lane — live tape, dark pool, 0DTE GEX walls (refreshed every ~4s). */
export type SpxDeskFlow = {
  available: boolean;
  polled_at: string;
  price: number;
  dark_pool: DarkPoolSnapshot | null;
  spx_flows: SpxFlowBrief[];
  unified_tape: SpxTapeItem[];
  gex_walls: GexWall[];
  gex_net: number | null;
  gex_king: number | null;
  gamma_flip: number | null;
  above_gamma_flip: boolean;
  gamma_regime: string;
  flow_0dte_call_premium: number | null;
  flow_0dte_put_premium: number | null;
  flow_0dte_net: number | null;
  strike_stacks: FlowStrikeStack[];
  flow_data_age_ms?: number | null;
  flow_cluster_live?: boolean;
  /** Age (ms) of the GEX ladder backing gex_walls; stale = sticky last-good (gap #7a). */
  gex_age_ms?: number | null;
  gex_stale?: boolean;
  net_prem_ticks: NetPremTick[];
  flow_by_expiry: Record<string, unknown>[];
  net_flow_by_expiry: Record<string, unknown>[];
  greek_exposure: GreekExposureSummary | null;
};

function level(
  label: string,
  value: number | null,
  price: number,
  kind: "support" | "resistance" | "neutral" = "neutral"
): SpxDeskLevel {
  return { label, value, kind, distance_pct: distancePct(price, value) };
}

function buildLevels(input: {
  price: number;
  lod: number | null;
  hod: number | null;
  vwap: number | null;
  pdh: number | null;
  pdl: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  sma50: number | null;
  sma200: number | null;
  gex_king: number | null;
  max_pain: number | null;
  gamma_flip: number | null;
}): SpxDeskLevel[] {
  const p = input.price;
  const items: SpxDeskLevel[] = [
    level("HOD", input.hod, p, "resistance"),
    level("PDH", input.pdh, p, "resistance"),
    level("GEX Anchor", input.gex_king, p, "resistance"),
    level("Max Pain", input.max_pain, p, "neutral"),
    level("γ Flip", input.gamma_flip, p, "neutral"),
    level("EMA 20", input.ema20, p, "neutral"),
    level("VWAP", input.vwap, p, "neutral"),
    level("EMA 50", input.ema50, p, "neutral"),
    level("SMA 50", input.sma50, p, "neutral"),
    level("EMA 200", input.ema200, p, "neutral"),
    level("SMA 200", input.sma200, p, "neutral"),
    level("PDL", input.pdl, p, "support"),
    level("LOD", input.lod, p, "support"),
  ].filter((l) => l.value != null);

  return items.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

function buildUnifiedTape(
  flows: SpxFlowBrief[],
  darkPool: DarkPoolSnapshot | null
): SpxTapeItem[] {
  const items: SpxTapeItem[] = [];

  for (const f of flows) {
    const type = f.option_type.toUpperCase();
    // Gap #6 residual: skip typeless ('UNKNOWN') alerts rather than fabricate a CALL side/label. The
    // tape is a directional read, and parseUwFlowAlert now emits UNKNOWN for malformed UW prints.
    if (!type.startsWith("C") && !type.startsWith("P")) continue;
    const isPut = type.startsWith("P");
    items.push({
      kind: "flow",
      side: isPut ? "put" : "call",
      time: f.alerted_at,
      label: `${isPut ? "PUT" : "CALL"} ${f.strike}`,
      // ISSUE-35: null premium from DB propagates as null typed as number. In
      // spx-signals.ts tapeSkew, `bull += t.premium` then produces NaN. Guard here.
      premium: f.premium ?? 0,
      detail: `${f.ticker} · ${f.direction}`,
    });
  }

  for (const p of darkPool?.prints ?? []) {
    items.push({
      kind: "darkpool",
      side: "neutral",
      time: p.executed_at,
      label: p.strike > 0 ? `@ ${p.strike.toFixed(0)}` : "DP",
      premium: p.premium,
      detail: p.side,
    });
  }

  return items
    .sort((a, b) => safeTime(b.time) - safeTime(a.time))
    .slice(0, 32);
}

function tapeItemKey(t: SpxTapeItem): string {
  return tapeDedupKey(t);
}

/** Rolling tape — prepend new prints instead of replacing the whole list each poll. */
function mergeTapeBuffer(prev: SpxTapeItem[], incoming: SpxTapeItem[], max = 32): SpxTapeItem[] {
  const seen = new Set<string>();
  const out: SpxTapeItem[] = [];
  for (const t of [...incoming, ...prev]) {
    const key = tapeItemKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out.sort((a, b) => safeTime(b.time) - safeTime(a.time));
}

function spxTapeMinPremium(): number {
  const raw = process.env.SPX_TAPE_MIN_PREMIUM?.trim();
  const n = raw ? Number(raw) : 50_000;
  return Number.isFinite(n) && n > 0 ? n : 50_000;
}

/** SPX tape — per-ticker UW endpoint (lower rate-limit pressure than market flow-alerts). */
async function fetchSpxDeskFlowAlerts(limit = 32): Promise<SpxFlowBrief[]> {
  if (!uwConfigured()) return lastGoodSpxFlowBriefs;

  const rows = await fetchUwTickerFlowAlerts("SPX", limit);
  if (!rows.length) return lastGoodSpxFlowBriefs;

  const mapped = rows.map((f) => ({
    ticker: f.ticker,
    premium: f.premium,
    option_type: f.option_type,
    strike: f.strike,
    expiry: f.expiry,
    direction: f.direction,
    alerted_at: f.alerted_at,
    alert_rule: f.alert_rule,
    trade_count: f.trade_count,
    has_sweep: f.has_sweep,
  }));
  lastGoodSpxFlowBriefs = mapped;
  return mapped;
}

// ISSUE-27: Both buildSpxDesk and buildSpxDeskFlow call fetchSpxDeskFlowAlertsWithDb(32)
// independently. Deduplicate with a short-lived in-flight promise (10s window) so
// concurrent callers share one UW round-trip per interval.
let _flowAlertsInFlight: Promise<SpxFlowBrief[]> | null = null;
let _flowAlertsFetchedAt = 0;
const FLOW_ALERTS_DEDUP_MS = 10_000;

async function fetchSpxDeskFlowAlertsWithDb(limit = 32): Promise<SpxFlowBrief[]> {
  const now = Date.now();
  if (_flowAlertsInFlight && now - _flowAlertsFetchedAt < FLOW_ALERTS_DEDUP_MS) {
    return _flowAlertsInFlight;
  }
  _flowAlertsFetchedAt = now;
  _flowAlertsInFlight = _fetchSpxDeskFlowAlertsWithDbInner(limit).finally(() => {
    _flowAlertsInFlight = null;
  });
  return _flowAlertsInFlight;
}

async function _fetchSpxDeskFlowAlertsWithDbInner(limit = 32): Promise<SpxFlowBrief[]> {
  // DB (local, fast) and UW REST run in parallel — never serialize a slow UW round-trip
  // ahead of Postgres. The tape must be RECENCY-ordered (not premium-ordered): premium sort
  // was returning ancient whale prints and making flow_data_age_ms read 20m+ stale during RTH.
  const [fromUw, fromDbRows] = await Promise.all([
    fetchSpxDeskFlowAlerts(limit).catch(() => [] as SpxFlowBrief[]),
    dbConfigured()
      ? fetchRecentFlows({
          limit,
          min_premium: spxTapeMinPremium(),
          order: "recent",
          since_hours: 4,
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  if (!dbConfigured()) return fromUw;

  try {
    const spxDb = fromDbRows
      .filter((f) => {
        const t = f.ticker.toUpperCase();
        return t === "SPX" || t === "SPXW";
      })
      .map((f) => ({
        ticker: f.ticker,
        premium: f.premium,
        option_type: f.option_type,
        strike: f.strike,
        expiry: f.expiry,
        direction: f.direction,
        alerted_at: f.alerted_at,
        alert_rule: null,
        trade_count: null,
        has_sweep: false,
      }));

    const merged = [...fromUw, ...spxDb].sort(
      (a, b) => new Date(b.alerted_at).getTime() - new Date(a.alerted_at).getTime()
    );
    const seen = new Set<string>();
    const out: SpxFlowBrief[] = [];
    for (const f of merged) {
      const key = `${f.ticker}|${f.alerted_at}|${f.strike}|${f.option_type}|${f.premium}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return fromUw;
  }
}

function emptyPayload(asOf: string): SpxDeskPayload {
  return {
    available: false,
    as_of: asOf,
    source: "none",
    price: 0,
    spx_change_pct: 0,
    vix: null,
    vix_change_pct: null,
    above_vwap: false,
    lod: null,
    hod: null,
    vwap: null,
    pdh: null,
    pdl: null,
    prior_close: null,
    gap_pct: null,
    gap_source: null,
    ema20: null,
    ema50: null,
    ema200: null,
    sma50: null,
    sma200: null,
    tick: null,
    trin: null,
    add: null,
    internals_estimated: { tick: false, trin: false, add: false },
    gex_net: null,
    gex_king: null,
    max_pain: null,
    gamma_flip: null,
    above_gamma_flip: false,
    gamma_regime: "unknown",
    gex_walls: [],
    flow_0dte_call_premium: null,
    flow_0dte_put_premium: null,
    flow_0dte_net: null,
    tide_bias: null,
    tide_call_premium: null,
    tide_put_premium: null,
    tide_net: null,
    nope: null,
    nope_net_delta: null,
    uw_iv_rank: null,
    regime: "unknown",
    levels: [],
    dark_pool: null,
    spx_flows: [],
    unified_tape: [],
    strike_stacks: [],
    net_prem_ticks: [],
    vix_term: { vix9d: null, vix3m: null, structure: "unknown", detail: "" },
    data_quality: { vix_term_partial: false, missing: [] },
    sector_heat: [],
    leader_stocks: [],
    oi_changes: [],
    iv_term_structure: [],
    macro_events: [],
    news_headlines: [],
    greek_exposure: null,
    flow_by_expiry: [],
    net_flow_by_expiry: [],
    market_breadth: null,
    mag7_greek_flow: null,
    macro_indicators: [],
  };
}

export async function buildSpxDesk(): Promise<SpxDeskPayload> {
  const asOf = new Date().toISOString();
  const empty = emptyPayload(asOf);

  if (!polygonConfigured()) return empty;

  const { ensureDataSockets } = await import("../ws/init-data-sockets");
  ensureDataSockets();

  const today = todayEtYmd();
  const fromWeek = priorEtYmd(10);

  const intelPromise = engineIntelOverlayEnabled()
    ? fetchEngine<Record<string, unknown>>("/spx/state").catch(() => null)
    : Promise.resolve(null);

  const [
    snapsRaw,
    minuteBars,
    dailyBars,
    ema20,
    ema50,
    ema200,
    sma50,
    sma200,
    breadthAll,
    newsRaw,
    intel,
  ] = await Promise.all([
    fetchIndexSnapshots([SPX, VIX, VIX9D, VIX3M, TICK, TRIN, ADD]),
    fetchIndexMinuteBars(SPX, today, today).catch(() => []),
    fetchIndexDailyBars(SPX, fromWeek, today),
    fetchIndexEma(SPX, 20, "day"),
    fetchIndexEma(SPX, 50, "day"),
    fetchIndexEma(SPX, 200, "day"),
    fetchIndexSma(SPX, 50, "day"),
    fetchIndexSma(SPX, 200, "day"),
    serverCache("breadth-universe", 60_000, () => fetchBreadthUniverseSnapshots()).catch(() => []),
    // Cache the market-wide Benzinga news so concurrent desk builds and other consumers
    // (Largo live feed, Night's Watch, etc.) share one upstream pull per window.
    // TTL matches TTL.NEWS (2 min). fetchBenzingaNews is itself idempotent / GET-only.
    serverCache("bz:news:market", 120_000, () => fetchBenzingaNews(15)).catch(() => []),
    intelPromise,
  ]);

  const snaps = mergeWsIndexSnapshots(snapsRaw);

  const spxSnap = snaps[SPX];
  const vixSnap = snaps[VIX];
  if (!spxSnap?.price) return empty;

  const price = spxSnap.price;
  // Gap #11: liveness of the SPX index tick backing `price`. A frozen WS feed (TCP half-open)
  // shows a non-zero-but-stale price; surface its age + stall so the UI never labels it live.
  const spxFeed = getIndexFeedFreshness(SPX);

  const [canonicalGex, polygonIvRank] = await Promise.all([
    resolveCanonicalDeskGex(price),
    fetchVixIvRankPercentile(),
  ]);

  // Polygon is the sole GEX source — uwGex slot removed (UW spot-exposures are 503).
  const uwExclusive = uwConfigured()
    ? await runUwSequential([
        () => resolveMarketTide(),
        () => fetchUwNope("SPX").catch(() => null),
        () => resolveFlow0dte("SPX"),
        () => resolveDarkPool("SPX", { limit: 20, min_premium: 500_000 }),
        () =>
          canonicalGex.max_pain != null
            ? Promise.resolve(null)
            : fetchUwMaxPain("SPX").catch(() => null),
        () => (polygonIvRank != null ? Promise.resolve(null) : fetchUwIvRank("SPX").catch(() => null)),
      ])
    : [null, null, null, null, null, null];

  const [uwTide, uwNope, uwFlow, darkPool, uwMaxPain, uwIv] = uwExclusive;
  let maxPain = canonicalGex.max_pain ?? uwMaxPain ?? null;

  const session = sessionStatsFromMinuteBars(minuteBars);
  const prior = priorDayFromDailyBars(dailyBars);
  const vwap = session.vwap ?? (intel?.vwap as number | null) ?? null;
  const lod = session.lod ?? (intel?.lod as number | null) ?? null;
  const hod = session.hod ?? (intel?.hod as number | null) ?? null;

  const gammaFlip =
    (intel?.gamma_flip as number | null) ?? canonicalGex.gamma_flip ?? lastGoodGammaFlip ?? null;
  const aboveFlip = gammaFlip != null ? price > gammaFlip : false;
  const gammaRegimeLabel =
    canonicalGex.gamma_regime !== "unknown"
      ? canonicalGex.gamma_regime
      : lastGoodGammaRegime;
  const finalWalls = canonicalGex.gex_walls;
  const gexAgeMs = canonicalGex.gex_age_ms;
  const gexStale = canonicalGex.gex_stale;

  // Canonical matrix is the sole GEX source — no 0DTE recompute.
  const gexNet = (intel?.gex_net as number | null) ?? canonicalGex.gex_net ?? null;
  const gexKing = (intel?.gex_king as number | null) ?? canonicalGex.gex_king ?? null;
  maxPain = (intel?.max_pain as number | null) ?? maxPain ?? null;

  const regime =
    (intel?.chart_levels as { regime?: string } | undefined)?.regime ??
    inferRegime(price, ema20, ema50);

  const vixTerm = computeVixTermStructure(
    vixSnap?.price ?? null,
    snaps[VIX9D]?.price ?? null,
    snaps[VIX3M]?.price ?? null
  );
  const dataQuality = buildDeskDataQuality(snaps, vixTerm);

  // Fetch fresh flows for the full desk (same as flow lane) so commentary/play engine gets live tape.
  // 2s hard cap — slow UW must not stall the desk build; sticky fallback covers the gap.
  const freshFlowsRaw = uwConfigured()
    ? await Promise.race([
        fetchSpxDeskFlowAlertsWithDb(32),
        new Promise<SpxFlowBrief[]>((resolve) => setTimeout(() => resolve([]), 6000)),
      ]).catch(() => [])
    : [];
  const spxFlows: SpxFlowBrief[] = freshFlowsRaw.length ? freshFlowsRaw : lastGoodSpxFlowBriefs;
  if (freshFlowsRaw.length) lastGoodSpxFlowBriefs = freshFlowsRaw;
  const flowClusterLive = await isFlowFrameFreshAnywhere(120_000).catch(() => false);
  markFlowDataFromBriefs(spxFlows);
  const freshTape = buildUnifiedTape(spxFlows, darkPool);
  if (freshTape.length) lastGoodUnifiedTape = mergeTapeBuffer(lastGoodUnifiedTape, freshTape);
  const unifiedTape = lastGoodUnifiedTape.length ? lastGoodUnifiedTape : freshTape;

  const newsHeadlines: DeskNewsHeadline[] = (newsRaw ?? [])
    .map((a) => ({
      title: a.title,
      published: a.published,
      tickers: a.tickers ?? [],
    }))
    .filter((n) => n.title)
    .sort((a, b) => {
      const relevant = (tickers: string[]) =>
        tickers.some((t) => /SPX|SPY|VIX|QQQ|\bES\b/i.test(t)) ? 1 : 0;
      return relevant(b.tickers) - relevant(a.tickers);
    })
    .slice(0, 10);

  // PERF (auto/performance-2026-06-26): macro events, the desk gap snapshot and the
  // daily-market/prior-closes pair are mutually independent reads — run them concurrently
  // instead of three sequential awaits so the (blocking, SWR-off) desk rebuild spends
  // max(t) not sum(t) on this stretch. The sync breadth/internals derivations don't depend
  // on any of them, so they stay inline above the concurrent fetch. Semantics unchanged:
  // identical results, and a throw from macro/gap still aborts the build exactly as before.
  const leaderStocks = leaderStocksFromBreadth(breadthAll ?? []);
  const sectorHeat = (breadthAll ?? []).filter((s) => !LEADER_TICKERS.has(s.ticker));
  const internals = resolveMarketInternals(
    {
      tick: snaps[TICK]?.price ?? (intel?.tick as number | null) ?? null,
      trin: snaps[TRIN]?.price ?? (intel?.trin as number | null) ?? null,
      add: snaps[ADD]?.price ?? null,
    },
    breadthAll ?? []
  );

  const [macroEventsResolved, gapSnap, [dailyMarket, priorCloses]] = await Promise.all([
    mergeMacroEventsToday({ headlines: newsHeadlines }),
    resolveDeskGap({
      spx_price: price,
      prior_close: prior.pdc,
      premarket: isPremarketPlanningWindow(),
    }),
    Promise.all([
      fetchDailyMarketSummary(today).catch(() => null),
      fetchPriorDayCloses(today).catch(() => ({})),
    ]),
  ]);

  const [greekExpRows, flowByExpiry, netFlowByExpiry, netPremTicks, mag7Rows, macroIndicators] = uwConfigured()
    ? await runUwSequential([
        () => fetchUwGreekExposureExpiry("SPX").catch(() => []),
        () => fetchUwFlowPerExpiry("SPX", 12).catch(() => []),
        () => fetchUwNetFlowExpiry(20).catch(() => []),
        () => fetchUwNetPremTicks("SPY").catch(() => []),
        () => fetchUwGroupGreekFlow("mag7").catch(() => []),
        () => fetchUwMacroIndicators().catch(() => []),
      ])
    : [[], [], [], [], [], []];

  const greekExposure = summarizeGreekExposureByExpiry(
    greekExpRows as Record<string, unknown>[],
    today
  );
  const mag7GreekFlow = summarizeGroupGreekFlow(
    "mag7",
    mag7Rows as Record<string, unknown>[]
  );
  const marketBreadth = dailyMarket?.results?.length
    ? computeMarketBreadthFromSummary(dailyMarket.results, priorCloses)
    : null;

  const levels = buildLevels({
    price,
    lod,
    hod,
    vwap,
    pdh: prior.pdh,
    pdl: prior.pdl,
    ema20,
    ema50,
    ema200,
    sma50,
    sma200,
    gex_king: gexKing,
    max_pain: maxPain,
    gamma_flip: gammaFlip,
  });

  return {
    available: true,
    as_of: asOf,
    source: intel?.available ? "merged" : uwConfigured() ? "polygon+uw-flow" : "polygon",
    price,
    spx_change_pct: spxSnap.change_pct,
    vix: vixSnap?.price ?? (intel?.vix as number | null) ?? null,
    vix_change_pct: vixSnap?.change_pct ?? (intel?.vix_change_pct as number | null) ?? null,
    above_vwap: vwap != null ? price >= vwap : false,
    lod,
    hod,
    vwap,
    pdh: prior.pdh,
    pdl: prior.pdl,
    prior_close: prior.pdc,
    gap_pct: gapSnap.gap_pct,
    gap_source: gapSnap.gap_source,
    ema20,
    ema50,
    ema200,
    sma50,
    sma200,
    tick: internals.tick,
    trin: internals.trin,
    add: internals.add,
    internals_estimated: internals.estimated,
    gex_net: gexNet,
    gex_king: gexKing,
    max_pain: maxPain,
    gamma_flip: gammaFlip,
    above_gamma_flip: aboveFlip,
    gamma_regime: gammaRegimeLabel,
    gex_walls: finalWalls,
    flow_0dte_call_premium:
      (intel?.flow_0dte_call_premium as number | null) ?? uwFlow?.call_premium ?? null,
    flow_0dte_put_premium:
      (intel?.flow_0dte_put_premium as number | null) ?? uwFlow?.put_premium ?? null,
    flow_0dte_net: (intel?.flow_0dte_net as number | null) ?? uwFlow?.net ?? null,
    tide_bias: (intel?.tide_bias as string | null) ?? uwTide?.bias ?? null,
    tide_call_premium: uwTide?.call_premium ?? null,
    tide_put_premium: uwTide?.put_premium ?? null,
    tide_net: uwTide?.net ?? null,
    nope: (intel?.nope as { nope?: number } | null)?.nope ?? uwNope?.nope ?? null,
    nope_net_delta: uwNope?.net_delta ?? null,
    uw_iv_rank: (intel?.uw_iv_rank as number | null) ?? polygonIvRank ?? uwIv ?? null,
    regime: String(regime),
    levels,
    dark_pool: darkPool,
    spx_flows: spxFlows,
    unified_tape: unifiedTape,
    strike_stacks: computeFlowStrikeStacks(spxFlows),
    net_prem_ticks: netPremTicks,
    vix_term: {
      vix9d: vixTerm.vix9d,
      vix3m: vixTerm.vix3m,
      structure: vixTerm.structure,
      detail: vixTerm.detail,
    },
    data_quality: dataQuality,
    flow_data_age_ms: resolveFlowDataAgeMs(spxFlows),
    flow_cluster_live: flowClusterLive,
    price_age_ms: spxFeed.ageMs,
    feed_stalled: spxFeed.stalled === true,
    gex_age_ms: gexAgeMs,
    gex_stale: gexStale,
    sector_heat: sectorHeat,
    leader_stocks: leaderStocks ?? [],
    oi_changes: [],
    iv_term_structure: [],
    macro_events: macroEventsResolved,
    news_headlines: newsHeadlines,
    greek_exposure: greekExposure,
    flow_by_expiry: flowByExpiry,
    net_flow_by_expiry: netFlowByExpiry,
    market_breadth: marketBreadth,
    mag7_greek_flow: mag7GreekFlow,
    macro_indicators: macroIndicators,
  };
}

async function fetchPriorDayCached(): Promise<{
  pdh: number | null;
  pdl: number | null;
  pdc: number | null;
}> {
  const now = Date.now();
  if (now - cachedPriorDay.fetchedAt < 60_000 && cachedPriorDay.pdh != null) {
    return { pdh: cachedPriorDay.pdh, pdl: cachedPriorDay.pdl, pdc: cachedPriorDay.pdc };
  }
  const today = todayEtYmd();
  const bars = await fetchIndexDailyBars(SPX, priorEtYmd(10), today).catch(() => []);
  const prior = priorDayFromDailyBars(bars);
  cachedPriorDay = { pdh: prior.pdh, pdl: prior.pdl, pdc: prior.pdc, fetchedAt: now };
  return { pdh: prior.pdh, pdl: prior.pdl, pdc: prior.pdc };
}

/** EMAs / VWAP / HOD/LOD — refreshed on a slower cadence so 1s pulse stays light. */
async function refreshPulseStructureIfNeeded(today: string): Promise<PulseStructureCache> {
  const now = Date.now();
  const ttl = deskPulseStructureCacheTtlMs();
  if (cachedPulseStructure.fetchedAt > 0 && now - cachedPulseStructure.fetchedAt < ttl) {
    return cachedPulseStructure;
  }

  const [minuteBars, ema20, ema50, ema200, sma50, sma200, breadthAll] =
    await Promise.all([
      fetchIndexMinuteBars(SPX, today, today).catch(() => []),
      fetchIndexEma(SPX, 20, "day"),
      fetchIndexEma(SPX, 50, "day"),
      fetchIndexEma(SPX, 200, "day"),
      fetchIndexSma(SPX, 50, "day"),
      fetchIndexSma(SPX, 200, "day"),
      serverCache("breadth-universe", 60_000, () => fetchBreadthUniverseSnapshots()).catch(() => []),
    ]);

  const session = sessionStatsFromMinuteBars(minuteBars);
  const leaderStocks = leaderStocksFromBreadth(breadthAll ?? []);
  cachedPulseStructure = {
    fetchedAt: now,
    lod: session.lod,
    hod: session.hod,
    vwap: session.vwap ?? null,
    ema20,
    ema50,
    ema200,
    sma50,
    sma200,
    leader_stocks: leaderStocks,
    breadth_samples: breadthAll ?? [],
  };
  return cachedPulseStructure;
}

function gexSnapshotForPrice(price: number) {
  const gammaFlip = lastGoodGammaFlip;
  const walls = topGexWalls(lastGoodStrikeLevels, price, GEX_WALL_LADDER_LIMIT);
  const finalWalls = walls.length ? walls : lastGoodGexWalls;
  const gRegime = gammaRegime(price, gammaFlip);
  return {
    gamma_flip: gammaFlip,
    above_gamma_flip: gammaFlip != null ? price > gammaFlip : false,
    gamma_regime: gRegime !== "unknown" ? gRegime : lastGoodGammaRegime,
    gex_walls: finalWalls,
  };
}

/** Polygon-only fast lane — 1s price tick + slower structure refresh. */
export async function buildSpxDeskPulse(): Promise<SpxDeskPulse> {
  const { ensureDataSockets } = await import("../ws/init-data-sockets");
  ensureDataSockets();
  const polledAt = new Date().toISOString();
  const empty: SpxDeskPulse = {
    available: false,
    polled_at: polledAt,
    price: 0,
    spx_change_pct: 0,
    vix: null,
    vix_change_pct: null,
    above_vwap: false,
    lod: null,
    hod: null,
    vwap: null,
    pdh: null,
    pdl: null,
    prior_close: null,
    gap_pct: null,
    gap_source: null,
    ema20: null,
    ema50: null,
    ema200: null,
    sma50: null,
    sma200: null,
    tick: null,
    trin: null,
    add: null,
    internals_estimated: { tick: false, trin: false, add: false },
    regime: "unknown",
    leader_stocks: [],
    vix_term: { vix9d: null, vix3m: null, structure: "unknown", detail: "" },
    data_quality: { vix_term_partial: false, missing: [] },
    market_open: false,
    market_status: "closed",
    market_label: "CLOSED",
  };

  if (!polygonConfigured()) return empty;

  const marketNow = await fetchMarketStatusNow();
  const now = new Date();
  const premarketPlan = isPremarketPlanningWindow(now);
  const rthOpen = isSpxRthActive(now, marketNow);
  const label = marketStatusLabel(now, marketNow);

  if (!rthOpen && !premarketPlan) {
    const closedPulse: SpxDeskPulse = {
      ...empty,
      market_open: false,
      market_status: marketNow?.market ?? "closed",
      market_label: label,
    };
    lastPulseForSignals = closedPulse;
    return closedPulse;
  }

  const today = todayEtYmd();
  const [snapsRaw, prior, structure] = await Promise.all([
    fetchIndexSnapshots([SPX, VIX, VIX9D, VIX3M, TICK, TRIN, ADD]),
    fetchPriorDayCached(),
    refreshPulseStructureIfNeeded(today),
  ]);
  const snaps = mergeWsIndexSnapshots(snapsRaw);

  const spxSnap = snaps[SPX];
  const vixSnap = snaps[VIX];
  if (!spxSnap?.price) return empty;

  const price = spxSnap.price;
  // Gap #11: liveness of the SPX index tick on the FAST lane (the price the desk shows as live).
  const spxFeed = getIndexFeedFreshness(SPX);
  const vwap = structure.vwap;
  // Audit gap #14 (truth mandate): when there is NO real session extreme yet (empty minute
  // bars early in RTH, or no prior-day bar in premarket), return null — NOT spot. Seeding
  // HOD/LOD from the live price renders a fabricated extreme that looks like a real level.
  // Premarket uses the prior day's high/low when present; RTH uses the live session extreme;
  // both fall to null (→ UI shows 'unavailable') rather than the current price.
  const lod = premarketPlan && !rthOpen ? prior.pdl ?? null : structure.lod ?? null;
  const hod = premarketPlan && !rthOpen ? prior.pdh ?? null : structure.hod ?? null;
  const ema20 = structure.ema20;
  const ema50 = structure.ema50;
  const vixTerm = computeVixTermStructure(
    vixSnap?.price ?? null,
    snaps[VIX9D]?.price ?? null,
    snaps[VIX3M]?.price ?? null
  );
  const dataQuality = buildDeskDataQuality(snaps, vixTerm);

  const internals = resolveMarketInternals(
    {
      tick: snaps[TICK]?.price ?? null,
      trin: snaps[TRIN]?.price ?? null,
      add: snaps[ADD]?.price ?? null,
    },
    structure.breadth_samples
  );

  const gapSnap = await resolveDeskGap({
    spx_price: price,
    prior_close: prior.pdc,
    premarket: premarketPlan && !rthOpen,
  });

  const result: SpxDeskPulse = {
    available: true,
    polled_at: polledAt,
    price,
    spx_change_pct: spxSnap.change_pct,
    vix: vixSnap?.price ?? null,
    vix_change_pct: vixSnap?.change_pct ?? null,
    above_vwap: vwap != null ? price >= vwap : false,
    lod,
    hod,
    vwap,
    pdh: prior.pdh,
    pdl: prior.pdl,
    prior_close: prior.pdc,
    gap_pct: gapSnap.gap_pct,
    gap_source: gapSnap.gap_source,
    ema20,
    ema50,
    ema200: structure.ema200,
    sma50: structure.sma50,
    sma200: structure.sma200,
    tick: internals.tick,
    trin: internals.trin,
    add: internals.add,
    internals_estimated: internals.estimated,
    regime: String(inferRegime(price, ema20, ema50)),
    leader_stocks: structure.leader_stocks,
    vix_term: {
      vix9d: vixTerm.vix9d,
      vix3m: vixTerm.vix3m,
      structure: vixTerm.structure,
      detail: vixTerm.detail,
    },
    data_quality: dataQuality,
    price_age_ms: spxFeed.ageMs,
    feed_stalled: spxFeed.stalled === true,
    market_open: rthOpen,
    market_status: premarketPlan && !rthOpen ? "premarket" : marketNow?.market ?? "open",
    market_label: premarketPlan && !rthOpen ? "PRE-MARKET" : label,
    // Trading halt store — in-process cache read, zero extra RPS.
    active_halts: getActiveTradingHalts().map((h) => ({
      symbol: h.symbol,
      halt_type: h.halt_type,
      reason: h.reason,
    })),
    halt_channel_stale: isTradingHaltChannelStale(),
  };
  lastPulseForSignals = result;
  return result;
}

/** UW flow lane — GEX strike ladder, live tape, dark pool (~4s). */
export async function buildSpxDeskFlow(): Promise<SpxDeskFlow> {
  const { ensureDataSockets } = await import("../ws/init-data-sockets");
  ensureDataSockets();
  await syncDeskStickyFromRedis();
  const polledAt = new Date().toISOString();
  const empty: SpxDeskFlow = {
    available: false,
    polled_at: polledAt,
    price: 0,
    dark_pool: null,
    spx_flows: [],
    unified_tape: [],
    gex_walls: [],
    gex_net: null,
    gex_king: null,
    gamma_flip: null,
    above_gamma_flip: false,
    gamma_regime: "unknown",
    flow_0dte_call_premium: null,
    flow_0dte_put_premium: null,
    flow_0dte_net: null,
    strike_stacks: [],
    net_prem_ticks: [],
    flow_by_expiry: [],
    net_flow_by_expiry: [],
    greek_exposure: null,
  };

  // Use Polygon market status for holiday-aware guard (matches pulse lane behavior).
  const flowMarketNow = polygonConfigured() ? await fetchMarketStatusNow() : null;
  const flowNow = new Date();
  if (!isSpxRthActive(flowNow, flowMarketNow) && !isPremarketPlanningWindow(flowNow)) return empty;

  // PERF (auto/performance-2026-06-26): the Polygon index snapshot and the UW flow-alerts
  // pull are independent providers — fetch them concurrently rather than one-then-the-other
  // so the ~4s live flow lane doesn't serialize a Polygon round-trip in front of the UW one.
  const [spxSnapRaw, spxFlowsRaw] = await Promise.all([
    polygonConfigured()
      ? fetchIndexSnapshots([SPX]).then((m) => mergeWsIndexSnapshots(m)[SPX])
      : Promise.resolve(null),
    uwConfigured() ? fetchSpxDeskFlowAlertsWithDb(32) : Promise.resolve([] as SpxFlowBrief[]),
  ]);

  const [darkPool, uwFlow, greekExpRows, flowByExpiry, netFlowByExpiry, netPremTicks] = uwConfigured()
    ? await runUwSequential([
        () => resolveDarkPool("SPX", { limit: 20, min_premium: 500_000 }),
        () => resolveFlow0dte("SPX"),
        () => fetchUwGreekExposureExpiry("SPX").catch(() => []),
        () => fetchUwFlowPerExpiry("SPX", 12).catch(() => []),
        () => fetchUwNetFlowExpiry(20).catch(() => []),
        () => fetchUwNetPremTicks("SPY").catch(() => []),
      ])
    : [null, null, [], [], [], []];

  const spxSnap = spxSnapRaw;
  const price = spxSnap?.price ?? 0;
  if (!price && !spxFlowsRaw.length) return empty;

  const canonicalGex = price > 0 ? await resolveCanonicalDeskGex(price) : stickyDeskGexFallback(0);

  const spxFlows: SpxFlowBrief[] = spxFlowsRaw ?? [];
  if (spxFlows.length) lastGoodSpxFlowBriefs = spxFlows;
  const flowClusterLive = await isFlowFrameFreshAnywhere(120_000).catch(() => false);
  markFlowDataFromBriefs(spxFlows);
  const strike_stacks = computeFlowStrikeStacks(spxFlows);

  const freshTape = buildUnifiedTape(spxFlows, darkPool);
  if (freshTape.length) {
    lastGoodUnifiedTape = mergeTapeBuffer(lastGoodUnifiedTape, freshTape);
  }
  const unifiedTape = lastGoodUnifiedTape.length ? lastGoodUnifiedTape : freshTape;

  const spot = price || spxSnap?.price || 0;

  publishDeskStickyToRedis();

  const greekExposure = summarizeGreekExposureByExpiry(
    greekExpRows as Record<string, unknown>[],
    todayEtYmd()
  );

  return {
    available: spot > 0,
    polled_at: polledAt,
    price: spot,
    dark_pool: darkPool,
    spx_flows: spxFlows,
    unified_tape: unifiedTape,
    strike_stacks,
    gex_walls: canonicalGex.gex_walls,
    gex_net: canonicalGex.gex_net,
    gex_king: canonicalGex.gex_king,
    gamma_flip: canonicalGex.gamma_flip,
    above_gamma_flip: canonicalGex.above_gamma_flip,
    gamma_regime: canonicalGex.gamma_regime,
    flow_0dte_call_premium: uwFlow?.call_premium ?? null,
    flow_0dte_put_premium: uwFlow?.put_premium ?? null,
    flow_0dte_net: uwFlow?.net ?? null,
    flow_data_age_ms: resolveFlowDataAgeMs(spxFlows),
    flow_cluster_live: flowClusterLive,
    gex_age_ms: canonicalGex.gex_age_ms,
    gex_stale: canonicalGex.gex_stale,
    net_prem_ticks: netPremTicks,
    flow_by_expiry: flowByExpiry,
    net_flow_by_expiry: netFlowByExpiry,
    greek_exposure: greekExposure,
  };
}
