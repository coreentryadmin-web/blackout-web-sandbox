import type { AggBar } from "@/lib/providers/polygon-largo";
import { fetchPolygonMtfTechnicals } from "@/lib/providers/polygon-largo";

export type TechnicalCard = {
  ticker: string;
  price: number;
  trend: string;
  setup_tags: string[];
  support_levels: number[];
  resistance_levels: number[];
  gap_zones: string[];
  breakout_zones: string[];
  prior_day: { high: number | null; low: number | null; close: number | null };
  weekly: { high: number | null; low: number | null };
  rsi14: number | null;
  rel_volume: number | null;
  atr14: number | null;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  summary: string;
};

function swingLevels(bars: AggBar[], lookback = 30): { support: number[]; resistance: number[] } {
  const subset = bars.slice(-lookback);
  if (subset.length < 5) return { support: [], resistance: [] };
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < subset.length - 2; i++) {
    const h = subset[i]!.h;
    const l = subset[i]!.l;
    if (
      h > subset[i - 1]!.h &&
      h > subset[i - 2]!.h &&
      h > subset[i + 1]!.h &&
      h > subset[i + 2]!.h
    ) {
      highs.push(Number(h.toFixed(2)));
    }
    if (
      l < subset[i - 1]!.l &&
      l < subset[i - 2]!.l &&
      l < subset[i + 1]!.l &&
      l < subset[i + 2]!.l
    ) {
      lows.push(Number(l.toFixed(2)));
    }
  }
  const dedup = (levels: number[]) => {
    const sorted = Array.from(new Set(levels)).sort((a, b) => a - b);
    const out: number[] = [];
    for (const lv of sorted) {
      if (!out.length || Math.abs(lv - out[out.length - 1]!) / Math.max(out[out.length - 1]!, 0.01) > 0.005) {
        out.push(lv);
      }
    }
    return out;
  };
  return {
    resistance: dedup(highs).slice(-5).reverse(),
    support: dedup(lows).slice(0, 5),
  };
}

function classifySetup(params: {
  price: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  atr14: number | null;
  relVol: number | null;
  priorHigh: number | null;
  priorClose: number | null;
  weekHigh: number | null;
  weekLow: number | null;
  rangeHigh20: number | null;
}): string[] {
  const tags: string[] = [];
  const { price, ema20, ema50, ema200, rsi14, atr14, relVol, priorHigh, priorClose, weekHigh, rangeHigh20 } =
    params;
  const atr = atr14 ?? price * 0.015;

  if (rangeHigh20 && price >= rangeHigh20 * 0.995) tags.push("20d range breakout");
  if (weekHigh && price > weekHigh && (relVol ?? 0) >= 1.4) tags.push("weekly breakout zone");
  if (priorHigh && price > priorHigh && (relVol ?? 0) >= 1.2) tags.push("prior day HOD break");

  if (priorClose) {
    const gap = price - priorClose;
    if (Math.abs(gap) > atr * 0.5) {
      tags.push(`gap ${gap > 0 ? "up" : "down"} ${Math.abs(gap).toFixed(2)}`);
      tags.push(gap > 0 ? "gap-fill risk below" : "gap-fill bounce zone above");
    }
  }

  if (ema50 && Math.abs(price - ema50) < atr * 0.5) tags.push("at 50 EMA support/resistance");
  if (ema200 && Math.abs(price - ema200) < atr * 0.5) tags.push("at 200 EMA");

  if (ema20 && ema50 && ema200) {
    if (ema20 > ema50 && ema50 > ema200 && price > ema20) tags.push("bullish MA stack");
    if (ema20 < ema50 && ema50 < ema200 && price < ema20) tags.push("bearish MA stack");
  }

  if (rsi14 != null) {
    if (rsi14 >= 70) tags.push("RSI overbought");
    else if (rsi14 <= 30) tags.push("RSI oversold");
  }

  if ((relVol ?? 0) >= 2) tags.push("volume expansion");
  return tags.length ? tags : ["no dominant pattern"];
}

export async function buildTechnicalCard(ticker: string): Promise<TechnicalCard | null> {
  const mtf = await fetchPolygonMtfTechnicals(ticker);
  if (!mtf?.price) return null;

  const dailyBars = mtf.daily_bars?.length ? mtf.daily_bars : [];
  const swings = swingLevels(dailyBars, 45);
  const relVol = mtf.rel_volume ?? null;
  const setupTags = classifySetup({
    price: mtf.price,
    ema20: mtf.emas?.ema20 ?? null,
    ema50: mtf.emas?.ema50 ?? null,
    ema200: mtf.emas?.ema200 ?? null,
    rsi14: mtf.rsi?.daily ?? null,
    atr14: mtf.atr14 ?? null,
    relVol,
    priorHigh: mtf.prev_day?.high ?? null,
    priorClose: mtf.prev_day?.close ?? null,
    weekHigh: mtf.weekly?.high ?? null,
    weekLow: mtf.weekly?.low ?? null,
    rangeHigh20: mtf.range_high_20d ?? null,
  });

  const gapZones = setupTags.filter((t) => t.includes("gap"));
  const breakoutZones = setupTags.filter((t) => t.includes("breakout") || t.includes("HOD"));

  return {
    ticker: ticker.toUpperCase(),
    price: mtf.price,
    trend: mtf.trend_stack ?? "mixed",
    setup_tags: setupTags,
    support_levels: [...swings.support, mtf.weekly?.support, mtf.monthly?.support].filter(
      (v): v is number => v != null && Number.isFinite(v)
    ),
    resistance_levels: [...swings.resistance, mtf.weekly?.resistance, mtf.monthly?.resistance].filter(
      (v): v is number => v != null && Number.isFinite(v)
    ),
    gap_zones: gapZones,
    breakout_zones: breakoutZones,
    prior_day: {
      high: mtf.prev_day?.high ?? null,
      low: mtf.prev_day?.low ?? null,
      close: mtf.prev_day?.close ?? null,
    },
    weekly: { high: mtf.weekly?.high ?? null, low: mtf.weekly?.low ?? null },
    rsi14: mtf.rsi?.daily ?? null,
    rel_volume: relVol,
    atr14: mtf.atr14 ?? null,
    vwap: mtf.timeframes?.daily?.vwap ?? null,
    ema20: mtf.emas?.ema20 ?? null,
    ema50: mtf.emas?.ema50 ?? null,
    ema200: mtf.emas?.ema200 ?? null,
    summary: `${mtf.trend_stack} · ${setupTags.slice(0, 4).join(" · ")}`,
  };
}
