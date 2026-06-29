export type CommentaryOfflineTone = "weekend" | "premarket" | "extended" | "closed";

export type CommentaryOfflineCopy = {
  tone: CommentaryOfflineTone;
  kicker: string;
  headline: string;
  body: string;
  tagline: string;
};

const POOLS: Record<CommentaryOfflineTone, CommentaryOfflineCopy[]> = {
  weekend: [
    {
      tone: "weekend",
      kicker: "Markets closed",
      headline: "Markets closed",
      body: "No SPX session and no 0DTE window. Commentary resumes at Monday's pre-market open.",
      tagline: "Session resumes Monday pre-market.",
    },
    {
      tone: "weekend",
      kicker: "Weekend",
      headline: "Desk offline",
      body: "Equity markets are closed through the weekend. No live structure until the bell.",
      tagline: "Live commentary returns Monday pre-market.",
    },
  ],
  premarket: [
    {
      tone: "premarket",
      kicker: "Pre-market",
      headline: "Desk warming up",
      body: "GEX, flow, and levels are loading. Commentary goes live with the cash session.",
      tagline: "RTH opens 6:30 AM PT.",
    },
    {
      tone: "premarket",
      kicker: "Pre-market",
      headline: "Systems online",
      body: "GEX and flow are loading. Night Hawk playbook is available. Commentary arms at the bell.",
      tagline: "Pre-market standby before the 0DTE session.",
    },
  ],
  extended: [
    {
      tone: "extended",
      kicker: "After hours",
      headline: "Session wrapped",
      body: "RTH is closed. Extended-hours prints are thin — commentary waits for the cash session.",
      tagline: "Live structure resumes at the bell.",
    },
    {
      tone: "extended",
      kicker: "0DTE closed",
      headline: "Window closed",
      body: "The 0DTE window has closed for today. Night Hawk is building tomorrow's playbook.",
      tagline: "Next edition publishes this evening.",
    },
  ],
  closed: [
    {
      tone: "closed",
      kicker: "Feed offline",
      headline: "No live feed",
      body: "No live SPX feed means no live commentary. We do not synthesize data when the tape is dark.",
      tagline: "Commentary resumes when the session opens.",
    },
    {
      tone: "closed",
      kicker: "Session closed",
      headline: "Session closed",
      body: "The market is not open. Commentary surfaces only when underlying data is live.",
      tagline: "Structure resumes at the next session.",
    },
    {
      tone: "closed",
      kicker: "Standing by",
      headline: "Standing by",
      body: "There is no live session to summarize right now.",
      tagline: "Commentary returns with the open.",
    },
  ],
};

function etWeekday(now = new Date()): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? 0;
}

export function commentaryOfflineTone(desk?: { market_label?: string } | null): CommentaryOfflineTone {
  const day = etWeekday();
  if (day === 0 || day === 6) return "weekend";

  const label = desk?.market_label?.toUpperCase() ?? "";
  if (label.includes("PRE")) return "premarket";
  if (label.includes("EXTENDED")) return "extended";
  if (label.includes("CLOSED")) return "closed";
  return "closed";
}

export function pickCommentaryOfflineCopy(desk?: { market_label?: string } | null): CommentaryOfflineCopy {
  const tone = commentaryOfflineTone(desk);
  const pool = POOLS[tone];
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );
  return pool[(hour + dayIndex()) % pool.length] ?? pool[0];
}

function dayIndex(): number {
  return etWeekday();
}
