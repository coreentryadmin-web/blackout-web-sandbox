/**
 * US equity regular trading hours in America/New_York (weekdays 9:30 AM–4:00 PM).
 * Safe on server and client — uses Intl only (no window).
 */
export function isEtMarketHours(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return false;

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  return mins >= 570 && mins < 960;
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
