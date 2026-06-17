import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

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
      kicker: "🏖 MARKETS ON VACATION",
      headline: "DESK IN COMA",
      body: "No SPX. No 0DTE. No chaos. Claude is touch grass mode until Monday.",
      tagline: "Go outside — we'll scream at the tape together soon.",
    },
    {
      tone: "weekend",
      kicker: "🌴 WEEKEND PROTOCOL",
      headline: "AI UNPLUGGED",
      body: "The oracle doesn't work Saturdays. Neither should you.",
      tagline: "Live Desk AI resumes when Wall Street wakes up.",
    },
  ],
  premarket: [
    {
      tone: "premarket",
      kicker: "☕ PRE-MARKET PURGATORY",
      headline: "STANDBY MODE",
      body: "Coffee's brewing. Commentary ignites when the desk goes live.",
      tagline: "RTH opens 6:30 AM PT — then Claude reads the tape for real.",
    },
    {
      tone: "premarket",
      kicker: "🌅 DAWN PATROL",
      headline: "ORACLE WARMING UP",
      body: "GEX loading. Flow loading. Attitude loading.",
      tagline: "Hang tight — Live Desk AI spins up with cash session.",
    },
  ],
  extended: [
    {
      tone: "extended",
      kicker: "🌙 AFTER-HOURS VOID",
      headline: "TAPE'S ASLEEP",
      body: "RTH wrapped. The AI put down the megaphone until tomorrow's open.",
      tagline: "Extended hours — extended silence. Back at 6:30 AM PT.",
    },
    {
      tone: "extended",
      kicker: "⏸ SESSION FLAT",
      headline: "DESK OFFLINE",
      body: "0DTE window closed. Commentary hibernates until the bell rings again.",
      tagline: "Rest up. Tomorrow's lottery ticket is fresh.",
    },
  ],
  closed: [
    {
      tone: "closed",
      kicker: "🔇 SIGNAL LOST",
      headline: "DESK OFFLINE",
      body: "No live SPX feed — no live AI rant. Connect when the desk wakes.",
      tagline: "Commentary loads when SPX desk is live.",
    },
    {
      tone: "closed",
      kicker: "💤 VAULT LOCKED",
      headline: "CLAUDE IS NAPPING",
      body: "The mentor doesn't ghost — the market just isn't open.",
      tagline: "Live Desk AI returns with the session.",
    },
    {
      tone: "closed",
      kicker: "🎰 NO BELL, NO YELL",
      headline: "ORACLE OFF DUTY",
      body: "Without a live tape there's nothing to roast. Check back at the open.",
      tagline: "Precision · Patience · Gate structure — tomorrow.",
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

export function commentaryOfflineTone(desk?: SpxDeskPayload | null): CommentaryOfflineTone {
  const day = etWeekday();
  if (day === 0 || day === 6) return "weekend";

  const label = desk?.market_label?.toUpperCase() ?? "";
  if (label.includes("PRE")) return "premarket";
  if (label.includes("EXTENDED")) return "extended";
  if (label.includes("CLOSED")) return "closed";
  return "closed";
}

/** Pick a stable-but-rotating offline card (changes hourly). */
export function pickCommentaryOfflineCopy(desk?: SpxDeskPayload | null): CommentaryOfflineCopy {
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
