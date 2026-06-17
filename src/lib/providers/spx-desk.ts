import { polygonConfigured, engineIntelOverlayEnabled, uwConfigured } from "./config";
import { dbConfigured, fetchRecentFlows } from "@/lib/db";
import { fetchEconomicCalendarToday, type MacroEvent } from "./finnhub";
import {
  analyzeStrikeGexRows,
  computeGammaFlip,
  gammaRegime,
  topGexWalls,
  type GexStrikeLevel,
  type GexWall,
} from "./gamma-desk";
import {
  computeVixTermStructure,
  fetchBenzingaNews,
  fetchIndexDailyBars,
  fetchIndexEma,
  fetchIndexMinuteBars,
  fetchIndexSma,
  fetchIndexSnapshots,
  fetchIndexVwap,
  fetchLeaderStockSnapshots,
} from "./polygon";
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
  fetchUwIvRank,
  fetchUwIvTermStructure,
  fetchUwMarketTide,
  fetchUwMaxPain,
  fetchUwNetPremTicks,
  fetchUwNope,
  fetchUwOdteGex,
  fetchUwOdteSpotExposuresByStrike,
  fetchUwOiChange,
  fetchMarketFlowAlerts,
  type DarkPoolSnapshot,
  type IvTermPoint,
  type NetPremTick,
  type OiChangeItem,
} from "./unusual-whales";
import { fetchEngine } from "@/lib/engine";

let lastGoodGexWalls: GexWall[] = [];
let lastGoodStrikeLevels: GexStrikeLevel[] = [];
let lastGoodGammaFlip: number | null = null;
let lastGoodGammaRegime = "unknown";
let lastGoodUnifiedTape: SpxTapeItem[] = [];
let cachedPriorDay = {
  pdh: null as number | null,
  pdl: null as number | null,
  fetchedAt: 0,
};

const SPX = "I:SPX";
const VIX = "I:VIX";
const VIX9D = "I:VIX9D";
const VIX3M = "I:VIX3M";
const TICK = "I:TICK";
const TRIN = "I:TRIN";
const ADD = "I:ADD";

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
  vix_change_pct: number;
  above_vwap: boolean;
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
  tick: number | null;
  trin: number | null;
  add: number | null;
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
  | "ema20"
  | "ema50"
  | "ema200"
  | "sma50"
  | "sma200"
  | "tick"
  | "trin"
  | "add"
  | "regime"
  | "leader_stocks"
  | "vix_term"
> & { polled_at: string };

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
    level("GEX King", input.gex_king, p, "resistance"),
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
    const isPut = f.option_type.toUpperCase().startsWith("P");
    items.push({
      kind: "flow",
      side: isPut ? "put" : "call",
      time: f.alerted_at,
      label: `${isPut ? "PUT" : "CALL"} ${f.strike}`,
      premium: f.premium,
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
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 32);
}

function tapeItemKey(t: SpxTapeItem): string {
  return `${t.kind}|${t.time}|${t.label}|${t.premium}`;
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
  return out.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}

function spxTapeMinPremium(): number {
  const raw = process.env.SPX_TAPE_MIN_PREMIUM?.trim();
  const n = raw ? Number(raw) : 50_000;
  return Number.isFinite(n) && n > 0 ? n : 50_000;
}

/** Market-wide UW flow alerts for SPX + SPXW (richer than per-stock snapshot). */
async function fetchSpxDeskFlowAlerts(limit = 32): Promise<SpxFlowBrief[]> {
  if (!uwConfigured()) return [];

  const minPremium = spxTapeMinPremium();
  const perTicker = Math.min(limit, 40);
  const [spx, spxw] = await Promise.all([
    fetchMarketFlowAlerts({ ticker: "SPX", limit: perTicker, min_premium: minPremium }),
    fetchMarketFlowAlerts({ ticker: "SPXW", limit: perTicker, min_premium: minPremium }),
  ]);

  return [...spx, ...spxw]
    .sort((a, b) => new Date(b.alerted_at).getTime() - new Date(a.alerted_at).getTime())
    .slice(0, limit)
    .map((f) => ({
      ticker: f.ticker,
      premium: f.premium,
      option_type: f.option_type,
      strike: f.strike,
      expiry: f.expiry,
      direction: f.direction,
      alerted_at: f.alerted_at,
    }));
}

