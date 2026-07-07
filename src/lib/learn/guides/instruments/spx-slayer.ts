import { defineToolGuide, CROSS } from "@/lib/learn/guides/shared";

export const spxSlayerGuide = defineToolGuide({
  slug: "spx-slayer",
  chapter: 2,
  title: "SPX Slayer",
  description:
    "The flagship real-time SPX desk — GEX walls, gamma flip, play engine verdicts, and 0DTE execution intelligence in one terminal.",
  overview: [
    "SPX Slayer is your primary Regular Trading Hours desk for PM-settled 0DTE SPX options. It unifies dealer gamma structure, volatility regime, flow bias, and BlackOut Intelligence play scoring into a single three-column terminal.",
    "The desk is built around one merged data spine (`useMergedDesk`): pulse, full desk, and flow lanes combine into a single payload that feeds the header, commentary rail, and session gates. The play engine and 0DTE matrix poll independently because they move on different clocks.",
    "Cash-settled SPX options are European-style. The desk targets PM-settled 0DTE — the highest-liquidity intraday instrument. Treat SCANNING as the default honest state: the engine only surfaces a play when sequential gates align.",
  ],
  layout: {
    title: "Desk layout",
    paragraphs: [
      "Open `/dashboard` on a wide screen for the intended experience. On mobile, panels stack with Trade Alerts first; on xl breakpoints you get a true command center: left GEX matrix, center play engine, right Largo commentary. The left rail is matrix-only — no Benzinga scroll, live tape, or interval-flow panels.",
      "Optional halt banners sit above everything. A confirmed active halt blocks entries; a degraded halt feed does not block by itself (the engine fails open with a warning) — read that banner before interpreting any verdict below it, and manually verify no active halt exists.",
      "Scan top-to-bottom, left-to-right during the open: header for regime → left matrix for strike context → center for actionable verdict → right rail for narrative synthesis. Do not start in the commentary rail and work backward.",
    ],
  },
  panels: [
    {
      name: "Trading halt banners",
      location: "Top of page — above header",
      purpose:
        "Exchange halt awareness and feed health. A confirmed active halt on a watched symbol blocks new entries regardless of play engine state. A degraded halt feed does NOT block entries by itself — the engine fails open and warns instead, since blocking every entry on a transient feed gap was too aggressive.",
      shows: [
        "Active halts: symbol, halt type, reason",
        "Halt feed degraded warning during an active session when the channel hasn't updated",
      ],
      cadence: "Updates with merged desk (~2s flow lane)",
      consume:
        "Read this first every time you land on the desk. A green play card means nothing if the TRADING HALT banner is showing — that one blocks entries for real. The degraded-feed banner is a caution, not a block: manually verify no active halt exists before entering.",
      tip: "Halts on SPX or related indices can freeze the entire 0DTE thesis — do not try to trade through them.",
    },
    {
      name: "SpxSniperHeader",
      location: "Full-width top bar",
      purpose:
        "Session command bar: spot price, volatility context, trend structure, and the scalar GEX summary that frames every other panel.",
      shows: [
        "Hero SPX price with animated tick and session % change",
        "Inline pills: VIX, VWAP (bull/bear tint by above_vwap), net GEX",
        "Metric blocks: EMA 20/50/200, SMA 50/200, HOD/PDH, LOD/PDL",
        "Right cluster: market status, FreshnessChip (live/stale/offline), Regime, γ Flip, Max Pain, IV Rank",
      ],
      actions: ["Display only — no clicks required; use FreshnessChip to judge data trust"],
      cadence: "Merged desk: pulse 1s (no SSE) or 10s (SSE connected), flow 2s, full desk 10s",
      consume:
        "Establish regime in ten seconds: Is spot above or below VWAP? Where is gamma flip relative to price? Is IV Rank elevated (expensive premium) or compressed? Regime and flip together tell you whether dealer hedging is likely to dampen or amplify moves. Only after this scan should you read the play engine.",
      tip: "FreshnessChip goes stale if polled data is older than ~90s or feed_stalled is set — do not size up on stale structure.",
    },
    {
      name: "SpxGexMatrixHeatmap",
      location: "Left rail (matrix-only — no tape or news panels)",
      purpose:
        "Compact multi-expiry dealer GEX/VEX matrix with spot row, per-column kings, and 0DTE-scoped flip totals.",
      shows: [
        "Lens toggle: GEX vs VEX",
        "γ flip and net exposure for the active 0DTE (or front-expiry) column",
        "Sticky grid: Strike × expiry columns with signed dollar cells",
        "Spot row highlight, king nodes (★), column max +/- gamma walls",
        "Cross-validation note when UW oracle diverges from Polygon walls",
        "Matrix as-of timestamp and stale badge when GEX is aged",
      ],
      actions: [
        "Toggle GEX / VEX lens",
        "Auto-scroll keeps the spot strike row centered when price moves",
      ],
      cadence: "GEX heatmap poll: 8s RTH / 20s off-hours; live spot via pulse SSE",
      consume:
        "Use this panel to validate wall quotes from the header before sizing. Bright positive GEX above spot often acts as a speed bump; negative GEX below can accelerate breaks. Switch to VEX when vol is moving faster than price — vanna exposure shifts when IV changes. Cross-check flip location here against Thermal when the trade depends on a level.",
      tip: "The matrix is the visual proof behind scalar call/put walls — if Slayer says call wall at 6050, find that strike here before entry.",
    },
    {
      name: "SpxTradeAlerts (Play Engine)",
      location: "Center column — hero panel",
      purpose:
        "Actionable 0DTE trade state: engine verdict, option ticket, confirmations, confluence, play history, and optional lotto dock.",
      shows: [
        "Header: PLAY ENGINE / Trade Alerts with LIVE or OFFLINE badge",
        "Scanning state when no open play or market closed copy off-hours",
        "Hero when live: action (BUY CALL/PUT, SELL, HOLD, TRIM, WATCH, SCANNING), headline, option ticket, thesis, grade, score, confidence %",
        "Entry / stop / target grid and invalidation line",
        "Claude verdict on BUY states",
        "Confirmations panel: pass/fail gates, 5m trend/RSI/3m close/MTF, WATCH metadata, telemetry, warnings",
        "Confluence factors (top 10) and play log (last 9 entries)",
        "LottoPlayBlock (7:00–10:30 AM ET): phase, contract, targets, triggers, flow/intel, sizing",
      ],
      actions: [
        "Passive audio cue on SCANNING→BUY or SCANNING→WATCHING transitions",
        "No click-to-trade — use ticket details for your broker",
      ],
      cadence: "Play engine: 3s during session; lotto: 10s after open / 60s pre-open in window",
      consume:
        "Wait for a non-SCANNING verdict during live session before acting. When BUY appears, read confirmations first — failed gates explain why prior scans did not fire. Honor entry, stop, and target as sized at gate evaluation; invalidation is the hard thesis break. WATCH means conditions are forming, not permission to front-run. Use confluence factors to understand why the engine scored the setup, not as a checklist to override the verdict.",
      tip: "If confirmations show MTF or flow failures while headline looks bullish, trust the gate layer — the engine is filtering noise.",
    },
    {
      name: "SpxCommentaryRail (Largo feed)",
      location: "Right rail",
      purpose:
        "Live AI desk commentary synthesized from the current merged desk snapshot — bias, changes, and watch items in card form.",
      shows: [
        "Live / standby indicator and Reading… state while fetching",
        "Offline copy tuned to session (weekend, premarket, extended, closed)",
        "Feed cards (up to 24): bias chip, time, headline, changed[] bullets, body lines, Watch list",
        "Featured card with expand/collapse after 12 lines",
      ],
      actions: ["Expand/collapse featured analysis on long cards"],
      cadence:
        "Server ~5-min generation windows; client minimum ~55s between fetches; refetch on material price/regime changes",
      consume:
        "Use after you have read header + matrix + play state. Commentary explains what changed, not what to click. Watch lists are monitoring items, not entries. When offline, read the tone-specific hero — it tells you why the rail is quiet. For deep follow-up questions, open full Largo on `/terminal`.",
      tip: "Deduped by as_of timestamp — if cards stop updating, check FreshnessChip on the header before blaming the AI.",
    },
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
        body: "Call wall, put wall, gamma flip, King node, and VWAP define the structural session. IV Rank flags expensive vs cheap premium environments.",
      },
      {
        title: "Data merge cache",
        body: "Session storage preserves merged desk across quick refreshes (7.5s write throttle). Midnight ET rollover resets session context automatically.",
      },
    ],
  },
  usage: {
    intro: "Pair with Night Hawk pre-market and HELIX intraday. This workflow assumes RTH unless noted.",
    steps: [
      {
        title: "Pre-market context",
        body: "Review Night Hawk Evening Edition for GEX levels and bias. Note invalidation before the open.",
      },
      {
        title: "Land on the desk",
        body: "Check halt banners and FreshnessChip. Read header for flip, VWAP, and IV Rank.",
      },
      {
        title: "Validate structure",
        body: "Scroll the left matrix to confirm walls and flip zone. Cross-check in Thermal if sizing at a level.",
      },
      {
        title: "Wait for verdict",
        body: "Do not front-run SCANNING. Read confirmations when a BUY or WATCH state appears.",
      },
      {
        title: "Execute with discipline",
        body: "Honor stop and target from the play card. Journal the entry immediately.",
      },
      {
        title: "Confirm with flow",
        body: "Keep HELIX visible. Counter-flow at walls is a valid early exit signal.",
      },
    ],
  },
  crossLinks: [
    CROSS.thermal("Full GEX surface across strikes — complements scalar walls on the desk."),
    CROSS.helix("Raw flow tape behind the compressed flow bias signal."),
    CROSS.hawk("Evening playbook supplies pre-open structural context."),
    CROSS.largo("Structured Q&A on live desk state and GEX regime."),
  ],
  dos: [
    "Use gamma flip as the primary regime switch.",
    "Cross-check walls in Thermal before sizing at a level.",
    "Reduce size when IV Rank is elevated.",
    "Honor published stops — R:R was sized at gate evaluation.",
    "Read panel reference top-to-bottom on first visit each session.",
  ],
  donts: [
    "Don't trade against SCANNING by anticipating the engine.",
    "Don't confuse IV Rank with IV Percentile.",
    "Don't treat walls as guaranteed S/R — they are dealer hedge concentrations.",
    "Don't over-size 0DTE — gamma accelerates into the close.",
    "Don't ignore halt banners or stale freshness chips.",
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
    {
      q: "Why does the matrix have its own poll if the header already shows GEX?",
      a: "The header summarizes session scalars; the matrix shows per-strike distribution and supports VEX lens — essential for precision entries.",
    },
    {
      q: "What is the lotto dock?",
      a: "A separate 0DTE setup engine active 7:00–10:30 AM ET with its own poll cadence. It complements, not replaces, the main play engine.",
    },
  ],
  glossary: [
    {
      name: "Engine",
      terms: [
        { term: "SCANNING", def: "Default state — one or more gates failed; no play is open." },
        { term: "King node", def: "Strike with highest absolute session GEX — intraday gravitational center." },
        { term: "FreshnessChip", def: "Live/stale/offline indicator for merged desk polling health." },
      ],
    },
  ],
});
