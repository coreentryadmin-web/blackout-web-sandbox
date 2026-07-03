/**
 * US equity regular trading hours in America/New_York (weekdays 9:30 AM–4:00 PM ET,
 * honoring NYSE early-close half-days and full-day market holidays). Safe on server and client.
 */
import { isTradingDayEt } from "@/lib/nighthawk/session";
import { getEarlyCloseMinutes } from "@/lib/spx-play-session-guards";
import { etClock, etMinutes } from "@/lib/spx-play-session-time";

function todayEtYmd(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** Canonical cash RTH gate — used by UI polling, options WS, correctness, and cron health. */
export function isEtCashRth(now = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  // Full NYSE closures (e.g. Jul 3 when Jul 4 is Saturday) are weekdays on the clock but not
  // trading sessions — without this gate data-correctness falsely flags stale flow_alerts during
  // holidays when UW legitimately has no new prints.
  if (!isTradingDayEt(todayEtYmd(now))) return false;
  const mins = etMinutes(now);
  const close = getEarlyCloseMinutes(now) ?? etClock(16, 0);
  return mins >= etClock(9, 30) && mins <= close;
}

/** @deprecated Alias — prefer isEtCashRth for early-close correctness. */
export function isEtMarketHours(now = new Date()): boolean {
  return isEtCashRth(now);
}

/** Stable hash for sharding tickers across cron ticks (0 … mod-1). */
export function tickerShard(ticker: string, mod: number): number {
  const t = ticker.trim().toUpperCase();
  if (mod <= 1) return 0;
  let h = 0;
  for (let i = 0; i < t.length; i++) {
    h = (h * 31 + t.charCodeAt(i)) >>> 0;
  }
  return h % mod;
}
