import { polygonConfigured } from "./config";
import {
  fetchIndexDailyBars,
  fetchIndexEma,
  fetchIndexMinuteBars,
  fetchIndexSma,
  fetchIndexSnapshots,
  fetchIndexVwap,
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
  fetchUwFlow0dte,
  fetchUwIvRank,
  fetchUwMarketTide,
  fetchUwMaxPain,
  fetchUwNope,
  fetchUwOdteGex,
} from "./unusual-whales";
import { fetchEngine } from "@/lib/engine";

const SPX = "I:SPX";
const VIX = "I:VIX";
const TICK = "I:TICK";
const TRIN = "I:TRIN";

export type SpxDeskLevel = {
  label: string;
  value: number | null;
  kind: "support" | "resistance" | "neutral";
  distance_pct: number | null;
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
  gex_net: number | null;
  gex_king: number | null;
  max_pain: number | null;
  gamma_flip: number | null;
  flow_0dte_call_premium: number | null;
  flow_0dte_put_premium: number | null;
  flow_0dte_net: number | null;
  tide_bias: string | null;
  nope: number | null;
  uw_iv_rank: number | null;
  regime: string;
  levels: SpxDeskLevel[];
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

export async function buildSpxDesk(): Promise<SpxDeskPayload> {
  const asOf = new Date().toISOString();
  const empty: SpxDeskPayload = {
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
    gex_net: null,
    gex_king: null,
    max_pain: null,
    gamma_flip: null,
    flow_0dte_call_premium: null,
    flow_0dte_put_premium: null,
    flow_0dte_net: null,
    tide_bias: null,
    nope: null,
    uw_iv_rank: null,
    regime: "unknown",
    levels: [],
  };

  if (!polygonConfigured()) return empty;

  const today = todayEtYmd();
  const fromWeek = priorEtYmd(10);

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
    intel,
  ] = await Promise.all([
    fetchIndexSnapshots([SPX, VIX, TICK, TRIN]),
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
    fetchEngine<Record<string, unknown>>("/spx/state").catch(() => null),
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

  const gexNet = (intel?.gex_net as number | null) ?? uwGex?.net_gex ?? null;
  const gexKing = (intel?.gex_king as number | null) ?? uwGex?.gex_king ?? null;
  const maxPain = (intel?.max_pain as number | null) ?? uwMaxPain ?? null;
  const gammaFlip = (intel?.gamma_flip as number | null) ?? null;

  const regime =
    (intel?.chart_levels as { regime?: string } | undefined)?.regime ??
    inferRegime(price, ema20, ema50);

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

  const tickSnap = snaps[TICK];
  const trinSnap = snaps[TRIN];

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
    tick: tickSnap?.price ?? (intel?.tick as number | null) ?? null,
    trin: trinSnap?.price ?? (intel?.trin as number | null) ?? null,
    gex_net: gexNet,
    gex_king: gexKing,
    max_pain: maxPain,
    gamma_flip: gammaFlip,
    flow_0dte_call_premium: (intel?.flow_0dte_call_premium as number | null) ?? uwFlow?.call_premium ?? null,
    flow_0dte_put_premium: (intel?.flow_0dte_put_premium as number | null) ?? uwFlow?.put_premium ?? null,
    flow_0dte_net: (intel?.flow_0dte_net as number | null) ?? uwFlow?.net ?? null,
    tide_bias: (intel?.tide_bias as string | null) ?? uwTide?.bias ?? null,
    nope: (intel?.nope as { nope?: number } | null)?.nope ?? uwNope?.nope ?? null,
    uw_iv_rank: (intel?.uw_iv_rank as number | null) ?? uwIv ?? null,
    regime: String(regime),
    levels,
  };
}
