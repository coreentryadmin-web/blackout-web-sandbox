/** Eastern Time helpers for play session gates. */

export function etMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  // LOW-26: some Node.js/ICU builds return "24" for midnight with hour12:false.
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function etClock(hour: number, minute: number): number {
  return hour * 60 + minute;
}

export function formatEtTime(hour: number, minute: number): string {
  const h12 = hour % 12 || 12;
  const ampm = hour >= 12 ? "PM" : "AM";
  const mm = minute.toString().padStart(2, "0");
  return `${h12}:${mm} ${ampm} ET`;
}
