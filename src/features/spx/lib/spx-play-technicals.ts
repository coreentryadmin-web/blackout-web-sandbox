import { polygonConfigured } from "@/lib/providers/config";
import { fetchIndexEma, fetchIndexMinuteBars, fetchIndexRsi } from "@/lib/providers/polygon";
import { todayEtYmd } from "@/lib/providers/spx-session";
import {
  playMtfBufferPts,
  playOpeningRangeMinutes,
  playTechnicalsCacheSec,
} from "@/features/spx/lib/spx-play-config";
import { etClock, etMinutes } from "@/features/spx/lib/spx-play-session-time";

type Bar = { t: number; o: number; h: number; l: number; c: number; v?: number };

/** Bar-derived fields for playbook matcher fidelity (OR / VWAP streaks / EMA9). */
export type PlaybookBarMetrics = {
  /** Frozen opening-range high once OR window completes; null while collecting. */
  or_high: number | null;
  or_low: number | null;
  /** True once ET time ≥ 9:30 + or_minutes and OR bars exist. */
  or_defined: boolean;
  /** Minutes used to define OR (from playOpeningRangeMinutes). */
  or_minutes: number;
  /** Trailing m1 closes strictly below VWAP. */
  minutes_below_vwap: number;
  minutes_above_vwap: number;
  /** Trailing m3 closes at/above VWAP (+ buffer). */
  m3_consecutive_closes_above_vwap: number;
  m3_consecutive_closes_below_vwap: number;
  /** 1m EMA9 from today's minute closes. */
  m1_ema9: number | null;
  /** |ema9 − vwap| shrinking vs ~3 m3 bars ago. */
  ema9_curling_toward_vwap: boolean | null;
};

export const EMPTY_PLAYBOOK_BAR_METRICS: PlaybookBarMetrics = {
  or_high: null,
  or_low: null,
  or_defined: false,
  or_minutes: 20,
  minutes_below_vwap: 0,
  minutes_above_vwap: 0,
  m3_consecutive_closes_above_vwap: 0,
  m3_consecutive_closes_below_vwap: 0,
  m1_ema9: null,
  ema9_curling_toward_vwap: null,
};

export type PlayTechnicals = {
  available: boolean;
  price: number;
  m1_bars: number;
  m3_close: number | null;
  m5_close: number | null;
  m5_ema20: number | null;
  m5_rsi: number | null;
  m5_rsi_warning: string | null;
  m5_trend: "up" | "down" | "flat";
  m3_above_vwap: boolean | null;
  breakout: {
    pdh_break: boolean;
    pdl_break: boolean;
    hod_break: boolean;
    lod_break: boolean;
    vwap_reclaim: boolean;
    vwap_lost: boolean;
  };
  mtf: {
    /** null when no meaningful key level exists (VWAP, PDH, PDL all null) */
    m3_confirms_long: boolean | null;
    /** null when no meaningful key level exists (VWAP, PDH, PDL all null) */
    m3_confirms_short: boolean | null;
    m5_confirms_long: boolean;
    m5_confirms_short: boolean;
  };
} & PlaybookBarMetrics;

const SPX = "I:SPX";
let cached: { at: number; data: PlayTechnicals } | null = null;

function resampleBars(bars: Bar[], minutes: number): Bar[] {
  if (!bars.length) return [];
  const bucketMs = minutes * 60_000;
  const map = new Map<number, Bar>();

  for (const b of bars) {
    const key = Math.floor(b.t / bucketMs) * bucketMs;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...b, t: key });
    } else {
      existing.h = Math.max(existing.h, b.h);
      existing.l = Math.min(existing.l, b.l);
      existing.c = b.c;
      existing.v = (existing.v ?? 0) + (b.v ?? 0);
    }
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

function rsi(bars: Bar[], period = 14): number | null {
  if (bars.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i].c - bars[i - 1].c;
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].c - bars[i - 1].c;
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function emaFromCloses(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
  }
  return val;
}

