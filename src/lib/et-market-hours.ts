/**
 * US equity regular trading hours in America/New_York (weekdays 9:30 AM–4:00 PM ET,
 * honoring NYSE early-close half-days and full-day market holidays). Safe on server and client.
 */
import { isTradingDayEt } from "@/lib/nighthawk/session";
import { getEarlyCloseMinutes } from "@/lib/spx-play-session-guards";
import { etClock, etMinutes } from "@/lib/spx-play-session-time";
import { todayEt } from "@/lib/et-date";

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
  if (!isTradingDayEt(todayEt(now))) return false;
  const mins = etMinutes(now);
  const close = getEarlyCloseMinutes(now) ?? etClock(16, 0);
  return mins >= etClock(9, 30) && mins <= close;
}

/** @deprecated Alias — prefer isEtCashRth for early-close correctness. */
export function isEtMarketHours(now = new Date()): boolean {
  return isEtCashRth(now);
}

/**
 * Extended cache-warm window: weekday trading days, 4:00 AM–8:00 PM ET (the standard US-equity
 * pre-market + cash + after-hours span). The cache-warm crons (grid/heatmap/desk/nights-watch —
 * see rth-warm-leader.ts) key off this instead of isEtCashRth: those crons used to stop dead the
 * instant cash RTH ended (4:00 PM ET) and stayed off until 9:30 AM the next trading day (and all
 * weekend), so any evening/pre-market visit forced every short-TTL cache to cold-rebuild on the
 * next real hit instead of serving a warm read — reproduced live 2026-07-06 ~18:41 ET as the
 * site-wide slowness report (SPX desk 4.5s, GEX heatmap 2.4s, 0DTE board 1.8s cold vs <150ms
 * warm). See docs/audit/FINDINGS.md.
 */
export function isEtExtendedWarmHours(now = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  if (!isTradingDayEt(todayEt(now))) return false;
  const mins = etMinutes(now);
  return mins >= etClock(4, 0) && mins <= etClock(20, 0);
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
