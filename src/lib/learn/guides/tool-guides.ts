import { defineToolGuide, CROSS } from "@/lib/learn/guides/shared";

export const spxSlayerGuide = defineToolGuide({
  slug: "spx-slayer",
  chapter: 2,
  title: "SPX Slayer",
  description:
    "The flagship real-time SPX desk — GEX walls, gamma flip, play engine verdicts, and 0DTE execution intelligence in one terminal.",
  overview: [
    "SPX Slayer is your primary Regular Trading Hours desk for PM-settled 0DTE SPX options. It unifies dealer gamma structure, volatility regime, flow bias, and BlackOut Intelligence play scoring.",
    "A 30-second play engine evaluates sequential gates during RTH. When all pass, an active play card surfaces with entry, target, and stop — noise is filtered before it reaches your screen.",
    "Cash-settled SPX options are European-style. The desk targets PM-settled 0DTE — the highest-liquidity intraday instrument.",
  ],
  howItWorks: {
    paragraphs: [
      "GEX walls and gamma flip are computed from the live chain each engine cycle. Flow bias compresses HELIX-style institutional direction into an engine input.",
    ],
    features: [
      {
        title: "Sequential gate logic",
        body: "Entry gates (GEX regime, VWAP, EMA stack, flow bias, R:R) → BlackOut Intelligence verdict → option ticket builder → play open. Any failure keeps the desk in SCANNING.",
      },
      {
        title: "Verdict states",
        body: "APPROVE_BUY / APPROVE_SELL open a directional play. SCANNING means conditions are not simultaneously satisfied — not a bug.",
      },
      {
        title: "Key levels",
        body: "Call wall, put wall, gamma flip, King Node, and VWAP define the structural session. IV Percentile (IVP) flags expensive vs cheap premium environments.",
      },
    ],
  },
  usage: {
    intro: "Pair with Night Hawk pre-market and HELIX intraday.",
    steps: [
      { title: "Pre-market context", body: "Review Night Hawk Evening Edition for GEX levels and bias." },
      { title: "Orient at the open", body: "Identify call wall, put wall, flip, and King Node within the first minutes." },
      { title: "Wait for verdict", body: "Do not front-run SCANNING. Let the engine align gates." },
      { title: "Execute with discipline", body: "Honor stop and target from the play card. Log the position in Night's Watch." },
      { title: "Confirm with flow", body: "Monitor HELIX for institutional prints that confirm or contradict direction." },
    ],
  },
  crossLinks: [
    CROSS.thermal("Full GEX surface across strikes — complements scalar walls on the desk."),
    CROSS.helix("Raw flow tape behind the compressed flow bias signal."),
    CROSS.hawk("Evening playbook supplies pre-open structural context."),
    CROSS.largo("Structured Q&A on live desk state and GEX regime."),
    CROSS.watch("Live P&L and exit tracking after you enter a play."),
    CROSS.grid("Macro catalysts that can override intraday GEX mechanics."),
  ],
  dos: [
    "Use gamma flip as the primary regime switch.",
    "Cross-check walls in Thermal before sizing at a level.",
    "Reduce size when IVP is elevated.",
    "Honor published stops — R:R was sized at gate evaluation.",
  ],
  donts: [
    "Don't trade against SCANNING by anticipating the engine.",
    "Don't confuse IV Rank with IV Percentile.",
    "Don't treat walls as guaranteed S/R — they are dealer hedge concentrations.",
    "Don't over-size 0DTE — gamma accelerates into the close.",
  ],
  faq: [
    {
      q: "Why SCANNING during a strong trend?",
      a: "Trend alone is insufficient. VWAP extension, R:R at walls, flow confirmation, and AI approval must align concurrently.",
    },
    {
      q: "How are GEX walls different from chart S/R?",
      a: "Walls are forward-looking dealer hedge obligations from open interest — mechanistic, not memory-based.",
    },
  ],
  glossary: [
    {
      name: "Engine",
      terms: [
        { term: "SCANNING", def: "Default state — one or more gates failed; no play is open." },
        { term: "King Node", def: "Strike with highest absolute session GEX — intraday gravitational center." },
      ],
    },
  ],
});

