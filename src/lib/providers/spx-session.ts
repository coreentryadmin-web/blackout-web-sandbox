const ET = "America/New_York";

export function todayEtYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function priorEtYmd(daysBack = 5): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

type AggBar = { t?: number; o: number; h: number; l: number; c: number; v?: number };

export function sessionStatsFromMinuteBars(bars: AggBar[]): {
  lod: number | null;
  hod: number | null;
  vwap: number | null;
  open: number | null;
} {
  const rth = filterRthBars(bars);
  if (!rth.length) return { lod: null, hod: null, vwap: null, open: null };

  let lod = Infinity;
  let hod = -Infinity;
  let pv = 0;
  let vol = 0;

  for (const b of rth) {
    lod = Math.min(lod, b.l);
    hod = Math.max(hod, b.h);
    const typical = (b.h + b.l + b.c) / 3;
    const v = b.v && b.v > 0 ? b.v : 1;
    pv += typical * v;
    vol += v;
  }

  return {
    lod: Number.isFinite(lod) ? lod : null,
    hod: Number.isFinite(hod) ? hod : null,
    vwap: vol > 0 ? pv / vol : null,
    open: rth[0]?.o ?? null,
  };
}

export function priorDayFromDailyBars(bars: AggBar[]): {
  pdh: number | null;
  pdl: number | null;
  pdc: number | null;
} {
  if (bars.length < 2) {
    const only = bars[0];
    return only
      ? { pdh: only.h, pdl: only.l, pdc: only.c }
      : { pdh: null, pdl: null, pdc: null };
  }
  const prior = bars[bars.length - 2] ?? bars[bars.length - 1];
  return { pdh: prior.h, pdl: prior.l, pdc: prior.c };
}

function filterRthBars(bars: AggBar[]): AggBar[] {
  return bars.filter((b) => {
    if (!b.t) return false;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(new Date(b.t));
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const mins = hour * 60 + minute;
    return mins >= 9 * 60 + 30 && mins <= 16 * 60;
  });
}

export function distancePct(price: number, level: number | null): number | null {
  if (level == null || price <= 0) return null;
  return ((level - price) / price) * 100;
}

export function inferRegime(
  price: number,
  ema20: number | null,
  ema50: number | null
): string {
  if (!price || ema20 == null || ema50 == null) return "unknown";
  if (price > ema20 && ema20 > ema50) return "bullish";
  if (price < ema20 && ema20 < ema50) return "bearish";
  if (price > ema20) return "recovering";
  if (price < ema20) return "weak";
  return "neutral";
}
