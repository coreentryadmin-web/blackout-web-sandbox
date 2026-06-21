/** SPX 0DTE desk session — RTH only (stops after 1:00 PM PT / 4:00 PM ET). */

export type MarketStatusLabel = "RTH OPEN" | "PRE-MARKET" | "EXTENDED" | "CLOSED";

export type PolygonMarketNow = {
  market: string;
  earlyHours: boolean;
  afterHours: boolean;
  serverTime: string;
};

function ptParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: dayMap[weekday] ?? 0,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** Cash RTH window for SPX desk: Mon–Fri 6:30 AM – 1:00 PM PT. */
export function isSpxRthActive(now = new Date(), status?: PolygonMarketNow | null): boolean {
  const pt = ptParts(now);
  if (pt.day === 0 || pt.day === 6) return false;

  if (status) {
    if (status.market === "closed") return false;
    if (status.market === "open") {
      // MEDIUM: cross-check PT time + weekday — a stale Polygon response
      // must not make the engine think the market is open on a weekend or
      // outside regular trading hours.
      const mins = pt.hour * 60 + pt.minute;
      const open = 6 * 60 + 30;
      const close = 13 * 60;
      if (pt.day === 0 || pt.day === 6) return false;
      if (mins < open || mins >= close) return false;
      return true;
    }
    if (status.market === "extended-hours") return false;
    if (status.earlyHours) return false;
    if (status.afterHours) return false;
  }

  const mins = pt.hour * 60 + pt.minute;
  const open = 6 * 60 + 30;
  const close = 13 * 60;
  return mins >= open && mins < close;
}

export function marketStatusLabel(
  now = new Date(),
  status?: PolygonMarketNow | null
): MarketStatusLabel {
  if (!isSpxRthActive(now, status)) {
    const pt = ptParts(now);
    if (pt.day === 0 || pt.day === 6) return "CLOSED";
    const mins = pt.hour * 60 + pt.minute;
    if (mins < 6 * 60 + 30) return "PRE-MARKET";
    if (status?.market === "extended-hours" || status?.afterHours || mins >= 13 * 60) {
      return "EXTENDED";
    }
    return "CLOSED";
  }
  return "RTH OPEN";
}
