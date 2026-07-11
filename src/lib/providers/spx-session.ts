import { todayEt } from "@/lib/et-date";

const ET = "America/New_York";

export const todayEtYmd = todayEt;

/**
 * Is a `platform_briefs` "premarket" row still safe to serve as the current brief?
 *
 * A premarket brief for today is legitimately published before the open using
 * yesterday's close, so "today" AND "the single calendar day before today" both
 * count as fresh. Anything older than that (2+ days stale) must NOT be served as
 * current — confirmed live bug: a 2026-06-29 brief (SPX ~7408) was served with
 * `available: true` during live 2026-07-01 RTH trading (SPX ~7494), an 86-point
 * gap, with no indication the data was 2 sessions old. Deliberately a
 * plain 1-calendar-day allowance (not a trading-calendar lookup): simple, and
 * catches the actual reported failure mode without overfitting to weekend/holiday
 * edge cases.
 */
export function isPremarketBriefFresh(briefDateYmd: string, todayYmd: string): boolean {
  if (briefDateYmd === todayYmd) return true;
  const brief = new Date(`${briefDateYmd}T00:00:00Z`);
  const today = new Date(`${todayYmd}T00:00:00Z`);
  if (Number.isNaN(brief.getTime()) || Number.isNaN(today.getTime())) return false;
  const oneDayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((today.getTime() - brief.getTime()) / oneDayMs);
  return diffDays === 1;
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
  /** False when index bars have zero volume — VWAP is equal-weight typical price, not true VWAP. */
  vwap_volume_weighted: boolean;
} {
  const rth = filterRthBars(bars);
  if (!rth.length) {
    return { lod: null, hod: null, vwap: null, open: null, vwap_volume_weighted: false };
  }

  let lod = Infinity;
  let hod = -Infinity;
  let pv = 0;
  let vol = 0;
  let sawRealVolume = false;

  for (const b of rth) {
    lod = Math.min(lod, b.l);
    hod = Math.max(hod, b.h);
    const typical = (b.h + b.l + b.c) / 3;
    // ISSUE-16: Polygon index bars often have v=0; fallback to v=1 makes this an
    // equal-weight typical price average rather than a true volume-weighted mean.
    const hasVol = (b.v ?? 0) > 0;
    if (hasVol) sawRealVolume = true;
    const v = hasVol ? b.v! : 1;
    pv += typical * v;
    vol += v;
  }

  return {
    // ISSUE-39: lod init is Infinity; if all bars have l=0 (Polygon glitch), lod becomes 0
    // which is finite, so we add the lod > 0 guard.
    lod: lod > 0 && Number.isFinite(lod) ? lod : null,
    hod: Number.isFinite(hod) ? hod : null,
    vwap: vol > 0 ? pv / vol : null,
    open: rth[0]?.o ?? null,
    vwap_volume_weighted: sawRealVolume,
  };
}

/** Calendar date (YYYY-MM-DD) of a bar timestamp in US Eastern (exchange) time. */
function etYmdFromMs(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function priorDayFromDailyBars(
  bars: AggBar[],
  todayYmd: string = todayEtYmd()
): {
  pdh: number | null;
  pdl: number | null;
  pdc: number | null;
} {
  // The prior session = the most recent COMPLETED trading day: the last bar whose
  // Eastern-time date is before today. Off-hours (pre-market / overnight / weekend) the
  // last daily bar IS that session; during RTH the last bar is today's in-progress
  // partial bar and must be skipped. Gaps (weekends/holidays) are handled naturally.
  //
  // Previously this blindly used bars[length-2], which is correct only while a partial
  // "today" bar is present. Off-hours it skipped the true last session and returned data
  // one full session stale — corrupting PDH/PDL/PDC and every derived level (the R1/R2/
  // S1/S2 pivots, PDH/PDL breakouts). This supersedes the old ISSUE-34 length<2 guard.
  if (bars.length === 0) return { pdh: null, pdl: null, pdc: null };
  if (bars.every((b) => b.t != null)) {
    for (let i = bars.length - 1; i >= 0; i -= 1) {
      const b = bars[i];
      if (b.t != null && etYmdFromMs(b.t) < todayYmd) {
        return { pdh: b.h, pdl: b.l, pdc: b.c };
      }
    }
    // Every bar is dated today (only a partial bar so far) — no completed prior session.
    return { pdh: null, pdl: null, pdc: null };
  }
  // Timestamps unavailable: fall back to the conservative assumption that the last bar
  // is today's partial and the prior completed session is the one before it.
  if (bars.length < 2) return { pdh: null, pdl: null, pdc: null };
  const prior = bars[bars.length - 2];
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
    return mins >= 9 * 60 + 30 && mins < 16 * 60;
  });
}

/** During RTH the live index tick can run ahead of Polygon minute bars. Widen extremes so spot ∈ [LOD,HOD] without seeding nulls from price (gap #14). */
export function widenSessionExtremesWithSpot(
  price: number,
  hod: number | null,
  lod: number | null,
  rthOpen: boolean
): { hod: number | null; lod: number | null } {
  if (!rthOpen || !(price > 0)) return { hod, lod };
  return {
    hod: hod != null && Number.isFinite(hod) ? Math.max(hod, price) : hod,
    lod: lod != null && Number.isFinite(lod) ? Math.min(lod, price) : lod,
  };
}

export function distancePct(price: number, level: number | null): number | null {
  // ISSUE-37: level=0 produces -100% distance instead of null; guard against it.
  if (level == null || level <= 0 || price <= 0) return null;
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
