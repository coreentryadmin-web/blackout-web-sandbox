export const dynamic = "force-static";

import Link from "next/link";
import type { Metadata } from "next";
import { LearnDoc } from "@/components/learn/LearnDoc";

export const metadata: Metadata = {
  title: "Getting Started | BlackOut Trading",
  description:
    "Platform overview for BlackOut Trading — how SPX Slayer, HELIX, Largo, Night Hawk, Heat Maps, Night's Watch, and BlackOut Grid connect into a single institutional-grade workflow.",
};

const sections = [
  { id: "overview", label: "Platform Overview" },
  { id: "how-it-works", label: "How It Works" },
  { id: "account-setup", label: "Account Setup" },
  { id: "workflow", label: "Suggested Workflow" },
  { id: "tools", label: "Tool Map" },
  { id: "dos-donts", label: "Dos & Don'ts" },
  { id: "cross-references", label: "All Tools" },
  { id: "faq", label: "FAQ" },
  { id: "glossary", label: "Glossary" },
];

const tools = [
  {
    name: "Night Hawk",
    href: "/learn/night-hawk",
    timing: "Evening — before market close / after hours",
    role: "Scans the options chain each evening and publishes a curated playbook of high-conviction SPX setups for the following session. Your pre-market briefing.",
  },
  {
    name: "SPX Slayer",
    href: "/learn/spx-slayer",
    timing: "Market open through close",
    role: "The flagship real-time desk. Live GEX walls, dealer positioning, technicals, and AI-scored setups converge here. Your primary desk for the trading day.",
  },
  {
    name: "HELIX Options Flow",
    href: "/learn/helix-flows",
    timing: "Continuous (RTH + extended)",
    role: "Live tape of institutional options flow sourced from our flow intelligence engine. Filters for size, premium, and unusual positioning. Confirms or challenges your thesis in real time.",
  },
  {
    name: "Largo AI Terminal",
    href: "/learn/largo-ai",
    timing: "On demand",
    role: "AI-powered analysis desk. Ask structured market questions, get grounded answers that pull from live GEX, flow, and positioning data — not generic commentary.",
  },
  {
    name: "Heat Maps",
    href: "/learn/heat-maps",
    timing: "Real-time (RTH)",
    role: "Visual GEX, VEX, DEX, and CHARM surfaces. Shows exactly where dealer hedging pressure concentrates across strikes and expiries.",
  },
  {
    name: "Night's Watch",
    href: "/learn/nights-watch",
    timing: "Continuous",
    role: "Personal position manager with live P&L, Greeks tracking, and exit alerts. Your trade journal and risk dashboard, wired to live options data.",
  },
  {
    name: "BlackOut Grid",
    href: "/learn/blackout-grid",
    timing: "Continuous",
    role: "Market intelligence hub. News, dark pool prints, earnings calendars, analyst revisions, congressional trades, and economic events — all in one structured feed.",
  },
];

