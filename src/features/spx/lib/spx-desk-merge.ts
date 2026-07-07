/**
 * Client-safe desk merge — do NOT import spx-desk.ts from client components
 * (it pulls Polygon/UW server providers into the browser bundle).
 */
import type { SpxDeskLevel, SpxDeskPayload, SpxDeskPulse, SpxDeskFlow, SpxTapeItem } from "@/features/spx/lib/spx-desk";
import type { GexWall } from "@/lib/providers/gamma-desk";
import { todayEtYmd, distancePct, widenSessionExtremesWithSpot } from "@/lib/providers/spx-session";
import { computeFlowStrikeStacks } from "@/lib/largo/flow-strike-stacks";
import { safeTime } from "@/lib/safe-time";
import { tapeDedupKey } from "@/lib/tape-dedup-key";

export function recalcGexWallDistances(walls: GexWall[], spot: number): GexWall[] {
  if (!walls.length || spot <= 0) return walls;
  return walls.map((w) => ({
    ...w,
    // Recompute kind alongside distance so a price crossing flips support/resistance
    // (matches topGexWalls: strike <= spot is support, strike > spot is resistance).
    kind: w.strike > spot ? "resistance" : "support",
    distance_pts: Math.round((w.strike - spot) * 100) / 100,
  }));
}

