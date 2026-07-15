import {
  fetchIndexDailyBars,
  fetchIndexEma,
  fetchIndexSnapshots,
  fetchStockDailyBars,
  fetchStockSnapshot,
  fetchTickerEma,
  fetchTickerRsi,
} from "@/lib/providers/polygon";
import { getStockLiveCandle } from "@/lib/ws/stock-candle-store";
import { priorEtYmd, todayEtYmd } from "@/lib/providers/spx-session";

type Bar = { t?: number; o: number; h: number; l: number; c: number; v?: number };

export function largoSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (t === "SPX" || t === "VIX") return `I:${t}`;
  return t;
}

function stockSymbol(ticker: string): string {
  return largoSymbol(ticker).replace(/^I:/, "");
}

function atr14(bars: Bar[]): number | null {
  if (bars.length < 15) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    trs.push(Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c)));
  }
  const slice = trs.slice(-14);
  return Number((slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2));
}

function returnPct(bars: Bar[], days: number): number | null {
  if (bars.length <= days) return null;
  const last = bars[bars.length - 1].c;
  const prev = bars[bars.length - 1 - days].c;
  if (!prev) return null;
  return Number((((last - prev) / prev) * 100).toFixed(2));
}

export async function buildLargoTechnicals(ticker: string) {
  const sym = largoSymbol(ticker);
  const isIndex = sym.startsWith("I:");
  const from = priorEtYmd(120);
  const to = todayEtYmd();

  const [quoteRaw, dailyBars, ema20, ema50, ema200, rsi14] = await Promise.all([
    isIndex ? fetchIndexSnapshots([sym]) : null,
    isIndex
      ? fetchIndexDailyBars(sym, from, to).catch(() => [])
      : fetchStockDailyBars(stockSymbol(ticker), from, to).catch(() => []),
    isIndex ? fetchIndexEma(sym, 20, "day") : fetchTickerEma(stockSymbol(ticker), 20, "day"),
    isIndex ? fetchIndexEma(sym, 50, "day") : fetchTickerEma(stockSymbol(ticker), 50, "day"),
    isIndex ? fetchIndexEma(sym, 200, "day") : fetchTickerEma(stockSymbol(ticker), 200, "day"),
    isIndex ? fetchTickerRsi(sym, 14, "day") : fetchTickerRsi(stockSymbol(ticker), 14, "day"),
  ]);

  let price = 0;
  let changePct = 0;
  const wsTicker = isIndex ? sym.replace(/^I:/, "") : stockSymbol(ticker);
  const wsCandle = getStockLiveCandle(wsTicker);
  const ws = wsCandle.current && wsCandle.current.close > 0 ? wsCandle.current.close : null;
  if (ws != null) {
    price = ws;
  } else if (isIndex) {
    const row = quoteRaw?.[sym];
    price = row?.price ?? 0;
    changePct = row?.change_pct ?? 0;
  } else {
    const snap = await fetchStockSnapshot(stockSymbol(ticker));
    price = snap?.price ?? 0;
    changePct = snap?.change_pct ?? 0;
  }

  const last = dailyBars.at(-1)?.c ?? price;
  const trend =
    ema20 != null && ema50 != null
      ? last > ema20 && ema20 > ema50
        ? "bullish"
        : last < ema20 && ema20 < ema50
          ? "bearish"
          : "mixed"
      : "unknown";

  const highs = dailyBars.map((b) => b.h);
  const lows = dailyBars.map((b) => b.l);

  return {
    ticker: sym,
    price,
    change_pct: changePct,
    trend,
    emas: { ema20, ema50, ema200 },
    rsi14,
    atr14: atr14(dailyBars),
    returns: {
      d5: returnPct(dailyBars, 5),
      d10: returnPct(dailyBars, 10),
      d20: returnPct(dailyBars, 20),
    },
    swing_high_20d: highs.length ? Math.max(...highs.slice(-20)) : null,
    swing_low_20d: lows.length ? Math.min(...lows.slice(-20)) : null,
    range_high_20d: highs.length ? Math.max(...highs.slice(-20)) : null,
    range_low_20d: lows.length ? Math.min(...lows.slice(-20)) : null,
    above_ema20: ema20 != null ? last > ema20 : null,
    above_ema50: ema50 != null ? last > ema50 : null,
    data_source: "polygon",
  };
}

export async function buildPeerRelativeStrength(ticker: string) {
  const sym = stockSymbol(ticker);
  const from = priorEtYmd(40);
  const to = todayEtYmd();
  const sectorMap: Record<string, string> = {
    AAPL: "XLK",
    MSFT: "XLK",
    NVDA: "XLK",
    GOOG: "XLC",
    META: "XLC",
    TSLA: "XLY",
    AMZN: "XLY",
  };
  const peer = sectorMap[sym] ?? "SPY";

  const [stockBars, peerBars] = await Promise.all([
    fetchStockDailyBars(sym, from, to),
    fetchStockDailyBars(peer, from, to),
  ]);

  return {
    ticker: sym,
    peer_etf: peer,
    stock: { d5: returnPct(stockBars, 5), d10: returnPct(stockBars, 10), d20: returnPct(stockBars, 20) },
    peer: { d5: returnPct(peerBars, 5), d10: returnPct(peerBars, 10), d20: returnPct(peerBars, 20) },
    leading:
      (returnPct(stockBars, 10) ?? 0) > (returnPct(peerBars, 10) ?? 0) ? "outperforming" : "lagging",
  };
}

export async function buildSeasonality() {
  const from = priorEtYmd(400);
  const to = todayEtYmd();
  const bars = await fetchStockDailyBars("SPY", from, to, "400");
  const byMonth = new Map<number, number[]>();
  for (let i = 1; i < bars.length; i++) {
    const d = new Date(bars[i].t ?? 0);
    const m = d.getUTCMonth();
    const ret = ((bars[i].c - bars[i - 1].c) / bars[i - 1].c) * 100;
    const arr = byMonth.get(m) ?? [];
    arr.push(ret);
    byMonth.set(m, arr);
  }
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return {
    proxy: "SPY",
    months: Array.from(byMonth.entries()).map(([m, rets]) => ({
      month: monthNames[m],
      avg_return_pct: Number((rets.reduce((a, b) => a + b, 0) / rets.length).toFixed(2)),
      samples: rets.length,
    })),
  };
}

export async function buildQqqRelativeStrength() {
  const from = priorEtYmd(40);
  const to = todayEtYmd();
  const [qqq, spy] = await Promise.all([
    fetchStockDailyBars("QQQ", from, to),
    fetchStockDailyBars("SPY", from, to),
  ]);
  const q10 = returnPct(qqq, 10);
  const s10 = returnPct(spy, 10);
  return {
    qqq: { d5: returnPct(qqq, 5), d10: q10, d20: returnPct(qqq, 20) },
    spy: { d5: returnPct(spy, 5), d10: s10, d20: returnPct(spy, 20) },
    spread_10d: q10 != null && s10 != null ? Number((q10 - s10).toFixed(2)) : null,
    tech_leadership: (q10 ?? 0) > (s10 ?? 0) ? "QQQ leading" : "QQQ lagging SPY",
  };
}