export default function GettingStartedPage() {
  return (
    <LearnDoc
      title="Getting Started"
      description="A complete orientation to the BlackOut platform — how each tool works, how they connect, and the workflow that puts institutional dealer intelligence at the center of every trade decision."
      sections={sections}
    >
            {/* Overview */}
            <section id="overview">
              <h2 className="text-2xl font-semibold text-white mb-6 pb-3 border-b border-white/10">
                Platform Overview
              </h2>
              <div className="space-y-4 text-secondary leading-relaxed">
                <p>
                  BlackOut Trading is a professional-grade SPX and 0DTE options
                  intelligence platform built around one conviction: the only
                  edge that compounds is seeing what institutional dealers are
                  positioned for — not what retail sentiment says.
                </p>
                <p>
                  Every surface on the platform is designed to surface dealer
                  hedging flows, institutional positioning, and structural market
                  mechanics in real time. The toolset is not a collection of
                  independent indicators. It is a pipeline — data enters raw
                  from the options chain, gets processed through GEX and flow
                  analytics, and emerges as actionable intelligence on your
                  screen.
                </p>
                <p>
                  The platform is built for traders who already understand
                  options mechanics. It does not teach you how to trade. It
                  gives you the institutional-quality data infrastructure to
                  trade what you already know more precisely.
                </p>
              </div>

              <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  {
                    label: "Primary Underlying",
                    value: "SPX / 0DTE",
                    sub: "S&P 500 index options",
                  },
                  {
                    label: "Data Sources",
                    value: "3 institutional feeds",
                    sub: "Options chain, flow intelligence, AI engine",
                  },
                  {
                    label: "Update Cadence",
                    value: "Real-time",
                    sub: "WebSocket + cron hybrid",
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-lg border border-white/10 bg-white/[0.03] p-5"
                  >
                    <p className="text-xs text-cyan-400 font-mono uppercase tracking-wider mb-1">
                      {stat.label}
                    </p>
                    <p className="text-white font-semibold text-lg">
                      {stat.value}
                    </p>
                    <p className="text-mute text-sm mt-1">{stat.sub}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* How It Works */}
            <section id="how-it-works">
              <h2 className="text-2xl font-semibold text-white mb-6 pb-3 border-b border-white/10">
                How It Works
              </h2>
              <div className="space-y-4 text-secondary leading-relaxed">
                <p>
                  BlackOut ingests raw options chain data from{" "}
                  <span className="text-cyan-400 font-medium">our market data engine</span>{" "}
                  computing Gamma
                  Exposure (GEX), Vanna Exposure (VEX), Delta Exposure (DEX),
                  and Charm across every live strike and expiry for SPX. This
                  computation runs on a continuous cycle during regular trading
                  hours and is cached for low-latency delivery to the front end.
                </p>
                <p>
                  Institutional options flow is ingested from{" "}
                  <span className="text-cyan-400 font-medium">
                    our flow intelligence engine
                  </span>
                  , filtering for unusual size, premium thresholds, and dark
                  pool prints. This tape drives the HELIX flow desk and feeds
                  the SPX Slayer signal engine.
                </p>
                <p>
                  AI analysis is powered by{" "}
                  <span className="text-cyan-400 font-medium">
                    our AI engine
                  </span>{" "}
                  through the Largo terminal, which is wired directly to live
                  GEX and flow data rather than operating on static training
                  knowledge. Largo can interpret current dealer positioning,
                  summarize flow context, and reason about structure in plain
                  language.
                </p>
                <p>
                  The platform routes all of this into specialized surfaces: a
                  real-time trading desk (SPX Slayer), a visual positioning map
                  (Heat Maps), an evening scanner (Night Hawk), a position
                  tracker (Night&apos;s Watch), and a macro intelligence feed
                  (BlackOut Grid). These are not siloed. A GEX wall identified
                  in Heat Maps is the same wall displayed in SPX Slayer and
                  referenced in Largo analysis.
                </p>
              </div>

              {/* Data flow diagram */}
              <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.03] p-6">
                <p className="text-xs text-cyan-400 font-mono uppercase tracking-wider mb-5">
                  Data Pipeline
                </p>
                <div className="space-y-3">
                  {[
                    {
                      layer: "Ingestion",
                      color: "border-cyan-500",
                      items: [
                        "Live Options Chain",
                        "Institutional Flow Feed",
                        "AI Engine",
                      ],
                    },
                    {
                      layer: "Computation",
                      color: "border-sky-500",
                      items: [
                        "GEX / VEX / DEX / CHARM surfaces",
                        "Flow filtering & scoring",
                        "SPX setup engine",
                      ],
                    },
                    {
                      layer: "Intelligence Surfaces",
                      color: "border-indigo-400",
                      items: [
                        "SPX Slayer desk",
                        "HELIX tape",
                        "Heat Maps",
                        "Night Hawk edition",
                        "Largo AI",
                        "Night's Watch",
                        "BlackOut Grid",
                      ],
                    },
                  ].map((row) => (
                    <div key={row.layer} className="flex gap-4 items-start">
                      <div
                        className={`w-28 shrink-0 rounded border-l-2 ${row.color} pl-3 py-1`}
                      >
                        <span className="text-xs text-mute font-mono">
                          {row.layer}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {row.items.map((item) => (
                          <span
                            key={item}
                            className="text-xs bg-white/[0.06] text-secondary rounded px-2 py-1 border border-white/12"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Account Setup */}
            <section id="account-setup">
              <h2 className="text-2xl font-semibold text-white mb-6 pb-3 border-b border-white/10">
                Account Setup
              </h2>
              <div className="space-y-4 text-secondary leading-relaxed">
                <p>
                  BlackOut Trading membership is provisioned through our subscription platform. Once your
                  subscription is active, your account is automatically
                  authorized — no additional API keys or configuration is
                  required on your end. All data feeds are platform-managed.
                </p>
              </div>
              <ol className="mt-6 space-y-4">
                {[
                  {
                    step: "1",
                    title: "Subscribe",
                    body: "Complete checkout at the BlackOut Trading membership page. Membership is $199/month with immediate platform access upon payment confirmation.",
                  },
                  {
                    step: "2",
                    title: "Sign in with your account",
                    body: "Use the email address associated with your subscription. Authentication is handled via our auth system — no separate password setup required if you use a social login.",
                  },
                  {
                    step: "3",
                    title: "Verify platform access",
                    body: "Navigate to SPX Slayer or HELIX from the main menu. If data loads, your entitlements are active. If you see a paywall, ensure the email matches your membership subscription.",
                  },
                  {
                    step: "4",
                    title: "Review Night Hawk setup",
                    body: "Night Hawk publishes its Evening Edition on a scheduled cadence. Bookmark the Night Hawk page and check it each evening after 4:30 PM ET for the next session's playbook.",
                  },
                ].map((item) => (
                  <li
                    key={item.step}
                    className="flex gap-4 rounded-lg border border-white/10 bg-white/[0.03] p-5"
                  >
                    <span className="shrink-0 w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-mono text-sm font-semibold">
                      {item.step}
                    </span>
                    <div>
                      <p className="text-white font-medium mb-1">{item.title}</p>
                      <p className="text-mute text-sm leading-relaxed">
                        {item.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {/* Suggested Workflow */}
            <section id="workflow">
              <h2 className="text-2xl font-semibold text-white mb-6 pb-3 border-b border-white/10">
                Suggested Workflow
              </h2>
              <p className="text-secondary mb-8 leading-relaxed">
                The platform is designed around a repeatable daily rhythm. Each
                tool occupies a specific phase of the trading day. Used in
                sequence, they provide context layering — each surface confirms,
                qualifies, or challenges the signals from the previous one.
              </p>
              <div className="space-y-4">
                {[
                  {
                    phase: "Evening",
                    time: "4:30 PM – 8:00 PM ET",
                    tool: "Night Hawk",
                    href: "/learn/night-hawk",
                    action:
                      "Read the Evening Edition. Review the curated setups, key GEX levels, and flow context for the next session. Set your bias and watchlist before the open.",
                  },
                  {
                    phase: "Pre-Market",
                    time: "8:00 AM – 9:30 AM ET",
                    tool: "BlackOut Grid",
                    href: "/learn/blackout-grid",
                    action:
                      "Scan overnight news, economic events, and pre-market flow. Identify any catalyst that would invalidate the Night Hawk thesis before you size in.",
                  },
                  {
                    phase: "Market Open",
                    time: "9:30 AM ET",
                    tool: "SPX Slayer",
                    href: "/learn/spx-slayer",
                    action:
                      "Open SPX Slayer as your primary desk. Monitor live GEX walls, setup scores, and price action relative to key dealer levels. This is your primary desk.",
                  },
                  {
                    phase: "Intraday",
                    time: "Continuous",
                    tool: "HELIX + Heat Maps",
                    href: "/learn/helix-flows",
                    action:
                      "Run HELIX alongside SPX Slayer. Large, unusual flow prints often precede or confirm directional moves. Cross-reference with Heat Maps to see where dealer hedging is concentrated.",
                  },
                  {
                    phase: "Analysis",
                    time: "On demand",
                    tool: "Largo AI",
                    href: "/learn/largo-ai",
                    action:
                      "When context is ambiguous or you want a structured read on current positioning, query Largo. It interprets live data — not generic market commentary.",
                  },
                  {
                    phase: "Trade Management",
                    time: "Continuous",
                    tool: "Night's Watch",
                    href: "/learn/nights-watch",
                    action:
                      "Log positions in Night's Watch. Monitor live P&L, Greeks, and exit alerts without leaving the platform.",
                  },
                ].map((item) => (
                  <div
                    key={item.phase}
                    className="flex gap-0 rounded-lg border border-white/10 overflow-hidden"
                  >
                    <div className="w-2 shrink-0 bg-cyan-500/30" />
                    <div className="flex flex-col sm:flex-row gap-4 p-5 flex-1">
                      <div className="sm:w-36 shrink-0">
                        <p className="text-cyan-400 font-semibold text-sm">
                          {item.phase}
                        </p>
                        <p className="text-mute text-xs mt-0.5 font-mono">
                          {item.time}
                        </p>
                      </div>
                      <div className="flex-1">
                        <Link
                          href={item.href}
                          className="text-sky-300 font-medium hover:text-cyan-400 transition-colors"
                        >
                          {item.tool} &rarr;
                        </Link>
                        <p className="text-mute text-sm mt-1 leading-relaxed">
                          {item.action}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Tool Map */}
            <section id="tools">
              <h2 className="text-2xl font-semibold text-white mb-6 pb-3 border-b border-white/10">
                Tool Map
              </h2>
              <p className="text-secondary mb-8 leading-relaxed">
                Every tool on the platform is described below with its primary
                function, timing, and role in the overall workflow.
              </p>
              <div className="space-y-4">
                {tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="rounded-lg border border-white/10 bg-white/[0.03] p-5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                      <Link
                        href={tool.href}
                        className="text-sky-300 font-semibold hover:text-cyan-400 transition-colors text-lg"
                      >
                        {tool.name}
                      </Link>
                      <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded px-2 py-1 shrink-0">
                        {tool.timing}
                      </span>
                    </div>
                    <p className="text-mute text-sm leading-relaxed">
                      {tool.role}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* Dos & Don'ts */}
            <section id="dos-donts">
              <h2 className="text-2xl font-semibold text-white mb-6 pb-3 border-b border-white/10">
                Dos & Don&apos;ts
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="rounded-lg border border-emerald-800/50 bg-emerald-900/10 p-6">
                  <p className="text-emerald-400 font-semibold uppercase text-xs tracking-wider font-mono mb-4">
                    Do
                  </p>
                  <ul className="space-y-3">
                    {[
                      "Use Night Hawk as pre-session preparation, not as a live trade signal. Context built the evening before is context — validate it at open.",
                      "Cross-reference GEX walls in Heat Maps before entering a position at a level SPX Slayer flags. Visual confirmation reduces false edges.",
                      "Use Largo when you want structured analysis, not when you want reassurance. Ask it hard questions about current data.",
                      "Log every position in Night's Watch immediately. Real-time Greeks and P&L tracking requires position data to be current.",
                      "Check HELIX for flow confirmation when price approaches a key GEX level. Large prints at a wall are structurally meaningful.",
                      "Read the BlackOut Grid's economic calendar before the open. Macro catalysts override GEX mechanics.",
                    ].map((item) => (
                      <li key={item} className="flex gap-3 text-sm text-secondary">
                        <span className="text-emerald-400 mt-0.5 shrink-0">&#10003;</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-6">
                  <p className="text-red-400 font-semibold uppercase text-xs tracking-wider font-mono mb-4">
                    Don&apos;t
                  </p>
                  <ul className="space-y-3">
                    {[
                      "Don't treat GEX walls as guaranteed support/resistance. They are dealer hedge concentration points — they can break, especially into binary events.",
                      "Don't rely on a single tool in isolation. SPX Slayer without HELIX confirmation and Heat Map context is half the picture.",
                      "Don't query Largo for real-time price levels — it is an analysis engine, not a live quote feed. Use SPX Slayer for current price action.",
                      "Don't override a Night Hawk thesis based on early pre-market noise without checking the Grid for a legitimate catalyst.",
                      "Don't ignore the flow tape during high-GEX environments. When dealers are heavily hedged, institutional order flow has outsized impact.",
                      "Don't enter a 0DTE position without confirming that the GEX data on-screen is current. Check the data timestamp on SPX Slayer.",
                    ].map((item) => (
                      <li key={item} className="flex gap-3 text-sm text-secondary">
                        <span className="text-red-400 mt-0.5 shrink-0">&#10007;</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            {/* Cross-References */}
            <section id="cross-references">
              <h2 className="text-2xl font-semibold text-white mb-6 pb-3 border-b border-white/10">
                All Tools
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { name: "SPX Slayer", href: "/learn/spx-slayer", desc: "Real-time SPX options desk" },
                  { name: "HELIX Options Flow", href: "/learn/helix-flows", desc: "Live institutional flow tape" },
                  { name: "Largo AI Terminal", href: "/learn/largo-ai", desc: "AI-powered market analysis" },
                  { name: "Night Hawk", href: "/learn/night-hawk", desc: "Evening SPX play scanner" },
                  { name: "Heat Maps", href: "/learn/heat-maps", desc: "GEX / VEX / DEX / CHARM surfaces" },
                  { name: "Night's Watch", href: "/learn/nights-watch", desc: "Position manager with live P&L" },
                  { name: "BlackOut Grid", href: "/learn/blackout-grid", desc: "Market intelligence dashboard" },
                ].map((tool) => (
                  <Link
                    key={tool.name}
                    href={tool.href}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] hover:border-cyan-700 hover:bg-white/[0.05] transition-all p-4 group"
                  >
                    <div>
                      <p className="text-sky-300 font-medium group-hover:text-cyan-400 transition-colors">
                        {tool.name}
                      </p>
                      <p className="text-mute text-xs mt-0.5">{tool.desc}</p>
                    </div>
                    <span className="text-mute/70 group-hover:text-cyan-400 transition-colors text-lg">
                      &rarr;
                    </span>
                  </Link>
                ))}
              </div>
            </section>

            {/* FAQ */}
            <section id="faq">
              <h2 className="text-2xl font-semibold text-white mb-6 pb-3 border-b border-white/10">
                FAQ
              </h2>
              <div className="space-y-6">
                {[
                  {
                    q: "How current is the GEX data?",
                    a: "GEX surfaces are recomputed from the live options chain during regular trading hours on a continuous cycle. A timestamp is displayed on SPX Slayer and Heat Maps indicating the last computation. Outside RTH, data reflects the most recent available chain snapshot.",
                  },
                  {
                    q: "Does BlackOut support underlyings other than SPX?",
                    a: "The platform is purpose-built for SPX and 0DTE SPX options. The GEX computation, flow scoring, and Night Hawk scanner are all SPX-specific. Broad-market context (sector flows, macro events) appears in BlackOut Grid for supporting situational awareness.",
                  },
                  {
                    q: "What is the difference between Night Hawk and SPX Slayer?",
                    a: "Night Hawk is an asynchronous evening publication — it processes the prior session and publishes a curated playbook for the next one. SPX Slayer is a live, real-time desk intended for active use during market hours. Night Hawk provides context and bias; SPX Slayer provides execution intelligence.",
                  },
                  {
                    q: "Can Largo AI access live market data?",
                    a: "Yes. Largo is wired directly to the platform's live GEX, flow, and positioning data. When you query it during market hours, its responses are grounded in current data, not static training knowledge. It explicitly cites its sources and will tell you when data is stale.",
                  },
                  {
                    q: "How does Night's Watch get my position data?",
                    a: "Night's Watch requires you to log positions manually or via the platform's entry flow. It does not connect to your brokerage account. Once a position is logged, it pulls live options pricing to compute real-time P&L and Greeks.",
                  },
                ].map((item) => (
                  <div key={item.q} className="rounded-lg border border-white/10 bg-white/[0.03] p-6">
                    <p className="text-white font-semibold mb-3">{item.q}</p>
                    <p className="text-mute text-sm leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Glossary */}
            <section id="glossary">
              <h2 className="text-2xl font-semibold text-white mb-6 pb-3 border-b border-white/10">
                Glossary
              </h2>
              <div className="space-y-10">
                {[
                  {
                    category: "Greeks & Dealer Mechanics",
                    terms: [
                      {
                        term: "CHARM",
                        def: "Delta decay with respect to time (dDelta/dTime). Charm measures how a dealer's delta hedge changes as time passes, creating intraday directional pressure as expiry approaches.",
                      },
                      {
                        term: "DEX (Delta Exposure)",
                        def: "The aggregate dollar delta dealers must hedge across all open positions. High DEX indicates large directional hedging pressure in the market.",
                      },
                      {
                        term: "GEX (Gamma Exposure)",
                        def: "The aggregate gamma dealers hold across all open options contracts, measured in dollar terms per 1% move in the underlying. Positive GEX means dealers are short gamma and act as stabilizers; negative GEX means they amplify moves.",
                      },
                      {
                        term: "GEX Wall",
                        def: "A price level where dealer gamma exposure is highly concentrated. At positive-GEX walls, dealers sell into rallies and buy dips, creating magnetic price behavior. At negative-GEX walls, the effect inverts.",
                      },
                      {
                        term: "VEX (Vanna Exposure)",
                        def: "The sensitivity of dealer delta to changes in implied volatility (dDelta/dIV). Rising IV in a high-VEX environment forces dealers to unwind delta hedges, often creating rapid directional moves.",
                      },
                    ],
                  },
                  {
                    category: "Flow & Market Structure",
                    terms: [
                      {
                        term: "Dark Pool",
                        def: "An off-exchange venue where large institutional orders are executed without displaying to the public order book. Dark pool prints visible in HELIX represent significant institutional conviction.",
                      },
                      {
                        term: "Flow Tape",
                        def: "A real-time stream of options transactions filtered for size and unusual characteristics. BlackOut's HELIX tape is sourced from our flow intelligence engine and focuses on prints that suggest institutional positioning rather than retail hedging.",
                      },
                      {
                        term: "Open Interest (OI)",
                        def: "The total number of outstanding options contracts at a given strike and expiry. High OI concentrations inform GEX computation — they represent where dealer hedging obligations are largest.",
                      },
                      {
                        term: "0DTE",
                        def: "Zero days to expiration. SPX 0DTE options expire the same day they are traded. They are highly sensitive to intraday GEX mechanics and form the core of the BlackOut platform's use case.",
                      },
                    ],
                  },
                  {
                    category: "Platform-Specific Terms",
                    terms: [
                      {
                        term: "Evening Edition",
                        def: "Night Hawk's nightly publication, generated from the prior session's options chain and flow data. Published each trading day after market close with structured SPX setups for the following session.",
                      },
                      {
                        term: "Largo",
                        def: "BlackOut's AI analysis terminal, powered by our AI engine. Largo is connected to live GEX and flow data and is designed for structured market reasoning, not general conversation.",
                      },
                      {
                        term: "Night's Watch",
                        def: "The platform's personal options position manager. Tracks live P&L, Greeks, and configurable exit alerts against live options pricing.",
                      },
                      {
                        term: "RTH (Regular Trading Hours)",
                        def: "9:30 AM – 4:00 PM ET. BlackOut's real-time data feeds are most active during RTH. GEX recomputation, HELIX flow, and SPX Slayer signals are all RTH-primary.",
                      },
                      {
                        term: "Setup Score",
                        def: "SPX Slayer's AI-generated rating for a given trade setup. Incorporates GEX context, flow confirmation, technical structure, and volatility environment. Scores range from F through A+.",
                      },
                    ],
                  },
                ].map((group) => (
                  <div key={group.category}>
                    <p className="text-cyan-400 text-xs font-mono uppercase tracking-widest mb-4">
                      {group.category}
                    </p>
                    <div className="space-y-4">
                      {group.terms.map((entry) => (
                        <div
                          key={entry.term}
                          className="flex gap-4 border-b border-white/10/60 pb-4 last:border-0"
                        >
                          <dt className="w-40 shrink-0 text-sky-300 font-medium text-sm pt-0.5">
                            {entry.term}
                          </dt>
                          <dd className="text-mute text-sm leading-relaxed flex-1">
                            {entry.def}
                          </dd>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
    </LearnDoc>
  );
}