export const helixFlowsGuide = defineToolGuide({
  slug: "helix-flows",
  chapter: 3,
  title: "HELIX",
  description:
    "Institutional options flow tape — sweeps, blocks, and unusual prints filtered for size and conviction.",
  overview: [
    "HELIX surfaces the options flow that matters: large premium, aggressive sweeps, and prints that suggest institutional positioning rather than routine hedging.",
    "The tape feeds SPX Slayer's flow bias gate and provides raw confirmation when price approaches GEX walls.",
    "Run HELIX alongside your primary desk — it is confirmation layer, not a standalone signal generator.",
  ],
  howItWorks: {
    paragraphs: ["Flow is ingested continuously during RTH and scored for unusual characteristics relative to open interest and historical volume."],
    features: [
      { title: "Whale filtering", body: "Premium and size thresholds elevate prints that move dealer risk." },
      { title: "Directional bias", body: "Aggregated call vs put premium hints at institutional lean — fed into Slayer gates." },
      { title: "Dark pool context", body: "Off-exchange equity prints may appear in Grid; HELIX focuses on listed options flow." },
    ],
  },
  usage: {
    steps: [
      { title: "Dock beside SPX Slayer", body: "Keep HELIX visible during active plays." },
      { title: "Watch at walls", body: "Large prints into call/put walls are structurally meaningful." },
      { title: "Challenge your thesis", body: "Counter-flow from institutions is a valid early exit signal." },
    ],
  },
  crossLinks: [
    CROSS.spx("Engine consumes compressed flow bias from this tape."),
    CROSS.thermal("See where dealer gamma concentrates as flow hits strikes."),
    CROSS.grid("Macro news that explains sudden flow spikes."),
  ],
  dos: ["Treat sweeps as urgency signals.", "Correlate flow direction with gamma regime above/below flip."],
  donts: ["Don't chase every print — context at structure matters.", "Don't ignore SPX Slayer SCANNING while flow runs hot."],
  faq: [{ q: "Is HELIX real-time?", a: "Yes during RTH, subject to feed latency. Check freshness indicators on the desk." }],
});

export const largoAiGuide = defineToolGuide({
  slug: "largo-ai",
  chapter: 4,
  title: "Largo",
  description:
    "BlackOut Intelligence desk analyst wired to live GEX, flow, and positioning — structured reasoning, not generic chat.",
  overview: [
    "Largo answers structured market questions using tool calls into live platform data: GEX structure, flow context, positions, and regime.",
    "It is an analysis terminal, not a quote feed. Use SPX Slayer for price and Largo for interpretation.",
  ],
  howItWorks: {
    paragraphs: ["Each response may invoke platform tools (get_spx_structure, get_flow_context, etc.) so answers cite current data."],
    features: [
      { title: "Grounded responses", body: "Live tool calls prevent stale training-data hallucinations on levels and regime." },
      { title: "Session memory", body: "Conversations persist per session for multi-step analysis." },
      { title: "Kill-switch aware", body: "Spend limits protect platform-wide AI budget — rare 503 during outages." },
    ],
  },
  usage: {
    steps: [
      { title: "Ask specific questions", body: '"Where is gamma flip vs spot?" beats "Should I buy?"' },
      { title: "Cross-check Slayer", body: "Compare Largo output to active play card and walls." },
      { title: "Use after ambiguous flow", body: "When HELIX and structure disagree, Largo can synthesize." },
    ],
  },
  crossLinks: [
    CROSS.spx("Shares live desk state Largo can reference."),
    CROSS.helix("Flow context tool calls mirror HELIX themes."),
    CROSS.thermal("GEX surface detail beyond scalar walls."),
  ],
  dos: ["Ask falsifiable questions about current data.", "Use for thesis stress-tests."],
  donts: ["Don't use for entry timing alone.", "Don't treat output as trade advice."],
  faq: [{ q: "Does Largo work off-hours?", a: "Yes, but data may be last RTH snapshot — it will say when stale." }],
});

export const nightHawkGuide = defineToolGuide({
  slug: "night-hawk",
  chapter: 5,
  title: "Night Hawk",
  description: "Evening playbook — tomorrow's SPX setups, GEX context, and invalidation levels published after the close.",
  overview: [
    "Night Hawk publishes the Evening Edition: market context, catalyst scan, GEX positioning, thesis, play ideas, and invalidation levels.",
    "It is asynchronous preparation — not a live execution desk. SPX Slayer takes over at the open.",
  ],
  howItWorks: {
    paragraphs: ["Scans end-of-day chain and flow to curate high-conviction setups for the next session."],
    features: [
      { title: "Edition blocks", body: "Structured six-block document for repeatable pre-market review." },
      { title: "Invalidation levels", body: "Hard levels that void the thesis if breached." },
      { title: "Night's Watch integration", body: "Same /nighthawk route hosts position manager UI." },
    ],
  },
  usage: {
    steps: [
      { title: "Read after 4:30 PM ET", body: "Bookmark the edition cadence." },
      { title: "Note invalidation", body: "Carry levels into pre-market Grid scan." },
      { title: "Validate at open", body: "Slayer may disagree — markets change overnight." },
    ],
  },
  crossLinks: [
    CROSS.spx("Live execution desk for RTH."),
    CROSS.grid("Overnight catalysts that override the edition."),
    CROSS.watch("Track plays opened from Night Hawk ideas."),
  ],
  dos: ["Use as bias, not autopilot.", "Re-read invalidation at the open."],
  donts: ["Don't enter solely on yesterday's edition without open validation."],
  faq: [{ q: "Night Hawk vs SPX Slayer?", a: "Night Hawk = evening publication; Slayer = live RTH engine." }],
});

