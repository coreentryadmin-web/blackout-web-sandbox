import { defineToolGuide, CROSS } from "@/lib/learn/guides/shared";

export const heatMapsGuide = defineToolGuide({
  slug: "heat-maps",
  chapter: 6,
  title: "BlackOut Thermal",
  description: "Visual GEX, VEX, DEX, and CHARM surfaces — where dealer hedging pressure concentrates across strikes and expiries.",
  overview: [
    "Thermal renders the full dealer exposure grid that SPX Slayer summarizes as walls, flip, and King Node. Route: `/heatmap`. Default ticker is SPY; switch to SPX or index names via TickerSwitcher.",
    "Two primary views: Matrix (strike × expiry heat table) and Profile + Curve + Shift (ladder bars, cumulative curve, intraday migration). Four lenses: GEX, VEX, DEX, CHARM — each reframes dealer risk.",
    "Overlays tie HELIX flow and dark pool levels onto the profile view. LargoRead provides on-demand AI explanation of the current surface.",
  ],
  layout: {
    title: "Desk layout",
    paragraphs: [
      "Control row at top: ticker search, view tabs (Matrix vs Profile bundle), freshness badge, lens tabs (GEX/VEX/DEX/CHARM).",
      "Matrix view is full-width heat table. Profile view splits 7/5: left exposure ladder + expiry scope; right cumulative curve + shift ladder (GEX/VEX only).",
      "Rail cards below main views: DarkPoolRail, FlowSummary, KeyLevelBox, AlertsStrip, LargoRead — not all visible in every lens.",
    ],
  },
  panels: [
    {
      name: "TickerSwitcher & freshness",
      location: "Top control row",
      purpose: "Select underlying and judge data health before interpreting colors.",
      shows: [
        "Preset tickers with search",
        "Live spot price and session change %",
        "Live / Quote only / Offline badge",
        "Fast-move flash when quote vs matrix spot diverges >0.5%",
      ],
      actions: ["Pick ticker from presets or search"],
      cadence: "Matrix 20s RTH / 60s off-hours; quote 15s / 60s; index spot via pulse SSE",
      consume:
        "Confirm Live before sizing. Quote only means matrix may lag spot — wait for next poll. Fast-move flash triggers force refresh (throttled ≤1 per 8s) — pause until matrix catches spot.",
    },
    {
      name: "Lens tabs (GEX / VEX / DEX / CHARM)",
      location: "Control row — right of view tabs",
      purpose: "Switch dealer exposure type without refetching — all blocks ship in one payload.",
      shows: [
        "GEX: gamma flip, call/put walls, max pain, anchor",
        "VEX: vanna walls and flip",
        "DEX: delta-zero pivot and posture (hidden if absent)",
        "CHARM: charm-zero pivot and pinning (hidden if absent)",
      ],
      actions: ["Click lens tab — client-side switch"],
      cadence: "Instant; data from matrix payload",
      consume:
        "Start GEX for direction and wall logic. Switch VEX when IV is moving faster than price. DEX for delta hedging flow intuition. CHARM late-day for pinning into close. Shift view only applies to GEX and VEX.",
      tip: "DEX/CHARM tabs auto-hide when not in cache for a ticker.",
    },
    {
      name: "Matrix view",
      location: "Main panel — default tab",
      purpose: "Strike × expiry heat map with diverging color scale per lens.",
      shows: [
        "Rows per strike, columns per expiry",
        "Spot row highlight",
        "Signed exposure values in cells",
        "MatrixFreshness as-of timestamp",
      ],
      actions: ["Switch to Profile view for overlays and ladders"],
      cadence: "20s RTH / 60s off-hours",
      consume:
        "Scan horizontally for expiry concentration — 0DTE column dominates SPX intraday. Scan vertically for wall strikes. Compare spot row to flip from KeyLevelBox. Use before entries at Slayer-quoted walls.",
    },
    {
      name: "ExposureProfile + ExpiryScopeBar",
      location: "Profile view — left column",
      purpose: "Strike ladder bars with spot/flip/anchor markers and optional flow/dark pool overlays.",
      shows: [
        "Per-strike exposure bars",
        "Spot, flip, anchor markers",
        "ExpiryScope chips: All · 0DTE · Near · Monthly · per-expiry",
        "HELIX Flow overlay markers (net premium by strike)",
        "Dark Pool horizontal level lines",
      ],
      actions: [
        "Toggle HELIX Flow overlay",
        "Toggle Dark Pool overlay",
        "Click expiry scope chips to re-sum profile",
      ],
      cadence: "Matrix payload; overlays ~30s server cache",
      consume:
        "ExpiryScope narrows noise — use 0DTE for Slayer alignment, All for swing context. Enable flow overlay to see where today's prints concentrated vs static GEX. Dark pool lines show off-lit equity levels that may interact with options structure.",
      tip: "Overlays default on when data exists; muted FlowSummary when ticker not on overlay allowlist.",
    },
    {
      name: "CumulativeCurve + ShiftView",
      location: "Profile view — right column",
      purpose: "Cumulative exposure curve and intraday migration (built/melted strikes).",
      shows: [
        "SVG cumulative exposure curve",
        "Shift ladder: strikes that gained vs lost exposure since open (GEX/VEX)",
      ],
      cadence: "Same matrix poll; shift from intraday snapshot",
      consume:
        "Curve inflection points approximate flip zones. ShiftView answers what changed today — bright built strikes are new concentrations; melted strikes lost dealer interest. Hidden for DEX/CHARM lenses.",
    },
    {
      name: "KeyLevelBox",
      location: "Below main views — rail",
      purpose: "Consolidated structure tiles: flip, walls, max pain, anchor, net total, day-over-day deltas.",
      shows: ["Lens-specific level tiles with info tooltips", "DoD deltas where available"],
      cadence: "From matrix payload each poll",
      consume:
        "Copy these levels to your journal — they should match Slayer header scalars for SPX. Mismatch suggests ticker difference or stale poll — check freshness.",
    },
    {
      name: "AlertsStrip",
      location: "Rail — below key levels",
      purpose: "Positioning event alerts (wall breaks, flip crosses).",
      shows: ["Dismissible alert chips for structural events"],
      actions: ["Dismiss individual alerts"],
      cadence: "Alerts on 20s payload",
      consume:
        "Alerts are event markers — read once, then focus back on matrix. For historical flip/spot context, KeyLevelBox's day-over-day deltas cover whether structure moved vs prior sessions.",
    },
    {
      name: "FlowSummary & DarkPoolRail",
      location: "Compact rail cards",
      purpose: "Today's net call/put premium tilt and dark pool level list for the ticker.",
      shows: [
        "FlowSummary: net premium tilt",
        "DarkPoolRail: compact DP level list",
      ],
      cadence: "Overlay payload ~30s",
      consume:
        "Quick cross-check vs HELIX without leaving Thermal. Flow tilt disagreements with GEX posture warrant caution on directional size.",
    },
    {
      name: "LargoRead",
      location: "Bottom rail — on demand",
      purpose: "AI narrative explaining the current surface in plain language.",
      shows: ["Lazy-loaded explain text after Ask Largo"],
      actions: ["Ask Largo / Hide"],
      cadence: "On demand → /api/market/gex-heatmap/explain (~3 min server cache)",
      consume:
        "Use after you have scanned matrix and key levels — LargoRead synthesizes, does not replace reading the heat. Hide when done to reduce noise. For interactive Q&A, open full Largo terminal.",
    },
  ],
  howItWorks: {
    paragraphs: [
      "Surfaces recompute from live chain during RTH with responsive caching. One API payload carries matrix, overlays, history, and shift blocks; lens and expiry scope are client-side transforms.",
    ],
    features: [
      { title: "Unified payload", body: "Single gex-heatmap fetch powers matrix, profile, overlays, and key levels." },
      { title: "Fast-move guard", body: "Spot divergence >0.5% triggers throttled force refresh." },
      { title: "Overlay allowlist", body: "Some tickers omit flow overlay — FlowSummary shows unavailable copy." },
      { title: "Slayer parity", body: "Same computation family as Slayer walls — Thermal is the full surface." },
    ],
  },
  usage: {
    intro: "Open before sizing at any Slayer-quoted structural level.",
    steps: [
      { title: "Confirm ticker and freshness", body: "SPX for index 0DTE thesis; check Live badge." },
      { title: "Matrix scan", body: "Locate spot row, flip zone, and brightest cells." },
      { title: "Profile + overlays", body: "Enable flow overlay; scope to 0DTE." },
      { title: "Read KeyLevelBox", body: "Copy flip and walls to cross-check Slayer header." },
      { title: "Shift check", body: "Note built/melted strikes since open." },
      { title: "Optional LargoRead", body: "Ask for narrative if structure is ambiguous." },
    ],
  },
  crossLinks: [
    CROSS.spx("Scalar walls and flip on the live desk — must agree for SPX."),
    CROSS.helix("Flow confirmation at highlighted strikes and FlowSummary tilt."),
    CROSS.largo("Full terminal for follow-up questions on regime."),
  ],
  dos: [
    "Use before entries at structural levels.",
    "Switch VEX when vol dominates price.",
    "Scope expiry to 0DTE for Slayer alignment.",
    "Dismiss alerts after reading — reduce clutter.",
  ],
  donts: [
    "Don't stare at static screenshots — levels reprice every 20s.",
    "Don't ignore Quote only / Offline badges.",
    "Don't assume overlays exist for every ticker.",
  ],
  faq: [
    { q: "Thermal vs Slayer GEX?", a: "Same computation family — Thermal is the full surface; Slayer shows key scalars and left-rail 0DTE matrix." },
    { q: "Why SPY default?", a: "Liquid proxy with rich chain; switch to SPX for index-native levels." },
    { q: "What is Shift view?", a: "Intraday migration of exposure — which strikes gained or lost dealer gamma/vanna since open." },
  ],
});
