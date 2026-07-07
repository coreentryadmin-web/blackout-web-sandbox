import { defineToolGuide, CROSS } from "@/lib/learn/guides/shared";

export const nightHawkGuide = defineToolGuide({
  slug: "night-hawk",
  chapter: 5,
  title: "Night Hawk",
  description:
    "Evening playbook and pre-market confirmation — tomorrow's SPX setups, GEX context, and invalidation levels published after the close.",
  overview: [
    "Night Hawk publishes the Evening Edition: market recap, catalyst scan, GEX positioning, ranked play ideas, and hard invalidation levels for the next session.",
    "Route `/nighthawk` hosts two products side-by-side: PlaybookBoard (left) for the edition and 0DTE Command (right) for the always-on intraday scanner. This chapter covers the playbook; 0DTE Command has its own guide.",
    "It is asynchronous preparation — not a live execution desk. SPX Slayer takes over at the open. Morning confirm cron updates CONFIRMED / DEGRADED / INVALIDATED badges on each play.",
  ],
  layout: {
    title: "Desk layout",
    paragraphs: [
      "Two-column layout: PlaybookBoard on the left (~40%), ZeroDteBoard (0DTE Command) on the right (~60%). PlayDetailModal overlays when you select a ranked play.",
      "Edition data refreshes on a slower cadence than Slayer — expect 120s SWR on edition, 60s on play-status, 300s on track record.",
      "If tonight's board is not published yet, stale/prior edition copy appears with explicit notice — read the freshness badges before trading old levels.",
    ],
  },
  panels: [
    {
      name: "PlaybookBoard header",
      location: "Top of left column",
      purpose: "Edition metadata, freshness state, and session context for tonight's playbook.",
      shows: [
        "Edition date and recap headline",
        "Freshness badges: Edition live / Recap live / Prior edition / Awaiting close",
        "Pre-market summary counts (confirmed/degraded/invalidated)",
        "Stale, degraded, or carry-forward notices",
      ],
      cadence: "Edition 120s; play-status 60s",
      consume:
        "Read badges first. Prior edition means you are looking at yesterday's board — validate every level at the open. Awaiting close means today's edition is still being forged. Pre-market counts tell you how many plays survived morning confirm.",
    },
    {
      name: "HawkRecordStrip",
      location: "Below playbook header",
      purpose: "Rolling track record for resolved Night Hawk plays.",
      shows: [
        "30-day (configurable) resolved count",
        "Target hit %, profitable %, avg return",
        "Building track record or pending count when sample is small",
      ],
      cadence: "300s via parent SWR",
      consume:
        "Use for calibration, not prediction. Low sample sizes show building copy — do not over-weight percentages early in a window. Pair with your own journal.",
    },
    {
      name: "MarketContextBar",
      location: "Below record strip",
      purpose: "End-of-day market snapshot carried into the edition: tide, indices, sector leaders/laggards.",
      shows: [
        "Tide bias chip",
        "SPX and VIX snapshot",
        "Sector leaders and laggards",
      ],
      cadence: "Updates with edition payload",
      consume:
        "Sets the macro tone for the recap. Sector leaders hint where flow may concentrate next session. Cross-check Grid sector heat at the open if rotation looks extreme.",
    },
    {
      name: "Market recap (collapsible)",
      location: "Mid left column",
      purpose: "Narrative end-of-day summary supporting the ranked plays.",
      shows: ["Collapsible recap prose from the edition builder"],
      actions: ["Show / Hide market recap toggle"],
      cadence: "Static per edition until next publish",
      consume:
        "Expand once per evening read. The recap explains why plays ranked — not just where. Hide after reading to preserve vertical space for play rows.",
    },
    {
      name: "PlaybookPlayRow (×5 slots)",
      location: "Main left column — ranked list",
      purpose: "Up to five ranked setups for the next session with conviction, levels, and morning status.",
      shows: [
        "Rank #1–5, ticker, direction, conviction",
        "Morning badge: Confirmed / Degraded / Invalidated",
        "Score, flow streak, IV, premium cap",
        "Thesis, entry / target / stop, options contract, risk note",
        "Hawk Intel → hint when populated",
        "Empty slot: being forged copy",
      ],
      actions: [
        "Click / Enter / Space on populated row → PlayDetailModal",
      ],
      cadence: "Edition refresh 120s; morning badges via play-status 60s",
      consume:
        "Work top-down by rank. Note invalidation before entry. Morning badges override yesterday's optimism — INVALIDATED means do not trade the setup without fresh Slayer confirmation. Empty slots are normal before publish time (~after cash close cron).",
      tip: "Plays can carry until close next session — read carry notices in the header.",
    },
    {
      name: "PlayDetailModal (Hawk Intel)",
      location: "Center overlay — on play select",
      purpose: "Deep AI briefing for one ranked play: context, reasoning, and expanded intel.",
      shows: [
        "Rank, ticker, direction, conviction, score, streak, IV",
        "Entry / target / stop / contract",
        "Hawk Intel explanation (fetched once per open)",
      ],
      actions: ["Close modal"],
      cadence: "Fetch on open only — no auto-poll",
      consume:
        "Open for your #1–2 ranked ideas after reading the row. Intel is supplementary to invalidation levels — hard levels on the row still rule. Close and re-open if edition refreshed mid-read.",
    },
  ],
  howItWorks: {
    paragraphs: [
      "After cash close, cron builds the edition from end-of-day chain, flow, and catalyst context. Pre-market morning confirm cron re-evaluates each play against overnight structure.",
    ],
    features: [
      { title: "Edition blocks", body: "Structured document: recap, context bar, five ranked rows, record strip." },
      { title: "Morning confirm", body: "CONFIRMED / DEGRADED / INVALIDATED badges reflect pre-open revalidation." },
      { title: "Carry logic", body: "Plays may persist across sessions until close or invalidation." },
      { title: "Shared route", body: "/nighthawk also hosts 0DTE Command — playbook left, always-on scanner right." },
    ],
  },
  usage: {
    intro: "Read after 4:30 PM ET. Validate at the open on Slayer — markets change overnight.",
    steps: [
      { title: "Read after close", body: "Bookmark edition cadence; expand recap once." },
      { title: "Note invalidation", body: "Carry hard levels into pre-market Grid scan." },
      { title: "Check morning badges", body: "Before 9:30, refresh for CONFIRMED vs INVALIDATED." },
      { title: "Validate at open", body: "Slayer flip and walls may disagree — Slayer wins for execution." },
      { title: "Check 0DTE Command", body: "See today's always-on scanner finds on the same page." },
    ],
  },
  crossLinks: [
    CROSS.spx("Live execution desk for RTH."),
    CROSS.grid("Overnight catalysts that override the edition."),
    CROSS.helix("Night Hawk Flow panel on HELIX links edition to live tape."),
    CROSS.largo("Ask get_nighthawk_edition for structured Q&A on the board."),
  ],
  dos: [
    "Use as bias, not autopilot.",
    "Re-read invalidation at the open.",
    "Respect INVALIDATED morning badges.",
    "Read Hawk Intel for context, not permission.",
  ],
  donts: [
    "Don't enter solely on yesterday's edition without open validation.",
    "Don't ignore stale/prior edition notices.",
    "Don't confuse Night Hawk with the play engine — different clocks and gates.",
  ],
  faq: [
    { q: "Night Hawk vs SPX Slayer?", a: "Night Hawk = evening publication + morning confirm; Slayer = live RTH engine with 3s play poll." },
    { q: "When is the edition published?", a: "After cash close via cron; empty slots show until complete (~evening ET)." },
    { q: "Why is 0DTE Command on the same page?", a: "Single workflow: read the evening playbook and the always-on scanner without route changes." },
  ],
});
