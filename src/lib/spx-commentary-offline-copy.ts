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
      kicker: "🏖 MARKETS LOCKED",
      headline: "LARGO DARK",
      body: "No SPX. No 0DTE. No chaos. Largo powered down until Monday's open — go stack gains in real life.",
      tagline: "We hunt together when Wall Street wakes up.",
    },
    {
      tone: "weekend",
      kicker: "🌴 WEEKEND LOCKOUT",
      headline: "NEURAL LINK OFFLINE",
      body: "The tape doesn't lie. But it also doesn't exist on Saturdays. Neither should your screen time.",
      tagline: "Largo fires back up Monday pre-market. Rest, stack, repeat.",
    },
  ],
  premarket: [
    {
      tone: "premarket",
      kicker: "☕ PRE-MARKET INTEL",
      headline: "DESK WARMING UP",
      body: "Coffee's brewing. GEX is loading. Largo is stretching. Commentary goes live with the cash session.",
      tagline: "RTH opens 6:30 AM PT — Largo reads the tape for real.",
    },
    {
      tone: "premarket",
      kicker: "🌅 DAWN PATROL",
      headline: "SYSTEMS ONLINE",
      body: "GEX loading. Flow loading. Attitude armed. Night Hawk plays are digested. Largo activates at the bell.",
      tagline: "Pre-market calm before the 0DTE storm.",
    },
  ],
  extended: [
    {
      tone: "extended",
      kicker: "🌙 AFTER-HOURS VOID",
      headline: "SESSION WRAPPED",
      body: "RTH closed. Smart money stopped leaving breadcrumbs. Largo powered down the megaphone until tomorrow's open.",
      tagline: "Extended hours are noise. Real structure begins at the bell.",
    },
    {
      tone: "extended",
      kicker: "⏸ 0DTE WINDOW CLOSED",
      headline: "DESK DARK",
      body: "The 0DTE window shut. Today's entries are history. Night Hawk is already hunting tomorrow's plays.",
      tagline: "Rest up. Tomorrow's setup is being prepped.",
    },
  ],
  closed: [
    {
      tone: "closed",
      kicker: "🔇 SIGNAL LOST",
      headline: "DESK OFFLINE",
      body: "No live SPX feed means no live intel. Largo doesn't make up data — it waits for real tape.",
      tagline: "Connect when the desk wakes. Precision doesn't guess.",
    },
    {
      tone: "closed",
      kicker: "💤 NEURAL LINK DARK",
      headline: "LARGO OFFLINE",
      body: "The desk doesn't ghost — the market just isn't open. No tape, no signal, no noise.",
      tagline: "Largo returns with the session. Patience is a position.",
    },
    {
      tone: "closed",
      kicker: "🎰 NO BELL, NO SIGNAL",
      headline: "ORACLE STANDING BY",
      body: "Without a live tape there's nothing to read and nothing to roast. Largo reads the market, not the silence.",
      tagline: "Precision · Patience · Structure — tomorrow.",
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
