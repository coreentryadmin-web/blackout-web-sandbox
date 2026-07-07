import type { LearnGuide } from "@/lib/learn/types";
import { PRIMARY_NAV } from "@/lib/learn/site-map";
import { CROSS } from "@/lib/learn/guides/shared";

export const gettingStartedGuide: LearnGuide = {
  slug: "getting-started",
  chapter: 1,
  title: "Getting Started",
  description:
    "Your orientation to BlackOut — membership, navigation, the daily workflow, and how every desk shares the same dealer-intelligence pipeline.",
  kicker: "Chapter 1 · Foundation",
  sections: [
    {
      type: "prose",
      id: "overview",
      title: "Platform overview",
      paragraphs: [
        "BlackOut is a professional SPX and 0DTE options intelligence platform built around dealer positioning — gamma exposure, institutional flow, and structural market mechanics — not retail sentiment.",
        "Every surface is part of one pipeline. Raw chain and flow data is computed into GEX surfaces, scored by the play engine, and distributed across desks that cross-reference the same levels in real time.",
        "This academy follows a textbook sequence: start here, then read each tool chapter in order. Every chapter links to live routes in the app and to related guides.",
      ],
    },
    {
      type: "stats",
      id: "at-a-glance",
      title: "At a glance",
      items: [
        { label: "Primary instrument", value: "SPX / 0DTE", sub: "PM-settled index options" },
        { label: "Intelligence stack", value: "GEX + Flow + AI", sub: "Shared across all desks" },
        { label: "Cadence", value: "Real-time RTH", sub: "WebSocket + scheduled crons" },
      ],
    },
    {
      type: "site-nav",
      id: "navigation",
      title: "Navigate the website",
      intro:
        "Use the top navigation to jump between live desks. Learn (this section) documents each route. Account and Upgrade manage membership.",
      items: PRIMARY_NAV,
    },
    {
      type: "pipeline",
      id: "pipeline",
      title: "How data flows",
      intro: "Understanding the pipeline explains why a GEX wall in Thermal is the same wall on SPX Slayer and in Largo answers.",
      layers: [
        {
          layer: "Ingestion",
          accent: "cyan",
          items: ["Live options chain", "Institutional flow feed", "Macro & news context"],
        },
        {
          layer: "Computation",
          accent: "sky",
          items: ["GEX / VEX / DEX / CHARM", "Flow scoring", "SPX play engine"],
        },
        {
          layer: "Surfaces",
          accent: "indigo",
          items: ["SPX Slayer", "HELIX", "Thermal", "Night Hawk", "Largo"],
        },
      ],
    },
    {
      type: "steps",
      id: "account",
      title: "Account setup",
      intro: "Membership is provisioned automatically after checkout. No API keys required on your side.",
      steps: [
        {
          title: "Subscribe",
          body: "Complete checkout on the Upgrade page. Premium access activates when payment confirms.",
        },
        {
          title: "Sign in",
          body: "Use the same email as your subscription. Authentication is handled by Clerk — social login supported.",
        },
        {
          title: "Verify access",
          body: "Open SPX Slayer (/dashboard) or HELIX (/flows). Live data confirms entitlements are active.",
        },
        {
          title: "Bookmark Learn",
          body: "Return to /learn anytime. Chapters are ordered for a linear read or jump to any tool guide.",
        },
      ],
    },
    {
      type: "timeline",
      id: "workflow",
      title: "Suggested daily workflow",
      intro: "Each phase uses a specific desk. Cross-link chapters as you progress through the day.",
      items: [
        {
          phase: "Evening",
          time: "4:30 – 8:00 PM ET",
          toolSlug: "night-hawk",
          action: "Read the Evening Edition. Set bias and key GEX levels before the open.",
        },
        {
          phase: "RTH open",
          time: "9:30 AM ET",
          toolSlug: "spx-slayer",
          action: "Open SPX Slayer as your primary desk. Monitor walls, flip, and engine verdicts.",
        },
        {
          phase: "Intraday",
          time: "Continuous",
          toolSlug: "helix-flows",
          action: "Run HELIX alongside the desk. Confirm or challenge direction with institutional prints.",
        },
        {
          phase: "Analysis",
          time: "On demand",
          toolSlug: "largo-ai",
          action: "Query Largo for structured reads on live GEX and flow — not generic commentary.",
        },
        {
          phase: "Management",
          time: "Continuous",
          toolSlug: "night-hawk",
          action: "Check 0DTE Command on /nighthawk for fresh always-on scanner finds.",
        },
      ],
    },
    {
      type: "tool-map",
      id: "tools",
      title: "Tool map",
      intro:
        "Every chapter below includes a Panel reference section — a field guide to each live UI region, its refresh cadence, and how to consume it during RTH. Read overview and layout first, then panels, then workflow.",
      slugs: [
        "spx-slayer",
        "helix-flows",
        "largo-ai",
        "night-hawk",
        "heat-maps",
        "glossary",
      ],
    },
    {
      type: "dos-donts",
      id: "dos-donts",
      title: "Platform principles",
      dos: [
        "Layer tools — Night Hawk for bias, Slayer for execution, HELIX for confirmation, Thermal for structure.",
        "Cross-reference GEX walls across desks before sizing at a level.",
        "Use Largo for hard questions about live data, not for reassurance.",
      ],
      donts: [
        "Don't treat any single desk as the full picture.",
        "Don't trade against a SCANNING engine state by guessing the next verdict.",
        "Don't assume GEX walls are static — they reprice with open interest.",
        "Don't ignore timestamps on live data during fast markets.",
        "Don't confuse educational content with personalized advice.",
      ],
    },
    {
      type: "cross-links",
      id: "next-chapters",
      title: "Continue reading",
      links: [
        CROSS.spx("Chapter 2 — the flagship RTH desk and play engine."),
        CROSS.helix("Chapter 3 — institutional flow tape."),
        CROSS.thermal("Chapter 6 — visual dealer surfaces."),
      ],
    },
    {
      type: "faq",
      id: "faq",
      title: "FAQ",
      items: [
        {
          q: "How current is GEX data?",
          a: "Recomputed from the live chain during RTH. Timestamps appear on SPX Slayer and Thermal. Off-hours reflects the latest snapshot.",
        },
        {
          q: "Does BlackOut support non-SPX underlyings?",
          a: "The core engine is SPX / 0DTE-first. HELIX may show related tickers for situational awareness, and 0DTE Command (on Night Hawk) scans the broader market for single-name 0DTE setups.",
        },
        {
          q: "Where do I manage billing?",
          a: "Account (/account) and Upgrade (/upgrade). Membership syncs to your Clerk profile automatically.",
        },
      ],
    },
    {
      type: "cta",
      id: "start-desk",
      title: "Ready for the open?",
      body: "When RTH begins, open SPX Slayer and follow Chapter 2 for the full desk workflow.",
      toolSlug: "spx-slayer",
      ctaLabel: "Open SPX Slayer",
    },
  ],
};
