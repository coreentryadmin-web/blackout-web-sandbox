import { todayEt as todayEtYmd } from "@/lib/et-date";

export type MacroEvent = {
  time: string;
  event: string;
  country: string;
  impact: string;
  actual?: string | null;
  estimate?: string | null;
  /** ET calendar date (YYYY-MM-DD). Set by the live UW feed; optional so the curated
   *  literal and all existing readers are unaffected. */
  date?: string;
};

/** Curated US macro dates — FALLBACK only (the live UW /api/market/economic-calendar feed
 *  is the primary source once wired). FOMC verified vs federalreserve.gov and CPI/NFP vs
 *  the BLS *revised* 2026 schedule (post-2025-shutdown), 2026-06-22. FOMC is ONE row on the
 *  decision day — the decision, statement, and press conference all release that final
 *  afternoon (no separate next-day presser row). Update from
 *  federalreserve.gov/monetarypolicy/fomccalendars.htm + bls.gov/schedule. */
const US_MACRO_SCHEDULE_2026: Array<{ date: string; event: string; impact: "high" | "medium" }> = [
  { date: "2026-01-09", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-01-13", event: "CPI", impact: "high" },
  { date: "2026-01-28", event: "FOMC Decision", impact: "high" },
  { date: "2026-02-11", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-02-13", event: "CPI", impact: "high" },
  { date: "2026-03-06", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-03-11", event: "CPI", impact: "high" },
  { date: "2026-03-18", event: "FOMC Decision", impact: "high" },
  { date: "2026-04-03", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-04-10", event: "CPI", impact: "high" },
  { date: "2026-04-29", event: "FOMC Decision", impact: "high" },
  { date: "2026-05-08", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-05-12", event: "CPI", impact: "high" },
  { date: "2026-06-05", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-06-10", event: "CPI", impact: "high" },
  { date: "2026-06-17", event: "FOMC Decision", impact: "high" },
  { date: "2026-07-02", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-07-14", event: "CPI", impact: "high" },
  { date: "2026-07-29", event: "FOMC Decision", impact: "high" },
  { date: "2026-08-07", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-08-12", event: "CPI", impact: "high" },
  { date: "2026-09-04", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-09-11", event: "CPI", impact: "high" },
  { date: "2026-09-16", event: "FOMC Decision", impact: "high" },
  { date: "2026-10-02", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-10-14", event: "CPI", impact: "high" },
  { date: "2026-10-28", event: "FOMC Decision", impact: "high" },
  { date: "2026-11-06", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-11-10", event: "CPI", impact: "high" },
  { date: "2026-12-04", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-12-09", event: "FOMC Decision", impact: "high" },
  { date: "2026-12-10", event: "CPI", impact: "high" },
];

/** 2027: FOMC verified vs federalreserve.gov (8 meetings; subject to Fed revision until
 *  nearer the dates). CPI/NFP are ESTIMATES — BLS has NOT published the 2027 release
 *  calendar yet, so these are best-effort placeholders that the live UW feed supersedes;
 *  do not treat the 2027 CPI/NFP rows as authoritative. */
const US_MACRO_SCHEDULE_2027: Array<{ date: string; event: string; impact: "high" | "medium" }> = [
  { date: "2027-01-08", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-01-13", event: "CPI", impact: "high" },
  { date: "2027-01-27", event: "FOMC Decision", impact: "high" },
  { date: "2027-02-05", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-02-10", event: "CPI", impact: "high" },
  { date: "2027-03-05", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-03-10", event: "CPI", impact: "high" },
  { date: "2027-03-17", event: "FOMC Decision", impact: "high" },
  { date: "2027-04-02", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-04-13", event: "CPI", impact: "high" },
  { date: "2027-04-28", event: "FOMC Decision", impact: "high" },
  { date: "2027-05-07", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-05-12", event: "CPI", impact: "high" },
  { date: "2027-06-04", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-06-09", event: "FOMC Decision", impact: "high" },
  { date: "2027-06-10", event: "CPI", impact: "high" },
  { date: "2027-07-02", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-07-14", event: "CPI", impact: "high" },
  { date: "2027-07-28", event: "FOMC Decision", impact: "high" },
  { date: "2027-08-06", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-08-11", event: "CPI", impact: "high" },
  { date: "2027-09-03", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-09-14", event: "CPI", impact: "high" },
  { date: "2027-09-15", event: "FOMC Decision", impact: "high" },
  { date: "2027-10-01", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-10-13", event: "CPI", impact: "high" },
  { date: "2027-10-27", event: "FOMC Decision", impact: "high" },
  { date: "2027-11-05", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-11-10", event: "CPI", impact: "high" },
  { date: "2027-12-03", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-12-08", event: "FOMC Decision", impact: "high" },
  { date: "2027-12-10", event: "CPI", impact: "high" },
];

const ALL_MACRO_SCHEDULE = [...US_MACRO_SCHEDULE_2026, ...US_MACRO_SCHEDULE_2027];

/** Authoritative FOMC decision dates (federalreserve.gov, verified 2026-06-22) — 8/year,
 *  each the final day of the 2-day meeting. Source of truth for the canary below. */
const EXPECTED_FOMC: Record<string, readonly string[]> = {
  "2026": ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"],
  "2027": ["2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08"],
};

// Cold-start canary: if the curated FOMC rows ever drift from the expected dates (a stale
// hand-edit), log LOUD so it's caught before it can mis-gate a real-money 0DTE trade. This
// is deterministic (no LLM); the live UW feed is the primary source once wired.
(function assertFomcConsistency() {
  for (const [year, expected] of Object.entries(EXPECTED_FOMC)) {
    const actual = ALL_MACRO_SCHEDULE.filter(
      (e) => e.date.startsWith(year) && e.event === "FOMC Decision"
    )
      .map((e) => e.date)
      .sort();
    const ok = actual.length === expected.length && actual.every((d, i) => d === expected[i]);
    if (!ok) {
      console.error(
        `[macro-events] FOMC schedule drift for ${year}: expected [${expected.join(", ")}] but literal has [${actual.join(", ")}] — update US_MACRO_SCHEDULE from federalreserve.gov/monetarypolicy/fomccalendars.htm`
      );
    }
  }
})();

const MACRO_HEADLINE_RE =
  /\b(CPI|FOMC|FED|PCE|NFP|NONFARM|JOBS|PAYROLL|PPI|GDP|RETAIL SALES|ISM|PMI|UNEMPLOYMENT|CLAIMS|RATE DECISION|POWELL)\b/i;

/**
 * Return the approximate ET release time for a known macro event label.
 * Times are approximate and should be verified against the Fed's official
 * schedule (https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)
 * and the BLS/BEA release calendars before relying on them for trading.
 */
function eventReleaseTime(eventLabel: string): string {
  const upper = eventLabel.toUpperCase();
  // FOMC Minutes are released at 14:00 ET (not 08:30).
  if (upper.includes("FOMC MINUTES")) return "14:00";
  // FOMC Decision (rate announcement) at 14:00 ET.
  if (upper.includes("FOMC DECISION")) return "14:00";
  // FOMC Press Conference follows the decision at ~14:30 ET.
  if (upper.includes("FOMC PRESS CONFERENCE")) return "14:30";
  // NFP, CPI, PPI, GDP, Retail Sales, Claims — standard 08:30 ET.
  return "08:30";
}

function scheduleRowToEvent(e: { date: string; event: string; impact: "high" | "medium" }): MacroEvent {
  return {
    time: eventReleaseTime(e.event),
    event: e.event,
    country: "US",
    impact: e.impact,
    actual: null,
    estimate: null,
  };
}

function staticMacroToday(now = new Date()): MacroEvent[] {
  const today = todayEtYmd(now);
  return ALL_MACRO_SCHEDULE.filter((e) => e.date === today).map(scheduleRowToEvent);
}

/** High-impact US macro events on a specific ET calendar date. */
export function macroEventsOnDate(dateYmd: string): MacroEvent[] {
  return ALL_MACRO_SCHEDULE.filter((e) => e.date === dateYmd).map(scheduleRowToEvent);
}

function macroFromHeadlines(
  headlines: Array<{ title?: string }> | undefined
): MacroEvent[] {
  const hits: MacroEvent[] = [];
  for (const h of headlines?.slice(0, 8) ?? []) {
    const title = h.title ?? "";
    if (!MACRO_HEADLINE_RE.test(title)) continue;
    hits.push({
      time: "",
      event: `News: ${title.slice(0, 72)}`,
      country: "US",
      impact: "medium",
      actual: null,
      estimate: null,
    });
  }
  return hits.slice(0, 3);
}

function dedupeEvents(events: MacroEvent[]): MacroEvent[] {
  const seen = new Set<string>();
  const out: MacroEvent[] = [];
  for (const e of events) {
    const key = e.event.toUpperCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.slice(0, 8);
}

/** Resolve today's macro catalysts from curated schedule + headline keywords. */
export async function resolveMacroEventsToday(input: {
  headlines?: Array<{ title?: string }>;
}): Promise<{ events: MacroEvent[]; source: "static" | "headlines" | "none" }> {
  const staticHits = staticMacroToday();
  if (staticHits.length > 0) {
    return { events: staticHits, source: "static" };
  }

  const fromNews = macroFromHeadlines(input.headlines);
  if (fromNews.length > 0) {
    return { events: fromNews, source: "headlines" };
  }

  return { events: [], source: "none" };
}

/** Merge static schedule + headline keywords for desk macro rail. */
export async function mergeMacroEventsToday(input: {
  headlines?: Array<{ title?: string }>;
}): Promise<MacroEvent[]> {
  // Prefer the live UW feed for today's rows; fall back to the corrected literal when the
  // live feed has nothing for today (outage/empty/parse-fail) so the desk macro rail is
  // never artificially emptied.
  const today = todayEtYmd();
  const live = await fetchLiveMacroCalendar();
  const liveToday = live?.filter((e) => e.date === today) ?? null;
  const staticHits = liveToday && liveToday.length ? liveToday : staticMacroToday();
  const fromNews = macroFromHeadlines(input.headlines);
  return dedupeEvents([...staticHits, ...fromNews]);
}

/** Upcoming US macro from curated schedule. */
export function fetchUpcomingMacroEvents(daysAhead = 7): MacroEvent[] {
  const today = todayEtYmd();
  // Use calendar-day arithmetic in ET to avoid DST errors (a day can be 23 or 25 hours).
  // Parse today's ET date, advance by daysAhead calendar days, then reformat.
  const todayParts = today.split("-").map(Number) as [number, number, number];
  const endDate = new Date(
    Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2] + Math.max(1, daysAhead))
  );
  const end = todayEtYmd(endDate);

  return ALL_MACRO_SCHEDULE.filter((e) => e.date >= today && e.date <= end).map((e) => ({
    time: eventReleaseTime(e.event),
    event: e.event,
    country: "US",
    impact: e.impact,
    actual: null,
    estimate: null,
  }));
}

// ---------------------------------------------------------------------------
// Live macro calendar — UW /api/market/economic-calendar is the PRIMARY source.
// The curated literal above is the offline FALLBACK: every consumer adopts live data only
// when its window-filtered slice is non-empty, else returns the literal verbatim — so a
// UW outage / parse failure can never empty the macro gate.
// ---------------------------------------------------------------------------

function isoUtcToEtYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return todayEtYmd(d);
}

function isoUtcToEtHhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

const HIGH_IMPACT_REPORT_RE = /CPI|payroll|nonfarm|PCE|PPI|retail|ISM|unemploy|claims/i;

/** Map UW economic-calendar rows → MacroEvent[]. Defensive per-row (a malformed row is
 *  dropped, never throws). FOMC label is byte-identical to the literal so dedupe keys and
 *  the EXPECTED_FOMC canary stay aligned. */
export function parseUwEconomicCalendar(rows: Record<string, unknown>[]): MacroEvent[] {
  const out: MacroEvent[] = [];
  for (const r of rows) {
    try {
      const type = String(r.type ?? "").toLowerCase().trim();
      const rawEvent = String(r.event ?? "").trim();
      const timeIso = String(r.time ?? "").trim();
      if (!timeIso || (!rawEvent && type !== "fomc")) continue;
      const date = isoUtcToEtYmd(timeIso);
      if (!date) continue;

      let event: string;
      let impact: "high" | "medium";
      if (type === "fomc") {
        const upper = rawEvent.toUpperCase();
        if (upper.includes("MINUTE")) {
          event = "FOMC Minutes";
          impact = "medium";
        } else if (upper.includes("PRESS CONFERENCE")) {
          event = "FOMC Press Conference";
          impact = "high";
        } else if (
          !rawEvent ||
          upper.includes("DECISION") ||
          upper.includes("STATEMENT") ||
          upper.includes("RATE DECISION") ||
          upper.includes("FOMC MEETING")
        ) {
          event = "FOMC Decision";
          impact = "high";
        } else {
          event = rawEvent;
          impact = "medium";
        }
      } else if (type === "fed-speaker") {
        event = rawEvent || "Fed Speaker";
        impact = "medium";
      } else {
        event = rawEvent;
        impact = HIGH_IMPACT_REPORT_RE.test(rawEvent) ? "high" : "medium";
      }

      out.push({
        time: isoUtcToEtHhmm(timeIso),
        event,
        country: "US",
        impact,
        actual: null,
        estimate: r.forecast != null ? String(r.forecast) : null,
        date,
      });
    } catch {
      /* skip malformed row */
    }
  }
  return out;
}

/** Observe-only canary: log if the live feed's FOMC dates disagree with EXPECTED_FOMC
 *  within the live horizon. Never throws, never feeds a gate. */
function checkLiveVsLiteralFomc(live: MacroEvent[]): void {
  const liveFomc = live
    .filter((e) => e.event === "FOMC Decision" && e.date)
    .map((e) => e.date as string)
    .sort();
  if (liveFomc.length === 0) return;
  const start = liveFomc[0];
  const end = liveFomc[liveFomc.length - 1];
  const expected = Object.values(EXPECTED_FOMC)
    .flat()
    .filter((d) => d >= start && d <= end)
    .sort();
  const liveSet = new Set(liveFomc);
  const expSet = new Set(expected);
  const missing = expected.filter((d) => !liveSet.has(d));
  const extra = liveFomc.filter((d) => !expSet.has(d));
  if (missing.length || extra.length) {
    // Observe-only canary (never feeds a gate). The live UW feed often tags non-decision items
    // (e.g. the FOMC *minutes* release ~3 weeks after a meeting) as "FOMC Decision", which shows
    // up here as a benign `extra` date vs our decision-only literal. So this is WARN, not ERROR —
    // a real drift (a `missing` decision) is still surfaced, without spamming the error stream.
    console.warn(
      `[macro-events] LIVE_VS_LITERAL FOMC drift in-window: live=[${liveFomc.join(", ")}] expected=[${expected.join(", ")}] missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`
    );
  }
}

/** Live UW economic calendar → MacroEvent[], or null on outage/empty (→ literal fallback).
 *  Rides the UW in-proc cache + circuit breaker via fetchUwMarketEconomicCalendar. Uses a
 *  dynamic import so this module gains no static dependency on the heavy UW client. */
export async function fetchLiveMacroCalendar(limit = 50): Promise<MacroEvent[] | null> {
  try {
    const { fetchUwMarketEconomicCalendar } = await import("@/lib/providers/unusual-whales");
    const rows = await fetchUwMarketEconomicCalendar(limit);
    if (!rows || rows.length === 0) return null;
    const events = parseUwEconomicCalendar(rows);
    if (events.length === 0) return null;
    checkLiveVsLiteralFomc(events);
    return events;
  } catch {
    return null;
  }
}

/** Live-preferred variant of macroEventsOnDate (corrected literal fallback on a live miss). */
export async function macroEventsOnDateLive(dateYmd: string): Promise<MacroEvent[]> {
  const live = await fetchLiveMacroCalendar();
  const hits = live?.filter((e) => e.date === dateYmd) ?? null;
  return hits && hits.length ? hits : macroEventsOnDate(dateYmd);
}

/** Live-preferred variant of fetchUpcomingMacroEvents (corrected literal fallback on a miss). */
export async function fetchUpcomingMacroEventsLive(daysAhead = 7): Promise<MacroEvent[]> {
  const today = todayEtYmd();
  const todayParts = today.split("-").map(Number) as [number, number, number];
  const endDate = new Date(
    Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2] + Math.max(1, daysAhead))
  );
  const end = todayEtYmd(endDate);
  const live = await fetchLiveMacroCalendar();
  const window = live?.filter((e) => e.date != null && e.date >= today && e.date <= end) ?? null;
  return window && window.length ? window : fetchUpcomingMacroEvents(daysAhead);
}