async function fetchSpxDeskFlowAlertsWithDb(limit = 32): Promise<SpxFlowBrief[]> {
  const fromUw = await fetchSpxDeskFlowAlerts(limit);
  if (!dbConfigured()) return fromUw;

  try {
    const fromDb = await fetchRecentFlows({
      limit,
      min_premium: spxTapeMinPremium(),
    });
    const spxDb = fromDb
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
    vix_change_pct: 0,
    above_vwap: false,
    lod: null,
    hod: null,
    vwap: null,
    pdh: null,
    pdl: null,
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
    net_prem_ticks: [],
    vix_term: { vix9d: null, vix3m: null, structure: "unknown", detail: "" },
    sector_heat: [],
    leader_stocks: [],
    oi_changes: [],
    iv_term_structure: [],
    macro_events: [],
    news_headlines: [],
  };
}

export async function buildSpxDesk(): Promise<SpxDeskPayload> {
  const asOf = new Date().toISOString();
  const empty = emptyPayload(asOf);

  if (!polygonConfigured()) return empty;

  const today = todayEtYmd();
  const fromWeek = priorEtYmd(10);

  const intelPromise = engineIntelOverlayEnabled()
    ? fetchEngine<Record<string, unknown>>("/spx/state").catch(() => null)
    : Promise.resolve(null);

  const [
    snaps,
    minuteBars,
    dailyBars,
    ema20,
    ema50,
    ema200,
    sma50,
    sma200,
    vwapInd,
    uwGex,
    uwMaxPain,
    uwTide,
    uwNope,
    uwIv,
    uwFlow,
    strikeRows,
    darkPool,
    spxFlowsRaw,
    netPremTicks,
    oiChanges,
    ivTerm,
    leaderStocks,
    macroEvents,
    newsRaw,
    intel,
  ] = await Promise.all([
    fetchIndexSnapshots([SPX, VIX, VIX9D, VIX3M, TICK, TRIN, ADD]),
    fetchIndexMinuteBars(SPX, today, today).catch(() => []),
    fetchIndexDailyBars(SPX, fromWeek, today).catch(() => []),
    fetchIndexEma(SPX, 20, "minute"),
    fetchIndexEma(SPX, 50, "minute"),
    fetchIndexEma(SPX, 200, "day"),
    fetchIndexSma(SPX, 50, "day"),
    fetchIndexSma(SPX, 200, "day"),
    fetchIndexVwap(SPX, "minute"),
    fetchUwOdteGex("SPX"),
    fetchUwMaxPain("SPX"),
    fetchUwMarketTide(),
    fetchUwNope("SPX"),
    fetchUwIvRank("SPX"),
    fetchUwFlow0dte("SPX"),
    fetchUwOdteSpotExposuresByStrike("SPX"),
    fetchUwDarkPool("SPX", { limit: 20, min_premium: 500_000 }),
    fetchSpxDeskFlowAlertsWithDb(32),
    fetchUwNetPremTicks("SPY"),
    fetchUwOiChange("SPX"),
    fetchUwIvTermStructure("SPX"),
    fetchLeaderStockSnapshots().catch(() => []),
    fetchEconomicCalendarToday().catch(() => []),
    fetchBenzingaNews(15).catch(() => []),
    intelPromise,
  ]);

  const spxSnap = snaps[SPX];
  const vixSnap = snaps[VIX];
  if (!spxSnap?.price) return empty;

  const session = sessionStatsFromMinuteBars(minuteBars);
  const prior = priorDayFromDailyBars(dailyBars);

  const price = spxSnap.price;
  const vwap = session.vwap ?? vwapInd ?? (intel?.vwap as number | null) ?? null;
  const lod = session.lod ?? (intel?.lod as number | null) ?? spxSnap.price;
  const hod = session.hod ?? (intel?.hod as number | null) ?? spxSnap.price;

  const gexAnalysis = analyzeStrikeGexRows(strikeRows.length ? strikeRows : []);
  if (gexAnalysis.ranked_levels.length) {
    lastGoodStrikeLevels = gexAnalysis.ranked_levels;
  }
  const levelsForWalls = gexAnalysis.ranked_levels.length
    ? gexAnalysis.ranked_levels
    : lastGoodStrikeLevels;
  const flipLevels = levelsForWalls.map((l) => ({
    strike: l.strike,
    net_gex: l.net_gex,
  }));
  const computedFlip = computeGammaFlip(flipLevels, price);
  const gammaFlip =
    (intel?.gamma_flip as number | null) ?? computedFlip ?? lastGoodGammaFlip ?? null;
  const aboveFlip = gammaFlip != null ? price > gammaFlip : false;
  const gRegime = gammaRegime(price, gammaFlip);
  const walls = topGexWalls(levelsForWalls, price, 6);
  if (walls.length) lastGoodGexWalls = walls;
  const finalWalls = walls.length ? walls : lastGoodGexWalls;
  if (gammaFlip != null) lastGoodGammaFlip = gammaFlip;
  const gammaRegimeLabel = gRegime !== "unknown" ? gRegime : lastGoodGammaRegime;
  if (gRegime !== "unknown") lastGoodGammaRegime = gRegime;

  const gexNet = (intel?.gex_net as number | null) ?? uwGex?.net_gex ?? gexAnalysis.net_gex ?? null;
  const gexKing =
    (intel?.gex_king as number | null) ?? uwGex?.gex_king ?? gexAnalysis.gex_king_strike ?? null;
  const maxPain = (intel?.max_pain as number | null) ?? uwMaxPain ?? null;

  const regime =
    (intel?.chart_levels as { regime?: string } | undefined)?.regime ??
    inferRegime(price, ema20, ema50);

  const vixTerm = computeVixTermStructure(
    vixSnap?.price ?? null,
    snaps[VIX9D]?.price ?? null,
    snaps[VIX3M]?.price ?? null
  );

  const spxFlows: SpxFlowBrief[] = spxFlowsRaw ?? [];

  const freshTape = buildUnifiedTape(spxFlows, darkPool);
  if (freshTape.length) {
    lastGoodUnifiedTape = mergeTapeBuffer(lastGoodUnifiedTape, freshTape);
  }
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
    source: intel?.available ? "merged" : "polygon+uw",
    price,
    spx_change_pct: spxSnap.change_pct,
    vix: vixSnap?.price ?? (intel?.vix as number | null) ?? null,
    vix_change_pct: vixSnap?.change_pct ?? (intel?.vix_change_pct as number) ?? 0,
    above_vwap: vwap != null ? price >= vwap : false,
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
    tick: snaps[TICK]?.price ?? (intel?.tick as number | null) ?? null,
    trin: snaps[TRIN]?.price ?? (intel?.trin as number | null) ?? null,
    add: snaps[ADD]?.price ?? null,
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
    uw_iv_rank: (intel?.uw_iv_rank as number | null) ?? uwIv ?? null,
    regime: String(regime),
    levels,
    dark_pool: darkPool,
    spx_flows: spxFlows,
    unified_tape: unifiedTape,
    net_prem_ticks: netPremTicks ?? [],
    vix_term: {
      vix9d: vixTerm.vix9d,
      vix3m: vixTerm.vix3m,
      structure: vixTerm.structure,
      detail: vixTerm.detail,
    },
    sector_heat: [],
    leader_stocks: leaderStocks ?? [],
    oi_changes: oiChanges ?? [],
    iv_term_structure: ivTerm ?? [],
    macro_events: macroEvents ?? [],
    news_headlines: newsHeadlines,
  };
}