export const heatMapsGuide = defineToolGuide({
  slug: "heat-maps",
  chapter: 6,
  title: "BlackOut Thermal",
  description: "Visual GEX, VEX, DEX, and CHARM surfaces — where dealer hedging pressure concentrates.",
  overview: [
    "Thermal renders the full dealer exposure grid SPX Slayer summarizes as walls and flip.",
    "Toggle lenses (GEX, VEX, etc.) to see regime shifts across strikes and expiries.",
  ],
  howItWorks: {
    paragraphs: ["Surfaces recompute from live chain during RTH with caching for responsive UI."],
    features: [
      { title: "Strike ladder", body: "Spot row and matrix show concentration at a glance." },
      { title: "Lens toggles", body: "Switch exposure type without leaving the board." },
      { title: "SPX focus", body: "Optimized for index 0DTE context; other tickers may be available." },
    ],
  },
  usage: {
    steps: [
      { title: "Confirm Slayer walls", body: "Visual proof before sizing at a quoted wall." },
      { title: "Watch flip zone", body: "Chop often clusters around gamma flip transitions." },
      { title: "Pair with HELIX", body: "Flow into bright matrix cells is high signal." },
    ],
  },
  crossLinks: [
    CROSS.spx("Scalar walls and flip on the live desk."),
    CROSS.helix("Flow confirmation at highlighted strikes."),
  ],
  dos: ["Use before entries at structural levels."],
  donts: ["Don't stare at static screenshots — levels reprice."],
  faq: [{ q: "Thermal vs Slayer GEX?", a: "Same computation family — Thermal is the full surface; Slayer shows key scalars." }],
});

export const nightsWatchGuide = defineToolGuide({
  slug: "nights-watch",
  chapter: 7,
  title: "Night's Watch",
  description: "Personal options position manager — live P&L, Greeks, and exit guidance on logged positions.",
  overview: [
    "Night's Watch tracks positions you log on-platform. It does not connect to your brokerage — you maintain the book.",
    "Live chain pricing drives P&L and Greeks; valuation status shows freshness.",
  ],
  howItWorks: {
    paragraphs: ["Positions stored per Clerk user. Pricing refreshed from options chain APIs."],
    features: [
      { title: "Verdict engine", body: "HOLD / TRIM / SELL guidance based on structure and P&L." },
      { title: "Live marks", body: "live / stale / unavailable states surface data quality." },
      { title: "Night Hawk route", body: "Accessible from /nighthawk alongside playbook content." },
    ],
  },
  usage: {
    steps: [
      { title: "Log immediately on entry", body: "Greeks require current position data." },
      { title: "Monitor verdict", body: "Use as discipline aid — not automatic execution." },
      { title: "Close when invalidation hits", body: "Align with Night Hawk / Slayer levels." },
    ],
  },
  crossLinks: [
    CROSS.spx("Play cards supply entry/stop/target references."),
    CROSS.hawk("Evening invalidation levels for swing context."),
  ],
  dos: ["Update size and strikes accurately.", "Check valuation status before trusting P&L."],
  donts: ["Don't assume brokerage sync — manual book only."],
  faq: [{ q: "Why stale pricing?", a: "Chain fetch delayed >30s — retry or check market hours." }],
});

export const blackoutGridGuide = defineToolGuide({
  slug: "blackout-grid",
  chapter: 8,
  title: "BlackOut Grid",
  description: "Cross-market intelligence board — news, flow, earnings, sectors, catalysts, and macro context.",
  overview: [
    "Grid aggregates panels you can show, hide, and reorder — a single situational awareness board.",
    "Use pre-market to stress-test Night Hawk and intraday to explain flow anomalies.",
  ],
  howItWorks: {
    paragraphs: ["Bootstrap API loads panel data; ticker context filters applicable modules."],
    features: [
      { title: "Modular panels", body: "News, movers, earnings, congress, dark pool, GEX snapshot, and more." },
      { title: "Ticker filter", body: "Search bar scopes relevant panels to a symbol." },
      { title: "Plain void UI", body: "Calm backdrop — data panels are the focus." },
    ],
  },
  usage: {
    steps: [
      { title: "Pre-market scan", body: "Economic calendar + overnight headlines." },
      { title: "Set ticker when researching", body: "Use / key focus on search in header." },
      { title: "Cross-link to Slayer", body: "Macro catalysts override micro GEX temporarily." },
    ],
  },
  crossLinks: [
    CROSS.hawk("Evening thesis validation."),
    CROSS.spx("RTH execution after macro check."),
    CROSS.helix("Deeper flow than Grid summaries."),
  ],
  dos: ["Check calendar before FOMC/CPI days."],
  donts: ["Don't ignore high-impact events when sizing 0DTE."],
  faq: [{ q: "Is Grid real-time?", a: "Panel-dependent — each module shows its own freshness." }],
});