/** Pure — exported for unit tests. */
export function openingRangeFromBars(
  bars: Bar[],
  orMinutes: number,
  nowEtMins: number
): Pick<PlaybookBarMetrics, "or_high" | "or_low" | "or_defined" | "or_minutes"> {
  const orStart = etClock(9, 30);
  const orEnd = orStart + orMinutes;
  const orBars = bars.filter((b) => {
    const m = etMinutes(new Date(b.t));
    return m >= orStart && m < orEnd;
  });
  const defined = nowEtMins >= orEnd && orBars.length > 0;
  if (!defined) {
    return { or_high: null, or_low: null, or_defined: false, or_minutes: orMinutes };
  }
  return {
    or_high: Math.max(...orBars.map((b) => b.h)),
    or_low: Math.min(...orBars.map((b) => b.l)),
    or_defined: true,
    or_minutes: orMinutes,
  };
}

/** Pure trailing streak of m1 closes on one side of VWAP. */
export function vwapSideStreaks(
  bars: Bar[],
  vwap: number | null
): Pick<PlaybookBarMetrics, "minutes_below_vwap" | "minutes_above_vwap"> {
  if (vwap == null || !bars.length) return { minutes_below_vwap: 0, minutes_above_vwap: 0 };
  let below = 0;
  let above = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].c < vwap) below++;
    else break;
  }
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].c > vwap) above++;
    else break;
  }
  return { minutes_below_vwap: below, minutes_above_vwap: above };
}

export function consecutiveClosesVsLevel(
  bars: Bar[],
  level: number | null,
  side: "above" | "below",
  buf = 0
): number {
  if (level == null || !bars.length) return 0;
  let n = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    const ok = side === "above" ? bars[i].c >= level + buf : bars[i].c <= level - buf;
    if (ok) n++;
    else break;
  }
  return n;
}

function ema9CurlingTowardVwap(m3: Bar[], vwap: number | null, ema9Now: number | null): boolean | null {
  if (vwap == null || ema9Now == null || m3.length < 4) return null;
  const lookback = m3.slice(0, -3);
  if (lookback.length < 9) return null;
  const ema9Then = emaFromCloses(
    lookback.map((b) => b.c),
    9
  );
  if (ema9Then == null) return null;
  const distNow = Math.abs(ema9Now - vwap);
  const distThen = Math.abs(ema9Then - vwap);
  return distNow < distThen - 0.05;
}