export function mergeTapeItems(
  incoming: SpxTapeItem[],
  prev: SpxTapeItem[],
  max = 32
): SpxTapeItem[] {
  const seen = new Set<string>();
  const out: SpxTapeItem[] = [];
  for (const t of [...incoming, ...prev]) {
    const key = tapeDedupKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  // Sort by time descending (newest prints first) with premium as tiebreaker, so the live
  // tape reflects real tape order instead of a static premium ranking that looks frozen
  // during fast prints (matches the server-side time-sort in the flows feed).
  return out.sort((a, b) => {
    const timeDiff = safeTime(b.time) - safeTime(a.time);
    if (timeDiff !== 0) return timeDiff;
    return (b.premium ?? 0) - (a.premium ?? 0);
  });
}

export function flowAlertToTapeItem(alert: {
  ticker: string;
  premium: number;
  option_type: string;
  strike: number;
  direction: string;
  alerted_at: string;
}): SpxTapeItem {
  const isPut = alert.option_type.toUpperCase().startsWith("P");
  return {
    kind: "flow",
    side: isPut ? "put" : "call",
    time: alert.alerted_at,
    label: `${isPut ? "PUT" : "CALL"} ${alert.strike}`,
    premium: alert.premium,
    detail: `${alert.ticker} | ${alert.direction}`,
  };
}

function level(
  label: string,
  value: number | null,
  price: number,
  kind: "support" | "resistance" | "neutral" = "neutral"
): SpxDeskLevel {
  return { label, value, kind, distance_pct: distancePct(price, value) };
}

/** Sticky session structure — pulse gaps must not drop HOD/PDH/VWAP from the desk. */
// ISSUE-22: TTL is session-date-based (not time-based) so the cache persists through
// the entire trading session and only resets at the session boundary, preventing a
// 1-2 poll cycle VWAP/EMA gap during active trading.
const STRUCTURE_REDIS_KEY = "desk:sticky:merge_structure";
const STRUCTURE_REDIS_TTL_SEC = 2 * 60 * 60; // 2 hours

const lastGoodStructure: {
  hod: number | null;
  lod: number | null;
  pdh: number | null;
  pdl: number | null;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  sma50: number | null;
  sma200: number | null;
} = {
  hod: null,
  lod: null,
  pdh: null,
  pdl: null,
  vwap: null,
  ema20: null,
  ema50: null,
  ema200: null,
  sma50: null,
  sma200: null,
};

let lastGoodStructureSessionDate: string | null = null;
let lastGoodStructureAt = 0;

export function resetSpxDeskMergeCache(): void {
  (Object.keys(lastGoodStructure) as Array<keyof typeof lastGoodStructure>).forEach((key) => {
    lastGoodStructure[key] = null;
  });
  lastGoodStructureSessionDate = null;
  lastGoodStructureAt = 0;
}

/** C7: Load structure from Redis so workers that haven't run a full desk build
 *  can still serve non-null VWAP/HOD/LOD/EMAs (cross-instance sticky state). */
async function loadStructureFromRedis(): Promise<void> {
  if (!process.env.REDIS_URL?.trim()) return;
  try {
    const { sharedCacheGet } = await import("@/lib/shared-cache");
    const saved = await sharedCacheGet<{
      data: typeof lastGoodStructure;
      sessionDate: string;
    }>(STRUCTURE_REDIS_KEY);
    if (saved && saved.sessionDate === todayEtYmd()) {
      (Object.keys(lastGoodStructure) as Array<keyof typeof lastGoodStructure>).forEach((key) => {
        if (lastGoodStructure[key] == null && saved.data[key] != null) {
          lastGoodStructure[key] = saved.data[key];
        }
      });
      if (lastGoodStructureAt === 0) lastGoodStructureAt = Date.now();
      if (lastGoodStructureSessionDate == null) lastGoodStructureSessionDate = saved.sessionDate;
    }
  } catch {
    // keep in-process state on Redis failure
  }
}

/** C7: Fire-and-forget — persist local structure to Redis for other workers. */
function publishStructureToRedis(): void {
  if (!process.env.REDIS_URL?.trim()) return;
  void import("@/lib/shared-cache")
    .then(({ sharedCacheSet }) =>
      sharedCacheSet(
        STRUCTURE_REDIS_KEY,
        { data: { ...lastGoodStructure }, sessionDate: todayEtYmd() },
        STRUCTURE_REDIS_TTL_SEC
      )
    )
    .catch(() => {
      /* best-effort cross-instance sticky state — never throw into the hot path */
    });
}

function ensureStructureCacheFresh(): void {
  const today = todayEtYmd();
  // ISSUE-22: Reset only on session-date change, not on time-based TTL.
  // This avoids a 1-2 poll gap in VWAP/EMA signals during active trading.
  if (lastGoodStructureSessionDate != null && lastGoodStructureSessionDate !== today) {
    resetSpxDeskMergeCache();
    lastGoodStructureSessionDate = today;
    return;
  }
  if (lastGoodStructureSessionDate == null) {
    lastGoodStructureSessionDate = today;
  }
}

function seedStructureCacheFromBase(base: {
  hod: number | null;
  lod: number | null;
  pdh: number | null;
  pdl: number | null;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  sma50: number | null;
  sma200: number | null;
}): void {
  // C7: If local structure is entirely null (worker that hasn't run a full desk build),
  // attempt to load from Redis before seeding from base. Fire-and-forget async load;
  // subsequent calls will pick up the Redis-populated values.
  const localIsEmpty = (Object.keys(lastGoodStructure) as Array<keyof typeof lastGoodStructure>)
    .every((k) => lastGoodStructure[k] == null);
  if (localIsEmpty) {
    void loadStructureFromRedis();
  }

  let updated = false;
  (Object.keys(lastGoodStructure) as Array<keyof typeof lastGoodStructure>).forEach((key) => {
    const val = base[key];
    if (lastGoodStructure[key] == null && val != null) {
      lastGoodStructure[key] = val;
      updated = true;
    }
  });
  if (updated) publishStructureToRedis();
}

function stickyStructureLevel(
  key: keyof typeof lastGoodStructure,
  pulseVal: number | null | undefined,
  baseVal: number | null | undefined,
  livePrice?: number
): number | null {
  ensureStructureCacheFresh();
  let next: number | null;
  if (key === "hod" || key === "lod") {
    const candidates: number[] = [];
    for (const v of [pulseVal, baseVal, lastGoodStructure[key], livePrice]) {
      if (v != null && Number.isFinite(v) && v > 0) candidates.push(v);
    }
    if (!candidates.length) return null;
    next = key === "hod" ? Math.max(...candidates) : Math.min(...candidates);
  } else {
    next = pulseVal ?? baseVal ?? lastGoodStructure[key] ?? null;
  }
  if (next != null) {
    const changed = lastGoodStructure[key] !== next;
    lastGoodStructure[key] = next;
    lastGoodStructureAt = Date.now();
    lastGoodStructureSessionDate = todayEtYmd();
    // C7: Persist updated structure to Redis (fire-and-forget) so other workers
    // can pick up VWAP/HOD/LOD/EMAs without having run a full desk build.
    if (changed) publishStructureToRedis();
  }
  return next;
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
    // Anchor = argmax|net_gex|; it's often the PUT wall (support) and may sit below spot,
    // so it carries no directional meaning — mark it neutral (sky/gold) to match the
    // Heatmap ANCHOR node + Dealer Desk gold treatment, not unconditional resistance/red (#80).
    level("GEX Anchor", input.gex_king, p, "neutral"),
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

/** Overlay UW flow lane — tape, dark pool, GEX walls. */
export function mergeFlowIntoDesk(base: SpxDeskPayload, flow: SpxDeskFlow): SpxDeskPayload {
  const price = flow.price || base.price;
  const walls = flow.gex_walls.length ? flow.gex_walls : base.gex_walls;
  const spx_flows = flow.spx_flows.length ? flow.spx_flows : base.spx_flows;
  const strike_stacks =
    flow.strike_stacks?.length
      ? flow.strike_stacks
      : computeFlowStrikeStacks(spx_flows);
  // ISSUE-19: levels here use base.lod/hod/vwap, which may be stale from the full desk
  // build. This is intentional — mergePulseIntoDesk runs AFTER this and overwrites levels
  // with the fresh pulse values. Do not change this merge order or levels will regress.
  return {
    ...base,
    polled_at: flow.polled_at,
    dark_pool: flow.dark_pool ?? base.dark_pool,
    spx_flows,
    unified_tape: flow.unified_tape.length ? flow.unified_tape : base.unified_tape,
    strike_stacks,
    gex_walls: recalcGexWallDistances(walls, price),
    gex_net: flow.gex_net ?? base.gex_net,
    gex_king: flow.gex_king ?? base.gex_king,
    gamma_flip: flow.gamma_flip ?? base.gamma_flip,
    above_gamma_flip: flow.above_gamma_flip,
    gamma_regime: flow.gamma_regime ?? base.gamma_regime,
    flow_0dte_call_premium: flow.flow_0dte_call_premium ?? base.flow_0dte_call_premium,
    flow_0dte_put_premium: flow.flow_0dte_put_premium ?? base.flow_0dte_put_premium,
    flow_0dte_net: flow.flow_0dte_net ?? base.flow_0dte_net,
    flow_data_age_ms: flow.flow_data_age_ms ?? base.flow_data_age_ms ?? null,
    flow_cluster_live: flow.flow_cluster_live ?? base.flow_cluster_live ?? false,
    // Reflect the ~4s flow lane's GEX freshness on the merged desk (not the 10s full-desk base) so
    // the 'last-good GEX · not live' staleness badge (#7a) fires promptly instead of lagging a cycle.
    gex_age_ms: flow.gex_age_ms ?? base.gex_age_ms ?? null,
    gex_stale: flow.gex_stale ?? base.gex_stale ?? false,
    net_prem_ticks: flow.net_prem_ticks?.length ? flow.net_prem_ticks : base.net_prem_ticks,
    flow_by_expiry: flow.flow_by_expiry?.length ? flow.flow_by_expiry : base.flow_by_expiry,
    net_flow_by_expiry: flow.net_flow_by_expiry?.length ? flow.net_flow_by_expiry : base.net_flow_by_expiry,
    greek_exposure: flow.greek_exposure ?? base.greek_exposure,
    price,
    levels: buildLevels({
      price,
      lod: base.lod,
      hod: base.hod,
      vwap: base.vwap,
      pdh: base.pdh,
      pdl: base.pdl,
      ema20: base.ema20,
      ema50: base.ema50,
      ema200: base.ema200,
      sma50: base.sma50,
      sma200: base.sma200,
      gex_king: flow.gex_king ?? base.gex_king,
      max_pain: base.max_pain,
      gamma_flip: flow.gamma_flip ?? base.gamma_flip,
    }),
  };
}

/** Overlay fast Polygon pulse — price/session only (does not touch tape or GEX). */
export function mergePulseIntoDesk(
  base: SpxDeskPayload,
  pulse: SpxDeskPulse
): SpxDeskPayload {
  seedStructureCacheFromBase(base);
  const price = pulse.price > 0 ? pulse.price : base.price;
  const rthOpen = pulse.market_open ?? base.market_open ?? false;
  const liveSpot = rthOpen && price > 0 ? price : undefined;
  let lod = stickyStructureLevel("lod", pulse.lod, base.lod, liveSpot);
  let hod = stickyStructureLevel("hod", pulse.hod, base.hod, liveSpot);
  ({ hod, lod } = widenSessionExtremesWithSpot(price, hod, lod, rthOpen));
  const vwap = stickyStructureLevel("vwap", pulse.vwap, base.vwap);
  const pdh = stickyStructureLevel("pdh", pulse.pdh, base.pdh);
  const pdl = stickyStructureLevel("pdl", pulse.pdl, base.pdl);
  const ema20 = stickyStructureLevel("ema20", pulse.ema20, base.ema20);
  const ema50 = stickyStructureLevel("ema50", pulse.ema50, base.ema50);
  const ema200 = stickyStructureLevel("ema200", pulse.ema200, base.ema200);
  const sma50 = stickyStructureLevel("sma50", pulse.sma50, base.sma50);
  const sma200 = stickyStructureLevel("sma200", pulse.sma200, base.sma200);
  const vix = pulse.vix != null && pulse.vix > 0 ? pulse.vix : base.vix;
  return {
    ...base,
    price,
    spx_change_pct: pulse.spx_change_pct,
    vix,
    vix_change_pct: pulse.vix_change_pct,
    above_vwap: pulse.above_vwap,
    lod,
    hod,
    vwap,
    pdh,
    pdl,
    ema20,
    ema50,
    ema200,
    sma50,
    sma200,
    tick: pulse.tick ?? base.tick,
    trin: pulse.trin ?? base.trin,
    add: pulse.add ?? base.add,
    regime: pulse.regime ?? base.regime,
    leader_stocks: pulse.leader_stocks.length ? pulse.leader_stocks : base.leader_stocks,
    vix_term: pulse.vix_term ?? base.vix_term,
    data_quality: pulse.data_quality ?? base.data_quality,
    market_open: pulse.market_open ?? base.market_open,
    market_status: pulse.market_status ?? base.market_status,
    market_label: pulse.market_label ?? base.market_label,
    as_of: pulse.polled_at,
    polled_at: pulse.polled_at,
    // Reflect the ~1s pulse lane's price freshness on the merged desk (not the 10s base) so the
    // 'feed stalled · price not live' indicator (#11) catches a half-open freeze within seconds.
    price_age_ms: pulse.price_age_ms ?? base.price_age_ms ?? null,
    feed_stalled: pulse.feed_stalled ?? base.feed_stalled ?? false,
    // Carry halt state from the pulse (updated every ~1s) so the desk always reflects the
    // current in-process halt store without waiting for the 10s full desk refresh.
    active_halts: pulse.active_halts ?? base.active_halts,
    halt_channel_stale: pulse.halt_channel_stale ?? base.halt_channel_stale,
    // ISSUE-18+20: Recompute above_gamma_flip with current price so price crossings
    // of the gamma flip level are reflected after each pulse — base value would be stale.
    above_gamma_flip: base.gamma_flip != null ? price > base.gamma_flip : base.above_gamma_flip,
    gex_walls: recalcGexWallDistances(base.gex_walls, price),
    levels: buildLevels({
      price,
      lod,
      hod,
      vwap,
      pdh,
      pdl,
      ema20,
      ema50,
      ema200,
      sma50,
      sma200,
      gex_king: base.gex_king,
      max_pain: base.max_pain,
      gamma_flip: base.gamma_flip,
    }),
  };
}

/** Merge desk + flow + pulse lanes (shared by server loader and client hooks). */
export function mergeDeskLayers(
  desk: SpxDeskPayload,
  flow: SpxDeskFlow | null | undefined,
  pulse: SpxDeskPulse | null | undefined
): SpxDeskPayload {
  let merged = desk;
  if (flow?.available) merged = mergeFlowIntoDesk(merged, flow);
  if (pulse) {
    if (pulse.available) merged = mergePulseIntoDesk(merged, pulse);
    else {
      merged = {
        ...merged,
        market_open: pulse.market_open,
        market_status: pulse.market_status,
        market_label: pulse.market_label,
        polled_at: pulse.polled_at,
      };
    }
  }
  return merged;
}

const signalDeskStub = (): SpxDeskPayload => ({
  available: false,
  as_of: new Date().toISOString(),
  source: "pulse+flow",
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
});

/** Minimal merged desk for server-side signal logging (pulse + flow lanes). */
export function buildDeskFromPulseFlow(pulse: SpxDeskPulse, flow: SpxDeskFlow): SpxDeskPayload {
  const price = pulse.price || flow.price;
  let out = mergeFlowIntoDesk({ ...signalDeskStub(), price, available: price > 0 }, flow);
  out = mergePulseIntoDesk(out, pulse);
  return {
    ...out,
    available: price > 0 && (pulse.market_open ?? true),
    market_open: pulse.market_open,
    market_status: pulse.market_status,
    market_label: pulse.market_label,
  };
}