async function fetchPriorDayCached(): Promise<{ pdh: number | null; pdl: number | null }> {
  const now = Date.now();
  if (now - cachedPriorDay.fetchedAt < 60_000 && cachedPriorDay.pdh != null) {
    return { pdh: cachedPriorDay.pdh, pdl: cachedPriorDay.pdl };
  }
  const today = todayEtYmd();
  const bars = await fetchIndexDailyBars(SPX, priorEtYmd(10), today).catch(() => []);
  const prior = priorDayFromDailyBars(bars);
  cachedPriorDay = { pdh: prior.pdh, pdl: prior.pdl, fetchedAt: now };
  return { pdh: prior.pdh, pdl: prior.pdl };
}

function gexSnapshotForPrice(price: number) {
  const levelsForWalls = lastGoodStrikeLevels;
  const flipLevels = levelsForWalls.map((l) => ({ strike: l.strike, net_gex: l.net_gex }));
  const gammaFlip = computeGammaFlip(flipLevels, price) ?? lastGoodGammaFlip;
  const walls = topGexWalls(levelsForWalls, price, 6);
  const finalWalls = walls.length ? walls : topGexWalls(lastGoodStrikeLevels, price, 6);
  const gRegime = gammaRegime(price, gammaFlip);
  return {
    gamma_flip: gammaFlip,
    above_gamma_flip: gammaFlip != null ? price > gammaFlip : false,
    gamma_regime: gRegime !== "unknown" ? gRegime : lastGoodGammaRegime,
    gex_walls: finalWalls.length ? finalWalls : lastGoodGexWalls,
  };
}

