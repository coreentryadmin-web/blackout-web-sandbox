import { defineToolGuide, CROSS } from "@/lib/learn/guides/shared";

export const helixFlowsGuide = defineToolGuide({
  slug: "helix-flows",
  chapter: 3,
  title: "HELIX",
  description:
    "Institutional options flow tape — sweeps, blocks, and unusual prints filtered for size and conviction.",
  overview: [
    "HELIX surfaces the options flow that matters: large premium, aggressive sweeps, and prints that suggest institutional positioning rather than routine hedging.",
    "The page stacks context layers before the tape: tide bar for session lean, anomaly banner for regime events, AI brief for narrative, then filters and the main alert stream with an analytics column.",
    "Run HELIX alongside SPX Slayer — it is a confirmation layer, not a standalone signal generator. Flow bias on the Slayer desk is a compressed view of what you see here in raw form.",
  ],
  layout: {
    title: "Desk layout",
    paragraphs: [
      "Route: `/flows`. Below the page header you get HelixTideBar, then FlowAnomalyBanner, then the FlowFeed desk — filter bar, watchlist, main tape (left 8 cols), analytics column (right 4 cols).",
      "TickerDrawer opens as a right overlay when you click any alert or analytics row — it is drill-down, not a permanent panel.",
      "Keep HELIX on a second monitor or split screen with Slayer during active plays. The tape moves continuously via SSE when connected.",
    ],
  },
  panels: [
    {
      name: "HelixTideBar",
      location: "Header rail — below page title",
      purpose: "Compact SPX market-tide indicator: institutional call vs put premium lean for the session.",
      shows: [
        "BULLISH / BEARISH / NEUTRAL pill",
        "Call vs put premium split bar with dollar amounts",
        "Tide label",
      ],
      cadence: "15s poll via merged SPX state",
      consume:
        "Glance once per few minutes for session direction. Tide disagreements with Slayer flow bias are worth investigating in the tape — someone is leaning differently at the aggregate level.",
      tip: "Self-hides when desk data is unavailable — if missing, check session hours and entitlements first.",
    },
    {
      name: "FlowAnomalyBanner",
      location: "Full-width strip above FlowFeed",
      purpose: "Surfaces recent flow anomalies from market-regime detection — unusual clustering or severity events.",
      shows: [
        "Every anomaly detected in the last 15 minutes (no display cap)",
        "Severity badge, ticker, direction, detail text",
        "Critical items pulse visually",
      ],
      actions: ["Dismiss (session-local — returns if new anomalies arrive)"],
      cadence: "20s poll + refetch on window focus",
      consume:
        "When this banner appears, pause and read before filtering the tape. Anomalies often precede vol expansion or sector rotation. Dismiss only after you have noted the tickers — it is a push notification for the desk.",
    },
    {
      name: "FlowBrief",
      location: "Top of FlowFeed — first panel",
      purpose: "AI narrative summary of current session flow themes.",
      shows: [
        "RTH: AI brief · Live with server-generated text and as-of time (ET)",
        "After hours: static rotating copy with After hours badge",
      ],
      cadence: "Fetch on mount + every 15 min during RTH; RTH check every 60s",
      consume:
        "Read at session open and after lunch lull. The brief orients you before scrolling hundreds of prints. After close, do not expect live updates — preserved last RTH brief may still display.",
    },
    {
      name: "Filter bar & WatchlistBar",
      location: "Between FlowBrief and main grid",
      purpose: "Control what appears in the tape: premium floor, type, ticker, replay, audio, export, and starred tickers.",
      shows: [
        "MIN premium: $200K / $500K / $1M / $20M+",
        "Type: ALL / CALL / PUT with live counts",
        "Ticker text filter (max 6 chars)",
        "Replay controls with 0.5× / 1× / 2× speed",
        "Whale audio toggle (>$1M)",
        "Watchlist-only star filter",
        "CSV export of current displayAlerts",
        "Alert count, newest age, Live / Stale / Offline dot",
      ],
      actions: [
        "Set premium floor and type filter",
        "Filter by ticker or watchlist stars",
        "Toggle replay mode for historical tape review",
        "Export CSV for journaling",
        "Star/unstar tickers in WatchlistBar chips",
      ],
      cadence: "Counts update on each SSE message; staleness if newest print >5 min",
      consume:
        "Start at $500K or $1M during busy sessions — $200K is the ingest floor but noisy at open. Use CALL/PUT filter when testing a directional thesis. Watchlist-only mode turns HELIX into a personal radar. Stale/offline dot means fall back to 30s REST poll — treat tape as degraded.",
      tip: "Pressing star on a ticker both saves it and enables quick filter-from-watchlist workflow.",
    },
    {
      name: "FlowAlertStream",
      location: "Main grid — left column (8/12 on lg+)",
      purpose: "Primary live options flow tape — the HELIX panel proper.",
      shows: [
        "Per card: ticker, CALL/PUT, rule badges (SWEEP/FLOOR/BLOCK/etc.), WHALE, 0DTE",
        "Premium, age, strike/expiry/DTE, ask%, score, direction",
        "Context badges: STACKING, SPLIT, HAWK, VELOCITY, COORD, GEX proximity (FLIP/CALL WALL/PUT WALL), earnings",
        "OTM%, open interest, IV",
        "↑ N new scroll prompt when scrolled down; Load more cap at 150 cards",
      ],
      actions: [
        "Click card → open TickerDrawer",
        "Star/unstar ticker from card",
        "Scroll to catch up on backlog",
      ],
      cadence: "SSE live when connected; REST fallback 30s when SSE down",
      consume:
        "Scan top-down for recency — age column tells you if you are late. WHALE and SWEEP together imply urgency. GEX proximity badges tie prints to Slayer structure — a sweep into call wall is structurally different from random OTM lotto. STACKING and COORD suggest repeated institutional activity; use TickerDrawer to confirm. Do not chase every print — context at walls and flip matters.",
      tip: "UNKNOWN option_type rows are dropped server-side — if a name disappears, it failed type validation.",
    },
    {
      name: "Analytics column",
      location: "Main grid — right column (4/12)",
      purpose: "Derived analytics from the in-memory tape plus supplemental dark pool and Night Hawk data.",
      shows: [
        "Always: Net Premium leaderboard (top 6 tickers), Strike Stacks, Dark Pool panel",
        "Expanded: Velocity Radar, Night Hawk Flow, Split Flow Radar, Sector Flow, Cumulative Net Premium chart",
      ],
      actions: [
        "More panels / Fewer panels toggle",
        "Click stack or radar row → TickerDrawer",
      ],
      cadence: "Recomputes on tape updates; dark pool 30s; Night Hawk edition 120s",
      consume:
        "Net Premium answers who is winning call vs put today. Strike Stacks surface repeat activity at the same strike — often more informative than one-off sweeps. Expand panels when researching rotation (Sector Flow) or conflicting legs (Split Flow Radar). Velocity Radar highlights acceleration — prints in the last 15m vs prior 15m.",
      tip: "Night Hawk Flow panel links evening playbook plays to live conviction — useful at the open.",
    },
    {
      name: "TickerDrawer",
      location: "Right-side overlay — opens on demand",
      purpose: "Per-ticker drill-down: recent flow, premium split, and dark pool prints.",
      shows: [
        "Ticker header with call% bias pill",
        "Call/put premium summary bar",
        "Up to 40 flow rows respecting parent type filter",
        "Dark pool prints for the ticker",
      ],
      actions: ["Close drawer", "Star/unstar ticker"],
      cadence: "Fetch on open/ticker change only — no auto-refresh",
      consume:
        "Open when a card or analytics row catches your eye. Read premium split before direction — heavy call premium with bearish price action may mean hedging, not bullishness. Refresh by closing and re-opening if you need a later snapshot.",
    },
  ],
  howItWorks: {
    paragraphs: [
      "Flow is ingested continuously during RTH and scored for unusual characteristics relative to open interest and historical volume. SSE delivers prints in real time; REST backfills when the stream drops.",
    ],
    features: [
      { title: "Whale filtering", body: "Premium and size thresholds elevate prints that move dealer risk." },
      { title: "Directional bias", body: "Aggregated call vs put premium hints at institutional lean — fed into Slayer gates." },
      { title: "GEX proximity tagging", body: "Prints near flip or walls get contextual badges tied to the same GEX engine as Slayer." },
      { title: "Anomaly layer", body: "Regime detector writes anomalies consumed by the banner — separate from raw tape ingest." },
    ],
  },
  usage: {
    intro: "Dock beside SPX Slayer during RTH.",
    steps: [
      { title: "Orient with tide + brief", body: "Read HelixTideBar and FlowBrief before touching filters." },
      { title: "Set premium floor", body: "Raise minimum premium in fast markets to reduce noise." },
      { title: "Watch at walls", body: "Filter SPX or watch Slayer levels while scanning GEX proximity badges." },
      { title: "Drill down", body: "Open TickerDrawer on STACKING or WHALE prints that align with your thesis." },
      { title: "Challenge your thesis", body: "Counter-flow from institutions is a valid early exit signal on Slayer plays." },
    ],
  },
  crossLinks: [
    CROSS.spx("Engine consumes compressed flow bias from this tape."),
    CROSS.thermal("See where dealer gamma concentrates as flow hits strikes."),
    CROSS.hawk("Night Hawk Flow panel links edition plays to live tape."),
  ],
  dos: [
    "Treat sweeps as urgency signals.",
    "Correlate flow direction with gamma regime above/below flip.",
    "Use analytics column for rotation and stacking — not just the raw tape.",
    "Export CSV for post-session review.",
  ],
  donts: [
    "Don't chase every print — context at structure matters.",
    "Don't ignore SPX Slayer SCANNING while flow runs hot.",
    "Don't assume call premium always means bullish intent.",
    "Don't trust stale tape — check Live/Stale/Offline dot.",
  ],
  faq: [
    { q: "Is HELIX real-time?", a: "Yes during RTH via SSE when connected. REST fallback polls every 30s if the stream drops." },
    { q: "Why $200K minimum if I can filter higher?", a: "$200K is the server ingest floor; UI filters let you raise the display threshold." },
    { q: "What is replay mode?", a: "Historical tape playback at 0.5×–2× speed for review — not live trading." },
  ],
});
