export const FAQ_SUPPORT_EMAIL = "support@blackouttrades.com";

export type FaqCatKey = "platform" | "arsenal" | "signals" | "member" | "start";

export type FaqCategory = {
  key: FaqCatKey;
  label: string;
  n: string;
  blurb: string;
  wide?: boolean;
};

export type FaqItem = {
  id: string;
  catKey: FaqCatKey;
  cat: string;
  q: string;
  a: string;
};

export const FAQ_CATEGORIES: FaqCategory[] = [
  { key: "platform", label: "Platform", n: "01", blurb: "What BlackOut is, and how it runs." },
  {
    key: "arsenal",
    label: "Instruments",
    n: "02",
    blurb: "Every instrument on the desk, broken down.",
  },
  { key: "signals", label: "Signals & Data", n: "03", blurb: "Alerts, latency, and the proof." },
  {
    key: "member",
    label: "Membership",
    n: "04",
    blurb: "Access, pricing, and cancellation.",
    wide: true,
  },
  {
    key: "start",
    label: "Getting Started",
    n: "05",
    blurb: "From zero to live in one session.",
    wide: true,
  },
];

const RAW: Record<FaqCatKey, { q: string; a: string }[]> = {
  platform: [
    {
      q: "What exactly is BlackOut?",
      a: "BlackOut is an institutional-grade trading intelligence platform built for options and 0DTE traders. It combines live options flow, the SPX Slayer desk, dealer gamma positioning, dark-pool activity, Largo analysis, and the Night Hawk overnight playbook into one surface — what a professional desk sees, built for individual traders.",
    },
    {
      q: "Who is BlackOut built for?",
      a: "Active options, SPX and 0DTE traders — anyone who wants real structure on the screen instead of a hunch. Serious beginners are covered by the in-app Learn layer; full-time operators get a command surface dense enough to run a whole session from.",
    },
    {
      q: "Where does your data come from?",
      a: "Aggregated from professional-grade options and equity feeds, streamed live. We merge dealer positioning, options flow, dark-pool prints, and full market internals into one clean signal layer — the depth the pros run on, without stitching together a dozen terminals yourself.",
    },
    {
      q: "Do I need to connect a broker?",
      a: "No. BlackOut is a pure intelligence layer — you execute on your own broker. We surface the data, structure, and setups before price moves; you pull the trigger wherever you already trade.",
    },
    {
      q: "Is any of this financial advice?",
      a: "No. BlackOut provides market data, analytics, and pattern-recognition tools for educational and informational purposes only. Nothing here is a recommendation to buy or sell — every trade is your own decision. We just make sure you're never guessing the structure.",
    },
    {
      q: "Can I use BlackOut on my phone?",
      a: "Yes. BlackOut installs as an app on your phone — an alert-first, glanceable command surface built for the way 0DTE traders actually live during market hours.",
    },
  ],
  arsenal: [
    {
      q: "What is the SPX Slayer desk?",
      a: "The primary 0DTE desk. Live SPX with VWAP, gamma exposure and market internals, plus a graded play card: letter grade (A–F), numeric score, confidence read, an 11-point confirmation checklist (MTF, trend, structure, VWAP, flow, dark pool, tide, internals, catalyst, dealer GEX, vol regime), a suggested strike with entry / target / stop — and the invalidation level. It answers what's the setup and what's the risk in a single glance.",
    },
    {
      q: "What is Largo, the BlackOut Intelligence desk analyst?",
      a: "Largo is your BlackOut Intelligence desk analyst with full access to every tool's live data — flow, gamma, dark pool, the desk, news. Ask it anything in plain English: 'what's the SPX setup right now,' 'is this flow real or noise,' 'where are dealers trapped.' It answers grounded in live data and shows its work — never a guess pulled from thin air.",
    },
    {
      q: "What is the HELIX options-flow feed?",
      a: "Live options flow filtered down to what moves the desk, not a firehose: repeated-hit strike stacks (same-strike accumulation), sweeps versus blocks, call/put pressure, premium and fill counts. The engine merges the live feed with the full session's flow so the big prints never slip past.",
    },
    {
      q: "What is GEX / dealer positioning?",
      a: "Dealer gamma exposure, made actionable. The support and resistance gamma walls, the gamma flip level, and the regime read — positive gamma (dips get bought, range-bound) versus negative gamma (volatility expands). In short: what market makers are forced to do, and where liquidity is likely to pull price.",
    },
    {
      q: "What does the dark-pool view show?",
      a: "Off-exchange institutional prints and levels, anchored to price — where size is quietly accumulating or distributing away from the lit tape. The flow that prints in the dark, surfaced next to the level it sits on.",
    },
    {
      q: "What is Night Hawk?",
      a: "Your BlackOut Intelligence evening playbook. After the close, Night Hawk builds ranked swing and leap setups with a per-ticker dossier behind each one — so instead of starting tomorrow from a blank chart, you walk in with a plan.",
    },
    {
      q: "Is there a market overview / heatmap?",
      a: "Yes — a dealer-positioning heatmap. It maps GEX, VEX, DEX and CHARM by strike: the gamma walls that pin or repel price, the flip level where the regime turns, and where dealer flow concentrates. You read market structure before the first trade goes on, not a stale sector grid.",
    },
  ],
  signals: [
    {
      q: "How do alerts work?",
      a: "BlackOut surfaces live, in-app alerts the moment flow and desk state change — a setup moving to WATCH, a play promoting to ENTRY, unusual flow stacking into a level. The signal reaches you in real time, so you act on structure forming, not after it's gone.",
    },
    {
      q: "Is the data really real-time?",
      a: "Yes — everything streams live, tick by tick. Quotes, options flow, dealer gamma, dark-pool activity, and your alerts all update the instant the market moves, not on a delay. When a sweep hits or positioning shifts, you see it as it prints — the screen in front of you is always the market as it is right now, never a stale snapshot.",
    },
    {
      q: "Do you track your performance?",
      a: "Yes — transparently. BlackOut keeps an append-only log of every closed SPX setup, scored by its original grade, with best- and worst-case excursion recorded — not a cherry-picked highlight reel. You judge the grader on its own logged results, not our word. Past performance is no guarantee of future results.",
    },
  ],
  member: [
    {
      q: "How do I get access?",
      a: "Create your free BlackOut account, then choose monthly or yearly access using the same email. One click unlocks the full platform — same login, full clearance.",
    },
    {
      q: "What's included in Premium?",
      a: "The entire arsenal, one membership: the SPX Slayer desk, the HELIX live flow feed, Largo, GEX / dealer positioning, dark-pool activity, Night Hawk, the market heatmap, and the public play log. One tier, full clearance — nothing held back.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes. Billing is handled through our secure checkout partner, and you can manage or cancel your membership anytime from your account. Questions about a charge, an invoice, or your plan? Email billing@blackouttrades.com and we'll sort it out personally.",
    },
  ],
  start: [
    {
      q: "How do I get started in 5 minutes?",
      a: "Create your account, unlock Premium, and open the SPX Slayer desk — the live read is there immediately. Ask Largo your first question ('what's the SPX setup right now?'), and if you're newer to options, start with the in-app Learn layer. Inside your first session you'll have the desk's full read in front of you.",
    },
    {
      q: "How do I reach the team?",
      a: `Email us anytime at ${FAQ_SUPPORT_EMAIL} — real people, fast replies. Billing, access, a feature request, or a question about a setup: it reaches the desk.`,
    },
  ],
};

export const FAQ_ITEMS: FaqItem[] = FAQ_CATEGORIES.flatMap((c) =>
  RAW[c.key].map((it, i) => ({
    id: `${c.key}-${i + 1}`,
    catKey: c.key,
    cat: c.label,
    q: it.q,
    a: it.a,
  }))
);