export async function buildPlayTechnicals(
  price: number,
  ctx: {
    vwap: number | null;
    pdh: number | null;
    pdl: number | null;
    hod: number | null;
    lod: number | null;
  }
): Promise<PlayTechnicals> {
  const orMinutes = playOpeningRangeMinutes();
  const empty: PlayTechnicals = {
    available: false,
    price,
    m1_bars: 0,
    m3_close: null,
    m5_close: null,
    m5_ema20: null,
    m5_rsi: null,
    m5_rsi_warning: null,
    m5_trend: "flat",
    m3_above_vwap: null,
    breakout: {
      pdh_break: false,
      pdl_break: false,
      hod_break: false,
      lod_break: false,
      vwap_reclaim: false,
      vwap_lost: false,
    },
    mtf: {
      m3_confirms_long: null,
      m3_confirms_short: null,
      m5_confirms_long: false,
      m5_confirms_short: false,
    },
    ...EMPTY_PLAYBOOK_BAR_METRICS,
    or_minutes: orMinutes,
  };

  if (!polygonConfigured() || price <= 0) return empty;

  const now = Date.now();
  const cacheMs = playTechnicalsCacheSec() * 1000;
  // 1.5-pt price step is tight enough to catch gap-open moves (which can gap 10+ pts
  // between minutes) while avoiding needless Polygon refetches on sub-tick noise.
  if (cached && now - cached.at < cacheMs && Math.abs(cached.data.price - price) < 1.5) {
    return cached.data;
  }

  const today = todayEtYmd();
  const [bars, ema5m, indexRsi] = await Promise.all([
    fetchIndexMinuteBars(SPX, today, today),
    fetchIndexEma(SPX, 20, "minute"),
    fetchIndexRsi(SPX, 14, "minute"),
  ]);

  if (!bars.length) return empty;

  const norm: Bar[] = bars
    .filter((b) => b.t != null && Number.isFinite(b.c))
    .map((b) => ({ t: b.t!, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));

  const m3 = resampleBars(norm, 3);
  const m5 = resampleBars(norm, 5);
  const m3Close = m3.length ? m3[m3.length - 1].c : null;
  const m5Close = m5.length ? m5[m5.length - 1].c : null;
  const m5Closes = m5.map((b) => b.c);
  const m5Ema20 = ema5m ?? emaFromCloses(m5Closes, 20);
  const m5Rsi = indexRsi ?? rsi(m5, 14);

  const buf = playMtfBufferPts();
  const vwap = ctx.vwap;
  const nowEtMins = etMinutes(new Date(now));
  const or = openingRangeFromBars(norm, orMinutes, nowEtMins);
  const streaks = vwapSideStreaks(norm, vwap);
  const m3Above = consecutiveClosesVsLevel(m3, vwap, "above", buf);
  const m3Below = consecutiveClosesVsLevel(m3, vwap, "below", buf);
  const m1Ema9 = emaFromCloses(
    norm.map((b) => b.c),
    9
  );
  const ema9Curl = ema9CurlingTowardVwap(m3, vwap, m1Ema9);

  let m5Trend: PlayTechnicals["m5_trend"] = "flat";
  if (m5Close != null && m5Ema20 != null) {
    if (m5Close > m5Ema20 + buf) m5Trend = "up";
    else if (m5Close < m5Ema20 - buf) m5Trend = "down";
  }

  const m3AboveVwap = m3Close != null && vwap != null ? m3Close >= vwap : null;

  const breakout = {
    pdh_break: ctx.pdh != null && price > ctx.pdh + buf,
    pdl_break: ctx.pdl != null && price < ctx.pdl - buf,
    hod_break: ctx.hod != null && price > ctx.hod + buf,
    lod_break: ctx.lod != null && price < ctx.lod - buf,
    vwap_reclaim: vwap != null && m3Close != null && m3Close >= vwap + buf && price >= vwap,
    vwap_lost: vwap != null && m3Close != null && m3Close <= vwap - buf && price <= vwap,
  };

  // ISSUE-13: When all of VWAP, PDH, PDL are null, level falls back to price itself.
  // m3Close >= price + 0.25 would then trivially fire. Return null for m3Long/m3Short
  // when no meaningful key level exists to compare against.
  const levelResolved = vwap ?? ctx.pdh ?? ctx.pdl ?? null;
  const m3Long = m3Close != null && levelResolved != null ? m3Close >= levelResolved + buf : null;
  const m3Short = m3Close != null && levelResolved != null ? m3Close <= levelResolved - buf : null;
  const m5Long = m5Trend === "up";
  const m5Short = m5Trend === "down";
  const m5RsiWarning =
    m5Rsi != null && m5Rsi >= 72
      ? `5m RSI ${m5Rsi.toFixed(0)} overbought — momentum extended (not blocking)`
      : m5Rsi != null && m5Rsi <= 28
        ? `5m RSI ${m5Rsi.toFixed(0)} oversold — downside extended (not blocking)`
        : null;

  const result: PlayTechnicals = {
    available: true,
    price,
    m1_bars: norm.length,
    m3_close: m3Close,
    m5_close: m5Close,
    m5_ema20: m5Ema20,
    m5_rsi: m5Rsi,
    m5_rsi_warning: m5RsiWarning,
    m5_trend: m5Trend,
    m3_above_vwap: m3AboveVwap,
    breakout,
    mtf: {
      m3_confirms_long: m3Long,
      m3_confirms_short: m3Short,
      m5_confirms_long: m5Long,
      m5_confirms_short: m5Short,
    },
    ...or,
    ...streaks,
    m3_consecutive_closes_above_vwap: m3Above,
    m3_consecutive_closes_below_vwap: m3Below,
    m1_ema9: m1Ema9,
    ema9_curling_toward_vwap: ema9Curl,
  };

  cached = { at: now, data: result };
  return result;
}