/** Polygon-only fast lane — price, session, internals, mega-caps, GEX wall distances. */
export async function buildSpxDeskPulse(): Promise<SpxDeskPulse> {
  const polledAt = new Date().toISOString();
  const empty: SpxDeskPulse = {
    available: false,
    polled_at: polledAt,
    price: 0,
    spx_change_pct: 0,
    vix: null,
    vix_change_pct: 0,
    above_vwap: false,
    lod: null,
    hod: null,
    vwap: null,
    pdh: null,
    pdl: null,
    ema20: null,
    ema50: null,
    ema200: null,
    sma50: null,
    sma200: null,
    tick: null,
    trin: null,
    add: null,
    regime: "unknown",
    leader_stocks: [],
    vix_term: { vix9d: null, vix3m: null, structure: "unknown", detail: "" },
  };

  if (!polygonConfigured()) return empty;

  const today = todayEtYmd();
  const [
    snaps,
    minuteBars,
    prior,
    ema20,
    ema50,
    ema200,
    sma50,
    sma200,
    vwapInd,
    leaderStocks,
  ] = await Promise.all([
    fetchIndexSnapshots([SPX, VIX, VIX9D, VIX3M, TICK, TRIN, ADD]),
    fetchIndexMinuteBars(SPX, today, today).catch(() => []),
    fetchPriorDayCached(),
    fetchIndexEma(SPX, 20, "minute"),
    fetchIndexEma(SPX, 50, "minute"),
    fetchIndexEma(SPX, 200, "day"),
    fetchIndexSma(SPX, 50, "day"),
    fetchIndexSma(SPX, 200, "day"),
    fetchIndexVwap(SPX, "minute"),
    fetchLeaderStockSnapshots().catch(() => []),
  ]);

  const spxSnap = snaps[SPX];
  const vixSnap = snaps[VIX];
  if (!spxSnap?.price) return empty;

  const session = sessionStatsFromMinuteBars(minuteBars);
  const price = spxSnap.price;
  const vwap = session.vwap ?? vwapInd ?? null;
  const lod = session.lod ?? price;
  const hod = session.hod ?? price;
  const vixTerm = computeVixTermStructure(
    vixSnap?.price ?? null,
    snaps[VIX9D]?.price ?? null,
    snaps[VIX3M]?.price ?? null
  );

  return {
    available: true,
    polled_at: polledAt,
    price,
    spx_change_pct: spxSnap.change_pct,
    vix: vixSnap?.price ?? null,
    vix_change_pct: vixSnap?.change_pct ?? 0,
    above_vwap: vwap != null ? price >= vwap : false,
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
    tick: snaps[TICK]?.price ?? null,
    trin: snaps[TRIN]?.price ?? null,
    add: snaps[ADD]?.price ?? null,
    regime: String(inferRegime(price, ema20, ema50)),
    leader_stocks: leaderStocks ?? [],
    vix_term: {
      vix9d: vixTerm.vix9d,
      vix3m: vixTerm.vix3m,
      structure: vixTerm.structure,
      detail: vixTerm.detail,
    },
  };
}

