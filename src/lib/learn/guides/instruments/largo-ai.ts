import { defineToolGuide, CROSS } from "@/lib/learn/guides/shared";

export const largoAiGuide = defineToolGuide({
  slug: "largo-ai",
  chapter: 4,
  title: "Largo",
  description:
    "BlackOut Intelligence desk analyst wired to live GEX, flow, and positioning — structured reasoning, not generic chat.",
  overview: [
    "Largo answers structured market questions using tool calls into live platform data: GEX structure, flow context, positions, regime, and Night Hawk editions.",
    "Unlike the SPX Slayer commentary rail (push feed), Largo is pull-based: you ask, it fetches, it responds with cited tool traces. It is an analysis terminal, not a quote feed.",
    "Route: `/terminal`. Session persists in sessionStorage so multi-step investigations survive refresh within the same browser session.",
  ],
  layout: {
    title: "Desk layout",
    paragraphs: [
      "Largo is a single full-page chat surface — no side rails. The message log occupies the center; starter prompts appear when empty; input row sits at the bottom.",
      "While working, LargoThinkingState replaces idle UI: rotating phrases, pipeline nodes, and live tool trace labels show which data sources are being queried.",
      "Tool chips under each assistant message list what was actually fetched — always read them before trusting a number in the prose.",
    ],
  },
  panels: [
    {
      name: "Message log",
      location: "Center — main scroll region",
      purpose: "Conversation thread between you and Largo with markdown-rendered answers.",
      shows: [
        "User bubbles (your questions)",
        "Assistant bubbles with LargoMessageBody markdown",
        "Tools-used chips per answer listing invoked data sources",
        "aria-live region for accessibility during streaming",
      ],
      actions: ["Scroll history; read tool chips to verify grounding"],
      cadence: "Updates on each submitted question via streaming response",
      consume:
        "Read answers top-to-bottom but verify numbers against tool chips. If get_spx_structure ran, levels should match Slayer/Thermal. If no tools ran, treat output as general commentary only. Long answers may include tables — scan headers first.",
    },
    {
      name: "Starter prompts (Try asking)",
      location: "Empty state — above input",
      purpose: "Four fixed example questions that demonstrate good query shape.",
      shows: [
        "SPX setup question",
        "Flow noise question",
        "Gamma map question",
        "Three-line structure summary",
      ],
      actions: ["One-click send — populates and submits the prompt"],
      cadence: "Static copy",
      consume:
        "Use these as templates: specific, falsifiable, data-grounded. Adapt wording to your session — e.g. swap in your ticker or time window. Avoid yes/no trade permission questions.",
      tip: "Good Largo questions name the instrument, the lens (GEX, flow, regime), and what would change your mind.",
    },
    {
      name: "Follow-up chips (Ask next)",
      location: "Below last assistant message",
      purpose: "Dynamic suggested follow-ups based on the prior answer (up to 3).",
      shows: ["Contextual next questions generated with the response"],
      actions: ["One-click send"],
      cadence: "Regenerated per response",
      consume:
        "Follow-ups are the fastest way to drill deeper without retyping context. Use them for stress-tests: What invalidates this? What does flow show at the wall? What changed since open?",
    },
    {
      name: "Input row",
      location: "Bottom — fixed compose area",
      purpose: "Free-form question entry with busy state while Largo is working.",
      shows: [
        "Placeholder marquee when idle",
        "Disabled/busy state during streaming",
        "Send button",
      ],
      actions: ["Type question and submit form", "Wait for busy to clear before next send"],
      cadence: "On-demand per message",
      consume:
        "One question per thread turn keeps tool traces readable. If you need a multi-part investigation, use follow-ups rather than stuffing six questions into one message — routing picks tools per intent.",
      tip: "503 responses may appear during AI budget kill-switch — retry after a minute; data desks still work.",
    },
    {
      name: "LargoThinkingState",
      location: "Replaces input area while loading",
      purpose: "Transparency into in-flight tool calls and pipeline progress.",
      shows: [
        "Rotating status phrases",
        "Pipeline node visualization",
        "Active tool labels (e.g. SPX desk, GEX map, HELIX flow tape, Night Hawk)",
      ],
      cadence: "Live during streaming until response completes",
      consume:
        "Watch which tools activate. If you asked about flow but only get_spx_structure runs, rephrase to mention options flow explicitly. Unexpected tools may mean intent router interpreted your question broadly.",
    },
    {
      name: "Tool trace chips (per message)",
      location: "Footer of each assistant bubble",
      purpose: "Audit trail of live data sources consulted for that answer.",
      shows: [
        "Human-readable labels: live desk feed, SPX desk, confluence engine, GEX map, HELIX flow tape, Night Hawk, etc.",
        "Maps to ~70+ backend tools in LARGO_TOOL_DEFS grouped by SPX desk, flow, vol/macro, news, platform",
      ],
      cadence: "Set once per completed response",
      consume:
        "If chips include get_nighthawk_edition, cross-check PlaybookBoard. Missing expected tools is a signal to ask a narrower follow-up. Never treat an answer about live levels as current without a structure or GEX tool in the trace.",
      tip: "Full tool catalog lives in platform routing — UI shows a curated label subset for readability.",
    },
  ],
  howItWorks: {
    paragraphs: [
      "Each response routes through intent detection, selects tools from LARGO_TOOL_DEFS, executes live fetches, and streams synthesized prose. Session hydrate restores thread from sessionStorage on mount.",
    ],
    features: [
      { title: "Grounded responses", body: "Live tool calls prevent stale training-data hallucinations on levels and regime." },
      { title: "Streaming", body: "queryLargoStream delivers tokens incrementally — thinking state shows progress." },
      { title: "Session memory", body: "Conversations persist per browser session for multi-step analysis." },
      { title: "Kill-switch aware", body: "Spend limits protect platform-wide AI budget — rare 503 during outages." },
    ],
  },
  usage: {
    intro: "Use after reading Slayer header and matrix. Largo interprets; it does not replace execution discipline.",
    steps: [
      { title: "Ask specific questions", body: '"Where is gamma flip vs spot and what changed since open?" beats "Should I buy?"' },
      { title: "Read tool chips", body: "Confirm get_spx_structure or get_gex ran before acting on levels." },
      { title: "Cross-check Slayer", body: "Compare Largo output to active play card and walls." },
      { title: "Use after ambiguous flow", body: "When HELIX and structure disagree, Largo can synthesize with get_flow_tape." },
      { title: "Follow up", body: "Use Ask next chips to stress-test invalidation." },
    ],
  },
  crossLinks: [
    CROSS.spx("Shares live desk state Largo references via get_spx_structure and get_spx_play."),
    CROSS.helix("Flow context tool calls mirror HELIX tape themes."),
    CROSS.thermal("get_gex and positioning tools return surface detail beyond scalar walls."),
    CROSS.hawk("get_nighthawk_edition pulls Evening Edition context."),
  ],
  dos: [
    "Ask falsifiable questions about current data.",
    "Use for thesis stress-tests and regime explanation.",
    "Read tool chips on every answer.",
    "Prefer follow-up chips for depth.",
  ],
  donts: [
    "Don't use for entry timing alone.",
    "Don't treat output as trade advice or financial guidance.",
    "Don't assume off-hours answers use live RTH data — Largo will note staleness.",
    "Don't spam parallel questions while busy — wait for stream completion.",
  ],
  faq: [
    { q: "Does Largo work off-hours?", a: "Yes, but data may be last RTH snapshot — check tool chips and any staleness notes in the answer." },
    { q: "Largo vs SPX commentary rail?", a: "Rail pushes periodic desk narrative; Largo pulls on your questions with explicit tool traces." },
  ],
});