/** UW flow lane — GEX strike ladder, live tape, dark pool (~4s). */
export async function buildSpxDeskFlow(): Promise<SpxDeskFlow> {
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
  };

  const [spxSnap, strikeRows, darkPool, spxFlowsRaw, uwGex, uwFlow] = await Promise.all([
    polygonConfigured()
      ? fetchIndexSnapshots([SPX]).then((m) => m[SPX])
      : Promise.resolve(null),
    uwConfigured() ? fetchUwOdteSpotExposuresByStrike("SPX") : Promise.resolve([]),
    uwConfigured()
      ? fetchUwDarkPool("SPX", { limit: 20, min_premium: 500_000 })
      : Promise.resolve(null),
    uwConfigured() ? fetchSpxDeskFlowAlertsWithDb(32) : Promise.resolve([]),
    uwConfigured() ? fetchUwOdteGex("SPX") : Promise.resolve(null),
    uwConfigured() ? fetchUwFlow0dte("SPX") : Promise.resolve(null),
  ]);

  const price = spxSnap?.price ?? 0;
  if (!price && !strikeRows.length && !spxFlowsRaw.length) return empty;

  const gexAnalysis = analyzeStrikeGexRows(strikeRows.length ? strikeRows : []);
  if (gexAnalysis.ranked_levels.length) {
    lastGoodStrikeLevels = gexAnalysis.ranked_levels;
  }
  const levelsForWalls = gexAnalysis.ranked_levels.length
    ? gexAnalysis.ranked_levels
    : lastGoodStrikeLevels;
  const flipLevels = levelsForWalls.map((l) => ({
    strike: l.strike,
    net_gex: l.net_gex,
  }));
  const spot = price || spxSnap?.price || 0;
  const gammaFlip = computeGammaFlip(flipLevels, spot) ?? lastGoodGammaFlip;
  const walls = topGexWalls(levelsForWalls, spot, 6);
  const finalWalls = walls.length ? walls : lastGoodGexWalls;
  if (finalWalls.length) lastGoodGexWalls = finalWalls;
  if (gammaFlip != null) lastGoodGammaFlip = gammaFlip;
  const gRegime = gammaRegime(spot, gammaFlip);
  const gammaRegimeLabel = gRegime !== "unknown" ? gRegime : lastGoodGammaRegime;
  if (gRegime !== "unknown") lastGoodGammaRegime = gRegime;

  const spxFlows: SpxFlowBrief[] = spxFlowsRaw ?? [];

  const freshTape = buildUnifiedTape(spxFlows, darkPool);
  if (freshTape.length) {
    lastGoodUnifiedTape = mergeTapeBuffer(lastGoodUnifiedTape, freshTape);
  }
  const unifiedTape = lastGoodUnifiedTape.length ? lastGoodUnifiedTape : freshTape;

  return {
    available: spot > 0,
    polled_at: polledAt,
    price: spot,
    dark_pool: darkPool,
    spx_flows: spxFlows,
    unified_tape: unifiedTape,
    gex_walls: finalWalls,
    gex_net: uwGex?.net_gex ?? gexAnalysis.net_gex ?? null,
    gex_king: uwGex?.gex_king ?? gexAnalysis.gex_king_strike ?? null,
    gamma_flip: gammaFlip,
    above_gamma_flip: gammaFlip != null ? spot > gammaFlip : false,
    gamma_regime: gammaRegimeLabel,
    flow_0dte_call_premium: uwFlow?.call_premium ?? null,
    flow_0dte_put_premium: uwFlow?.put_premium ?? null,
    flow_0dte_net: uwFlow?.net ?? null,
  };
}
